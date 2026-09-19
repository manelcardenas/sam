import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AssignDishRequest(BaseModel):
    """Put a dish in a slot, alongside whatever is already there.

    **There is no entry id.** The dish *within* the slot is the identity — the
    recipe when there is one, the name when there is not — so sending the same
    dish again changes its headcount and sending a different one adds it. That
    keeps the client from having to track ids for rows it just created, and it
    makes the call idempotent in the way people actually repeat it.

    `dish_name` travels with `recipe_id` rather than being looked up, because the
    plan stores a snapshot (§8.3a) — deleting a recipe must not rewrite what you
    ate last August. The server still re-reads the name from the recipe when the
    id resolves; the field is what keeps the row readable when it stops resolving.
    """

    # `datetime.date`, not a bare `date` import: a field *named* `date` shadows
    # that name in the class namespace, and Pydantic then fails to resolve its own
    # annotation ("field name clashing with a type annotation").
    date: datetime.date = Field(description="Any day inside the plan's week; the plan itself is keyed to that week's Saturday")
    meal: Literal["lunch", "dinner"]
    recipe_id: str | None = Field(default=None, description="Null for a dish typed straight into the planner")
    dish_name: str = Field(min_length=1, max_length=255)
    servings: int = Field(ge=1, le=99, description="Headcount for this dish, which may differ from the recipe's own")


class ListLineRequest(BaseModel):
    """One confirmed line from the per-dish ingredient popup.

    `amount` is already scaled to the slot's headcount and already reflects what
    the user left ticked. The server does not recompute it — doing so would
    overrule the unticking, which is the popup's whole purpose (§4.6).
    """

    name: str = Field(min_length=1, max_length=255)
    amount: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=50)


class AddToListRequest(BaseModel):
    """Lines to merge into the list, optionally attributed to one dish."""

    entry_id: str | None = Field(default=None, description="Null for a hand-added extra — fruit, yoghurt, the things no dish implies")
    dish_name: str | None = Field(default=None, max_length=255, description="Shown in the per-line breakdown; required when entry_id is given")
    items: list[ListLineRequest] = Field(min_length=1)

    @model_validator(mode="after")
    def _attribution_is_all_or_nothing(self) -> "AddToListRequest":
        # A source with no dish name renders as an empty breakdown row, which
        # reads as a bug rather than as a manual extra.
        if self.entry_id and not self.dish_name:
            raise ValueError("dish_name is required when entry_id is given")
        return self


class ResyncEntryListRequest(BaseModel):
    """This dish's list lines, as they should be after a headcount change.

    `items` may be **empty**, which is the honest way to say "this dish now
    contributes nothing" — you unticked everything on the re-confirm. That is
    why there is no `min_length` here, unlike `AddToListRequest` where an empty
    body could only ever be a client bug.
    """

    dish_name: str = Field(max_length=255, description="Shown in the per-line breakdown, snapshotted like every other write")
    items: list[ListLineRequest] = Field(default_factory=list)


class AddToWeekListRequest(BaseModel):
    """Hand-typed extras for a week that may not have been planned yet.

    Keyed by a *day* rather than a plan id, because the plan may not exist: this
    is the path that lets you put sugar on next week's list in the middle of
    this one, without inventing a meal to hang it on. The server resolves the
    day to its Saturday and creates the week on first use.
    """

    day: datetime.date = Field(description="Any day inside the week the lines belong to")
    items: list[ListLineRequest] = Field(min_length=1)


class TickItemRequest(BaseModel):
    is_checked: bool


class AdvancePlanRequest(BaseModel):
    """Take the plan's one available transition.

    `from_status` is the client stating what it believes it is leaving. A
    mismatch is a 409, so two taps on a slow connection cannot close the calendar
    *and* the list — which is unrecoverable in v1, where transitions are one-way.
    """

    from_status: Literal["planning", "calendar_closed"]
    carry_over: list[str] = Field(
        default_factory=list,
        max_length=200,
        description="Ids of unticked lines to copy onto next week's list. Only valid when closing the list — nothing has been shopped for yet when the calendar closes.",
    )
