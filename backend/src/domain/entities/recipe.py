import enum
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, Field


class FoodType(enum.StrEnum):
    """What kind of thing this is, as a person would say it.

    `GUARNICION` was added for the planner (ingredient-capture-plan §5.3): rice,
    potatoes, a green salad — things you plate *alongside* something else. It is
    a category here rather than a separate entity or a second collection,
    because a `postre` is equally "not a meal, a component of one" and the schema
    accepted that framing four values ago. A guarnición graduates into an
    ordinary recipe the moment somebody writes the method down, exactly as
    ADR-0007 describes.
    """

    BEBIDA = "bebida"
    POSTRE = "postre"
    COMIDA = "comida"
    APERITIVO = "aperitivo"
    GUARNICION = "guarnicion"


class RecipeTag(enum.StrEnum):
    """What a recipe is like, from a fixed set (ADR-0009 §7).

    **Fixed, not free text.** A free tag box grows `tupper`, `Tupper`, `tuper`
    and `para llevar` for one idea, and the Phase 3 AI that fills the week has to
    filter on these exact values.

    **Tupper is positive**: a recipe without it is eaten at home. It exists to
    stop the week being filled with a soup for a lunch that travels.

    ⚡ *rápida* is deliberately absent: it is a fact about the total time
    (`is_quick`), and a stored copy would disagree with the times the moment
    somebody edits them.
    """

    TUPPER = "tupper"
    OVEN = "oven"
    AIR_FRYER = "air_fryer"
    NO_COOK = "no_cook"
    FREEZABLE = "freezable"
    SPICY = "spicy"
    ONE_PAN = "one_pan"
    PRESSURE_COOKER = "pressure_cooker"


#: Total time at or under which a recipe counts as ⚡ quick.
QUICK_MINUTES = 30


class Visibility(enum.StrEnum):
    """Who can see a recipe (ADR-0009 §2).

    `kitchen` is for the simple recipes a household writes for itself —
    "ensalada con carne", "bocatas" — which are not interesting to anybody else.
    A recipe somebody took the trouble to write a method for stays `public`, as
    every recipe was before.
    """

    PUBLIC = "public"
    KITCHEN = "kitchen"


class Viewer(BaseModel):
    """Who is asking for recipes: the person, and the kitchen they live in now.

    The kitchen is what makes a `kitchen` recipe visible, so it travels with the
    person rather than being looked up inside every check.
    """

    user_id: str
    kitchen_id: str | None = None


class Ingredient(BaseModel):
    name: str
    amount: float | None = None
    unit: str | None = None
    #: Sometimes goes in (corn in the salad), so it starts **unticked** when the
    #: recipe goes on the list. Stored, because it is a fact about the recipe,
    #: not about one week.
    optional: bool = False


class Ingredients(BaseModel):
    """`servings` is the headcount the ingredient amounts are sized for."""

    servings: int | None = None
    items: list[Ingredient] = Field(default_factory=list)


class RecipeRef(BaseModel):
    """Enough of a recipe to name it and link to it — for lists that point at recipes."""

    id: str
    title: str


class Recipe(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    instructions: str | None = None
    ingredients: Ingredients
    food_type: FoodType
    source_url: str | None = None
    prep_time_minutes: int | None = None
    cook_time_minutes: int | None = None
    tags: list[RecipeTag] = Field(default_factory=list)
    visibility: Visibility = Visibility.PUBLIC
    #: The household a `kitchen` recipe belongs to. None on public recipes, and on
    #: a kitchen recipe written by somebody who has never opened the planner —
    #: which then only its author sees.
    kitchen_id: str | None = None
    created_by: str  # user ID of the creator
    created_by_name: str | None = None  # creator's display_name, resolved via join
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())

    @property
    def is_quick(self) -> bool:
        """⚡ — derived from the times, never stored (see `RecipeTag`)."""
        total = (self.prep_time_minutes or 0) + (self.cook_time_minutes or 0)
        return 0 < total <= QUICK_MINUTES

    def visible_to(self, viewer: Viewer) -> bool:
        """Whether this person, living in this kitchen, may see the recipe.

        The author always may — including after leaving the kitchen it was
        written for, because it is still theirs.
        """
        if self.visibility == Visibility.PUBLIC or self.created_by == viewer.user_id:
            return True
        return viewer.kitchen_id is not None and self.kitchen_id == viewer.kitchen_id

    def editable_by(self, viewer: Viewer) -> bool:
        """The author, or — for a kitchen recipe — anybody in that kitchen.

        "Ensalada con carne" belongs to the household that eats it, so either
        person can fix the amount of meat. A public recipe stays its author's.
        """
        if self.created_by == viewer.user_id:
            return True
        return self.visibility == Visibility.KITCHEN and viewer.kitchen_id is not None and self.kitchen_id == viewer.kitchen_id
