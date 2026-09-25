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
    overwrite each other, which a shared kitchen depends on not happening.

    Four contract facts the signatures cannot carry:

    - **A plan belongs to a kitchen, not a person** (§8.12). Nothing here takes a
      user id to decide access; the caller resolves which kitchens it may touch
      and passes ids. `created_by` travels on the rows purely as attribution.
    - `get_plan_for_week` returning None is a normal answer, not an error. Most
      weeks have no plan yet.
    - `upsert_entry` keys on the **dish within the slot**, not the slot. A slot
      holds a flat list (ingredient-capture-plan §5), so assigning a *second*
      dish to Wednesday dinner adds it; assigning the *same* dish again changes
      its headcount rather than duplicating it. For a one-off text entry — which
      has no recipe id — the dish name plays that part, so typing "Sobras" twice
      does not leave two.
    - `drop_sources_for_entry` is separate from `delete_entry` on purpose. §4.5's
      drift rule: the list never rewrites itself, so unpicking a dish's lines is
      a second call the client makes after the user says yes.
    """

    @abstractmethod
    def get_plan(self, plan_id: str) -> MealPlan | None:
        pass

    @abstractmethod
    def get_plan_for_week(self, kitchen_id: str, week_start: date) -> MealPlan | None:
        pass

    @abstractmethod
    def create_plan(self, kitchen_id: str, week_start: date, created_by: str) -> MealPlan:
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
    def set_item_grocery_key(self, item_id: str, grocery_key: str, amount: float | None = None, unit: str | None = None) -> ShoppingListItem | None:
        """Say which vocabulary row a line means, after the fact. None if there is no such line.

        `amount` and `unit` are what a parse read **out of the name** — `6 huevos`
        typed into the manual box arrives as a line with no amount at all. They
        are taken only by a line that has no amount of its own; one that does
        already knows how much, and a guess must not overwrite it.

        **This can merge.** The key is half of the merge key, so giving `huveos`
        the key `huevos` makes it the same line as the `Huevos` already on the
        list. When that happens this line is folded into the existing one —
        amounts summed with `add_items`' None-is-not-zero rule, sources moved
        across, `created_by` left with whoever was first — and the survivor is
        returned. It stays ticked only if both were: a fresh line folded into a
        ticked one is something you still have to buy.
        """

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
    def list_year(self, kitchen_ids: list[str], year: int) -> list[PlanSummary]:
        pass
