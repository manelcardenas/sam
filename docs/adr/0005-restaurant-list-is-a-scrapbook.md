# The restaurant list is a scrapbook ordered by recency, and finding things is filters — not search

The dine page is titled "Where shall we eat?", which frames it as a decision aid: given that you are hungry now, narrow 24 places down to two or three candidates. That framing suggested an obvious default ordering — nearest first, or best-rated first — and an obvious next feature, a properly ranked fuzzy search. We chose neither. Asked what they were actually doing when the page felt bad, the answer was **browsing what we've been to** — the page's real job is reliving, and the failure was that it reads as an inventory of venues rather than a record of meals. So the list is ordered by **most recently visited**, and the cards surface the human content that already exists in the database (each restaurant's newest review comment, who has been, and when) instead of only venue facts. The title stays; the job it serves changed.

Two ranking ideas were rejected on the data rather than on taste. At the time of writing there are 24 restaurants and 37 reviews, no restaurant has more than **3** reviews, and 10 have exactly one — so ordering by review count ranks on the values 1, 2 and 3, which is noise, and ordering by average score lets a single enthusiastic 9.5 permanently outrank three considered 9.0s. Either could be rehabilitated later with a minimum-review threshold or a Bayesian prior pulling sparse restaurants toward the global mean, but neither is worth building before the data can support it. Distance-first was rejected for a different reason: it is a decision-aid ordering, and it is the one idea here that is genuinely *viable* (23 of 24 restaurants have coordinates), so it is deferred as an explicit sort control rather than ruled out.

For finding a specific place we chose **server-side filters** — cuisine, price level, score floor, reviewed-by-me — over investing in search. At 24 rows a typo-tolerant ranked engine has nothing meaningful to rank, while the cuisine distribution is lopsided enough (Chinese 10, Mediterranean 5, Spanish 5, then ones and twos) that filters pay off immediately and keep paying at 500 rows. This also resolves an existing duplication: name search is currently implemented twice — a client-side `.filter()` on the dine page and an ILIKE `?q=` in `search_restaurants` — and the client-side one, the weaker of the two, is the one in use. The client-side filter is deleted and the backend one is finally called. `docs/plans/future-roadmap.md` item 4 already said search needed "a real trigger (actual search-quality complaints)" before picking a direction; this ADR sets that trigger as the condition for revisiting Postgres FTS or a search service.

Consequences worth remembering: ordering by last visit means **restaurants with no reviews sort last** rather than being hidden — they must stay findable to receive a first review, and the query orders nulls last with name as the tiebreaker. Ordering and filtering now both depend on review data, so `search_restaurants` can no longer fetch restaurants and aggregates independently; the repository joins where the use case used to compose, which is the main structural cost of this decision. The list also becomes *unstable by design* — logging a review reorders the page — which is the intended reward for looking, but it means the position of a card is not a durable way to refer to it. And the scrapbook framing has a natural next step this ADR does not take: photos, and a map of everywhere you have been, are the two things that would most complete it, both deliberately deferred in `docs/plans/frontend-ux-plan.md`.

## Addendum (2026-09-04) — a rating sort was added, as an option

Requested directly after the page shipped: order by rating, high to low, ties broken by review
count. Built as `RestaurantSort.RATING`, exposed as an "Order" control. **Recency remains the
default**, so the decision above still governs what the page is *for* — the rating sort is a
second lens on the same list, not a new default.

Be clear about what the tie-break does and does not fix. It resolves *exact* ties: at 8.0, a
place two people rated now outranks a place one person rated, which is the right call. It does
**not** answer this ADR's original objection, because the objection was never about ties — a
single 9.5 still outranks three considered 9.0s, since 9.5 > 9.0 and the tie-break never runs.
That is live in the data today: the current top of the rating sort is a restaurant with **one**
review (8.1), ahead of one with two (8.0).

Accepted knowingly, because the sort is opt-in and the default is unchanged. The two mitigations
named above remain the fix if it starts to feel wrong: a minimum-review threshold before a place
can rank, or Bayesian shrinkage pulling sparse averages toward the global mean. Shrinkage is the
better of the two — it degrades gracefully instead of hiding places — and it is a change to one
SQL expression in `_score_sql.py`, which is where the display score and the sort key are now
deliberately kept identical.
