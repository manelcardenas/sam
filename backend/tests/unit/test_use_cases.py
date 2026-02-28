import pytest

from src.app.use_cases import CreateRecipe, DeleteRecipe, GetRecipe, ListRecipes, UpdateRecipes
from src.domain.entities import Recipe
from src.infra.adapters.repos import InMemoryRecipeRepository


@pytest.fixture
def repository() -> InMemoryRecipeRepository:
    """Create a fresh in-memory repository for each test."""
    return InMemoryRecipeRepository()


@pytest.fixture
def sample_recipe() -> Recipe:
    """Create a sample recipe for testing."""
    return Recipe(
        title="Test Recipe",
        description="A test recipe description",
        ingredients=["ingredient1", "ingredient2", "ingredient3"],
        food_type="comida",
        # created_by="user1",
    )


class TestCreateRecipe:
    def test_creates_recipe_successfully(self, repository: InMemoryRecipeRepository, sample_recipe: Recipe) -> None:
        use_case = CreateRecipe(repository)

        result = use_case.execute(sample_recipe)

        assert result.id == sample_recipe.id
        assert result.title == "Test Recipe"
        assert result.description == "A test recipe description"
        assert result.ingredients == ["ingredient1", "ingredient2", "ingredient3"]
        assert result.food_type == sample_recipe.food_type
        # assert result.created_by == sample_recipe.created_by

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
        recipe1 = Recipe(title="Recipe 1", description="Desc 1", ingredients=["a"], food_type="comida")  # created_by="user1"
        recipe2 = Recipe(title="Recipe 2", description="Desc 2", ingredients=["b"], food_type="postre")  # created_by="user2"

        create_use_case.execute(recipe1)
        create_use_case.execute(recipe2)

        list_use_case = ListRecipes(repository)
        result = list_use_case.execute()

        assert len(result) == 2
        titles = [r.title for r in result]
        assert "Recipe 1" in titles
        assert "Recipe 2" in titles


class TestUpdateRecipes:
    def test_updates_recipe_successfully(self, repository: InMemoryRecipeRepository, sample_recipe: Recipe) -> None:
        CreateRecipe(repository).execute(sample_recipe)
        use_case = UpdateRecipes(repository)

        updated_recipe = Recipe(
            id=sample_recipe.id,
            title="Updated Title",
            description="Updated description",
            ingredients=["new_ingredient"],
            food_type="comida",
            # created_by="user1",
        )
        result = use_case.execute(updated_recipe)

        assert result.id == sample_recipe.id
        assert result.title == "Updated Title"
        assert result.description == "Updated description"
        assert result.ingredients == ["new_ingredient"]

    def test_raises_error_when_recipe_not_found(self, repository: InMemoryRecipeRepository) -> None:
        use_case = UpdateRecipes(repository)
        non_existent_recipe = Recipe(
            id="non-existent-id",
            title="Title",
            description="Desc",
            ingredients=["a"],
            food_type="comida",
            # created_by="user1",
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
