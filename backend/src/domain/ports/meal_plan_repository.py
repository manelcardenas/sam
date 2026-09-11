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
    overwrite each other, which sharing depends on not happening.

    Four contract facts the signatures cannot carry:

    - `get_plan_for_week` returning None is a normal answer, not an error. Most
      weeks have no plan yet.
    - `upsert_entry` upserts because the slot is the identity — assigning
      Wednesday dinner twice means changing your mind, not creating a second
      Wednesday dinner (§6).
    - `drop_sources_for_entry` is separate from `delete_entry` on purpose. §4.5's
      drift rule: the list never rewrites itself, so unpicking a dish's lines is
      a second call the client makes after the user says yes.
    - `share_plan` and `unshare_plan` are idempotent. Doing either twice is a
      double tap, not an error.
    """

    @abstractmethod
    def get_plan(self, plan_id: str) -> MealPlan | None:
        pass

    @abstractmethod
    def get_plan_for_week(self, owner_id: str, week_start: date) -> MealPlan | None:
        pass

    @abstractmethod
    def create_plan(self, owner_id: str, week_start: date) -> MealPlan:
        pass

    @abstractmethod
    def upsert_entry(self, plan_id: str, entry: PlanEntry) -> PlanEntry:
        pass

    @abstractmethod
    def delete_entry(self, entry_id: str) -> None:
        pass

    @abstractmethod
    def add_items(self, plan_id: str, items: list[ShoppingListItem]) -> list[ShoppingListItem]:
        pass

    @abstractmethod
    def set_item_checked(self, item_id: str, is_checked: bool) -> ShoppingListItem | None:
        pass

    @abstractmethod
    def delete_item(self, item_id: str) -> None:
        pass

    @abstractmethod
    def drop_sources_for_entry(self, entry_id: str) -> int:
        pass

    @abstractmethod
    def set_status(self, plan_id: str, status: PlanStatus) -> MealPlan | None:
        pass

    @abstractmethod
    def share_plan(self, plan_id: str, user_id: str) -> None:
        pass

    @abstractmethod
    def unshare_plan(self, plan_id: str, user_id: str) -> None:
        pass

    @abstractmethod
    def list_shared_with(self, user_id: str, week_start: date) -> list[MealPlan]:
        pass

    @abstractmethod
    def list_year(self, user_id: str, year: int) -> list[PlanSummary]:
        pass
