import streamlit as st

from src.app.use_cases import CreateRecipe, DeleteRecipe, GetRecipe, ListRecipes, UpdateRecipes
from src.domain.entities import Recipe
from src.infra.adapters.repos import InMemoryRecipeRepository

# Page config
st.set_page_config(
    page_title="Recipe Manager",
    page_icon="🍳",
    layout="wide",
    initial_sidebar_state="expanded",
)


# Initialize repository in session state (singleton pattern)
# This ensures data persists across Streamlit reruns
def init_repository() -> InMemoryRecipeRepository:
    """Initialize or get existing repository from session state."""
    if "repo" not in st.session_state:
        st.session_state.repo = InMemoryRecipeRepository()
    return st.session_state.repo


def main() -> None:
    # Initialize repository
    repo = init_repository()

    # Initialize use cases with dependency injection
    create_recipe_uc = CreateRecipe(repo)
    list_recipes_uc = ListRecipes(repo)
    get_recipe_uc = GetRecipe(repo)
    update_recipe_uc = UpdateRecipes(repo)
    delete_recipe_uc = DeleteRecipe(repo)

    # App title
    st.title("🍳 Recipe Manager")
    st.markdown("*Manage your recipes with clean architecture*")
    st.divider()

    # Sidebar menu
    st.sidebar.title("Menu")
    menu_option = st.sidebar.radio(
        "Choose an action:",
        ["📋 List All Recipes", "+ Add New Recipe", "✏️ Update Recipe", "🗑️ Delete Recipe"],
    )

    # ====================
    # LIST ALL RECIPES
    # ====================
    if menu_option == "📋 List All Recipes":
        st.header("📋 All Recipes")

        recipes = list_recipes_uc.execute()

        if not recipes:
            st.info("No recipes found. Add your first recipe!")
        else:
            st.success(f"Total recipes: {len(recipes)}")

            # Display recipes in expandable cards
            for recipe in recipes:
                with st.expander(f"🍽️ {recipe.title}"):
                    col1, col2 = st.columns([2, 1])

                    with col1:
                        st.markdown(f"**Description:** {recipe.description}")
                        st.markdown("**Ingredients:**")
                        for ingredient in recipe.ingredients:
                            st.markdown(f"- {ingredient}")

                    with col2:
                        st.markdown(f"**ID:** `{recipe.id[:8]}...`")
                        st.markdown(f"**Created:** {recipe.created_at[:19]}")
                        st.markdown(f"**Updated:** {recipe.updated_at[:19]}")

    # ====================
    # ADD NEW RECIPE
    # ====================
    elif menu_option == "+ Add New Recipe":
        st.header("+ Add New Recipe")

        with st.form("add_recipe_form"):
            title = st.text_input("Recipe Title*", placeholder="e.g., Chocolate Chip Cookies")
            description = st.text_area("Description*", placeholder="A brief description of your recipe...")
            ingredients_text = st.text_area("Ingredients* (one per line)", placeholder="2 cups flour\n1 cup sugar\n1 cup chocolate chips\n2 eggs")

            submitted = st.form_submit_button("Add Recipe", type="primary")

            if submitted:
                # Validation
                if not title or not description or not ingredients_text:
                    st.error("❌ Please fill in all required fields!")
                else:
                    # Parse ingredients (split by newlines and filter empty)
                    ingredients = [ing.strip() for ing in ingredients_text.split("\n") if ing.strip()]

                    # Create recipe
                    recipe = Recipe(title=title, description=description, ingredients=ingredients)

                    # Execute use case
                    created_recipe = create_recipe_uc.execute(recipe)

                    st.success(f"✅ Recipe '{created_recipe.title}' created successfully!")
                    st.balloons()

                    # Show recipe details
                    with st.expander("View created recipe"):
                        st.json(created_recipe.model_dump())

    # ====================
    # UPDATE RECIPE
    # ====================
    elif menu_option == "✏️ Update Recipe":
        st.header("✏️ Update Recipe")

        recipes = list_recipes_uc.execute()

        if not recipes:
            st.warning("No recipes available to update.")
        else:
            # Select recipe to update
            recipe_titles = {f"{r.title} ({r.id[:8]}...)": r.id for r in recipes}
            selected_title = st.selectbox("Select a recipe to update:", list(recipe_titles.keys()))

            if selected_title:
                recipe_id = recipe_titles[selected_title]
                recipe = get_recipe_uc.execute(recipe_id)

                if recipe:
                    st.divider()

                    with st.form("update_recipe_form"):
                        st.subheader(f"Editing: {recipe.title}")

                        new_title = st.text_input("Recipe Title*", value=recipe.title)
                        new_description = st.text_area("Description*", value=recipe.description)
                        new_ingredients_text = st.text_area("Ingredients* (one per line)", value="\n".join(recipe.ingredients))

                        submitted = st.form_submit_button("Update Recipe", type="primary")

                        if submitted:
                            if not new_title or not new_description or not new_ingredients_text:
                                st.error("❌ Please fill in all required fields!")
                            else:
                                # Parse ingredients
                                new_ingredients = [ing.strip() for ing in new_ingredients_text.split("\n") if ing.strip()]

                                # Update recipe (keep same ID and created_at)
                                recipe.title = new_title
                                recipe.description = new_description
                                recipe.ingredients = new_ingredients

                                # Execute use case
                                updated_recipe = update_recipe_uc.execute(recipe)

                                st.success(f"✅ Recipe '{updated_recipe.title}' updated successfully!")
                                st.balloons()

    # ====================
    # DELETE RECIPE
    # ====================
    elif menu_option == "🗑️ Delete Recipe":
        st.header("🗑️ Delete Recipe")

        recipes = list_recipes_uc.execute()

        if not recipes:
            st.warning("No recipes available to delete.")
        else:
            # Select recipe to delete
            recipe_titles = {f"{r.title} ({r.id[:8]}...)": r.id for r in recipes}
            selected_title = st.selectbox("Select a recipe to delete:", list(recipe_titles.keys()))

            if selected_title:
                recipe_id = recipe_titles[selected_title]
                recipe = get_recipe_uc.execute(recipe_id)

                if recipe:
                    st.divider()

                    # Show recipe details
                    with st.expander("📄 Recipe Details"):
                        st.markdown(f"**Title:** {recipe.title}")
                        st.markdown(f"**Description:** {recipe.description}")
                        st.markdown("**Ingredients:**")
                        for ingredient in recipe.ingredients:
                            st.markdown(f"- {ingredient}")

                    # Confirmation
                    st.warning("⚠️ This action cannot be undone!")

                    col1, col2, _ = st.columns([1, 1, 2])

                    with col1:
                        if st.button("🗑️ Delete Recipe", type="primary"):
                            delete_recipe_uc.execute(recipe_id)
                            st.success(f"✅ Recipe '{recipe.title}' deleted successfully!")
                            st.rerun()

                    with col2:
                        if st.button("Cancel"):
                            st.info("Deletion cancelled.")

    # Sidebar info
    st.sidebar.divider()
    st.sidebar.markdown("### 📊 Statistics")
    recipes = list_recipes_uc.execute()
    st.sidebar.metric("Total Recipes", len(recipes))


if __name__ == "__main__":
    main()
