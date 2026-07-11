import uuid

from pydantic import BaseModel, Field


class Cuisine(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
