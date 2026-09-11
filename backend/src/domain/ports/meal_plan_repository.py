from abc import ABC, abstractmethod
from datetime import date

from src.domain.entities import MealPlan, PlanEntry, PlanStatus, PlanSummary, ShoppingListItem


class MealPlanRepository(ABC):
    """Persistence for the meal planner.

    The plan is the aggregate: `get_plan` returns the week with its entries, its
    list lines and each line's sources, because every surface that wants one
    wants all of them. The write methods are deliberately fine-grained rather
    than "save this whole plan" — the shopping list accretes one dish at a time
    (§2), and a whole-aggregate save would make two people ticking the same list
    overwrite each other, which Phase D's sharing depends on not happening.
    """

    @abstractmethod
    def get_plan(self, plan_id: str) -> MealPlan | None:
        pass

    @abstractmethod
    def get_plan_for_week(self, owner_id: str, week_start: date) -> MealPlan | None:
        """The owner's plan for that Saturday, or None if they haven't planned it.

        None is a normal answer, not an error: most weeks have no plan yet.
        """

    @abstractmethod
    def create_plan(self, owner_id: str, week_start: date) -> MealPlan:
        pass

    @abstractmethod
    def upsert_entry(self, plan_id: str, entry: PlanEntry) -> PlanEntry:
        """Put a dish in a slot, replacing whatever was there.

        Upsert rather than insert because the slot is the identity — assigning
        Wednesday dinner twice means changing your mind, not creating a second
        Wednesday dinner (one dish per slot in v1, §6).
        """

    @abstractmethod
    def delete_entry(self, entry_id: str) -> None:
        pass

    @abstractmethod
    def add_items(self, plan_id: str, items: list[ShoppingListItem]) -> list[ShoppingListItem]:
        """Merge lines into the list, keeping each line's per-dish breakdown.

        Merging on `(normalised name, unit)` and summing is the whole of §4.6.
        Returns the affected lines *after* merging, so the caller can show the
        running total without re-reading the plan.
        """

    @abstractmethod
    def set_item_checked(self, item_id: str, is_checked: bool) -> ShoppingListItem | None:
        pass

    @abstractmethod
    def delete_item(self, item_id: str) -> None:
        pass

    @abstractmethod
    def drop_sources_for_entry(self, entry_id: str) -> int:
        """Unpick one dish's contribution to the list, returning lines removed.

        §4.5's drift rule: changing Wednesday's dinner after building the list is
        *asked about*, never silently applied — so this is a separate call the
        client makes after the user says yes, not something `delete_entry` does
        on its own. A line left with no sources and no manual flag is removed;
        one that other dishes also contribute to keeps its remaining sources and
        loses only this dish's share.
        """

    @abstractmethod
    def set_status(self, plan_id: str, status: PlanStatus) -> MealPlan | None:
        pass

    @abstractmethod
    def share_plan(self, plan_id: str, user_id: str) -> None:
        """Give someone read-and-tick access. Idempotent — sharing twice with the
        same person is a double tap, not an error."""

    @abstractmethod
    def unshare_plan(self, plan_id: str, user_id: str) -> None:
        """Take it away. Also idempotent, for the same reason."""

    @abstractmethod
    def list_shared_with(self, user_id: str, week_start: date) -> list[MealPlan]:
        """Plans someone else has shared with this user for that week.

        A list rather than an optional: two people can each share their week
        with you, and picking one for you would be a guess.
        """

    @abstractmethod
    def list_year(self, user_id: str, year: int) -> list[PlanSummary]:
        """Every week in that year the user planned or was given (§5.3).

        Summaries, not plans — see `PlanSummary` for why. A week belongs to the
        year its *Saturday* falls in, which is the same rule `week_start_for`
        already applies, so a week straddling New Year lands in exactly one year
        and never in both.
        """
