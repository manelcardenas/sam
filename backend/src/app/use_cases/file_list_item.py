from datetime import UTC, datetime

from src.app.use_cases.plan_access import writable_plan
from src.domain.entities import Aisle, GroceryItem, GrocerySource, PlanAction, key_for, name_index, require, resolve_grocery_key
from src.domain.ports import GroceryRepository, MealPlanRepository


class FileListItem:
    """Put a shopping-list line in the aisle somebody picked for it.

    Two cases, and the caller cannot tell them apart, which is why this is one
    route rather than two:

    - **The line already means a vocabulary row.** Then the aisle is a fact about
      that row, and it moves for every line and every kitchen that uses it.
    - **Nothing in the vocabulary knows it** — `Otros`, and the AI either failed
      or was never asked. Then the typed words *become* a row, filed where the
      person said. Without that the pick would be thrown away with the line, and
      the next `bosses d'escombraries` would land in `Otros` again.

    The new row carries the typed words in all three name columns. It has no
    translation to offer and inventing one is the model's job, not this one's —
    and a single alias is also the safest shape: it cannot collide with any row
    that already exists, because if it could the name would have resolved.
    """

    def __init__(self, repository: MealPlanRepository, groceries: GroceryRepository) -> None:
        self.repository = repository
        self.groceries = groceries

    def execute(self, kitchen_id: str, plan_id: str, item_id: str, aisle: Aisle) -> None:
        plan = writable_plan(self.repository.get_plan(plan_id), kitchen_id)
        require(plan.status, PlanAction.EDIT_LIST)
        line = next((i for i in plan.items if i.id == item_id), None)
        if line is None:
            raise KeyError(f"List item {item_id} not found")

        vocabulary = self.groceries.list_all()
        # A key whose row an admin has since deleted means nothing any more; the
        # line is back to being words nobody has filed.
        known = line.grocery_key if any(item.key == line.grocery_key for item in vocabulary) else None
        key = known or resolve_grocery_key(line.display_name, name_index(vocabulary))
        if key is not None:
            self.groceries.set_aisle(key, aisle)
        else:
            name = line.display_name.strip()
            key = key_for(name)
            self.groceries.upsert_many(
                [
                    GroceryItem(
                        key=key,
                        name_es=name,
                        name_ca=name,
                        name_en=name,
                        aisle=aisle,
                        source=GrocerySource.HUMAN,
                        confirmed_at=datetime.now(UTC).isoformat(),
                    )
                ]
            )

        if line.grocery_key != key:
            self.repository.set_item_grocery_key(line.id, key)
