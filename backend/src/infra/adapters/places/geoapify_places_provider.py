import logging
import os

import httpx

from src.domain.entities import Place
from src.domain.ports import PlacesProvider, PlacesProviderError

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.geoapify.com"
_TIMEOUT_SECONDS = 5.0
_RESULT_LIMIT = 10


def _read_key_from_ssm(param_name: str) -> str:
    """Fetch the Geoapify API key SecureString from SSM Parameter Store.

    Same pattern as the Neon DSN (see infra/db/engine.py): CloudFormation can't
    inject ssm-secure values into env vars, so the Lambda gets the parameter
    NAME and fetches+decrypts it once at cold start. boto3 is provided by the
    Lambda runtime and imported lazily so local runs never need it.
    """
    import boto3

    ssm = boto3.client("ssm")
    response = ssm.get_parameter(Name=param_name, WithDecryption=True)
    return response["Parameter"]["Value"]


def resolve_geoapify_api_key() -> str | None:
    """Resolution order mirrors build_dsn(): raw env var locally (.env), SSM
    parameter name on Lambda. Returns None when neither is configured — the
    provider then fails with PlacesProviderError on use, not at startup."""
    key = os.environ.get("GEOAPIFY_API_KEY")
    if key:
        return key

    param_name = os.environ.get("GEOAPIFY_API_KEY_PARAM")
    if param_name:
        return _read_key_from_ssm(param_name)

    return None


class GeoapifyPlacesProvider(PlacesProvider):
    """Geoapify-backed places search (see docs/adr/0003).

    Uses the geocoding autocomplete endpoint (type=amenity) for text search and
    the Places API (categories=catering) for nearby search. Results are OSM
    data — storing what we copy onto a Restaurant is permitted (ODbL +
    Geoapify terms), unlike Google Places.
    """

    def __init__(self, api_key: str | None) -> None:
        self._api_key = api_key

    def search(self, text: str, bias_lat: float | None = None, bias_lon: float | None = None) -> list[Place]:
        params: dict[str, str | int] = {
            "text": text,
            "type": "amenity",
            "limit": _RESULT_LIMIT,
        }
        if bias_lat is not None and bias_lon is not None:
            params["bias"] = f"proximity:{bias_lon},{bias_lat}"
        features = self._get("/v1/geocode/autocomplete", params)
        return [place for place in map(self._to_place, features) if place is not None]

    def nearby(self, lat: float, lon: float, radius_m: int = 500) -> list[Place]:
        params: dict[str, str | int] = {
            "categories": "catering",
            "filter": f"circle:{lon},{lat},{radius_m}",
            "bias": f"proximity:{lon},{lat}",
            "limit": 2 * _RESULT_LIMIT,
        }
        features = self._get("/v2/places", params)
        return [place for place in map(self._to_place, features) if place is not None]

    def _get(self, path: str, params: dict[str, str | int]) -> list[dict]:
        if not self._api_key:
            raise PlacesProviderError("Geoapify is not configured — set GEOAPIFY_API_KEY (local) or GEOAPIFY_API_KEY_PARAM (Lambda)")
        try:
            response = httpx.get(f"{_BASE_URL}{path}", params={**params, "apiKey": self._api_key}, timeout=_TIMEOUT_SECONDS)
            response.raise_for_status()
        except httpx.HTTPError as e:
            logger.warning("Geoapify request failed: %s", e)
            raise PlacesProviderError("Places search is temporarily unavailable") from e
        return response.json().get("features", [])

    def _to_place(self, feature: dict) -> Place | None:
        props = feature.get("properties", {})
        name = props.get("name")
        place_id = props.get("place_id")
        lat, lon = props.get("lat"), props.get("lon")
        if not name or not place_id or lat is None or lon is None:
            return None  # street addresses / incomplete POIs — not pickable venues

        # Autocomplete (type=amenity) also returns non-food venues; keep only
        # catering.* results there. Nearby already filters server-side, and
        # some autocomplete hits omit categories — keep those rather than lose
        # a real restaurant to missing tags.
        categories = props.get("categories", [])
        if categories and not any(c.startswith("catering") for c in categories):
            return None

        # OSM cuisine tag is a ;-separated folksonomy ("italian;pizza").
        raw_cuisine = props.get("datasource", {}).get("raw", {}).get("cuisine", "")
        cuisines = [token.strip().replace("_", " ").lower() for token in raw_cuisine.split(";") if token.strip()]

        distance = props.get("distance")
        return Place(
            external_place_id=str(place_id),
            name=name,
            address=props.get("formatted"),
            latitude=lat,
            longitude=lon,
            cuisines=cuisines,
            distance_m=round(distance) if distance is not None else None,
        )
