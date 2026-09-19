from src.app.use_cases.plan_access import writable_plan
from src.domain.entities import PlanAction, ShoppingListItem, name_index, require, resolve_grocery_key
from src.domain.ports import GroceryRepository, MealPlanRepository


class AddToList:
    """Merge confirmed ingredient lines into the list.

    The amounts arrive already scaled to the slot's headcount. That is not the
    server being lazy: ADR 0001 scales by servings for *display*, and this list
    records what the user actually confirmed in the popup — including anything
    they unticked. Recomputing it here would quietly overrule them.

    **The vocabulary key is resolved here rather than at the edge**
    (ingredient-capture-plan §6.1). It is what two lines merge on, so it has to
    be decided once, on the way in, by something that can see the whole
    vocabulary — and both write paths (this and `AddToWeekList`) have to decide
    it the same way or one of them creates lines the other cannot merge with.
    """

    def __init__(self, repository: MealPlanRepository, groceries: GroceryRepository) -> None:
        self.repository = repository
        self.groceries = groceries

    def execute(self, kitchen_id: str, plan_id: str, items: list[ShoppingListItem]) -> list[ShoppingListItem]:
        plan = writable_plan(self.repository.get_plan(plan_id), kitchen_id)
        require(plan.status, PlanAction.EDIT_LIST)
        return self.repository.add_items(plan.id, resolve_keys(self.groceries, items))


def resolve_keys(groceries: GroceryRepository, items: list[ShoppingListItem]) -> list[ShoppingListItem]:
    """Stamp each line with the vocabulary row it means, where there is one.

    One `list_all()` for the whole batch rather than a lookup per line: the
    vocabulary is a few hundred rows that change a handful of times a year, and
    a line is written in batches of ten.

    A line the vocabulary does not know keeps `grocery_key = None` and merges on
    its own name, exactly as it did before any of this existed. That is the
    normal outcome for `bolsas de basura`, not a failure.
    """
    if not items:
        return items
    index = name_index(groceries.list_all())
    return [item.model_copy(update={"grocery_key": resolve_grocery_key(item.display_name, index)}) for item in items]
