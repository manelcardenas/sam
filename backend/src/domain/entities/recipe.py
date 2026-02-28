import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field


class Recipe(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str
    ingredients: list[str]
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    food_type: Literal["bebida", "postre", "comida", "aperitivo"]
    # created_by: str  # user ID of the creator
    # prep_time: int  # in minutes
