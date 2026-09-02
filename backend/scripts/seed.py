"""Seed script — loads the 14 real recipes plus a DINE dev fixture into PostgreSQL.

HOW TO RUN (local)
------------------
Make sure postgres is running, then from the repo root:

    docker compose up postgres -d
    uv run alembic upgrade head       # (only needed on a fresh DB)
    uv run python -m backend.scripts.seed

The script is IDEMPOTENT — it skips recipes and restaurants whose title/name
already exists. Safe to re-run.

SCHEMA
------
  instructions (str)   — recipe steps
  ingredients  (JSONB) — {"servings": null, "items": [{"name": x} for x in list]}
  food_type            — comida/postre/bebida/aperitivo
  created_by           — seed placeholder user (see SEED_USER below)

DINE FIXTURE
------------
RESTAURANTS/REVIEWS below are invented, not copied from production: local dev
data lives in git, and real people's review comments should not. The set is
chosen to cover every state the dine page can render — see the comment above
RESTAURANTS.

Review dates are offsets from *today*, so the "Lately" rail is always populated
no matter when the seed runs. Hardcoded dates would silently age out of it.

RESETTING THE DINE FIXTURE (local only)
---------------------------------------
The seed skips restaurants whose name already exists, so editing an entry above
has no effect until the old row is gone. To drop everything this script created
and nothing else — reviews cascade from restaurants:

    DELETE FROM restaurants WHERE created_by IN (
        'dev-martina', 'f16970fe-00a1-70cc-f835-a81fff1fadec');
    DELETE FROM users WHERE id = 'dev-martina';

Restaurants you added yourself through the UI have a different created_by and
are left alone. Never run this against Neon.
"""

import sys
from pathlib import Path

# Allow running as `python -m backend.scripts.seed` from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dotenv import load_dotenv

load_dotenv()

from datetime import date, timedelta  # noqa: E402

from sqlalchemy import select  # noqa: E402

from src.domain.entities.recipe import FoodType  # noqa: E402
from src.infra.db import (  # noqa: E402
    CuisineModel,
    DatabaseConnectionPool,
    RecipeModel,
    RestaurantModel,
    ReviewModel,
    UserModel,
    build_dsn,
)

# ---------------------------------------------------------------------------
# Placeholder user — all seeded recipes are attributed to this system user.
# Replace the id with a real Cognito sub once real user accounts exist.
# ---------------------------------------------------------------------------
SEED_USER_ID = "f16970fe-00a1-70cc-f835-a81fff1fadec"
SEED_USER = {
    "id": SEED_USER_ID,
    "display_name": "Nel",  # a non-NULL name — already "chosen", skips the /profile/complete gate
    "email": "manelcardenas5@gmail.com",
}

# A second reviewer, so cards can show more than one name and the "Reviewed by
# me" filter has something to exclude. Obviously-fake id: nothing in prod can
# collide with it, which makes the cleanup query in this module's docstring safe.
DEV_USER_ID = "dev-martina"
DEV_USER = {
    "id": DEV_USER_ID,
    "display_name": "Martina",
    "email": "martina@example.com",
}


def _items(raw: list[str]) -> list[dict]:
    """Convert a flat list of ingredient strings to the JSONB items format."""
    return [{"name": ingredient} for ingredient in raw]


