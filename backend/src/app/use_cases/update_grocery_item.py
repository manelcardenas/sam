from datetime import UTC, datetime

from src.domain.entities import Aisle, GroceryItem, key_for, name_index
from src.domain.errors import GroceryNameTakenError
from src.domain.ports import GroceryRepository


class UpdateGroceryItem:
    """An admin rewriting one vocabulary row: its three names, aisle, pantry flag and unit.

    **The row comes back confirmed**, like any correction a person makes — which
    is also what stops the next deploy's seed from putting the old values back.

    **Refused if a name would collide.** Renaming the typo row `Huveos` to
    `Huevos` makes two rows own the word `huevos`, and `name_index` — which every
    shopping-list write builds — would then refuse to build at all. The right
    fix for a duplicate is to delete it, and the error says which row already
    has the name so that is obvious.
    """

    def __init__(self, groceries: GroceryRepository) -> None:
        self.groceries = groceries

    def execute(self, key: str, *, name_es: str, name_ca: str, name_en: str, aisle: Aisle, is_pantry: bool, default_unit: str | None) -> GroceryItem:
        existing = self.groceries.get(key)
        if existing is None:
            raise KeyError(f"Grocery item {key} not found")

        names = [name.strip() for name in (name_es, name_ca, name_en)]
        if not all(names):
            raise ValueError("Every name needs at least one letter")

        edited = existing.model_copy(
            update={
                "name_es": names[0],
                "name_ca": names[1],
                "name_en": names[2],
                "aisle": aisle,
                "is_pantry": is_pantry,
                "default_unit": (default_unit or "").strip() or None,
                "confirmed_at": datetime.now(UTC).isoformat(),
            }
        )

        others = [item for item in self.groceries.list_all() if item.key != key]
        try:
            name_index([*others, edited])
        except ValueError as error:
            taken = name_index(others)
            owner = next((taken[key_for(name)] for name in names if key_for(name) in taken), None)
            raise GroceryNameTakenError(f"Another ingredient already uses that name: {owner}" if owner else str(error)) from error

        updated = self.groceries.update(edited)
        if updated is None:
            raise KeyError(f"Grocery item {key} not found")
        return updated
