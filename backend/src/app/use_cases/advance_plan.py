from datetime import timedelta

from src.app.use_cases.plan_access import owned_plan, plan_for_week
from src.domain.entities import (
    DAYS_IN_WEEK,
    MealPlan,
    PlanAction,
    PlanStateError,
    PlanStatus,
    ShoppingListItem,
    next_status,
    require,
)
from src.domain.ports import MealPlanRepository


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
        plan = owned_plan(self.repository.get_plan(plan_id), owner_id)
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

        target = plan_for_week(self.repository, owner_id, plan.week_start + timedelta(days=DAYS_IN_WEEK))
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