# ---------------------------------------------------------------------------
# The 14 recipes to seed into PostgreSQL.
# ---------------------------------------------------------------------------
RECIPES: list[dict] = [
    {
        "title": "Carrot cake",
        "instructions": "Carrotcake",
        "ingredients": {"servings": None, "items": _items(["Zanahoria"])},
        "food_type": FoodType.POSTRE,
    },
    {
        "title": "Arroz con leche",
        "instructions": "Arroz",
        "ingredients": {"servings": None, "items": _items(["2 de vainilla"])},
        "food_type": FoodType.POSTRE,
    },
    {
        "title": "Pollo curry",
        "instructions": "Pollo curry",
        "ingredients": {"servings": None, "items": _items(["Buscar"])},
        "food_type": FoodType.COMIDA,
    },
    {
        "title": "Pancakes",
        "instructions": "Tortitas\n\nhttps://recetasdecocina.elmundo.es/2020/01/tortitas-pancakes-receta-facil.html",
        "ingredients": {
            "servings": 6,
            "items": _items(
                [
                    "1 huevos",
                    "200 ml de leche entera",
                    "120 gramos de harina",
                    "30 ml de aceite de girasol",
                    "1 sobre de levadura",
                    "Sal",
                    "Canela",
                ]
            ),
        },
        "food_type": FoodType.POSTRE,
        "source_url": "https://recetasdecocina.elmundo.es/2020/01/tortitas-pancakes-receta-facil.html",
    },
    {
        "title": "Hummus",
        "instructions": ("Netejar els cigrons\nTriturar amb una mica d'aigua i oli\nTriturar també l'all\nAfegir espècies i llimona al gust"),
        "ingredients": {
            "servings": None,
            "items": _items(
                [
                    "1 pot de cigrons",
                    "1 all (o 2)",
                    "Aigua",
                    "Oli",
                    "Suc de llimona (aprox 1/2-1)",
                    "Comino",
                    "Pimentón",
                    "Sal",
                    "Pebre",
                ]
            ),
        },
        "food_type": FoodType.APERITIVO,
    },
    {
        "title": "Banana bread",
        "instructions": ("Molde rectangular (para 8 aprox)\nPrecalentar horno 180°\nMantequilla + azucar\nHuevos y plátanos\nHarina y levadura\nNueces y chocolate"),
        "ingredients": {
            "servings": 8,
            "items": _items(
                [
                    "Mantequilla temperatura ambiente 75g",
                    "Azúcar moreno 60g",
                    "Azúcar blanco 50g",
                    "Huevo M 2",
                    "Plátano maduro 4",
                    "Harina de trigo 225g",
                    "Levadura química 15g",
                    "Nueces 50g",
                    "Virutas de chocolate negro",
                ]
            ),
        },
        "food_type": FoodType.POSTRE,
    },
    {
        "title": "Pimientos del padrón",
        "instructions": "Air fryer a 180° C 20 minutos\nAñadir aceite y sal\nAún por perfeccionar",
        "ingredients": {
            "servings": None,
            "items": _items(["Pimientos semi picantes del Mercadona"]),
        },
        "food_type": FoodType.APERITIVO,
        "prep_time_minutes": 5,
        "cook_time_minutes": 20,
    },
    {
        "title": "Pastel de manzana y vainilla",
        "instructions": "Manzana y vainilla",
        "ingredients": {"servings": None, "items": _items(["Manzana", "Vainilla"])},
        "food_type": FoodType.POSTRE,
    },
    {
        "title": "Carne en salsa",
        "instructions": (
            "Para 10 personas\n\n"
            "1. Enharinar y sellar la carne\n"
            "2. Hacer el sofrito\n"
            "3. Añadir el vino y cocinarlo\n"
            "4. Añadir el caldo y la carne\n"
            "5. 25 minutos en la olla exprés"
        ),
        "ingredients": {
            "servings": 10,
            "items": _items(
                [
                    "1KG de Carne",
                    "4 zanahorias",
                    "1 puerro",
                    "1 cebolla",
                    "2 tomates maduras",
                    "Concentrado de tomate",
                    "2 bandejas de setas",
                    "Beicon opcional",
                    "125ml de vino",
                    "1l de caldo de carne",
                ]
            ),
        },
        "food_type": FoodType.COMIDA,
    },
    {
        "title": "Guisantes a la Nel",
        "instructions": "Guisantes",
        "ingredients": {"servings": None, "items": _items(["Guisantes"])},
        "food_type": FoodType.COMIDA,
    },
    {
        "title": "Lasaña",
        "instructions": "Lasaña",
        "ingredients": {"servings": None, "items": _items(["Lasaña"])},
        "food_type": FoodType.COMIDA,
    },
    {
        "title": "Gyozas",
        "instructions": "Gyozas",
        "ingredients": {"servings": None, "items": _items(["Gyozas"])},
        "food_type": FoodType.COMIDA,
    },
    {
        "title": "Vichisoise",
        "instructions": (
            "Cortar el puerro en rodajas finas y sofreír con un poco de mantequilla. "
            "Añadir las patatas peladas y cortadas y cubrir de agua/caldo. "
            "Añadir sal y pimienta.\n"
            "Cocer hasta que esté hecha la patata.\n"
            "Triturar y añadir leche al gusto"
        ),
        "ingredients": {
            "servings": 2,
            "items": _items(["1 puerro", "1 patata", "Caldo/agua", "Mantequilla", "Leche"]),
        },
        "food_type": FoodType.COMIDA,
    },
    {
        "title": "Sam",
        "instructions": "Samita al horno",
        "ingredients": {
            "servings": None,
            "items": _items(["Oreja", "Culo estropajo", "Tonel"]),
        },
        "food_type": FoodType.APERITIVO,
    },
]


