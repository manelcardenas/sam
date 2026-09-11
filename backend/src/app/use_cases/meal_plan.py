from datetime import date, timedelta

from src.domain.entities import (
    DAYS_IN_WEEK,
    MealPlan,
    PlanAction,
    PlanEntry,
    PlanStateError,
    PlanStatus,
    PlanSummary,
    ShoppingListItem,
    may_read,
    may_write,
    next_status,
    require,
    week_start_for,
)
from src.domain.ports import MealPlanRepository, UserRepository


def _owned(plan: MealPlan | None, user_id: str) -> MealPlan:
    """Resolve a plan the caller may *change*, or raise.

    Sharing is read-and-tick (§4.3), so this stayed owner-only when guests
    arrived — the scenario is that Martina plans the week and you both shop, not
    that you edit her Wednesday.
    """
    if plan is None:
        raise KeyError("Plan not found")
    if not may_write(plan, user_id):
        raise PermissionError("Only the plan's owner can change it")
    return plan


def _visible(plan: MealPlan | None, user_id: str) -> MealPlan:
    """Resolve a plan the caller may *see*, or raise. Owners and guests both."""
    if plan is None:
        raise KeyError("Plan not found")
    if not may_read(plan, user_id):
        raise PermissionError("This plan isn't shared with you")
    return plan


def _plan_for_week(repository: MealPlanRepository, owner_id: str, week_start: date) -> MealPlan:
    """The caller's plan for that week, created if this is the first thing in it.

    Lazy creation is deliberate: an empty plan row for every week somebody merely
    *looked* at would fill the archive (§5.3) with weeks nobody planned.

    **Two callers, and that is the point.** A week can now be started from either
    end — by assigning a dish, or by putting one thing on its list. Sharing the
    helper is what makes "adding sugar starts the week" the same rule as
    "assigning lunch starts the week", rather than two implementations that can
    drift apart.
    """
    plan = repository.get_plan_for_week(owner_id, week_start)
    if plan is None:
        plan = repository.create_plan(owner_id, week_start)
    return _owned(plan, owner_id)


class GetPlanForWeek:
    """The week view. Returns None when nothing has been planned yet.

    None is a normal answer rather than a 404: most weeks have no plan, and the
    planner opens on an empty calendar, not on an error.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, day: date) -> MealPlan | None:
        # Any day of the week resolves to its Saturday, so two clients disagreeing
        # about which day identifies a week can't create two plans for it (§4.4).
        return self.repository.get_plan_for_week(owner_id, week_start_for(day))


class AssignDish:
    """Put a dish in a slot, creating the week's plan if this is the first one.

    See `_plan_for_week` for why creation is lazy.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, entry: PlanEntry) -> tuple[MealPlan, PlanEntry]:
        # The week is derived from the entry's own date rather than passed
        # alongside it. An earlier version took both and guarded that they
        # agreed — which was unreachable, because the only caller sent the same
        # date twice. Deriving it means an entry cannot land in a week that does
        # not contain it, instead of that being a rule someone has to enforce.
        plan = _plan_for_week(self.repository, owner_id, week_start_for(entry.date))
        require(plan.status, PlanAction.EDIT_CALENDAR)
        return plan, self.repository.upsert_entry(plan.id, entry)


class RemoveDish:
    """Clear a slot. Its shopping-list contribution is left alone.

    §4.5's drift rule: the list is a saved artifact, and one that rewrites itself
    while you are holding it in the shop is worse than one that asks. Unpicking
    the ingredients is a second, explicit call the client makes after the user
    says yes — see `DropEntryFromList`.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, plan_id: str, entry_id: str) -> MealPlan:
        plan = _owned(self.repository.get_plan(plan_id), owner_id)
        require(plan.status, PlanAction.EDIT_CALENDAR)
        if not any(e.id == entry_id for e in plan.entries):
            raise KeyError(f"Plan entry {entry_id} not found")
        self.repository.delete_entry(entry_id)
        return plan


class DropEntryFromList:
    """Unpick one dish's contribution after the user confirms it (§4.5)."""

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, plan_id: str, entry_id: str) -> int:
        plan = _owned(self.repository.get_plan(plan_id), owner_id)
        require(plan.status, PlanAction.EDIT_LIST)
        return self.repository.drop_sources_for_entry(entry_id)


