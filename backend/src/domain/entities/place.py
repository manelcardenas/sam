from pydantic import BaseModel, Field


class Area(BaseModel):
    """A city/neighbourhood/address used to anchor a Place search somewhere
    else. Ephemeral like Place — never stored."""

    name: str  # short name, e.g. "Zaragoza"
    label: str  # disambiguated display label, e.g. "Zaragoza, Aragon, Spain"
    latitude: float
    longitude: float


class Place(BaseModel):
    """The external map provider's record of a physical venue, shown as a
    search result when adding a Restaurant. Never persisted — picking one
    creates (or links to) a Mapped Restaurant. See CONTEXT.md and docs/adr/0003."""

    external_place_id: str
    name: str
    address: str | None = None
    latitude: float
    longitude: float
    cuisines: list[str] = Field(default_factory=list)  # raw provider cuisine tags, lowercase; matched against the curated vocabulary client-side
    distance_m: int | None = None  # metres from the search bias point, when the provider reports it
