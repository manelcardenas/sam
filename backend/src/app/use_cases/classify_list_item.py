from src.app.use_cases.parse_ingredients import ParseIngredients
from src.app.use_cases.plan_access import writable_plan
from src.domain.entities import Aisle, PlanAction, name_index, require, resolve_grocery_key
from src.domain.ports import GroceryRepository, IngredientParser, MealPlanRepository


class ClassifyListItem:
    """Ask the model what a hand-typed line is, and file it there.

    **Called by the client after the line is already on the list**, never on the
    way in. ingredient-capture-plan §6.2's rule stands: adding by hand never
    waits on a model — you are standing in a kitchen typing fast, and that path
    has to stay instant and work with the provider down. This is the second,
    optional half: the line sits in `Otros` for the few seconds the call takes,
    then moves.

    **The same parse as the recipe box, not a second prompt.** One word of free
    text is just a very short ingredient list, and reusing `ParseIngredients`
    means a typo like `huveos` is matched to `huevos` by the same rules, and a
    genuinely new thing becomes a vocabulary row marked `source='ai'`, unvouched
    for, exactly like one proposed while writing a recipe.

    **It carries the quantity too.** The manual box sends a name and nothing
    else, so `6 huevos` is a line called "6 huevos" with no amount. Once it is
    filed it renders as `Huevos` from the vocabulary — and without taking the 6
    the parse read out of the name, the number would vanish from the screen.

    Four no-ops, all deliberate rather than errors:

    - the line already has a key that still means a row — somebody filed it by
      hand while this was in flight, and a person's pick outranks the model's;
    - the vocabulary learnt the word since — then it is filed without a call;
    - the parse split it into several things (`aceite y sal` typed as one line)
      — one line cannot live in two aisles, so it is left for a person;
    - the model's only idea is a **new** row in `other` — which is where the
      line already is, so the row would add nothing but a permanent vocabulary
      entry. This is what stops a mistyped `aksjhkjqew` becoming a word the whole
      app autocompletes. Unlike the recipe box, nobody reviews this parse before
      it is written, so it keeps only what it can use.
    """

    def __init__(self, repository: MealPlanRepository, groceries: GroceryRepository, parser: IngredientParser) -> None:
        self.repository = repository
        self.groceries = groceries
        self.parser = parser

    def execute(self, kitchen_id: str, plan_id: str, item_id: str) -> None:
        plan = writable_plan(self.repository.get_plan(plan_id), kitchen_id)
        require(plan.status, PlanAction.EDIT_LIST)
        line = next((i for i in plan.items if i.id == item_id), None)
        if line is None:
            raise KeyError(f"List item {item_id} not found")
        vocabulary = self.groceries.list_all()
        # A key still pointing at a row is a filed line. One pointing at a row
        # an admin deleted is not, and gets asked about like any other.
        if line.grocery_key is not None and any(item.key == line.grocery_key for item in vocabulary):
            return

        key = resolve_grocery_key(line.display_name, name_index(vocabulary))
        if key is not None:
            self.repository.set_item_grocery_key(line.id, key)
            return

        # One person, not the slot's headcount: nothing is being scaled, and the
        # number is only there because the prompt reads better with one.
        parsed, created = ParseIngredients(self.parser, self.groceries).propose(line.display_name, servings=1)
        if len(parsed.lines) != 1:
            return
        answer = parsed.lines[0]
        if answer.is_new:
            if answer.item.aisle == Aisle.OTHER:
                return
            self.groceries.upsert_many(created)

        self.repository.set_item_grocery_key(line.id, answer.item.key, answer.amount, answer.unit)
