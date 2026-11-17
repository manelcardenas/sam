import json
import logging
import os

import httpx
from pydantic import ValidationError

from src.domain.entities import GroceryItem, ReadRecipe, RecipeReaderError
from src.domain.ports import RecipeReader, RecipeSource
from src.infra.adapters.parsing.recipe_prompt import SYSTEM, TOOL_SCHEMA, aisle_block, user_block, vocabulary_block

logger = logging.getLogger(__name__)

# A whole recipe — method included — is a few hundred output tokens, where the
# ingredient box is a few dozen. Measured with deepseek-flash: ~1 s for a short
# list; a long recipe with its method is several times that. 60 s is generous on
# purpose: the person is watching a "leyendo…" state, and an answer at 20 s is
# far better than a timeout at 15. Vercel's function limit is 300 s.
TIMEOUT_SECONDS = 60.0

_TOOL = "read_recipe"


class OpenAICompatibleRecipeReader(RecipeReader):
    """`RecipeReader` over any provider that speaks the OpenAI chat API (ADR-0009 §8).

    Configured for **DeepSeek's `deepseek-flash`** by default — cheap, reads
    photos, and supports **strict tool calls**: the provider itself validates the
    answer against `TOOL_SCHEMA`, which its `json_object` mode does not (that one
    guarantees JSON, not its shape). Strict mode lives on DeepSeek's `/beta`
    endpoint, hence the default base URL.

    `thinking` is switched off because DeepSeek's thinking mode refuses a forced
    `tool_choice`, and extraction gains nothing from it. It is DeepSeek's field;
    if a fallback provider ever rejects unknown fields, this is the line to make
    conditional.
    """

    def __init__(self, *, base_url: str, model: str, api_key: str | None, timeout: float = TIMEOUT_SECONDS) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._api_key = api_key
        self._timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self._api_key and self._base_url and self._model)

    def read(self, source: RecipeSource, vocabulary: list[GroceryItem], usage: dict[str, dict[str, int]]) -> ReadRecipe:
        if not self.configured:
            raise RecipeReaderError("The recipe reader is not configured")

        prompt = user_block(source.text, source.known_lines)
        content: str | list[dict] = prompt
        if source.image:
            content = [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": source.image}}]

        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": f"{SYSTEM}\n\nAisles: {aisle_block()}\n\nVocabulary (key|es|ca|en|unit|usage):\n{vocabulary_block(vocabulary, usage)}"},
                {"role": "user", "content": content},
            ],
            "tools": [{"type": "function", "function": {"name": _TOOL, "strict": True, "parameters": TOOL_SCHEMA}}],
            "tool_choice": {"type": "function", "function": {"name": _TOOL}},
            "thinking": {"type": "disabled"},
            # Extraction, not writing: the same recipe read twice should give the
            # same rows, or "Volver a leer" shows changes nobody made.
            "temperature": 0,
        }

        try:
            response = httpx.post(f"{self._base_url}/chat/completions", json=payload, headers={"Authorization": f"Bearer {self._api_key}"}, timeout=self._timeout)
            response.raise_for_status()
            body = response.json()
        except httpx.HTTPStatusError as error:
            raise RecipeReaderError(f"{self._model} refused the request: {error.response.status_code} {error.response.text[:300]}") from error
        except (httpx.HTTPError, ValueError) as error:
            raise RecipeReaderError(f"{self._model} did not answer: {error}") from error

        usage_report = body.get("usage") or {}
        logger.info(
            "Recipe read by %s: %s prompt tokens (%s cached), %s completion tokens",
            self._model,
            usage_report.get("prompt_tokens"),
            usage_report.get("prompt_cache_hit_tokens"),
            usage_report.get("completion_tokens"),
        )

        try:
            arguments = body["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
            return ReadRecipe.model_validate_json(arguments)
        except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValidationError) as error:
            # Off-schema output is a failure, not something to salvage: half a
            # recipe looks like a whole one to the person reviewing it.
            raise RecipeReaderError(f"{self._model} returned something unusable: {error}") from error


def build_recipe_reader() -> RecipeReader:
    """DeepSeek by default; `LLM_RECIPE_MODEL` / `LLM_RECIPE_BASE_URL` change it without a deploy.

    The key is the one the ingredient box already uses, so production needs no
    new secret.
    """
    return OpenAICompatibleRecipeReader(
        base_url=os.environ.get("LLM_RECIPE_BASE_URL") or "https://api.deepseek.com/beta",
        model=os.environ.get("LLM_RECIPE_MODEL") or "deepseek-flash",
        api_key=os.environ.get("DEEPSEEK_API_KEY") or None,
    )
