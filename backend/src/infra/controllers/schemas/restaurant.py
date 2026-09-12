from pydantic import BaseModel, Field


class CreateRestaurantRequest(BaseModel):
    """Request body for creating a restaurant.

    The external_place_id/latitude/longitude trio is set when the user picked
    a Place (Mapped restaurant) and absent on manual entry. Creating with an
    external_place_id that's already on SAM returns the existing restaurant
    with 200 instead of creating a duplicate.
    """

    name: str = Field(min_length=1, max_length=255)
    address: str | None = Field(default=None, max_length=500)  # matches the VARCHAR(500) column — 422 here beats a 500 from Postgres
    price_level: int | None = Field(default=None, ge=1, le=4, description="1-4, € to €€€€")
    cuisines: list[str] = Field(default_factory=list)
    external_place_id: str | None = Field(default=None, max_length=255, description="Geoapify place id when created from a picked Place")
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class UpdateRestaurantRequest(BaseModel):
    """Request body for updating a restaurant's shared facts. Any authenticated user may call this — see ADR 0002.

    Coordinates are editable facts too (pin drop / pin correction), but only
    when BOTH are sent — omitting them means "leave the stored ones alone",
    so older clients can't accidentally wipe a location. The mapping identity
    (external_place_id) is never editable.
    """

    name: str = Field(min_length=1, max_length=255)
    address: str | None = Field(default=None, max_length=500)  # matches the VARCHAR(500) column — 422 here beats a 500 from Postgres
    price_level: int | None = Field(default=None, ge=1, le=4, description="1-4, € to €€€€")
    cuisines: list[str] = Field(default_factory=list)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
