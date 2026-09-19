from src.domain.entities import GroceryItem
from src.domain.ports import GroceryRepository


class ListGroceryItems:
    """The whole vocabulary, in one response.

    **No search parameter, deliberately.** A household's vocabulary is a few
    hundred rows — 266 at the seed — which is a single small payload the client
    caches for the session. Filtering it server-side would turn every keystroke
    in the manual-add box into a round trip, and autocomplete that waits on the
    network is autocomplete people stop using. The client already needs the
    whole list to group the shopping list by aisle, so this is one fetch serving
    two features.
    """

    def __init__(self, grocery_repository: GroceryRepository) -> None:
        self.grocery_repository = grocery_repository

    def execute(self) -> list[GroceryItem]:
        return self.grocery_repository.list_all()
