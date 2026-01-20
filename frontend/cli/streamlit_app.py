import streamlit as st
from api_client import RecipeAPIClient


def get_api_client() -> RecipeAPIClient:
    """Get or create API client in session state."""
    if "api" not in st.session_state:
        st.session_state.api = RecipeAPIClient()
    return st.session_state.api


def main() -> None:
    api = get_api_client()
    # App title
    st.title("Recipe Manager")
    st.markdown("*Manage your recipes with clean architecture*")
    st.divider()
    # Sidebar menu
    st.sidebar.title("Menu")
    menu_option = st.sidebar.radio(
        "Choose an action:",
        ["List All Recipes", "+ Add New Recipe", "Update Recipe", "Delete Recipe"],
    )
    # ====================
    # LIST ALL RECIPES
    # ====================
    if menu_option == "List All Recipes":
        st.header("All Recipes")
        try:
            recipes = api.list_recipes()
        except Exception as e:
            st.error(f"Failed to connect to API: {e}")
            return
        if not recipes:
            st.info("No recipes found. Add your first recipe!")
        else:
            st.success(f"Total recipes: {len(recipes)}")
            for recipe in recipes:
                with st.expander(f"{recipe.title}"):
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
        st.header("Add New Recipe")
        with st.form("add_recipe_form"):
            title = st.text_input("Recipe Title*", placeholder="e.g., Chocolate Chip Cookies")
            description = st.text_area("Description*", placeholder="A brief description of your recipe...")
            ingredients_text = st.text_area(
                "Ingredients* (one per line)",
                placeholder="2 cups flour\n1 cup sugar\n1 cup chocolate chips\n2 eggs",
            )
            submitted = st.form_submit_button("Add Recipe", type="primary")
            if submitted:
                if not title or not description or not ingredients_text:
                    st.error("Please fill in all required fields!")
                else:
                    ingredients = [ing.strip() for ing in ingredients_text.split("\n") if ing.strip()]
                    try:
                        created_recipe = api.create_recipe(title, description, ingredients)
                        st.success(f"Recipe '{created_recipe.title}' created successfully!")
                        st.balloons()
                        with st.expander("View created recipe"):
                            st.json(created_recipe.model_dump())
                    except Exception as e:
                        st.error(f"Failed to create recipe: {e}")
    # ====================
    # UPDATE RECIPE
    # ====================
    elif menu_option == "Update Recipe":
        st.header("Update Recipe")
        try:
            recipes = api.list_recipes()
        except Exception as e:
            st.error(f"Failed to connect to API: {e}")
            return
        if not recipes:
            st.warning("No recipes available to update.")
        else:
            recipe_titles = {f"{r.title} ({r.id[:8]}...)": r.id for r in recipes}
            selected_title = st.selectbox("Select a recipe to update:", list(recipe_titles.keys()))
            if selected_title:
                recipe_id = recipe_titles[selected_title]
                recipe = api.get_recipe(recipe_id)
                if recipe:
                    st.divider()
                    with st.form("update_recipe_form"):
                        st.subheader(f"Editing: {recipe.title}")
                        new_title = st.text_input("Recipe Title*", value=recipe.title)
                        new_description = st.text_area("Description*", value=recipe.description)
                        new_ingredients_text = st.text_area(
                            "Ingredients* (one per line)",
                            value="\n".join(recipe.ingredients),
                        )
                        submitted = st.form_submit_button("Update Recipe", type="primary")
                        if submitted:
                            if not new_title or not new_description or not new_ingredients_text:
                                st.error("Please fill in all required fields!")
                            else:
                                new_ingredients = [ing.strip() for ing in new_ingredients_text.split("\n") if ing.strip()]
                                try:
                                    updated_recipe = api.update_recipe(recipe_id, new_title, new_description, new_ingredients)
                                    st.success(f"Recipe '{updated_recipe.title}' updated successfully!")
                                    st.balloons()
                                except Exception as e:
                                    st.error(f"Failed to update recipe: {e}")
    # ====================
    # DELETE RECIPE
    # ====================
    elif menu_option == "Delete Recipe":
        st.header("Delete Recipe")
        try:
            recipes = api.list_recipes()
        except Exception as e:
            st.error(f"Failed to connect to API: {e}")
            return
        if not recipes:
            st.warning("No recipes available to delete.")
        else:
            recipe_titles = {f"{r.title} ({r.id[:8]}...)": r.id for r in recipes}
            selected_title = st.selectbox("Select a recipe to delete:", list(recipe_titles.keys()))
            if selected_title:
                recipe_id = recipe_titles[selected_title]
                recipe = api.get_recipe(recipe_id)
                if recipe:
                    st.divider()
                    with st.expander("Recipe Details"):
                        st.markdown(f"**Title:** {recipe.title}")
                        st.markdown(f"**Description:** {recipe.description}")
                        st.markdown("**Ingredients:**")
                        for ingredient in recipe.ingredients:
                            st.markdown(f"- {ingredient}")
                    st.warning("This action cannot be undone!")
                    col1, col2, _ = st.columns([1, 1, 2])
                    with col1:
                        if st.button("Delete Recipe", type="primary"):
                            try:
                                api.delete_recipe(recipe_id)
                                st.toast(f"Recipe '{recipe.title}' deleted successfully!")
                                st.rerun()
                            except Exception as e:
                                st.error(f"Failed to delete recipe: {e}")
                    with col2:
                        if st.button("Cancel"):
                            st.info("Deletion cancelled.")
    # Sidebar info
    st.sidebar.divider()
    st.sidebar.markdown("### Statistics")
    try:
        recipes = api.list_recipes()
        st.sidebar.metric("Total Recipes", len(recipes))
    except Exception:
        st.sidebar.metric("Total Recipes", "N/A")


if __name__ == "__main__":
    main()
