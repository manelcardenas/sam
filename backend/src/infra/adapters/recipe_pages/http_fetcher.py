import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx

from src.domain.entities import RecipePage, RecipePageError
from src.domain.ports import RecipePageFetcher
from src.infra.adapters.recipe_pages import recipe_html

#: Enough for any recipe page with its inline scripts; past it, it is not a recipe page.
MAX_BYTES = 3_000_000
MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 10.0


class HttpRecipePageFetcher(RecipePageFetcher):
    """Fetch a page somebody pasted a link to — **safely**, because the server is doing the fetching.

    A server that fetches any URL it is handed is a way into the network behind
    it (SSRF). So:

    - **https only.** Every real recipe site serves it.
    - **Public addresses only**, checked for *every* address the name resolves
      to, and again on **every redirect** — a public link that redirects to
      `169.254.169.254` is the classic trick.
    - **Small and quick:** 10 s, 3 MB, 3 redirects.

    The address is checked and then fetched as two steps, so a name that changes
    its answer in between (DNS rebinding) could slip past. Accepted for now: the
    endpoint needs a signed-in user and is rate-limited, and closing it fully
    means pinning the connection to the checked IP.
    """

    def __init__(self, timeout: float = TIMEOUT_SECONDS) -> None:
        self._timeout = timeout

    def fetch(self, url: str) -> RecipePage:
        current = url.strip()
        with httpx.Client(timeout=self._timeout, follow_redirects=False, headers={"User-Agent": "SAM-recipe-import/1.0", "Accept": "text/html"}) as client:
            for _ in range(MAX_REDIRECTS + 1):
                check_public_https(current)
                try:
                    with client.stream("GET", current) as response:
                        if response.is_redirect:
                            current = urljoin(current, response.headers.get("location", ""))
                            continue
                        if response.status_code >= 400:
                            raise RecipePageError(f"The page answered {response.status_code}")
                        if "html" not in response.headers.get("content-type", "html"):
                            raise RecipePageError("The link is not a web page")
                        html = _read_capped(response)
                except httpx.HTTPError as error:
                    raise RecipePageError(f"The page could not be fetched: {error}") from error
                return page_from_html(str(response.url), html)
        raise RecipePageError("Too many redirects")


def page_from_html(url: str, html: str) -> RecipePage:
    structured, text = recipe_html.parse_page(html)
    if structured is None:
        return RecipePage(url=url, text=text)
    name = structured.get("name")
    return RecipePage(
        url=url,
        title=name.strip() if isinstance(name, str) and name.strip() else None,
        servings=recipe_html.servings(structured.get("recipeYield")),
        prep_time_minutes=recipe_html.minutes(structured.get("prepTime")),
        cook_time_minutes=recipe_html.minutes(structured.get("cookTime")),
        ingredient_lines=recipe_html.ingredient_lines(structured.get("recipeIngredient")),
        instructions=recipe_html.instructions(structured.get("recipeInstructions")),
        text=text,
    )


def check_public_https(url: str) -> None:
    """Refuse anything but https to a host whose every address is public."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise RecipePageError("Only https links can be read")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise RecipePageError(f"{parts.hostname} does not exist") from error
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global or address.is_multicast:
            raise RecipePageError(f"{parts.hostname} is not a public address")


def _read_capped(response: httpx.Response) -> str:
    chunks: list[bytes] = []
    size = 0
    for chunk in response.iter_bytes():
        size += len(chunk)
        if size > MAX_BYTES:
            raise RecipePageError("The page is too big")
        chunks.append(chunk)
    return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")
