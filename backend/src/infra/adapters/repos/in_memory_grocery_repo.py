from src.domain.entities import GroceryItem
from src.domain.ports import GroceryRepository


class InMemoryGroceryRepository(GroceryRepository):
    """In-memory repository for unit tests only. Not used in production."""

    def __init__(self, items: list[GroceryItem] | None = None) -> None:
        self.items: dict[str, GroceryItem] = {item.key: item for item in items or []}

    def list_all(self) -> list[GroceryItem]:
        # Sorted by key, like the SQL adapter's `ORDER BY key`. A fake that
        # ordered differently would let a prompt prefix that is stable in tests
        # be unstable in production, which is exactly the kind of divergence
        # `sort_entries` has a comment about.
        return [self.items[key] for key in sorted(self.items)]

    def upsert_many(self, items: list[GroceryItem]) -> int:
        for item in items:
            existing = self.items.get(item.key)
            # Mirrors the SQL upsert's excluded-column list: re-running the seed
            # must not erase a human's confirmation or backdate a row.
            self.items[item.key] = item if existing is None else item.model_copy(update={"created_at": existing.created_at, "confirmed_at": existing.confirmed_at})
        return len(items)
