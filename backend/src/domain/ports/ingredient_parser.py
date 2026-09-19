from abc import ABC, abstractmethod

from src.domain.entities import GroceryItem, ParsedIngredients


class IngredientParser(ABC):
    """Turn a block of free text into structured ingredient lines (plan §4).

    **One call for the whole block, not one per line.** Three reasons, in order
    of weight: `aceite, sal, pimienta` is three ingredients on one line and a
    per-line call structurally cannot see that; context disambiguates (a list
    holding carne picada and espaguetis tells the model `tomate triturado` is the
    tinned kind); and one call pays the system-prompt overhead once.

    The vocabulary is passed in rather than fetched here, because a *port* that
    reaches for a repository is not a port. It also makes the prompt's contents
    the caller's decision, which is where the cost lives.

    Implementations raise `IngredientParserError` and nothing else. The caller
    has one response to every failure — fall back to raw lines the user edits by
    hand — so distinguishing a timeout from a malformed schema would offer a
    choice that does not exist.
    """

    @abstractmethod
    def parse(self, text: str, vocabulary: list[GroceryItem], servings: int) -> ParsedIngredients:
        """Structure `text`, matching each line against `vocabulary`.

        `servings` is context, not arithmetic: "para 4" in the text should not
        contradict the headcount the form already carries, and the model reads
        better with it than without. **Nothing here scales amounts** — ADR-0001
        scales at display time, and a parser that pre-divided would bake one
        headcount into the recipe for ever.
        """
