from datetime import UTC, datetime

from src.domain.entities import Aisle, GroceryItem
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

    def get(self, key: str) -> GroceryItem | None:
        return self.items.get(key)

    def set_aisle(self, key: str, aisle: Aisle) -> GroceryItem | None:
        existing = self.items.get(key)
        if existing is None:
            return None
        self.items[key] = existing.model_copy(update={"aisle": aisle, "confirmed_at": datetime.now(UTC).isoformat()})
        return self.items[key]

    def update(self, item: GroceryItem) -> GroceryItem | None:
        existing = self.items.get(item.key)
        if existing is None:
            return None
        self.items[item.key] = item.model_copy(update={"created_at": existing.created_at, "source": existing.source})
        return self.items[item.key]

    def delete(self, key: str) -> bool:
        return self.items.pop(key, None) is not None

    def upsert_many(self, items: list[GroceryItem]) -> int:
        for item in items:
            existing = self.items.get(item.key)
            if existing is None:
                self.items[item.key] = item
            elif existing.confirmed_at is None:
                # Mirrors the SQL upsert: never backdate a row, and never touch
                # one a person has vouched for (the `WHERE` on its ON CONFLICT).
                self.items[item.key] = item.model_copy(update={"created_at": existing.created_at, "confirmed_at": None})
        return len(items)
