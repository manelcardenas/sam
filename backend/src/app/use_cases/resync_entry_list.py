from src.app.use_cases.add_to_list import resolve_keys
from src.app.use_cases.plan_access import writable_plan
from src.domain.entities import PlanAction, ShoppingListItem, require
from src.domain.ports import GroceryRepository, MealPlanRepository


class ResyncEntryList:
    """Replace one dish's contribution to the list with a fresh set of lines.

    **Why this exists.** Changing a slot from 2 people to 7 rewrote
    `plan_entries.servings` and left the shopping list at the old amounts, because
    the list is a snapshot taken when you pressed "add to the list" and nothing
    ever went back to it. That is right for everything else the list holds — it
    is hand-edited, and a recomputation would erase your unticks — but a headcount
    is the one input whose whole purpose is to change the amounts.

    **Subtract then add, rather than overwrite.** `drop_sources_for_entry` already
    knows how to remove exactly this dish's share and no one else's: a line two
    dishes contributed to keeps the other dish's half, and a line you added by
    hand survives having no dish at all. Re-implementing that as an UPDATE would
    be a second, subtly different answer to a question already answered once.

    **Not automatic.** §4.5's rule is that the list never rewrites itself; the
    client asks first and calls this only if told to. Which is also why the whole
    replacement is one request: a user who said yes once should not be able to
    end up half-resynced by a dropped connection.
    """

    def __init__(self, repository: MealPlanRepository, groceries: GroceryRepository) -> None:
        self.repository = repository
        self.groceries = groceries

    def execute(self, kitchen_id: str, plan_id: str, entry_id: str, items: list[ShoppingListItem]) -> None:
        plan = writable_plan(self.repository.get_plan(plan_id), kitchen_id)
        require(plan.status, PlanAction.EDIT_LIST)

        if not any(entry.id == entry_id for entry in plan.entries):
            raise KeyError(f"Entry {entry_id} is not in plan {plan_id}")

        self.repository.drop_sources_for_entry(entry_id)
        if items:
            self.repository.add_items(plan.id, resolve_keys(self.groceries, items))
