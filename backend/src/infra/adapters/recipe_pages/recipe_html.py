"""Reading a recipe out of a web page's HTML — no network, no model.

Most recipe sites publish a `schema.org/Recipe` as JSON-LD, because Google shows
it in results. When a page has one, its ingredient lines and method are exactly
what the author wrote, so nothing has to guess where the ingredients start.
"""

import json
import re
from html.parser import HTMLParser

_DURATION = re.compile(r"^P(?:(?P<d>\d+)D)?(?:T(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+)S)?)?$", re.IGNORECASE)
_FIRST_NUMBER = re.compile(r"\d+")

#: The most of a page's visible text a model is asked to read. A recipe fits in
#: a fraction of it; the cap is what stops a 200 KB page becoming a 50,000-token
#: request.
TEXT_LIMIT = 12_000

_SKIPPED = {"script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe", "template"}


class _Collector(HTMLParser):
    """JSON-LD blocks, and the text a person would see."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.json_ld: list[str] = []
        self.text: list[str] = []
        self._in_json_ld = False
        self._skip_depth = 0
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script" and (dict(attrs).get("type") or "").lower() == "application/ld+json":
            self._in_json_ld = True
            self._buffer = []
            return
        if tag in _SKIPPED:
            self._skip_depth += 1
        elif tag in {"p", "li", "br", "div", "h1", "h2", "h3", "h4", "tr"}:
            self.text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self._in_json_ld and tag == "script":
            self.json_ld.append("".join(self._buffer))
            self._in_json_ld = False
            return
        if tag in _SKIPPED and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._in_json_ld:
            self._buffer.append(data)
        elif not self._skip_depth:
            self.text.append(data)


def parse_page(html: str) -> tuple[dict | None, str]:
    """The page's `Recipe` object, if it has one, and its visible text."""
    collector = _Collector()
    collector.feed(html)
    collector.close()

    recipe = None
    for block in collector.json_ld:
        try:
            recipe = _find_recipe(json.loads(block))
        except ValueError:
            continue  # one malformed block must not hide a good one after it
        if recipe is not None:
            break

    lines = (re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in "".join(collector.text).split("\n"))
    text = "\n".join(line for line in lines if line)
    return recipe, text[:TEXT_LIMIT]


def _find_recipe(node: object) -> dict | None:
    """The first object whose `@type` is (or includes) Recipe — inside lists and `@graph` too."""
    if isinstance(node, list):
        for child in node:
            found = _find_recipe(child)
            if found is not None:
                return found
        return None
    if not isinstance(node, dict):
        return None
    kind = node.get("@type")
    kinds = kind if isinstance(kind, list) else [kind]
    if "Recipe" in kinds:
        return node
    return _find_recipe(node.get("@graph", []))


def minutes(value: object) -> int | None:
    """An ISO 8601 duration (`PT1H15M`) in minutes, or None."""
    if not isinstance(value, str):
        return None
    match = _DURATION.match(value.strip())
    if not match or not any(match.groupdict().values()):
        return None
    parts = {k: int(v) for k, v in match.groupdict().items() if v}
    total = parts.get("d", 0) * 1440 + parts.get("h", 0) * 60 + parts.get("m", 0) + (1 if parts.get("s", 0) >= 30 else 0)
    return total or None


def servings(value: object) -> int | None:
    """`recipeYield` as a headcount: `4`, `"4"`, `"4 raciones"`, `["4", "4 personas"]`."""
    if isinstance(value, list):
        for item in value:
            found = servings(item)
            if found is not None:
                return found
        return None
    if isinstance(value, int | float) and not isinstance(value, bool):
        return int(value) if 1 <= value <= 99 else None
    if isinstance(value, str):
        match = _FIRST_NUMBER.search(value)
        if match and 1 <= int(match.group()) <= 99:
            return int(match.group())
    return None


def instructions(value: object) -> str | None:
    """`recipeInstructions` as plain steps, one per line.

    Sites write it as one string, a list of strings, a list of `HowToStep`, or
    `HowToSection`s holding steps; all four come out the same.
    """
    steps: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, str):
            steps.extend(part.strip() for part in re.split(r"\n+", node) if part.strip())
        elif isinstance(node, list):
            for child in node:
                walk(child)
        elif isinstance(node, dict):
            if "itemListElement" in node:
                if node.get("name"):
                    steps.append(f"{str(node['name']).strip()}:")
                walk(node["itemListElement"])
            else:
                walk(node.get("text") or node.get("name") or "")

    walk(value)
    return "\n".join(steps) or None


def ingredient_lines(value: object) -> list[str]:
    if not isinstance(value, list):
        value = [value] if isinstance(value, str) else []
    return [re.sub(r"\s+", " ", str(line)).strip() for line in value if str(line).strip()]
