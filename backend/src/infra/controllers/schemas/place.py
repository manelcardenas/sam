from pydantic import BaseModel


class ReverseGeocodeResponse(BaseModel):
    """Address at a pin-dropped point — display/prefill only, never stored server-side."""

    address: str | None
