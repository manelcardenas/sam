from src.domain.entities import Aisle, GroceryItem

# Sent once per call as a stable prefix. Every provider that caches prompt
# prefixes hits this, which is the whole reason the vocabulary goes first and the
# user's text goes last — reorder them and the cache misses on every request.
SYSTEM = """You turn a home cook's free-typed ingredients into structured lines.

Rules, in order of importance:

1. MATCH AGGRESSIVELY ON SPELLING. `spagetiis` is `espaguetis`; `hevos` is
   `huevos`. Phone keyboards and haste are not new ingredients.
2. REFUSE TO MATCH ON CATEGORY. `queso rallado` is NOT `queso parmesano`, and
   `pimienta` is NOT `pimiento`. They are bought in different places and merging
   them puts the wrong thing in the basket.
3. ONE LINE CAN HOLD SEVERAL INGREDIENTS. `aceite, sal, pimienta` is three.
4. NEVER INVENT A QUANTITY. `sal` with no amount stays with no amount. A missing
   amount is information, not an error.
5. A COUNT IS NOT A WEIGHT. `1 patata` is one potato — leave `unit` empty. Only
   set a unit the cook actually wrote or clearly meant: `200 gramos` and `200g`
   are both `200` + `g`. The fourth column below is what that item is usually
   sold by, which tells you `200 de aceite` means millilitres — it never means a
   bare number is one.
6. Keep `raw` exactly as the user wrote that ingredient, so they can see what you
   read. Never translate, tidy or correct it.

For each line either set `grocery_key` to an existing key, or set `proposed` for
a genuinely new ingredient — never both, never neither."""


def vocabulary_block(items: list[GroceryItem]) -> str:
    """`key|es|ca|en|unit` per row, one per line.

    Pipe-delimited rather than JSON because it is roughly half the tokens for the
    same information and this block dominates the request. The key comes first
    because it is what must be echoed back.

    **The unit is guidance for the model, not an instruction to the parser.** It
    used to be applied server-side to any amount that arrived without one, which
    turned `1 patata` into `1 g` of potato and `2 de vainilla` into `2 ml` of
    extract — measured on real data, that rule fired twice and was wrong both
    times, because it could only see that an amount existed, never what the cook
    wrote. The model can see both, so it decides.
    """
    return "\n".join(f"{item.key}|{item.name_es}|{item.name_ca}|{item.name_en}|{item.default_unit or ''}" for item in items)


def aisle_block() -> str:
    """The aisles a proposal may use, so the model cannot invent a twelfth."""
    return ", ".join(aisle.value for aisle in Aisle)


# The forced schema. `additionalProperties: false` and the `required` lists are
# doing real work: without them models cheerfully return a key the parser then
# has to guess the meaning of, and a line with neither `grocery_key` nor
# `proposed` — which is the one shape the domain forbids.
TOOL_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "raw": {"type": "string", "description": "The user's own words for this ingredient, verbatim"},
                    "grocery_key": {"type": ["string", "null"], "description": "An existing vocabulary key, or null if this is new"},
                    "proposed": {
                        "type": ["object", "null"],
                        "description": "Only when grocery_key is null",
                        "properties": {
                            "name_es": {"type": "string"},
                            "name_ca": {"type": "string"},
                            "name_en": {"type": "string"},
                            "aisle": {"type": "string", "enum": [aisle.value for aisle in Aisle]},
                            "is_pantry": {"type": "boolean"},
                        },
                        "required": ["name_es", "name_ca", "name_en", "aisle", "is_pantry"],
                        "additionalProperties": False,
                    },
                    "amount": {"type": ["number", "null"]},
                    "unit": {"type": ["string", "null"]},
                },
                "required": ["raw", "grocery_key", "proposed", "amount", "unit"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["lines"],
    "additionalProperties": False,
}


def user_block(text: str, servings: int) -> str:
    return f"Para {servings} personas.\n\n{text}"
