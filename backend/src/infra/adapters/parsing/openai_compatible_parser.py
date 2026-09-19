import json
import logging

import httpx
from pydantic import ValidationError

from src.domain.entities import GroceryItem, IngredientParserError, ParsedIngredients
from src.domain.ports import IngredientParser
from src.infra.adapters.parsing.prompt import SYSTEM, TOOL_SCHEMA, aisle_block, user_block, vocabulary_block

logger = logging.getLogger(__name__)

# 8 seconds, then the caller tries the other provider — worst case ~17s before
# the user lands in the manual fallback. **API Gateway kills the integration at
# 30s regardless of the Lambda timeout**, and cold start plus auth plus the
# database eat around 4s of that, so a more patient budget would mean a slow
# primary shows the user nothing at all rather than showing them a fallback.
TIMEOUT_SECONDS = 8.0


class OpenAICompatibleParser(IngredientParser):
    """One adapter for every provider that speaks the OpenAI chat API.

    DeepSeek, Z.ai (GLM), Moonshot (Kimi) and Alibaba (Qwen) all do, so choosing
    a provider is a `base_url` and a model name rather than a second
    implementation. That is deliberate: the fallback is selected by changing two
    environment values and one SSM parameter, with no code deploy
    (docs/plans/ingredient-capture-plan.md §7.2).

    **Structured output is forced through a tool call**, not asked for in prose.
    A schema the provider validates is the difference between parsing a reply and
    hoping for one — and when a model does return something off-schema, Pydantic
    rejects it here and the caller fails over rather than retrying the model that
    just failed.
    """

    def __init__(self, *, base_url: str, model: str, api_key: str | None, timeout: float = TIMEOUT_SECONDS) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._api_key = api_key
        self._timeout = timeout

    @property
    def configured(self) -> bool:
        """Whether this one can be called at all.

        A provider with no key is not an error at startup — the app boots and
        everything else works, exactly as a missing Geoapify key leaves
        `/places/*` answering 503 while the rest of the site runs.
        """
        return bool(self._api_key and self._base_url and self._model)

    def parse(self, text: str, vocabulary: list[GroceryItem], servings: int) -> ParsedIngredients:
        if not self.configured:
            raise IngredientParserError(f"{self._model or 'parser'} is not configured")

        payload = {
            "model": self._model,
            "messages": [
                # The vocabulary goes in the *system* half and first, because it
                # is byte-identical between calls and every provider that caches
                # prompt prefixes keys on exactly that.
                {"role": "system", "content": f"{SYSTEM}\n\nAisles: {aisle_block()}\n\nVocabulary (key|es|ca|en):\n{vocabulary_block(vocabulary)}"},
                {"role": "user", "content": user_block(text, servings)},
            ],
            "tools": [{"type": "function", "function": {"name": "structure_ingredients", "parameters": TOOL_SCHEMA}}],
            "tool_choice": {"type": "function", "function": {"name": "structure_ingredients"}},
            # Deterministic-ish: this is an extraction task, not a creative one,
            # and a model that words `raw` differently each run makes the review
            # table jump about between attempts.
            "temperature": 0,
        }

        try:
            response = httpx.post(
                f"{self._base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=self._timeout,
            )
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise IngredientParserError(f"{self._model} did not answer: {error}") from error

        try:
            arguments = body["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
            return ParsedIngredients.model_validate_json(arguments)
        except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValidationError) as error:
            # Off-schema output is a *failure*, not something to salvage. Half a
            # parsed list looks like a complete one to the person reviewing it,
            # and the lines it silently dropped are the ones they will not buy.
            raise IngredientParserError(f"{self._model} returned something unusable: {error}") from error


class FailoverParser(IngredientParser):
    """Try each parser in turn; raise only when every one has failed.

    A decorator rather than a branch inside the use case, so the use case depends
    on the port and never learns there was more than one provider. Adding a third
    is appending to a list.
    """

    def __init__(self, parsers: list[IngredientParser]) -> None:
        self._parsers = parsers

    def parse(self, text: str, vocabulary: list[GroceryItem], servings: int) -> ParsedIngredients:
        failures: list[str] = []

        for parser in self._parsers:
            try:
                return parser.parse(text, vocabulary, servings)
            except IngredientParserError as error:
                # Logged at warning, not error: one provider being unreachable is
                # an expected Tuesday, and the user is about to get an answer from
                # the next one. Only the final raise is worth an alert.
                logger.warning("Ingredient parser failed over: %s", error)
                failures.append(str(error))

        raise IngredientParserError("; ".join(failures) or "No ingredient parser is configured")
