from src.domain.entities import Aisle, GroceryItem
from src.domain.ports import GroceryRepository


class SetGroceryAisle:
    """Say which aisle a vocabulary row belongs in.

    **The vocabulary is shared, so this corrects it for everybody** — the same
    trade ADR-0002 makes for restaurant facts. A row is a fact about a shop, not
    about whoever corrected it, and a per-kitchen override would be a second
    answer to "where are the eggs?" for the list to reconcile.

    The row comes back confirmed: a person put it there, which is what takes it
    off the unvouched-for list and keeps the seed from moving it back.
    """

    def __init__(self, groceries: GroceryRepository) -> None:
        self.groceries = groceries

    def execute(self, key: str, aisle: Aisle) -> GroceryItem:
        item = self.groceries.set_aisle(key, aisle)
        if item is None:
            raise KeyError(f"Grocery item {key} not found")
        return item
