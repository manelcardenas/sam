"""Request and response bodies, one module per controller.

Re-exported here so `from src.infra.controllers.schemas import X` keeps working
wherever the schema actually lives — the split is about where things are written,
not about making every caller track it.
"""

from src.infra.controllers.schemas.kitchen import AnswerInvitationRequest, InviteRequest
from src.infra.controllers.schemas.meal_plan import (
    AddToListRequest,
    AddToWeekListRequest,
    AdvancePlanRequest,
    AssignDishRequest,
    ResyncEntryListRequest,
    TickItemRequest,
)
from src.infra.controllers.schemas.place import ReverseGeocodeResponse
from src.infra.controllers.schemas.recipe import CreateRecipeRequest, UpdateRecipeRequest
from src.infra.controllers.schemas.restaurant import CreateRestaurantRequest, UpdateRestaurantRequest
from src.infra.controllers.schemas.review import CreateReviewRequest
from src.infra.controllers.schemas.user import UpdateMeRequest

__all__ = [
    "AddToListRequest",
    "AddToWeekListRequest",
    "AdvancePlanRequest",
    "AnswerInvitationRequest",
    "AssignDishRequest",
    "CreateRecipeRequest",
    "CreateRestaurantRequest",
    "CreateReviewRequest",
    "InviteRequest",
    "ResyncEntryListRequest",
    "ReverseGeocodeResponse",
    "TickItemRequest",
    "UpdateMeRequest",
    "UpdateRecipeRequest",
    "UpdateRestaurantRequest",
]
