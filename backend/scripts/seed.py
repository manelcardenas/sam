"""Seed script — loads the 14 real recipes into PostgreSQL.

HOW TO RUN (local)
------------------
Make sure postgres is running, then from the repo root:

    docker compose up postgres -d
    uv run alembic upgrade head       # (only needed on a fresh DB)
    uv run python -m backend.scripts.seed

The script is IDEMPOTENT — it skips recipes whose title already exists. Safe to re-run.

SCHEMA
------
  instructions (str)   — recipe steps
  ingredients  (JSONB) — {"servings": null, "items": [{"name": x} for x in list]}
  food_type            — comida/postre/bebida/aperitivo
  created_by           — seed placeholder user (see SEED_USER below)
"""

import sys
from pathlib import Path

# Allow running as `python -m backend.scripts.seed` from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import select  # noqa: E402

from src.domain.entities.recipe import FoodType  # noqa: E402
from src.infra.db import DatabaseConnectionPool, RecipeModel, UserModel, build_dsn  # noqa: E402

# ---------------------------------------------------------------------------
# Placeholder user — all seeded recipes are attributed to this system user.
# Replace the id with a real Cognito sub once real user accounts exist.
# ---------------------------------------------------------------------------
SEED_USER_ID = "f16970fe-00a1-70cc-f835-a81fff1fadec"
SEED_USER = {
    "id": SEED_USER_ID,
    "display_name": "Nel",
    "email": "manelcardenas5@gmail.com",
    "display_name_set_by_user": True,  # a chosen name — skips the /profile/complete gate
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


def run() -> None:
    db = DatabaseConnectionPool(dsn=build_dsn())
    db.open()

    with db.session_factory() as session:
        # --- Ensure the seed user exists (FK on recipes.created_by) ---
        existing_user = session.get(UserModel, SEED_USER_ID)
        if existing_user is None:
            session.add(UserModel(**SEED_USER))
            session.commit()
            print(f"✓ Created seed user: {SEED_USER['email']}")
        else:
            print(f"  Seed user already exists: {SEED_USER['email']}")

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

    db.close()
    print(f"\nDone — {inserted} inserted, {skipped} skipped.")


if __name__ == "__main__":
    run()
