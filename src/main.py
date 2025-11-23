from src.app.use_cases.create_recipe import CreateRecipe
from src.domain.entities import Recipe
from src.infra.adapters.repos import InMemoryRecipeRepository


def main() -> None:
    print("🍳 Recipe Manager - Local Test\n")

    # Setup: Create repository and use case
    repo = InMemoryRecipeRepository()
    create_recipe_use_case = CreateRecipe(repo)

    # Test 1: Create a recipe
    print("Test 1: Creating a recipe...")
    recipe = Recipe(
        title="Chocolate Chip Cookies", description="Classic homemade cookies", ingredients=["2 cups flour", "1 cup sugar", "1 cup chocolate chips", "2 eggs"]
    )

    created_recipe = create_recipe_use_case.execute(recipe)
    print(f"✅ Recipe created with ID: {created_recipe.id}")
    print(f"   Title: {created_recipe.title}")
    print(f"   Created at: {created_recipe.created_at}\n")

    # Test 2: Get the recipe
    print("Test 2: Retrieving the recipe...")
    retrieved_recipe = repo.get_recipe(created_recipe.id)
    if retrieved_recipe:
        print(f"✅ Recipe found: {retrieved_recipe.title}\n")
    else:
        print("❌ Recipe not found\n")

    # Test 3: List all recipes
    print("Test 3: Listing all recipes...")
    all_recipes = repo.list_recipes()
    print(f"✅ Total recipes: {len(all_recipes)}\n")

    # Test 4: Update the recipe
    print("Test 4: Updating the recipe...")
    retrieved_recipe.description = "Updated: The best chocolate chip cookies ever!"
    updated_recipe = repo.update_recipe(retrieved_recipe)
    print(f"✅ Recipe updated")
    print(f"   New description: {updated_recipe.description}")
    print(f"   Updated at: {updated_recipe.updated_at}\n")

    # Test 5: Delete the recipe
    print("Test 5: Deleting the recipe...")
    repo.delete_recipe(created_recipe.id)
    print(f"✅ Recipe deleted\n")

    # Verify deletion
    print("Test 6: Verifying deletion...")
    deleted_recipe = repo.get_recipe(created_recipe.id)
    if deleted_recipe is None:
        print("✅ Recipe successfully deleted\n")
    else:
        print("❌ Recipe still exists\n")

    print("🎉 All tests completed!")


if __name__ == "__main__":
    main()
