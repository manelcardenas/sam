from collections import Counter

from src.domain.entities import (
    DraftIngredient,
    GroceryItem,
    ReadIngredient,
    ReadRecipe,
    RecipeDraft,
    RecipePage,
    Viewer,
    name_index,
    near_duplicates,
    resolve_grocery_key,
)
from src.domain.entities.parsed_ingredient import ProposedGroceryItem, match_line
from src.domain.ports import GroceryRepository, RecipePageFetcher, RecipeReader, RecipeRepository, RecipeSource

#: Units that count pieces rather than weigh them — where "4 patatas" sits when
#: the cook counted. Only these get a grams suggestion; a line already in a
#: measured unit was weighed by somebody and is left alone.
_COUNTED = {"", "ud", "uds", "u", "unidad", "unidades", "pieza", "piezas"}


class ImportRecipe:
    """A recipe from pasted text, a link or a photo, as a draft to review (ADR-0009 §8).

    The model reads; **this guarantees**:

    - **Every source line comes back as at least one row.** A line the model
      skipped is restored with its own words as the name (`restored=True`), and a
      row it could not match keeps its words instead of being dropped. Losing an
      ingredient between the text and the rows was the worst failure of the old
      capture, because nobody notices what is not there.
    - **Nothing is written.** Matched products point at the vocabulary; new ones
      ride on their row as `new_item` until the person saves.
    - **Units follow the kitchen.** The model is told each product's usual unit
      and how the kitchen's recipes have written it, and a counted line of
      something bought by weight comes back with a grams suggestion.
    """

    def __init__(self, reader: RecipeReader, fetcher: RecipePageFetcher, groceries: GroceryRepository, recipes: RecipeRepository) -> None:
        self.reader = reader
        self.fetcher = fetcher
        self.groceries = groceries
        self.recipes = recipes

    def from_text(self, text: str, viewer: Viewer) -> RecipeDraft:
        return self._read(RecipeSource(text=text), viewer)

    def from_image(self, image: str, viewer: Viewer) -> RecipeDraft:
        return self._read(RecipeSource(image=image), viewer)

    def from_url(self, url: str, viewer: Viewer) -> RecipeDraft:
        """A page's own `schema.org/Recipe` wins wherever it says something.

        Its ingredient lines and method are taken as written, and the model only
        structures the lines and proposes tags. Without one, the page's visible
        text is read like a paste.
        """
        page = self.fetcher.fetch(url)
        if page.structured:
            source = RecipeSource(text=_page_as_text(page), known_lines=page.ingredient_lines)
        else:
            source = RecipeSource(text=page.text)

        draft = self._read(source, viewer)
        draft.source_url = page.url
        if page.structured:
            draft.title = page.title or draft.title
            draft.instructions = page.instructions or draft.instructions
            draft.prep_time_minutes = page.prep_time_minutes if page.prep_time_minutes is not None else draft.prep_time_minutes
            draft.cook_time_minutes = page.cook_time_minutes if page.cook_time_minutes is not None else draft.cook_time_minutes
            if page.servings is not None:
                draft.servings, draft.servings_from_source = page.servings, True
        return draft

    def _read(self, source: RecipeSource, viewer: Viewer) -> RecipeDraft:
        vocabulary = self.groceries.list_all()
        read = self.reader.read(source, vocabulary, unit_usage(self.recipes, vocabulary, viewer))
        if source.known_lines is not None:
            # The page said what its lines are. The model's copy of them is not
            # trusted over the page's own.
            read.ingredient_lines = source.known_lines
        return draft_from(read, vocabulary)


