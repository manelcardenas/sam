from src.domain.entities import GroceryItem, ParsedLine, ProposedGroceryItem, key_for, name_index, near_duplicates
from src.domain.entities.parsed_ingredient import ResolvedIngredients, ResolvedLine, match_line
from src.domain.ports import GroceryRepository, IngredientParser


class ParseIngredients:
    """Free text in, reviewable structured lines out (plan §4).

    The model proposes; **this decides**. It never trusts a `grocery_key` it did
    not recognise, and it derives every key itself with `key_for`.

    **It writes nothing** (ADR-0009 §8, 2026-11-17). New vocabulary rows used to
    be written here, at parse time, on the grounds that a word somebody typed is
    a word the app has seen. In practice that left a guess behind for every
    recipe abandoned halfway and every line the person then renamed. A new row
    now travels with its line as `new_item`, and the recipe's save writes it
    (`RememberGroceries`). The list's background lookup (`ClassifyListItem`)
    still calls `propose` and keeps what it decides is worth keeping.
    """

    def __init__(self, parser: IngredientParser, groceries: GroceryRepository) -> None:
        self.parser = parser
        self.groceries = groceries

    def execute(self, text: str, servings: int) -> ResolvedIngredients:
        resolved, _created = self.propose(text, servings)
        return resolved

    def propose(self, text: str, servings: int) -> tuple[ResolvedIngredients, list[GroceryItem]]:
        """Everything `execute` does except writing the new rows — which it returns instead.

        For a caller with its own opinion on which proposals are worth keeping:
        the list's background lookup (`ClassifyListItem`) will not keep a row the
        model could only file under `other`, because that is where the line
        already was — and a hand-typed `aksjhkjqew` should not become vocabulary
        that autocompletes for everybody.
        """
        vocabulary = self.groceries.list_all()
        known = {item.key: item for item in vocabulary}
        aliases = name_index(vocabulary)

        parsed = self.parser.parse(text, vocabulary, servings)

        created: list[GroceryItem] = []
        resolved: list[ResolvedLine] = []

        for line in parsed.lines:
            item, is_new = self._resolve(line, known, aliases)
            if item is None:
                continue
            if is_new:
                created.append(item)
                known[item.key] = item
                for name in (item.name_es, item.name_ca, item.name_en):
                    aliases[key_for(name)] = item.key
            resolved.append(
                ResolvedLine(
                    raw=line.raw,
                    item=item,
                    amount=line.amount,
                    # **The model's answer, or none.** There used to be a
                    # fallback here: an amount arriving with no unit took the
                    # vocabulary's `default_unit`. It read as harmless and was
                    # not — run over the real recipes it fired twice and was
                    # wrong twice, making `1 patata` into "1 g" of potato and
                    # `2 de vainilla` into "2 ml" of extract. It could only see
                    # *that* an amount existed, never whether the cook was
                    # counting or weighing. The model can see the raw text and
                    # now gets `default_unit` in the vocabulary block, so it
                    # decides — and a bare `100 aceite` stays unitless, which is
                    # vague where the old answer was wrong.
                    unit=line.unit,
                    is_new=is_new,
                    new_item=_proposal_of(item) if is_new else None,
                    # Only ever on a new row. Asking "did you mean Huevos?" about
                    # a row that already exists is asking about a decision the
                    # vocabulary already made.
                    did_you_mean=[known[k].name_es for k in near_duplicates(item.key, list(known)) if k in known] if is_new else [],
                )
            )

        return ResolvedIngredients(lines=resolved), created

    def _resolve(self, line: ParsedLine, known: dict[str, GroceryItem], aliases: dict[str, str]) -> tuple[GroceryItem | None, bool]:
        """The vocabulary row this line means — see `match_line`.

        A line with neither a match nor a proposal is dropped here: this box
        feeds the plan's quick create, where the person sees every row. The
        recipe import (`ImportRecipe`) keeps such lines instead.
        """
        return match_line(line.grocery_key, line.proposed, known, aliases)


def _proposal_of(item: GroceryItem) -> ProposedGroceryItem:
    """What the client sends back on save for a row this call would create."""
    return ProposedGroceryItem(
        name_es=item.name_es,
        name_ca=item.name_ca,
        name_en=item.name_en,
        aisle=item.aisle,
        is_pantry=item.is_pantry,
        default_unit=item.default_unit,
    )