class AddToList:
    """Merge confirmed ingredient lines into the list.

    The amounts arrive already scaled to the slot's headcount. That is not the
    server being lazy: ADR 0001 scales by servings for *display*, and this list
    records what the user actually confirmed in the popup — including anything
    they unticked. Recomputing it here would quietly overrule them.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, plan_id: str, items: list[ShoppingListItem]) -> list[ShoppingListItem]:
        plan = _owned(self.repository.get_plan(plan_id), owner_id)
        require(plan.status, PlanAction.EDIT_LIST)
        return self.repository.add_items(plan.id, items)


class AddToWeekList:
    """Put something on a week's list without planning a single dish.

    **The list is not downstream of the calendar.** It is Wednesday, you notice
    the sugar is nearly out, and the thing you want to record has no dish, no
    slot and no recipe behind it — it is just the next shop. Requiring a dish
    first would mean inventing a meal to remember sugar.

    So this takes a *day* rather than a plan id, resolves it to that week's
    Saturday, and creates the plan if it does not exist yet — the same lazy
    creation `AssignDish` uses, which is why both go through `_plan_for_week`.
    A week holding one line and no dishes is a real week: you are going to that
    shop.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, day: date, items: list[ShoppingListItem]) -> MealPlan:
        plan = _plan_for_week(self.repository, owner_id, week_start_for(day))
        require(plan.status, PlanAction.EDIT_LIST)
        self.repository.add_items(plan.id, items)
        return plan


class TickItem:
    """Check or uncheck a line.

    Allowed in every state a plan is still open in, because `calendar_closed` is
    the state you are actually shopping in — and allowed to **guests as well as
    the owner**, which is the one permission sharing grants (§4.3).
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, user_id: str, plan_id: str, item_id: str, is_checked: bool) -> ShoppingListItem:
        # `_visible`, not `_owned` — this is the single write sharing grants, and
        # it is the whole point of sharing: you are in the shop holding someone
        # else's list.
        plan = _visible(self.repository.get_plan(plan_id), user_id)
        require(plan.status, PlanAction.TICK)
        if not any(i.id == item_id for i in plan.items):
            # Checked against *this* plan, so an id from someone else's list
            # can't be ticked by guessing it.
            raise KeyError(f"List item {item_id} not found")
        item = self.repository.set_item_checked(item_id, is_checked)
        if item is None:
            raise KeyError(f"List item {item_id} not found")
        return item


class RemoveListItem:
    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, plan_id: str, item_id: str) -> None:
        plan = _owned(self.repository.get_plan(plan_id), owner_id)
        require(plan.status, PlanAction.EDIT_LIST)
        if not any(i.id == item_id for i in plan.items):
            raise KeyError(f"List item {item_id} not found")
        self.repository.delete_item(item_id)


class AdvancePlan:
    """Take the one transition available: planning → calendar closed → list closed.

    One-way and one step at a time in v1 (§5.2). The caller states which status
    it believes it is leaving, and a mismatch is a 409 rather than a silent
    double-advance — two taps on a slow connection must not close the calendar
    *and* the list.

    Closing the list can carry the things you did not get into next week. That
    belongs *here* rather than in a second call the client makes afterwards,
    because the lines have to be read while the plan is still open: once the
    status lands on `list_closed` the plan forbids every write, and a carry-over
    that failed halfway would leave the week closed and the sugar nowhere.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(
        self,
        owner_id: str,
        plan_id: str,
        expected: PlanStatus | None = None,
        carry_over: list[str] | None = None,
    ) -> MealPlan:
        plan = _owned(self.repository.get_plan(plan_id), owner_id)
        if expected is not None and plan.status is not expected:
            raise PlanStateError(f"The plan is {plan.status.value}, not {expected.value}")
        following = next_status(plan.status)

        if carry_over:
            if following is not PlanStatus.LIST_CLOSED:
                # Carrying over is "what I failed to buy", which only has a
                # meaning at the end of a shop. Closing the *calendar* has not
                # been shopped yet, so every line would qualify.
                raise ValueError("Only closing the list can carry lines over")
            self._carry(plan, owner_id, carry_over)

        advanced = self.repository.set_status(plan.id, following)
        if advanced is None:
            raise KeyError(f"Plan {plan_id} not found")
        return advanced

    def _carry(self, plan: MealPlan, owner_id: str, item_ids: list[str]) -> None:
        """Copy chosen unbought lines onto next week's list.

        An id that is not on this plan is a client bug — or an id borrowed from
        someone else's list — and raises. An id that has since been *ticked* is
        skipped silently instead: that is the other person in the shop finding it
        after all, and it must not stop the week from closing.
        """
        known = {item.id: item for item in plan.items}
        chosen = []
        for item_id in item_ids:
            item = known.get(item_id)
            if item is None:
                raise KeyError(f"List item {item_id} not found")
            if not item.is_checked:
                chosen.append(item)
        if not chosen:
            return

        target = _plan_for_week(self.repository, owner_id, plan.week_start + timedelta(days=DAYS_IN_WEEK))
        require(target.status, PlanAction.EDIT_LIST)
        self.repository.add_items(
            target.id,
            [
                ShoppingListItem(
                    display_name=item.display_name,
                    normalised_name="",  # the repository derives it; see merge_key
                    unit=item.unit,
                    total_amount=item.total_amount,
                    # Carried lines arrive with no sources: the dish that justified
                    # one belongs to the week that just closed, and pointing next
                    # week's list at last week's Wednesday would be a breakdown row
                    # that goes nowhere. It is a thing you still need — by hand now.
                    is_manual=True,
                )
                for item in chosen
            ],
        )


