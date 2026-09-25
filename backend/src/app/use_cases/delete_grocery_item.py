from src.domain.entities import GrocerySource
from src.domain.errors import SeedGroceryItemError
from src.domain.ports import GroceryRepository


class DeleteGroceryItem:
    """An admin removing a vocabulary row — the cleanup for `aksjhkjqew`.

    **Seeded rows are refused**, not deleted: the seed runs on every deploy and
    would recreate the row within the hour, so "deleted" would be a lie the list
    tells until the next push. The seed file is where those are removed.

    Nothing else has to happen. No foreign key points here — recipes name their
    ingredients, and a list line holding this key simply reads as unmatched
    afterwards, which puts it back in `Otros` where it can be filed again.
    """

    def __init__(self, groceries: GroceryRepository) -> None:
        self.groceries = groceries

    def execute(self, key: str) -> None:
        item = self.groceries.get(key)
        if item is None:
            raise KeyError(f"Grocery item {key} not found")
        if item.source == GrocerySource.SEED:
            raise SeedGroceryItemError("This ingredient comes from the seed and would come back on the next deploy — remove it from grocery_seed_data.py")
        self.groceries.delete(key)
