from src.domain.entities import RecipeRef, name_index, resolve_grocery_key
from src.domain.ports import GroceryRepository, RecipeRepository


class ListGroceryUsage:
    """Which recipes use each vocabulary row — for the admin deciding what a row is worth.

    **Computed, not stored.** A recipe keeps its ingredients as names in JSONB
    (data-model §2), with no key and no join table, so the only honest answer is
    to resolve every name the way the shopping list does when the recipe is
    planned: `resolve_grocery_key` against all three names of every row. A
    stored link would be a second copy of that decision, stale the moment an
    admin renamed a row. Quick-created dishes from `/plan` are `recipes` rows
    too, so they are counted like any other.

    A few hundred recipes of a dozen lines each is a few thousand dictionary
    lookups — cheaper than the round trip that asks for them.

    Keys no recipe uses are absent rather than empty lists. Names that match no
    row are skipped: they reach the list as unfiled lines, and there is no row
    here to hang them on.
    """

    def __init__(self, recipes: RecipeRepository, groceries: GroceryRepository) -> None:
        self.recipes = recipes
        self.groceries = groceries

    def execute(self) -> dict[str, list[RecipeRef]]:
        index = name_index(self.groceries.list_all())
        usage: dict[str, list[RecipeRef]] = {}
        for recipe in sorted(self.recipes.list_recipes(), key=lambda r: r.title.casefold()):
            ref = RecipeRef(id=recipe.id, title=recipe.title)
            # A set per recipe: `sal` for the water and `sal` to finish is one
            # recipe using salt, not two.
            keys = {resolve_grocery_key(item.name, index) for item in recipe.ingredients.items}
            for key in keys:
                if key is not None:
                    usage.setdefault(key, []).append(ref)
        return usage