# ---------------------------------------------------------------------------
# The DINE fixture. Invented places — see the module docstring.
#
# Every entry exists to put the dine page into a state that is otherwise
# awkward to reach by hand:
#
#   Cal Peret ............. two reviewers, newest visit has a comment (the happy path)
#   Sakura Ramen-ya ....... newest visit has NO comment, an older one does, so
#                           last_comment_at != last_visited_at and the quote
#                           must carry its own date
#   El Racó del Mar ....... reviewed but never commented -> "N visits, no notes written"
#   Curry Leaf ............ no reviews at all -> "Not reviewed yet", and null score badge
#   Bao & Bun ............. comment long enough to hit the line clamp
#   Casa de Comidas ... ... name long enough to hit the two-line heading clamp
#   Chez Amelie ........... Unmapped: no coordinates, no external_place_id
#   Taqueria Don Chuy ..... three reviews from two people -> review_count > reviewers
#
# `days_ago` is subtracted from today at run time.
# ---------------------------------------------------------------------------
RESTAURANTS: list[dict] = [
    {
        "name": "Cal Peret",
        "address": "Carrer de Blai 22, Barcelona",
        "price_level": 2,
        "latitude": 41.3742,
        "longitude": 2.1631,
        "cuisines": ["Spanish"],
        "created_by": SEED_USER_ID,
        "reviews": [
            {
                "user_id": SEED_USER_ID,
                "scores": (7.0, 8.5, 7.5, 8.0),
                "comment": "Les braves son les millors del barri, tornarem segur.",
                "days_ago": 3,
            },
            {"user_id": DEV_USER_ID, "scores": (7.5, 8.0, 8.0, 8.5), "comment": None, "days_ago": 24},
        ],
    },
    {
        "name": "Trattoria da Lucia",
        "address": "Carrer de Girona 61, Barcelona",
        "price_level": 3,
        "latitude": 41.3925,
        "longitude": 2.1712,
        "cuisines": ["Italian"],
        "created_by": DEV_USER_ID,
        "reviews": [
            {
                "user_id": DEV_USER_ID,
                "scores": (8.0, 9.0, 8.5, 7.0),
                "comment": "Cacio e pepe fet a taula. Car pero val la pena.",
                "days_ago": 6,
            },
        ],
    },
    {
        # The case that justifies last_comment_at existing as its own field.
        "name": "Sakura Ramen-ya",
        "address": "Carrer del Consell de Cent 300, Barcelona",
        "price_level": 2,
        "latitude": 41.3889,
        "longitude": 2.1620,
        "cuisines": ["Japanese"],
        "created_by": SEED_USER_ID,
        "reviews": [
            # Newest visit, deliberately silent.
            {"user_id": SEED_USER_ID, "scores": (6.5, 8.5, 7.0, 8.0), "comment": None, "days_ago": 9},
            # so the card has to quote this one, and say when it was said.
            {
                "user_id": DEV_USER_ID,
                "scores": (7.0, 9.0, 7.5, 8.0),
                "comment": "El tonkotsu es espes com ha de ser. Cua llarga a les 21h.",
                "days_ago": 41,
            },
        ],
    },
    {
        "name": "El Raco del Mar",
        "address": "Passeig Joan de Borbo 44, Barcelona",
        "price_level": 4,
        "latitude": 41.3765,
        "longitude": 2.1889,
        "cuisines": ["Mediterranean", "Spanish"],
        "created_by": SEED_USER_ID,
        # Reviewed, never commented.
        "reviews": [
            {"user_id": SEED_USER_ID, "scores": (9.0, 8.0, 7.0, 5.5), "comment": None, "days_ago": 15},
        ],
    },
    {
        "name": "Bao & Bun",
        "address": "Carrer de Sepulveda 130, Barcelona",
        "price_level": 1,
        "latitude": 41.3831,
        "longitude": 2.1585,
        "cuisines": ["Chinese"],
        "created_by": DEV_USER_ID,
        "reviews": [
            {
                "user_id": DEV_USER_ID,
                "scores": (6.0, 8.5, 7.0, 9.5),
                # Long on purpose: the card clamps at two lines, the rail at three.
                "comment": (
                    "Vam demanar de tot i encara vam pagar menys de vint euros cadascun. "
                    "El bao de porc esta molt be, el de bolets una mica sec, i la sopa "
                    "picant es massa picant si no avises. Local petit, sense reserves, "
                    "millor anar-hi aviat."
                ),
                "days_ago": 12,
            },
        ],
    },
    {
        "name": "Verd Vega",
        "address": "Carrer de Verdi 18, Barcelona",
        "price_level": 2,
        "latitude": 41.4041,
        "longitude": 2.1573,
        "cuisines": ["Vegan/Vegetarian"],
        "created_by": SEED_USER_ID,
        "reviews": [
            {
                "user_id": DEV_USER_ID,
                "scores": (8.5, 8.0, 8.5, 7.5),
                "comment": "El menu del dia canvia cada setmana i sempre encerten.",
                "days_ago": 19,
            },
            {
                "user_id": SEED_USER_ID,
                "scores": (8.0, 7.5, 8.0, 7.5),
                "comment": "Massa soroll a dins pero el hummus de remolatxa s'ho val.",
                "days_ago": 52,
            },
        ],
    },
    {
        # Long name: exercises the two-line heading clamp on the card.
        "name": "Casa de Comidas La Providencia del Barrio Antiguo",
        "address": "Carrer dels Tallers 77, Barcelona",
        "price_level": 1,
        "latitude": 41.3846,
        "longitude": 2.1673,
        "cuisines": ["Spanish"],
        "created_by": SEED_USER_ID,
        "reviews": [
            {
                "user_id": SEED_USER_ID,
                "scores": (5.0, 7.5, 6.5, 9.0),
                "comment": "Menu de 12 euros amb vi inclos. No hi vagis per la decoracio.",
                "days_ago": 31,
            },
        ],
    },
    {
        # Unmapped: added by hand, so no coordinates and no external_place_id.
        "name": "Chez Amelie",
        "address": None,
        "price_level": 3,
        "latitude": None,
        "longitude": None,
        "cuisines": ["French"],
        "created_by": DEV_USER_ID,
        "reviews": [
            {
                "user_id": DEV_USER_ID,
                "scores": (8.0, 8.5, 9.0, 6.5),
                "comment": "Nomes vuit taules. Cal reservar amb dies.",
                "days_ago": 62,
            },
        ],
    },
    {
        # Three reviews from two people: review_count must not be read as reviewer count.
        "name": "Taqueria Don Chuy",
        "address": "Carrer de Bailen 40, Barcelona",
        "price_level": 1,
        "latitude": 41.3936,
        "longitude": 2.1745,
        "cuisines": ["Mexican"],
        "created_by": SEED_USER_ID,
        "reviews": [
            {
                "user_id": SEED_USER_ID,
                "scores": (6.0, 9.0, 7.5, 9.0),
                "comment": "El pastor amb pinya, sempre. Tercera vegada aquest mes.",
                "days_ago": 5,
            },
            {"user_id": SEED_USER_ID, "scores": (6.0, 8.5, 7.0, 9.0), "comment": None, "days_ago": 28},
            {
                "user_id": DEV_USER_ID,
                "scores": (6.5, 8.0, 8.0, 8.5),
                "comment": "Salsa verda perillosa.",
                "days_ago": 70,
            },
        ],
    },
    {
        # No reviews at all: null score badge and the "be the first" empty state.
        "name": "Curry Leaf",
        "address": "Carrer de Casanova 90, Barcelona",
        "price_level": 2,
        "latitude": 41.3866,
        "longitude": 2.1546,
        "cuisines": ["Indian"],
        "created_by": DEV_USER_ID,
        "reviews": [],
    },
]


