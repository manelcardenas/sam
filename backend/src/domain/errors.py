class DisplayNameTakenError(Exception):
    """Raised when a chosen display_name collides with the UNIQUE constraint."""


class GroceryNameTakenError(Exception):
    """An edit would give two vocabulary rows the same written name.

    `name_index` refuses to build on that — and every shopping-list write goes
    through it — so this is refused at the edit rather than discovered at the
    next list write, where it would break the list for everybody.
    """


class SeedGroceryItemError(Exception):
    """A seeded vocabulary row cannot be deleted from the app.

    The seed runs on every deploy and would put it straight back. Removing one
    for good means removing it from `scripts/grocery_seed_data.py`.
    """
