import pytest

from src.app.use_cases import CreateRecipe, DeleteRecipe, GetRecipe, ListRecipes, UpdateRecipe
from src.domain.entities import Ingredients, Recipe
from src.infra.adapters.repos.in_memory_recipe_repo import InMemoryRecipeRepository

SAMPLE_INGREDIENTS = {
    "servings": 2,
    "items": [{"name": "ingredient1"}, {"name": "ingredient2"}],
}


@pytest.fixture
def repository() -> InMemoryRecipeRepository:
    """Create a fresh in-memory repository for each test."""
    return InMemoryRecipeRepository()


@pytest.fixture
def sample_recipe() -> Recipe:
    """Create a sample recipe for testing."""
    return Recipe(
        title="Test Recipe",
        instructions="Mix everything together.",
        ingredients=SAMPLE_INGREDIENTS,
        food_type="comida",
        created_by="user-123",
    )


class TestCreateRecipe:
    def test_creates_recipe_successfully(self, repository: InMemoryRecipeRepository, sample_recipe: Recipe) -> None:
        use_case = CreateRecipe(repository)

        result = use_case.execute(sample_recipe)

        assert result.id == sample_recipe.id
        assert result.title == "Test Recipe"
        assert result.instructions == "Mix everything together."
        assert result.ingredients == Ingredients(**SAMPLE_INGREDIENTS)
        assert result.food_type == sample_recipe.food_type
        assert result.created_by == "user-123"

    def test_created_recipe_is_retrievable(self, repository: InMemoryRecipeRepository, sample_recipe: Recipe) -> None:
        create_use_case = CreateRecipe(repository)
        get_use_case = GetRecipe(repository)

        created = create_use_case.execute(sample_recipe)
        retrieved = get_use_case.execute(created.id)

        assert retrieved is not None
        assert retrieved.id == created.id
        assert retrieved.title == created.title


class TestGetRecipe:
    def test_returns_recipe_when_exists(self, repository: InMemoryRecipeRepository, sample_recipe: Recipe) -> None:
        CreateRecipe(repository).execute(sample_recipe)
        use_case = GetRecipe(repository)

        result = use_case.execute(sample_recipe.id)

        assert result is not None
        assert result.id == sample_recipe.id

    def test_returns_none_when_not_exists(self, repository: InMemoryRecipeRepository) -> None:
        use_case = GetRecipe(repository)

        result = use_case.execute("non-existent-id")

        assert result is None


class TestListRecipes:
    def test_returns_empty_list_when_no_recipes(self, repository: InMemoryRecipeRepository) -> None:
        use_case = ListRecipes(repository)

        result = use_case.execute()

        assert result == []

    def test_returns_all_recipes(self, repository: InMemoryRecipeRepository) -> None:
        create_use_case = CreateRecipe(repository)
        recipe1 = Recipe(
            title="Recipe 1",
            instructions="Instructions 1",
            ingredients={"servings": 1, "items": [{"name": "a"}]},
            food_type="comida",
            created_by="user-1",
        )
        recipe2 = Recipe(
            title="Recipe 2",
            instructions="Instructions 2",
            ingredients={"servings": 1, "items": [{"name": "b"}]},
            food_type="postre",
            created_by="user-2",
        )

        create_use_case.execute(recipe1)
        create_use_case.execute(recipe2)

        list_use_case = ListRecipes(repository)
        result = list_use_case.execute()

        assert len(result) == 2
        titles = [r.title for r in result]
        assert "Recipe 1" in titles
        assert "Recipe 2" in titles


class TestUpdateRecipe:
    def test_updates_recipe_successfully(self, repository: InMemoryRecipeRepository, sample_recipe: Recipe) -> None:
        CreateRecipe(repository).execute(sample_recipe)
        use_case = UpdateRecipe(repository)

        updated_ingredients = {"servings": 1, "items": [{"name": "new_ingredient"}]}
        updated_recipe = Recipe(
            id=sample_recipe.id,
            title="Updated Title",
            instructions="Updated instructions.",
            ingredients=updated_ingredients,
            food_type="comida",
            created_by=sample_recipe.created_by,
        )
        result = use_case.execute(updated_recipe)

        assert result.id == sample_recipe.id
        assert result.title == "Updated Title"
        assert result.instructions == "Updated instructions."
        assert result.ingredients == Ingredients(**updated_ingredients)

    def test_raises_error_when_recipe_not_found(self, repository: InMemoryRecipeRepository) -> None:
        use_case = UpdateRecipe(repository)
        non_existent_recipe = Recipe(
            id="non-existent-id",
            title="Title",
            instructions="Instructions.",
            ingredients={"servings": 1, "items": [{"name": "a"}]},
            food_type="comida",
            created_by="user-1",
        )

        with pytest.raises(KeyError):
            use_case.execute(non_existent_recipe)


class TestDeleteRecipe:
    def test_deletes_recipe_successfully(self, repository: InMemoryRecipeRepository, sample_recipe: Recipe) -> None:
        CreateRecipe(repository).execute(sample_recipe)
        use_case = DeleteRecipe(repository)

        use_case.execute(sample_recipe.id)

        # Verify recipe is deleted
        get_use_case = GetRecipe(repository)
        assert get_use_case.execute(sample_recipe.id) is None

    def test_raises_error_when_recipe_not_found(self, repository: InMemoryRecipeRepository) -> None:
        use_case = DeleteRecipe(repository)

        with pytest.raises(KeyError):
            use_case.execute("non-existent-id")
