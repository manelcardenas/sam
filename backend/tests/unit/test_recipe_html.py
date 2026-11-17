"""Reading `schema.org/Recipe` out of real-world page shapes, and the link guard."""

import json

import pytest

from src.domain.entities import RecipePageError
from src.infra.adapters.recipe_pages import check_public_https, page_from_html
from src.infra.adapters.recipe_pages.recipe_html import instructions, minutes, servings


def _page(*blocks: object, body: str = "") -> str:
    scripts = "".join(f'<script type="application/ld+json">{block if isinstance(block, str) else json.dumps(block)}</script>' for block in blocks)
    return f"<html><head>{scripts}<script>var ads = 1;</script></head><body><nav>Menú</nav>{body}</body></html>"


LENTEJAS = {
    "@type": ["Recipe", "NewsArticle"],
    "name": "Lentejas con chorizo",
    "recipeYield": ["4", "4 raciones"],
    "prepTime": "PT15M",
    "cookTime": "PT1H",
    "recipeIngredient": ["300 g de lentejas", " 1  chorizo ", "1 cebolla"],
    "recipeInstructions": [
        {"@type": "HowToSection", "name": "Sofrito", "itemListElement": [{"@type": "HowToStep", "text": "Pica la cebolla."}]},
        {"@type": "HowToStep", "text": "Añade las lentejas."},
    ],
}


def test_a_recipe_inside_a_graph_with_a_list_type_is_found() -> None:
    page = page_from_html("https://example.com/l", _page({"@context": "https://schema.org", "@graph": [{"@type": "WebSite"}, LENTEJAS]}))

    assert page.structured
    assert page.title == "Lentejas con chorizo"
    assert page.ingredient_lines == ["300 g de lentejas", "1 chorizo", "1 cebolla"]
    assert (page.servings, page.prep_time_minutes, page.cook_time_minutes) == (4, 15, 60)
    assert page.instructions == "Sofrito:\nPica la cebolla.\nAñade las lentejas."


def test_a_malformed_block_does_not_hide_a_good_one_after_it() -> None:
    page = page_from_html("https://example.com/l", _page("{not json", LENTEJAS))

    assert page.title == "Lentejas con chorizo"


def test_a_page_without_one_offers_its_visible_text_only() -> None:
    page = page_from_html("https://example.com/l", _page(body="<h1>Tortilla</h1><ul><li>4 huevos</li><li>2 patatas</li></ul>"))

    assert not page.structured
    assert page.text == "Tortilla\n4 huevos\n2 patatas"
    assert "ads" not in page.text
    assert "Menú" not in page.text


@pytest.mark.parametrize(("value", "expected"), [("PT1H15M", 75), ("P1DT2H", 1560), ("PT45S", 1), ("PT0M", None), ("15 min", None), (None, None)])
def test_iso_durations(value: object, expected: int | None) -> None:
    assert minutes(value) == expected


@pytest.mark.parametrize(("value", "expected"), [(4, 4), ("6 personas", 6), (["2", "2 raciones"], 2), ("unas cuantas", None), (0, None), (True, None)])
def test_recipe_yield_as_a_headcount(value: object, expected: int | None) -> None:
    assert servings(value) == expected


def test_instructions_as_one_string_keep_their_lines() -> None:
    assert instructions("Hierve el agua.\n\nEcha la pasta.") == "Hierve el agua.\nEcha la pasta."


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/receta",  # not https
        "https://localhost/receta",
        "https://127.0.0.1/receta",
        "https://10.0.0.5/receta",
        "https://169.254.169.254/latest/meta-data",  # the cloud metadata address
        "https://[::1]/receta",
        "ftp://example.com/receta",
    ],
)
def test_the_guard_refuses_anything_but_public_https(url: str) -> None:
    with pytest.raises(RecipePageError):
        check_public_https(url)


def test_the_guard_lets_a_public_address_through() -> None:
    check_public_https("https://1.1.1.1/receta")
