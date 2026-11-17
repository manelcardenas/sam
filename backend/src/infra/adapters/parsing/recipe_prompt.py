from src.domain.entities import Aisle, GroceryItem, RecipeTag

# The stable prefix: identical bytes on every call, so a provider that caches
# prompt prefixes (DeepSeek does) bills it once. The vocabulary follows it, and
# the person's recipe goes last — reorder them and every request misses.
SYSTEM = """You read one home recipe — pasted text, a web page, or a photo — and fill in the tool.
The cooks write in Spanish or Catalan. Keep their words; never translate them.

INGREDIENT LINES (the most important part)

1. `ingredient_lines` is the recipe's ingredient list, ONE ENTRY PER LINE, COPIED
   VERBATIM, in order. Never merge two lines, never skip one, never add one. A
   line like "Para la salsa:" is a heading, not an ingredient — leave it out.
   If you were given the lines already, return them exactly as given.
2. `ingredients` has at least one row per line, and `line` is that line's index
   (0-based). One line can hold several ingredients: "sal y pimienta" is two rows
   with the same `line`.
3. `raw` is that ingredient's words as written. Do not tidy or correct them.

MATCHING

4. Match the vocabulary on SPELLING, generously: "spagetiis" is "espaguetis",
   "hevos" is "huevos", plurals and Catalan forms are the same product.
5. Never match on CATEGORY: "queso rallado" is NOT "queso parmesano", "pimienta"
   is NOT "pimiento". Different shelf, different product.
6. Each row sets `grocery_key` to an existing key, or `proposed` to a genuinely
   new product (all three names, an aisle, whether it is usually already at home,
   and its usual unit: "g", "ml", or null when it is counted) — never both.

AMOUNTS AND UNITS

7. Never invent an amount. "sal", "aceite al gusto" have no amount (null).
8. Use the unit the product is written in. The vocabulary's `unit` column is how
   it is bought ("g", "ml", or empty = counted), and the `usage` column is how
   THIS kitchen's recipes have written it ("g:6" = six recipes in grams, "count:2" = two counted it). Follow
   those unless the line clearly says another unit.
9. A count is not a weight: "4 patatas" is amount 4, unit null. But when the
   product is bought by weight (unit g) and the line counts pieces, ALSO set
   `grams_estimate` to your estimate of the total weight ("4 patatas medianas" ≈
   800). Otherwise `grams_estimate` is null.
10. Units in their short form: g, kg, ml, l, cucharada, cucharadita, diente, lata…
    "200 gramos" is 200 + "g".
11. `optional` is true when the recipe says so: "opcional", "(opcional)", "si
    quieres", "para decorar". "Al gusto" alone is not optional — it is an
    ingredient with no amount.

THE REST

12. `title`: the recipe's name, or null if there is none.
13. `servings`: ONLY when the text states it ("para 4 personas", "4 raciones").
    Otherwise null. Never guess.
14. `prep_time_minutes`, `cook_time_minutes`: only when stated. Otherwise null.
15. `instructions`: the method, as written, steps on separate lines. Null if the
    source has none. For a photo, transcribe it.
16. `tags`: only the ones that clearly apply, from this list —
      tupper: travels well in a lunchbox and is eaten later. NOT soups, NOT
        salads, NOT anything that must be eaten freshly made.
      oven: needs the oven.     air_fryer: made in an air fryer.
      no_cook: nothing is cooked.     freezable: freezes well once made.
      spicy: noticeably hot.     one_pan: one pan or pot for everything.
      pressure_cooker: made in a pressure cooker (olla exprés).
    When unsure, leave a tag out."""


def vocabulary_block(items: list[GroceryItem], usage: dict[str, dict[str, int]]) -> str:
    """`key|es|ca|en|unit|usage` per row, usage like `g:6 count:1`.

    Pipe-delimited for the same reason as the ingredient box's prompt: half the
    tokens of JSON for the block that dominates the request. `usage` is empty for
    most rows and only says something where this kitchen has written the product
    before — which is exactly where it should outvote the model's habits.
    """
    return "\n".join(f"{item.key}|{item.name_es}|{item.name_ca}|{item.name_en}|{item.default_unit or ''}|{_usage(usage.get(item.key))}" for item in items)


def _usage(counts: dict[str, int] | None) -> str:
    if not counts:
        return ""
    return " ".join(f"{unit or 'count'}:{n}" for unit, n in sorted(counts.items(), key=lambda kv: -kv[1]))


def user_block(text: str | None, known_lines: list[str] | None) -> str:
    """The person's recipe. With `known_lines`, the lines are fixed and only need structuring."""
    if known_lines is not None:
        numbered = "\n".join(f"{i}: {line}" for i, line in enumerate(known_lines))
        return f"The ingredient lines are already known — return them exactly:\n{numbered}\n\nThe recipe:\n{text or ''}"
    return text or "Read the recipe in the photo."


_NULLABLE_INT = {"type": ["integer", "null"]}

_PROPOSAL = {
    "type": "object",
    "properties": {
        "name_es": {"type": "string"},
        "name_ca": {"type": "string"},
        "name_en": {"type": "string"},
        "aisle": {"type": "string", "enum": [aisle.value for aisle in Aisle]},
        "is_pantry": {"type": "boolean"},
        "default_unit": {"type": ["string", "null"]},
    },
    "required": ["name_es", "name_ca", "name_en", "aisle", "is_pantry", "default_unit"],
    "additionalProperties": False,
}

# Every object lists all its properties as required, with no extras: DeepSeek's
# strict mode refuses a schema that does not, and a schema it validates is the
# difference between parsing an answer and hoping for one.
TOOL_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "title": {"type": ["string", "null"]},
        "servings": _NULLABLE_INT,
        "prep_time_minutes": _NULLABLE_INT,
        "cook_time_minutes": _NULLABLE_INT,
        "tags": {"type": "array", "items": {"type": "string", "enum": [tag.value for tag in RecipeTag]}},
        "instructions": {"type": ["string", "null"]},
        "ingredient_lines": {"type": "array", "items": {"type": "string"}},
        "ingredients": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "line": {"type": "integer"},
                    "raw": {"type": "string"},
                    "grocery_key": {"type": ["string", "null"]},
                    # `anyOf` with null rather than `"type": ["object", "null"]`:
                    # strict mode accepts type lists only of scalar types.
                    "proposed": {"anyOf": [_PROPOSAL, {"type": "null"}]},
                    "amount": {"type": ["number", "null"]},
                    "unit": {"type": ["string", "null"]},
                    "optional": {"type": "boolean"},
                    "grams_estimate": {"type": ["number", "null"]},
                },
                "required": ["line", "raw", "grocery_key", "proposed", "amount", "unit", "optional", "grams_estimate"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "servings", "prep_time_minutes", "cook_time_minutes", "tags", "instructions", "ingredient_lines", "ingredients"],
    "additionalProperties": False,
}


def aisle_block() -> str:
    return ", ".join(aisle.value for aisle in Aisle)
