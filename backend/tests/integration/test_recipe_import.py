"""`POST /recipes/import` and `ImportRecipe`, with a fake model (ADR-0009 §8).

What is pinned here is what the server guarantees whatever the model does:
every source line survives, nothing is written before save, units follow the
vocabulary, and a page's own `schema.org` beats the model's reading of it.
"""

from fastapi import APIRouter, FastAPI
from starlette.testclient import TestClient

from src.domain.entities import (
    Aisle,
    GroceryItem,
    GrocerySource,
    Ingredient,
    Ingredients,
    ProposedGroceryItem,
    ReadIngredient,
    ReadRecipe,
    Recipe,
    RecipePage,
    RecipePageError,
    RecipeReaderError,
    RecipeTag,
)
from src.domain.ports import RecipePageFetcher, RecipeReader, RecipeSource
from src.infra.adapters.repos.in_memory_grocery_repo import InMemoryGroceryRepository
from src.infra.adapters.repos.in_memory_kitchen_repo import InMemoryKitchenRepository
from src.infra.adapters.repos.in_memory_recipe_repo import InMemoryRecipeRepository
from src.infra.controllers import RecipeImportController
from src.infra.security import TokenPayload, get_current_user

ME = "user-nel"

VOCABULARY = [
    GroceryItem(key="patata", name_es="patata", name_ca="patata", name_en="potato", aisle=Aisle.PRODUCE, default_unit="g", source=GrocerySource.SEED),
    GroceryItem(key="cebolla", name_es="cebolla", name_ca="ceba", name_en="onion", aisle=Aisle.PRODUCE, source=GrocerySource.SEED),
    GroceryItem(key="huevos", name_es="huevos", name_ca="ous", name_en="eggs", aisle=Aisle.DAIRY_EGGS, source=GrocerySource.SEED),
]


class FakeReader(RecipeReader):
    def __init__(self, answer: ReadRecipe | Exception) -> None:
        self.answer = answer
        self.calls: list[tuple[RecipeSource, dict[str, dict[str, int]]]] = []

    def read(self, source: RecipeSource, vocabulary: list[GroceryItem], usage: dict[str, dict[str, int]]) -> ReadRecipe:  # noqa: ARG002 — the port's shape
        self.calls.append((source, usage))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer.model_copy(deep=True)


class FakeFetcher(RecipePageFetcher):
    def __init__(self, page: RecipePage | Exception) -> None:
        self.page = page

    def fetch(self, url: str) -> RecipePage:  # noqa: ARG002 — the port's shape
        if isinstance(self.page, Exception):
            raise self.page
        return self.page


TORTILLA = ReadRecipe(
    title="Tortilla de patatas",
    servings=None,
    tags=[RecipeTag.TUPPER, RecipeTag.TUPPER],
    instructions="Freír. Cuajar.",
    ingredient_lines=["4 patatas medianas", "1 cebolla", "6 huevos", "sal y pimienta", "kombucha (opcional)"],
    ingredients=[
        ReadIngredient(line=0, raw="patatas medianas", grocery_key="patata", amount=4, grams_estimate=812),
        ReadIngredient(line=1, raw="cebolla", grocery_key="cebolla", amount=1, grams_estimate=150),
        # line 2 ("6 huevos") — dropped by the model
        ReadIngredient(line=3, raw="sal", grocery_key=None, proposed=None),
        ReadIngredient(
            line=3, raw="pimienta", proposed=ProposedGroceryItem(name_es="pimienta", name_ca="pebre", name_en="pepper", aisle=Aisle.CONDIMENTS, is_pantry=True)
        ),
        ReadIngredient(
            line=4,
            raw="kombucha",
            optional=True,
            proposed=ProposedGroceryItem(name_es="kombucha", name_ca="kombutxa", name_en="kombucha", aisle=Aisle.DRINKS, default_unit="ml"),
        ),
    ],
)


class World:
    def __init__(self, answer: ReadRecipe | Exception = TORTILLA, page: RecipePage | Exception | None = None) -> None:
        self.groceries = InMemoryGroceryRepository(list(VOCABULARY))
        self.recipes = InMemoryRecipeRepository()
        self.reader = FakeReader(answer)
        self.fetcher = FakeFetcher(page or RecipePage(url="https://example.com"))

    def post(self, body: dict) -> object:
        router = APIRouter()
        RecipeImportController(self.reader, self.fetcher, self.groceries, self.recipes, InMemoryKitchenRepository(), router)
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: TokenPayload(sub=ME, email="n@example.com", exp=9999999999)
        return TestClient(app).post("/recipes/import", json=body)


