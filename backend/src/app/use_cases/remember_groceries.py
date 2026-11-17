from src.domain.entities import GroceryItem, GrocerySource, ProposedGroceryItem, key_for, name_index
from src.domain.ports import GroceryRepository


class RememberGroceries:
    """Add to the vocabulary the products a saved recipe introduced (ADR-0009 §8).

    **Saving writes; reading a recipe never does.** Parsing used to create these
    rows the moment the model proposed them, so a recipe abandoned halfway still
    left `kombucha` autocompleting for everybody, and a line the person then
    renamed left its first guess behind. Now a proposal travels with the row
    through the review, and only the ones still attached when the person presses
    "Guardar" arrive here.

    A proposal whose name already belongs to a row — in any of the three
    languages — is skipped rather than written: two people saving `calçots` in
    the same minute, or a model proposing what the seed already holds under its
    Catalan name, must not make `name_index` refuse to build.
    """

    def __init__(self, groceries: GroceryRepository) -> None:
        self.groceries = groceries

    def execute(self, proposals: list[ProposedGroceryItem]) -> int:
        if not proposals:
            return 0

        vocabulary = self.groceries.list_all()
        taken = set(name_index(vocabulary)) | {item.key for item in vocabulary}
        new: list[GroceryItem] = []

        for proposal in proposals:
            names = {key_for(name) for name in (proposal.name_es, proposal.name_ca, proposal.name_en)}
            key = key_for(proposal.name_es)
            if names & taken:
                continue
            new.append(
                GroceryItem(
                    key=key,
                    name_es=proposal.name_es,
                    name_ca=proposal.name_ca,
                    name_en=proposal.name_en,
                    aisle=proposal.aisle,
                    is_pantry=proposal.is_pantry,
                    default_unit=proposal.default_unit,
                    source=GrocerySource.AI,
                )
            )
            taken |= names | {key}

        return self.groceries.upsert_many(new) if new else 0
