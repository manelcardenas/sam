import uuid
from datetime import UTC, datetime

from sqlalchemy import or_
from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import Recipe, Viewer, Visibility
from src.domain.ports import RecipeRepository
from src.infra.db import RecipeModel


class PostgresRecipeRepository(RecipeRepository):
    """PostgreSQL-backed implementation of RecipeRepository.

    Uses a synchronous SQLAlchemy session per operation with NullPool,
    which is the correct pattern for Lambda: each call opens a fresh
    connection and closes it immediately, avoiding connection leaks.
    """

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def _to_entity(self, model: RecipeModel) -> Recipe:
        return Recipe(
            id=str(model.id),
            title=model.title,
            instructions=model.instructions,
            ingredients=model.ingredients,
            food_type=model.food_type,
            source_url=str(model.source_url) if model.source_url else None,
            prep_time_minutes=model.prep_time_minutes,
            cook_time_minutes=model.cook_time_minutes,
            tags=model.tags,
            visibility=model.visibility,
            kitchen_id=str(model.kitchen_id) if model.kitchen_id else None,
            created_by=model.created_by,
            created_by_name=model.creator.display_name if model.creator else None,
            created_at=model.created_at.isoformat(),
            updated_at=model.updated_at.isoformat(),
        )

    def add_recipe(self, recipe: Recipe) -> Recipe:
        with self._session_factory() as session:
            model = RecipeModel(
                title=recipe.title,
                instructions=recipe.instructions,
                ingredients=recipe.ingredients.model_dump(),
                food_type=recipe.food_type,
                source_url=recipe.source_url,
                prep_time_minutes=recipe.prep_time_minutes,
                cook_time_minutes=recipe.cook_time_minutes,
                tags=[tag.value for tag in recipe.tags],
                visibility=recipe.visibility,
                kitchen_id=uuid.UUID(recipe.kitchen_id) if recipe.kitchen_id else None,
                created_by=recipe.created_by,
            )
            session.add(model)
            session.commit()
            session.refresh(model)
            return self._to_entity(model)

    def get_recipe(self, recipe_id: str) -> Recipe | None:
        with self._session_factory() as session:
            model = session.get(RecipeModel, uuid.UUID(recipe_id))
            if model is None:
                return None
            return self._to_entity(model)

    def list_recipes(self, created_by: str | None = None, viewer: Viewer | None = None) -> list[Recipe]:
        with self._session_factory() as session:
            query = session.query(RecipeModel)
            if created_by is not None:
                query = query.filter(RecipeModel.created_by == created_by)
            if viewer is not None:
                # `Recipe.visible_to`, in SQL. The two must agree; the in-memory
                # repo runs the Python one, and the Postgres suite pins this one.
                visible = [RecipeModel.visibility == Visibility.PUBLIC, RecipeModel.created_by == viewer.user_id]
                if viewer.kitchen_id is not None:
                    visible.append(RecipeModel.kitchen_id == uuid.UUID(viewer.kitchen_id))
                query = query.filter(or_(*visible))
            return [self._to_entity(m) for m in query.all()]

    def update_recipe(self, recipe: Recipe) -> Recipe:
        with self._session_factory() as session:
            model = session.get(RecipeModel, uuid.UUID(recipe.id))
            if model is None:
                raise KeyError(f"Recipe with id {recipe.id} not found")
            model.title = recipe.title
            model.instructions = recipe.instructions
            model.ingredients = recipe.ingredients.model_dump()
            model.food_type = recipe.food_type
            model.source_url = recipe.source_url
            model.prep_time_minutes = recipe.prep_time_minutes
            model.cook_time_minutes = recipe.cook_time_minutes
            model.tags = [tag.value for tag in recipe.tags]
            model.visibility = recipe.visibility
            model.kitchen_id = uuid.UUID(recipe.kitchen_id) if recipe.kitchen_id else None
            model.updated_at = datetime.now(UTC)
            session.commit()
            session.refresh(model)
            return self._to_entity(model)

    def delete_recipe(self, recipe_id: str) -> None:
        with self._session_factory() as session:
            model = session.get(RecipeModel, uuid.UUID(recipe_id))
            if model is None:
                raise KeyError(f"Recipe with id {recipe_id} not found")
            session.delete(model)
            session.commit()