def run() -> None:
    db = DatabaseConnectionPool(dsn=build_dsn())
    db.open()

    with db.session_factory() as session:
        # --- Ensure the seed users exist (FK on recipes/restaurants.created_by) ---
        for user in (SEED_USER, DEV_USER):
            if session.get(UserModel, user["id"]) is None:
                session.add(UserModel(**user))
                session.commit()
                print(f"✓ Created seed user: {user['email']}")
            else:
                print(f"  Seed user already exists: {user['email']}")

        # --- Insert recipes, skipping titles that already exist ---
        inserted = 0
        skipped = 0
        for data in RECIPES:
            exists = session.execute(select(RecipeModel).where(RecipeModel.title == data["title"])).scalar_one_or_none()

            if exists is not None:
                print(f"  Skipping (already exists): {data['title']}")
                skipped += 1
                continue

            session.add(
                RecipeModel(
                    title=data["title"],
                    instructions=data["instructions"],
                    ingredients=data["ingredients"],
                    food_type=data["food_type"],
                    source_url=data.get("source_url"),
                    prep_time_minutes=data.get("prep_time_minutes"),
                    cook_time_minutes=data.get("cook_time_minutes"),
                    created_by=SEED_USER_ID,
                )
            )
            inserted += 1
            print(f"✓ Inserting: {data['title']}")

        session.commit()
        print(f"\nRecipes — {inserted} inserted, {skipped} skipped.")

        # --- Insert the dine fixture, skipping names that already exist ---
        vocabulary = {c.name: c for c in session.execute(select(CuisineModel)).scalars()}
        places_added = 0
        places_skipped = 0
        reviews_added = 0
        today = date.today()

        for data in RESTAURANTS:
            exists = session.execute(select(RestaurantModel).where(RestaurantModel.name == data["name"])).scalar_one_or_none()
            if exists is not None:
                print(f"  Skipping (already exists): {data['name']}")
                places_skipped += 1
                continue

            # Unknown tags would be dropped silently by the association below,
            # leaving a restaurant with no cuisine and no explanation.
            unknown = [name for name in data["cuisines"] if name not in vocabulary]
            if unknown:
                raise SystemExit(f"Cuisine(s) {unknown} for {data['name']} are not in the vocabulary — run `alembic upgrade head` first.")

            restaurant = RestaurantModel(
                name=data["name"],
                address=data["address"],
                price_level=data["price_level"],
                latitude=data["latitude"],
                longitude=data["longitude"],
                created_by=data["created_by"],
                cuisines=[vocabulary[name] for name in data["cuisines"]],
            )
            session.add(restaurant)
            # Flush rather than commit: restaurant.id is server-generated and the
            # reviews need it, but the whole fixture should still land atomically.
            session.flush()

            for review in data["reviews"]:
                location, food, service, value = review["scores"]
                session.add(
                    ReviewModel(
                        restaurant_id=restaurant.id,
                        user_id=review["user_id"],
                        location_score=location,
                        food_score=food,
                        service_score=service,
                        value_score=value,
                        comment=review["comment"],
                        visited_at=today - timedelta(days=review["days_ago"]),
                    )
                )
                reviews_added += 1

            places_added += 1
            print(f"✓ Inserting: {data['name']} ({len(data['reviews'])} review(s))")

        session.commit()

    db.close()
    print(f"Restaurants — {places_added} inserted, {places_skipped} skipped, {reviews_added} review(s) added.")


if __name__ == "__main__":
    run()
