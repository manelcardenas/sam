from abc import ABC, abstractmethod

from src.domain.entities import Area, Place


class PlacesProviderError(Exception):
    """The external places provider failed or is not configured."""


class PlacesProvider(ABC):
    """Search the external map provider for Places (restaurants). Results are
    ephemeral — SAM never stores Places, only the Restaurant created from one."""

    @abstractmethod
    def search(self, text: str, bias_lat: float | None = None, bias_lon: float | None = None) -> list[Place]:
        """Autocomplete-style search by name/text, optionally biased towards a location."""

    @abstractmethod
    def nearby(self, lat: float, lon: float, radius_m: int = 500) -> list[Place]:
        """Restaurants around a point, nearest first."""

    @abstractmethod
    def search_areas(self, text: str) -> list[Area]:
        """Autocomplete for cities/addresses, used to anchor a Place search elsewhere."""

    @abstractmethod
    def reverse_geocode(self, lat: float, lon: float) -> str | None:
        """Formatted address at a point (used to prefill after a pin drop), or None if unknown."""
