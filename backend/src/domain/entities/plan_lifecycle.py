import enum


class PlanStatus(enum.StrEnum):
    """Whether a week can still be changed.

    **There is no workflow any more** (meal-planner-plan §8.14). Weeks used to be
    walked through `planning → calendar_closed → list_closed` by two buttons, and
    the second one was the only thing that carried unbought lines forward — so a
    Saturday nobody pressed it stranded the sugar in a week nobody would open
    again. Unbought lines now follow you on their own (`CarryForward`), and a new
    week is always `planning`.

    `LIST_CLOSED` stays for the weeks that were archived under the old flow. Their
    leftovers were already dealt with — offered to the next week, kept or let go
    by a person — so they stay read-only and `CarryForward` skips them; reopening
    them would bring back lines somebody deliberately dropped.

    `calendar_closed` is gone from this enum: the migration that removed the
    button set every such week back to `planning`. The label survives in the
    Postgres type (`plan_status_enum`), because dropping an enum value there means
    rebuilding the type, and nothing can write it any more.
    """

    PLANNING = "planning"
    LIST_CLOSED = "list_closed"


class PlanAction(enum.StrEnum):
    """What someone is trying to do, for the permission table below."""

    EDIT_CALENDAR = "edit_calendar"
    EDIT_LIST = "edit_list"
    TICK = "tick"


# What each state permits. Two rows: a week is open, or it is a legacy archive.
_PERMITTED: dict[PlanStatus, frozenset[PlanAction]] = {
    PlanStatus.PLANNING: frozenset({PlanAction.EDIT_CALENDAR, PlanAction.EDIT_LIST, PlanAction.TICK}),
    PlanStatus.LIST_CLOSED: frozenset(),
}


class PlanStateError(Exception):
    """A write the plan's current state forbids.

    Deliberately distinct from "not yours": the controller maps this to 409 and
    ownership failures to 403, because a client that cannot tell them apart tells
    the user they lack permission when in fact the week is archived.
    """


def permits(status: PlanStatus, action: PlanAction) -> bool:
    return action in _PERMITTED[status]


def require(status: PlanStatus, action: PlanAction) -> None:
    """Guard for use cases. Raises rather than returning a bool, so a caller
    cannot forget to check the result."""
    if not permits(status, action):
        raise PlanStateError(f"Cannot {action.value} while the plan is {status.value}")
