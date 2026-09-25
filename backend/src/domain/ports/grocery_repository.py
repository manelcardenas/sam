from abc import ABC, abstractmethod

from src.domain.entities import Aisle, GroceryItem


class GroceryRepository(ABC):
    """The shared vocabulary of buyable things (plan §3).

    Read-heavy and tiny: a household's vocabulary is a few hundred rows that
    change a handful of times a year. That is why there is no pagination here
    and why `list_all` is an honest name rather than a trap — it is the whole
    table, and the whole table is what both callers want.
    """

    @abstractmethod
    def list_all(self) -> list[GroceryItem]:
        """Every row, in key order.

        Key order rather than display order because both callers need a stable
        sequence and neither needs a *language*: the parser sends this as a
        prompt prefix that must be byte-identical between calls for the
        provider's cache to hit it, and sorting by a localised name would make
        the prefix depend on who happened to be logged in.
        """

    @abstractmethod
    def get(self, key: str) -> GroceryItem | None:
        """One row by key, or None. None is a normal answer — most typed words are not rows."""

    @abstractmethod
    def set_aisle(self, key: str, aisle: Aisle) -> GroceryItem | None:
        """Move a row to another aisle **and mark it vouched for**, or None if there is no such row.

        Always stamps `confirmed_at`, even when the aisle does not change: a
        person looked at this row and said where it goes, which is exactly the
        fact `confirmed_at` exists to record — and what stops the seed moving it
        back on the next deploy (see `upsert_many`).
        """

    @abstractmethod
    def upsert_many(self, items: list[GroceryItem]) -> int:
        """Insert or update by `key`, returning how many rows were written.

        Upsert rather than insert so the seed is re-runnable: it is data, not a
        migration (the `cuisines` precedent), and running it twice after adding
        thirty rows should add thirty rows rather than fail on the first
        collision.

        **`created_at` and `confirmed_at` are never overwritten on an existing
        row.** Re-running the seed must not erase the fact that a person
        vouched for something, nor backdate a row somebody created by hand.

        **And a confirmed row is not touched at all.** The seed runs on every
        deploy, so anything a person corrected — an aisle from the list, a name
        from the admin panel — would otherwise last exactly until the next push:
        the correction would look like it worked and then quietly undo itself.
        Once somebody has vouched for a row, the seed file stops being its source
        of truth.
        """

    @abstractmethod
    def update(self, item: GroceryItem) -> GroceryItem | None:
        """Overwrite an existing row's names, aisle, pantry flag, unit and `confirmed_at`.

        The key is not writable: it is the primary key, and shopping-list lines
        hold it. Renaming `name_es` therefore leaves the key as it was — which is
        fine, because nothing resolves a line through the key's spelling; the
        three names are what `name_index` matches.
        """

    @abstractmethod
    def delete(self, key: str) -> bool:
        """Remove a row. False if there was none.

        Nothing cascades, because nothing has a foreign key into this table:
        recipes point at it by name and list lines carry the key as plain text.
        A line left holding a deleted key reads as unmatched — `Otros`, and
        eligible to be filed again.
        """