def unit_usage(recipes: RecipeRepository, vocabulary: list[GroceryItem], viewer: Viewer) -> dict[str, dict[str, int]]:
    """How the recipes this person can see write each product: `{"patata": {"g": 6, "": 1}}`.

    Resolved by name exactly as the shopping list resolves them, so "how is
    patata usually written" counts the same rows the list would merge. An empty
    string is "counted, no unit".
    """
    index = name_index(vocabulary)
    usage: dict[str, Counter[str]] = {}
    for recipe in recipes.list_recipes(viewer=viewer):
        for ingredient in recipe.ingredients.items:
            key = resolve_grocery_key(ingredient.name, index)
            if key is None:
                continue
            usage.setdefault(key, Counter())[(ingredient.unit or "").strip().lower()] += 1
    return {key: dict(counts) for key, counts in usage.items()}


def draft_from(read: ReadRecipe, vocabulary: list[GroceryItem]) -> RecipeDraft:
    """The model's answer, checked against the vocabulary and the source's own lines."""
    known = {item.key: item for item in vocabulary}
    aliases = name_index(vocabulary)
    lines = [line.strip() for line in read.ingredient_lines if line.strip()]

    rows: list[DraftIngredient] = []
    covered: set[int] = set()
    for ingredient in read.ingredients:
        # A row pointing past the end is the model miscounting, not a new line:
        # keep the row, attached to the last line it could mean.
        index = min(max(ingredient.line, 0), len(lines) - 1) if lines else 0
        covered.add(index)
        rows.append(_row(ingredient, index, lines[index] if lines else ingredient.raw, known, aliases))

    for index, text in enumerate(lines):
        if index not in covered:
            rows.append(DraftIngredient(line=index, source_line=text, name=text, restored=True))

    rows.sort(key=lambda row: row.line)  # stable: rows of one line keep the model's order
    return RecipeDraft(
        title=(read.title or "").strip() or None,
        servings=read.servings,
        servings_from_source=read.servings is not None,
        prep_time_minutes=read.prep_time_minutes,
        cook_time_minutes=read.cook_time_minutes,
        tags=list(dict.fromkeys(read.tags)),
        instructions=(read.instructions or "").strip() or None,
        ingredient_lines=lines,
        ingredients=rows,
    )


def _row(ingredient: ReadIngredient, index: int, source_line: str, known: dict[str, GroceryItem], aliases: dict[str, str]) -> DraftIngredient:
    item, is_new = match_line(ingredient.grocery_key, ingredient.proposed, known, aliases)
    unit = (ingredient.unit or "").strip() or None

    if item is None:
        # Not understood. The words stay, so the person sees and fixes the line
        # rather than never knowing it existed.
        return DraftIngredient(
            line=index, source_line=source_line, name=ingredient.raw.strip() or source_line, amount=ingredient.amount, unit=unit, optional=ingredient.optional
        )

    grams = None
    if item.default_unit == "g" and (unit or "").lower() in _COUNTED and ingredient.grams_estimate:
        grams = round(ingredient.grams_estimate)

    return DraftIngredient(
        line=index,
        source_line=source_line,
        name=item.name_es,
        amount=ingredient.amount,
        unit=unit,
        optional=ingredient.optional,
        item=None if is_new else item,
        new_item=_proposal(item) if is_new else None,
        did_you_mean=[known[k].name_es for k in near_duplicates(item.key, list(known)) if k in known] if is_new else [],
        grams_suggestion=grams,
    )


def _proposal(item: GroceryItem) -> ProposedGroceryItem:
    return ProposedGroceryItem(
        name_es=item.name_es,
        name_ca=item.name_ca,
        name_en=item.name_en,
        aisle=item.aisle,
        is_pantry=item.is_pantry,
        default_unit=item.default_unit,
    )


def _page_as_text(page: RecipePage) -> str:
    """What the model reads for a structured page: its title, lines and method, nothing else.

    The rest of a recipe page is adverts, comments and a life story; sending it
    would cost tokens and invite the model to read ingredients out of the
    comments.
    """
    parts = [page.title or "", "\n".join(page.ingredient_lines), page.instructions or ""]
    return "\n\n".join(part for part in parts if part)
