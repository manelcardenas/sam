import os

from src.domain.ports import IngredientParser
from src.infra.adapters.parsing.openai_compatible_parser import FailoverParser, OpenAICompatibleParser
from src.infra.adapters.parsing.recipe_reader import OpenAICompatibleRecipeReader, build_recipe_reader

__all__ = ["FailoverParser", "OpenAICompatibleParser", "OpenAICompatibleRecipeReader", "build_ingredient_parser", "build_recipe_reader"]

# (key env var, base-url env var, model env var).
#
# **Named after the vendor, like GEOAPIFY_API_KEY** — one convention in the env
# file rather than two. The port stays provider-agnostic; this tuple is the only
# place a vendor is named, which is what makes swapping one a config change.
#
# The fallback is second and deliberately unnamed in the repo: it is chosen
# separately, and an empty `<VENDOR>_API_KEY` sitting here for months would just
# be a decision nobody made.
_PROVIDERS = (
    ("DEEPSEEK_API_KEY", "LLM_PRIMARY_BASE_URL", "LLM_PRIMARY_MODEL"),
    ("LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL"),
)


def build_ingredient_parser() -> IngredientParser:
    """Primary, then fallback, then failure.

    Always returns a parser, even when nothing is configured — an unconfigured
    one raises `IngredientParserError` on use rather than at startup, so a
    missing key costs the ingredient box and not the whole API.
    """
    parsers = [
        OpenAICompatibleParser(
            base_url=os.environ.get(base_url_var, ""),
            model=os.environ.get(model_var, ""),
            api_key=os.environ.get(key_var) or None,
        )
        for key_var, base_url_var, model_var in _PROVIDERS
    ]
    return FailoverParser([parser for parser in parsers if parser.configured] or parsers[:1])
