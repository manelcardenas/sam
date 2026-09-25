from src.domain.entities import GroceryItem, GrocerySource, ParsedLine, key_for, name_index, near_duplicates
from src.domain.entities.parsed_ingredient import ResolvedIngredients, ResolvedLine
from src.domain.ports import GroceryRepository, IngredientParser


class ParseIngredients:
    """Free text in, reviewable structured lines out (plan §4).

    The model proposes; **this decides**. It never trusts a `grocery_key` it did
    not recognise, it derives every key itself with `key_for`, and it marks every
    row the model invented as `source='ai'` with no confirmation — so
    `WHERE source = 'ai' AND confirmed_at IS NULL` stays an honest list of
    everything nobody has vouched for.

    New rows are written **here, at parse time, before the user confirms**. That
    is deliberate: the vocabulary is not user data, it is a shared dictionary, and
    a word somebody typed is a word the app has now seen. Writing it on save
    instead would mean the review table showing an aisle for a row that does not
    exist yet, and two people parsing `calçots` in the same minute racing to
    create it.
    """

    def __init__(self, parser: IngredientParser, groceries: GroceryRepository) -> None:
        self.parser = parser
        self.groceries = groceries

    def execute(self, text: str, servings: int) -> ResolvedIngredients:
        resolved, created = self.propose(text, servings)
        if created:
            self.groceries.upsert_many(created)
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
                    # Only ever on a new row. Asking "did you mean Huevos?" about
                    # a row that already exists is asking about a decision the
                    # vocabulary already made.
                    did_you_mean=[known[k].name_es for k in near_duplicates(item.key, list(known)) if k in known] if is_new else [],
                )
            )

        return ResolvedIngredients(lines=resolved), created

    def _resolve(self, line: ParsedLine, known: dict[str, GroceryItem], aliases: dict[str, str]) -> tuple[GroceryItem | None, bool]:
        """The vocabulary row this line means, and whether it is brand new.

        A `grocery_key` the vocabulary does not hold is treated as **no match**
        rather than as an error: models occasionally echo a plausible key they
        invented, and the proposal beside it is usually right. Falling through is
        better than failing the whole block over one line.
        """
        if line.grocery_key and line.grocery_key in known:
            return known[line.grocery_key], False

        if line.proposed is None:
            # Neither a match nor a proposal. The schema forbids it, so this is a
            # model that ignored its own tool definition — drop the line rather
            # than invent an ingredient nobody typed.
            return None, False

        key = key_for(line.proposed.name_es)
        if key in known:
            # It proposed something that already exists under a different
            # spelling of the same name. Silently the right answer.
            return known[key], False

        # **Any of the three names, not just the Spanish one.** A proposal whose
        # Catalan or English name is already another row's name is that row: a
        # second row owning the same written form makes `name_index` refuse to
        # build, and every shopping-list write after it fails. Hand-filed rows
        # (`FileListItem`) carry the typed word in all three columns, so a later
        # proposal naming `Bosses d'escombraries` in Catalan is the common way in.
        for name in (line.proposed.name_es, line.proposed.name_ca, line.proposed.name_en):
            owner = aliases.get(key_for(name))
            if owner is not None:
                return known[owner], False

        return (
            GroceryItem(
                key=key,
                name_es=line.proposed.name_es,
                name_ca=line.proposed.name_ca,
                name_en=line.proposed.name_en,
                aisle=line.proposed.aisle,
                is_pantry=line.proposed.is_pantry,
                source=GrocerySource.AI,
            ),
            True,
        )