class GetSharedPlans:
    """Weeks other people have shared with the caller.

    Separate from `GetPlanForWeek` rather than folded into it: you can have your
    own plan for a week *and* be a guest on someone else's, and a single endpoint
    returning "the plan" would have to pick one. Picking would be a guess.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, user_id: str, day: date) -> list[MealPlan]:
        return self.repository.list_shared_with(user_id, week_start_for(day))


class SharePlan:
    """Give someone read-and-tick access, by the name you know them by.

    Resolving the display name here rather than exposing a user-search endpoint
    keeps the route budget down (every path costs an API Gateway entry) and
    avoids shipping a way to enumerate accounts. The trade is real and worth
    naming: a 404 still tells the caller that a name is not in use. At six
    accounts who all know each other that is the correct trade; at a thousand it
    would not be.
    """

    def __init__(self, repository: MealPlanRepository, users: UserRepository) -> None:
        self.repository = repository
        self.users = users

    def execute(self, owner_id: str, plan_id: str, display_name: str) -> MealPlan:
        plan = _owned(self.repository.get_plan(plan_id), owner_id)

        guest = self.users.get_by_display_name(display_name)
        if guest is None:
            raise LookupError(f"Nobody here is called {display_name.strip()}")
        if guest.id == owner_id:
            # Sharing with yourself would create a guest row that grants nothing
            # the owner does not already have, and then render you in your own
            # guest list.
            raise ValueError("You already have this plan")

        self.repository.share_plan(plan.id, guest.id)
        refreshed = self.repository.get_plan(plan.id)
        if refreshed is None:  # pragma: no cover — the plan was read a line ago
            raise KeyError(f"Plan {plan_id} not found")
        return refreshed


class UnsharePlan:
    """Take access away. Only the owner can, and the guest keeps nothing."""

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, owner_id: str, plan_id: str, guest_id: str) -> MealPlan:
        plan = _owned(self.repository.get_plan(plan_id), owner_id)
        self.repository.unshare_plan(plan.id, guest_id)
        refreshed = self.repository.get_plan(plan.id)
        if refreshed is None:  # pragma: no cover
            raise KeyError(f"Plan {plan_id} not found")
        return refreshed


class GetPlanArchive:
    """The year view (§5.3): which weeks were planned, and which were given to you.

    This is the payoff for §4.4's real dates and §4.5's saved artifact — neither
    is worth much alone, and together they are the feature. A rolling week
    overwritten every Saturday could not answer "what did we eat in August?" at
    all, and a *computed* list would answer it with today's recipes rather than
    what was actually bought.
    """

    def __init__(self, repository: MealPlanRepository) -> None:
        self.repository = repository

    def execute(self, user_id: str, year: int) -> list[PlanSummary]:
        return self.repository.list_year(user_id, year)
