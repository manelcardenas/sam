from pydantic import BaseModel


# Request schemas for API endpoints
class CreateRecipeRequest(BaseModel):
    """Request body for creating a new recipe."""

    title: str
    description: str
    ingredients: list[str]


class UpdateRecipeRequest(BaseModel):
    """Request body for updating an existing recipe."""

    title: str
    description: str
    ingredients: list[str]
