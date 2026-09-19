from abc import ABC, abstractmethod

from src.domain.entities import GroceryItem


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
    def upsert_many(self, items: list[GroceryItem]) -> int:
        """Insert or update by `key`, returning how many rows were written.

        Upsert rather than insert so the seed is re-runnable: it is data, not a
        migration (the `cuisines` precedent), and running it twice after adding
        thirty rows should add thirty rows rather than fail on the first
        collision.

        **`created_at` and `confirmed_at` are never overwritten on an existing
        row.** Re-running the seed must not erase the fact that a person
        vouched for something, nor backdate a row somebody created by hand.
        """
