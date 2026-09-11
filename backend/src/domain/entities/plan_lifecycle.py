import enum


class PlanStatus(enum.StrEnum):
    """The plan's lifecycle.

    Three states, not four: `archived` is what `list_closed` is *called* in the
    UI, and nothing could distinguish them, so it is not a state here.
    """

    PLANNING = "planning"
    CALENDAR_CLOSED = "calendar_closed"
    LIST_CLOSED = "list_closed"


class PlanAction(enum.StrEnum):
    """What someone is trying to do, for the permission table below."""

    EDIT_CALENDAR = "edit_calendar"
    EDIT_LIST = "edit_list"
    TICK = "tick"


# What each state permits.
#
# `CALENDAR_CLOSED` is the *shopping* state, which is why it still allows list
# edits and ticking: §2's flow closes the calendar before you leave the house,
# and the last additions — fruit, yoghurt, the things no dish implies — happen on
# the way out. `LIST_CLOSED` is what you do when the shopping is home.
_PERMITTED: dict[PlanStatus, frozenset[PlanAction]] = {
    PlanStatus.PLANNING: frozenset({PlanAction.EDIT_CALENDAR, PlanAction.EDIT_LIST, PlanAction.TICK}),
    PlanStatus.CALENDAR_CLOSED: frozenset({PlanAction.EDIT_LIST, PlanAction.TICK}),
    PlanStatus.LIST_CLOSED: frozenset(),
}

# One-way, one step at a time (§5.2 defers reopening). Expressed as a map rather
# than as `if` branches so "what comes next" has exactly one answer and the
# terminal state is visibly terminal.
_NEXT: dict[PlanStatus, PlanStatus | None] = {
    PlanStatus.PLANNING: PlanStatus.CALENDAR_CLOSED,
    PlanStatus.CALENDAR_CLOSED: PlanStatus.LIST_CLOSED,
    PlanStatus.LIST_CLOSED: None,
}


class PlanStateError(Exception):
    """A write the plan's current state forbids.

    Deliberately distinct from "not yours": the controller maps this to 409 and
    ownership failures to 403, because a client that cannot tell them apart tells
    the user they lack permission when in fact they closed the week an hour ago.
    """


def permits(status: PlanStatus, action: PlanAction) -> bool:
    return action in _PERMITTED[status]


def require(status: PlanStatus, action: PlanAction) -> None:
    """Guard for use cases. Raises rather than returning a bool, so a caller
    cannot forget to check the result."""
    if not permits(status, action):
        raise PlanStateError(f"Cannot {action.value} while the plan is {status.value}")


def next_status(status: PlanStatus) -> PlanStatus:
    """The one transition available from here. Raises at the terminal state."""
    following = _NEXT[status]
    if following is None:
        raise PlanStateError(f"A plan that is {status.value} has nowhere left to go")
    return following
