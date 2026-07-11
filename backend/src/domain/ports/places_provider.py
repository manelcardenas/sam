from abc import ABC, abstractmethod

from src.domain.entities import Place


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
