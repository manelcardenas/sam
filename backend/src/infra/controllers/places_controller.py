from fastapi import APIRouter, Depends, HTTPException, Query, status

from src.app.use_cases import NearbyPlaces, SearchPlaces
from src.domain.entities import Place
from src.domain.ports import PlacesProvider, PlacesProviderError
from src.infra.security import TokenPayload, get_current_user


class PlacesController:
    """Proxies Place search to the external provider (see docs/adr/0003).

    Auth is required like everywhere else — it doubles as the guard on the
    Geoapify quota, since only logged-in users can trigger provider calls.
    """

    def __init__(self, places_provider: PlacesProvider, router: APIRouter) -> None:
        self.places_provider = places_provider
        self.router = router
        self._register_routes()

    def _register_routes(self) -> None:
        self.router.add_api_route(
            "/places/search",
            self.search_places,
            methods=["GET"],
            response_model=list[Place],
            dependencies=[Depends(get_current_user)],
            summary="Search Places",
            description="Autocomplete-style Place search via the external provider, optionally biased towards ?lat=&lon=",
            tags=["Places"],
        )

        self.router.add_api_route(
            "/places/nearby",
            self.nearby_places,
            methods=["GET"],
            response_model=list[Place],
            dependencies=[Depends(get_current_user)],
            summary="Nearby Places",
            description="Restaurants around ?lat=&lon=, nearest first",
            tags=["Places"],
        )

    def search_places(
        self,
        q: str = Query(min_length=2, max_length=255),
        lat: float | None = Query(default=None, ge=-90, le=90),
        lon: float | None = Query(default=None, ge=-180, le=180),
        _current_user: TokenPayload = Depends(get_current_user),
    ) -> list[Place]:
        """Search Places by text. Results are ephemeral — never stored by SAM."""
        use_case = SearchPlaces(self.places_provider)
        try:
            return use_case.execute(q, lat, lon)
        except PlacesProviderError as e:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e

    def nearby_places(
        self,
        lat: float = Query(ge=-90, le=90),
        lon: float = Query(ge=-180, le=180),
        radius_m: int = Query(default=500, ge=50, le=5000),
        _current_user: TokenPayload = Depends(get_current_user),
    ) -> list[Place]:
        """List Places around a point — the '📍 near me' picker."""
        use_case = NearbyPlaces(self.places_provider)
        try:
            return use_case.execute(lat, lon, radius_m)
        except PlacesProviderError as e:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)) from e