def test_every_source_line_comes_back_even_the_ones_the_model_dropped() -> None:
    draft = World().post({"text": "una tortilla"}).json()

    assert sorted({row["line"] for row in draft["ingredients"]}) == [0, 1, 2, 3, 4]
    restored = next(row for row in draft["ingredients"] if row["line"] == 2)
    assert (restored["name"], restored["restored"]) == ("6 huevos", True)


def test_a_line_the_model_could_not_match_keeps_its_words() -> None:
    draft = World().post({"text": "una tortilla"}).json()

    salt = next(row for row in draft["ingredients"] if row["source_line"] == "sal y pimienta" and row["name"] == "sal")
    assert (salt["item"], salt["new_item"]) == (None, None)


def test_new_products_are_proposed_and_nothing_is_written() -> None:
    world = World()
    draft = world.post({"text": "una tortilla"}).json()

    kombucha = next(row for row in draft["ingredients"] if row["line"] == 4)
    assert kombucha["new_item"]["name_ca"] == "kombutxa"
    assert kombucha["item"] is None
    assert kombucha["optional"] is True
    assert [item.key for item in world.groceries.list_all()] == ["cebolla", "huevos", "patata"]
    assert world.recipes.list_recipes() == []


def test_grams_are_suggested_only_for_counted_lines_of_things_bought_by_weight() -> None:
    draft = World().post({"text": "una tortilla"}).json()
    by_line = {row["line"]: row for row in draft["ingredients"]}

    assert by_line[0]["grams_suggestion"] == 812, "potatoes are bought by weight"
    assert by_line[1]["grams_suggestion"] is None, "onions are counted"


def test_servings_are_only_marked_as_read_when_the_source_gave_them() -> None:
    assert World().post({"text": "x"}).json()["servings_from_source"] is False
    draft = World(TORTILLA.model_copy(update={"servings": 4})).post({"text": "x"}).json()
    assert (draft["servings"], draft["servings_from_source"]) == (4, True)


def test_tags_come_back_once() -> None:
    assert World().post({"text": "x"}).json()["tags"] == ["tupper"]


def test_the_model_is_told_how_the_kitchen_writes_each_product() -> None:
    world = World()
    for unit in ("g", "g", None):
        world.recipes.add_recipe(
            Recipe(title="x", ingredients=Ingredients(servings=2, items=[Ingredient(name="Patata", amount=1, unit=unit)]), food_type="comida", created_by=ME)
        )
    world.post({"text": "x"})

    _source, usage = world.reader.calls[0]
    assert usage == {"patata": {"g": 2, "": 1}}


def test_a_pages_own_recipe_beats_the_models_reading_of_it() -> None:
    page = RecipePage(
        url="https://example.com/tortilla",
        title="Tortilla de la abuela",
        servings=6,
        cook_time_minutes=40,
        ingredient_lines=["4 patatas medianas", "1 cebolla", "6 huevos", "sal y pimienta", "kombucha (opcional)"],
        instructions="Paso 1.",
    )
    world = World(page=page)
    draft = world.post({"url": "https://example.com/tortilla"}).json()

    source, _usage = world.reader.calls[0]
    assert source.known_lines == page.ingredient_lines
    assert (draft["title"], draft["servings"], draft["servings_from_source"]) == ("Tortilla de la abuela", 6, True)
    assert (draft["instructions"], draft["cook_time_minutes"], draft["source_url"]) == ("Paso 1.", 40, "https://example.com/tortilla")


def test_exactly_one_source_is_accepted() -> None:
    assert World().post({}).status_code == 422
    assert World().post({"text": "x", "url": "https://example.com"}).status_code == 422
    assert World().post({"image": "https://example.com/foto.jpg"}).status_code == 422, "a photo is a data URL, not a link"


def test_failures_say_whose_fault_they_are() -> None:
    assert World(RecipeReaderError("down")).post({"text": "x"}).status_code == 503
    assert World(page=RecipePageError("Only https links can be read")).post({"url": "http://example.com"}).status_code == 422
