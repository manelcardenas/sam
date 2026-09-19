# Future Roadmap — after `improvement-plan.md` is done

> Not scoped yet — just the ideas as raised, captured so they aren't lost. Each of these needs its own grilling/design pass before implementation, the same way Phase 2 (restaurant reviews) got one. Treat this as a backlog of topics, not a spec.

## 1. Buy a real domain

Currently the API is served from an AWS-generated `execute-api...amazonaws.com` URL and the frontend from an Amplify-generated one. Buying a domain (Route 53 or another registrar) and pointing it at both via a hosted zone + ACM certs would give stable, branded URLs that don't change if the underlying compute changes later (e.g. Lambda → EC2). This groundwork is already written up in [`neon-migration-plan.md`](./neon-migration-plan.md) section 0b — it was consciously punted there, not forgotten.

## 2. ~~Decide: stay on Lambda, or move off it for performance~~ — DECIDED (2026-09-01): stay on Lambda

**Resolved: we are staying on Lambda.** The EC2 path is not being pursued.
[`ec2-migration-plan.md`](./ec2-migration-plan.md) is shelved — kept as a fully worked-out
option (Caddy/NGINX reverse proxy, SSM-based deploys, single-instance no-ALB setup) so the
analysis doesn't have to be redone, but it is not a queued phase and its open questions
(domain, DNS, instance size, Free Tier) need no answers while this holds.

Reopen only on evidence: real cold-start or latency complaints, or a workload that doesn't
fit the request/response model. Absent that, Lambda + API Gateway is the chosen shape.

## 3. Improve the npm workflow — ✅ DONE (2026-09-06)

Friction was: `npm install` + `npm run dev` in two directories, with no equivalent of the
backend's `uv run start`, and no frontend test runner at all. All four phases of
[`./tooling-and-tests-plan.md`](./tooling-and-tests-plan.md) shipped in one session:

| | |
| --- | --- |
| **1. Vitest** | 64 tests over the URL modules, filter parsing and `UserProvider` — the frontend had zero |
| **2. ESLint CLI** | Off the deprecated `next lint` onto flat config; Node pinned once in `.nvmrc` |
| **3. npm workspaces** | Three lockfiles → one; `npm run dev` boots API and web together; `npm run check` runs everything |
| **4. knip** | Deleted 2 dead files, 3 dead exports and 1 unused dependency; found 2 phantom dependencies |

**The pnpm question was answered: no, npm workspaces.** The pain was having three separate
projects rather than anything npm does, workspaces fix that, and switching package managers would
change how Amplify builds the live site for a marginal local gain. One honest caveat recorded in
the plan: the `typeRoots` breakage during the migration was caused by npm's hoisting and would
*not* have happened under pnpm.

**Still outstanding, and it's the only thing: a confirmed Amplify build.** Phase 3 changed the
deploy path (`npm ci -w frontend --include-workspace-root`), and every local proxy passes, but
Amplify's own build is the real test.

Four things surfaced that weren't in the original item, all now fixed: `next lint` was deprecated
and removed in Next 16; `next` was pinned in two manifests with nothing keeping them in sync (now
guarded by `npm run check:next-pin`); **CI was building on Node 20, which reached end-of-life in
April 2026**; and `sharp` and `source-map-support` were both being imported without being
declared.

## 4. Improve search — Elasticsearch or similar — PARKED (reaffirmed 2026-09-06)

Today, restaurant/recipe search is a simple case-insensitive `ILIKE` query against Postgres (see the restaurant dedup search in [`improvement-plan.md`](./improvement-plan.md)). Fine for now, but doesn't scale to fuzzy matching, typo tolerance, or ranking relevance as the data grows. Options to weigh later: Postgres full-text search (`tsvector`, no new infra) as a cheap first step, vs. a dedicated search engine (Elasticsearch/OpenSearch, Meilisearch, Typesense) if requirements grow past what Postgres FTS can reasonably do. Needs a real trigger (actual search-quality complaints) before picking a direction — no sense over-engineering this before it hurts. **Reaffirmed 2026-09-01** in [`../adr/0005-restaurant-list-is-a-scrapbook.md`](../adr/0005-restaurant-list-is-a-scrapbook.md): at 24 restaurants the dine page ships *filters* instead, and this item stays parked until search quality is actually the complaint.

## 5. Redis — a learning exercise, and now *only* that — PARKED (reaffirmed 2026-09-06)

Motivation was always "want to practice building with Redis" rather than a real bottleneck.
Both use cases that once gave it a performance justification are gone, answered for free
in-process by [`./routing-and-latency-plan.md`](./routing-and-latency-plan.md):

- **JWKS caching** — was per *request*, not per container. Fixed with an `@lru_cache` factory
  (that plan's §4.1). Never was a Redis case.
- **Restaurant rating aggregates** — largely addressed by connection pooling (§4.3), which took
  `GET /restaurants` from three Handshakes to zero.

So take this on as a learning exercise or not at all; do not dress it up as performance work.
If it happens, the one open question is **where it runs**: ElastiCache needs a VPC, which
reintroduces the NAT gateway cost the Aurora→Neon migration existed to avoid (see
`neon-migration-plan.md` §0a). A serverless Redis reachable over HTTPS (e.g. Upstash) fits the
Lambda-outside-VPC shape the way Neon already does.

## 6. Real URLs for page state — ✅ DONE (2026-09-06)

`/dashboard` and `/dine` now keep their view state in query params, so pages are linkable,
survive a refresh, and — the actual point — the device back gesture moves back a view instead of
leaving the app, which matters because standalone PWA mode has no browser chrome. Implemented as
option A (query params, not path segments; `output: 'export'` rules those out) and written up in
[`./routing-and-latency-plan.md`](./routing-and-latency-plan.md) §3 and §7 step 4.

Worth noting for future work: §3 records that this was **not** a performance change, and why
route splitting would have bought nothing — the maps are already `next/dynamic`'d.

## 7. Latency after the cold start — ✅ DONE (2026-09-06)

**Warm p50 540 ms → 200 ms; connections per request 3 → 0; p90 2–4 s → 367 ms.** Diagnosed,
grilled, sequenced, shipped and measured in
[`./routing-and-latency-plan.md`](./routing-and-latency-plan.md), with
[`../adr/0006-pooled-connections-on-lambda.md`](../adr/0006-pooled-connections-on-lambda.md)
recording the one architectural reversal (NullPool → pooled connections).

Two corrections that outlived the work and are worth carrying forward:

- **The p90 was Geoapify, not Neon.** The plan initially blamed the database's autosuspend wake;
  per-route instrumentation showed 3129 ms of a 3148 ms `/places/nearby` request happening
  outside the database entirely.
- **Raising Lambda memory did nothing for Init**, which is still ~3.25 s. CPU was not the
  constraint. Nobody has a good theory yet beyond package unpacking and import I/O.

Still open, deliberately: Init itself (tolerated — cold starts aren't the complaint). The other
gap this work exposed — no frontend test runner — was closed on 2026-09-06 by item 3's Phase 1.
What the URL work still can't prove is that the *browser* behaves; that's item 8.

## 8. End-to-end browser testing — Playwright

Moved out of [`./tooling-and-tests-plan.md`](./tooling-and-tests-plan.md) (2026-09-06). It was
sketched there as a "Phase 4, later if wanted" bullet, which undersold it: this is a real
commitment, not a tooling chore, and it deserves to be chosen deliberately rather than smuggled
in behind a lint config.

**What it is.** Playwright drives a real browser — real navigation, real history, real touch
gestures — against the running app. Vitest tests modules in a fake DOM; Playwright tests the
product.

**Why it's the *right* tool for two things nothing currently covers:**

1. **The back gesture.** The whole point of the URL work
   ([`./routing-and-latency-plan.md`](./routing-and-latency-plan.md) §3, item 6 above) was that
   swiping back inside the PWA moves back one view instead of leaving the app. That behaviour
   lives in browser history, so **no unit test can ever prove it works.** Right now it is only
   verified by someone remembering to try it on a phone. The `dine-url` and `dashboard-url`
   Vitest suites check that the URLs *encode* correctly — not that the browser does the right
   thing with them.
2. **The page-level flows Vitest was deliberately kept away from.** `/dine` and `/dashboard` are
   576 and 403 lines of async and auth. Testing them with a fake DOM buys brittle tests; testing
   them in a browser buys real ones.

Sign-in is a third candidate, and it just proved its worth: the Phase 1 lockfile regeneration
bumped `aws-amplify` and the only available check was a human logging in by hand.

**Why it's not scheduled yet.** It's the largest single addition on the list — a browser
download in CI, fixtures for a signed-in session, a seeded database to assert against, and a
standing decision about what to do when a test is flaky. That's a work session of its own, and
none of it is urgent while the app has one user who *is* the developer.

**What would make it urgent:** a second person relying on the app, a back-gesture regression
reaching production, or a dependency bump touching auth again with no way to check it but by
hand.

## 9. AI ingredient capture — natural text, voice, photo, links

> **Scoped 2026-09-12 into [`./ingredient-capture-plan.md`](./ingredient-capture-plan.md).** That
> plan is wider than this item: the interview found that natural capture is useless without an
> **identity** for an ingredient, so it introduces a shared `grocery_items` vocabulary — which then
> also delivers a shopping list sorted by supermarket aisle, pantry staples that stop cluttering it,
> and the "básicos" quick-add. Voice, photo and link import stay deferred *there*, with triggers.
> The cost warning below is confirmed and quantified: **~5 cents a month**.

Scoped out of [`./meal-planner-plan.md`](./meal-planner-plan.md) §3, where the underlying problem
was measured: across 19 recipes and **111 ingredient lines**, `amount` is filled on **2** and
`unit` on **1**, while **56% of names start with a digit** — people write `"3 huevos"` into the
name field.

The instinct is to blame the data and fix it with a migration. That treats the symptom. **The
fields are empty because one box is pleasant and three boxes are tedious**, so making three
fields mandatory will re-rot the data the moment the novelty wears off.

The fix is to let people keep typing the way they already do, and have a model structure it:

```
3 huevos, 200g de harina, 1 vaso de aceite, sal
  → [{name: huevos, amount: 3}, {name: harina, amount: 200, unit: g}, …]
```

Confirm the rows, done. Natural extensions once the pipe exists: **voice** (dictate while the
fridge is open), **photo** of a cookbook page, and **import from a URL or a TikTok** — which is
what [mise.cooking](https://mise.cooking/) does and a large part of why its recipe capture feels
better than ours.

Two things to decide on their own terms rather than discover:

- **This is the project's first recurring cost.** A few hundred tokens per recipe is fractions of
  a cent at this volume, but it is not zero and it needs an API key. Everything so far has been
  free by construction; this is a deliberate exception, not an oversight.
- **Sequencing bonus:** build this and the 111-line backfill is free. Point it at the existing
  rows once and the migration script in the planner plan never needs writing. That argues for
  doing it *before* the planner's data fix — but the planner should not block on it, so the plan
  keeps the manual backfill as the path that does not depend on this item existing.

## 10. Prices and a supermarket catalogue

Split out of [`./meal-planner-plan.md`](./meal-planner-plan.md) §7, where the research lives.

Short version: **there is no official Mercadona API.** The undocumented one behind
`tienda.mercadona.es` is real and unauthenticated for the catalogue, but its own community
documentation notes that `robots.txt` blocks `/api` and asks callers to respect the ToS. Paid
wrappers fail the no-recurring-cost rule. Open Food Facts is genuinely open but barcode-shaped —
it describes jars, not `"400g minced beef"`.

The architectural reason to defer is stronger than the legal one: **a shopping list is
ingredients, a catalogue is products.** Matching them buys nothing for a household list *except*
prices — which is a real motivation, but one worth pricing separately once the planner exists and
you know whether you miss it.

## 11. Split the page files — `dine/page.tsx` is 843 lines

Inherited from [`./improvement-plan.md`](./improvement-plan.md) Phase 4 when that plan was closed
on 2026-09-11, because it is the one item there that **moved in the wrong direction**:

| | Sep 2026 (plan written) | 2026-09-11 |
| --- | --- | --- |
| `app/dine/page.tsx` | 434 | **843** |
| `app/dashboard/page.tsx` | 403 | **477** |

This is not a failure of the UX work — that work *did* extract presentation, into
`components/dine/`, `components/profile/`, `components/recipes/` and `components/map/`. What is
left in the page files is the part nobody has found a home for: data fetching, auth gating, URL
state and the effects tying them together. Adding features to those pages made that layer bigger
even as the JSX left.

**Why it is not urgent:** it is legible, it is tested at the module level, and nothing is broken.
**What would make it urgent:** the meal planner (item 5 of the queue) adding a fifth top-level
page of the same shape — at which point the orchestration pattern gets copied a fourth time
rather than named once.

The honest framing recorded in [`./frontend-ux-plan.md`](./frontend-ux-plan.md): splitting for
*routing* is impossible under `output: 'export'` and that question is closed. Splitting for
*maintainability* remains open on its own merits, and needs someone to decide what the extracted
thing actually is — a `usePageData` hook per domain, or something else.

## 12. Toast notifications — decide, don't default

Also inherited from Phase 4, where it sat as "❌ not done — `react-hot-toast`, tiny, free" for
four months.

**It has been "not done" long enough that the absence is now evidence.** Two full UX passes
designed feedback deliberately inline — `ConfirmModal.tsx`, form-level messages, the optimistic
patterns in the profile panels — and nobody reached for a toast. Adding one now would mean two
feedback idioms in one app, which is worse than either alone.

So the item is not "add react-hot-toast". It is: **find the case inline feedback genuinely cannot
serve**, and if there isn't one, delete this item. The strongest candidate is an action whose
result arrives after the user has navigated away — which the app does not currently have, but the
meal planner's shared-list ticking might.

## 13. The two features that need a shopping history — `Frecuentes` and pairing memory

**Both deferred to v2 on 2026-09-18.** They are the last two unbuilt pieces of
[`./ingredient-capture-plan.md`](./ingredient-capture-plan.md) — §6.2 (Phase B's second half) and
§5.5 (Phase G) — and they are **one item rather than two** because they are the same query over the
same data, blocked on the same thing, with the same trigger. When it fires, you build both.

| | What it offers | Reads |
| --- | --- | --- |
| **`Frecuentes`** | A chip row over the manual-add box: the things this kitchen buys most, one tap instead of typing `yogures` for the fortieth time | past plans' `shopping_list_items` |
| **Pairing memory** | *"¿con Arroz blanco?"* when you add carne en salsa, because those two have shared a slot five times | past plans' `plan_entries`, grouped by slot |

Both are **free**: a query over data the app already stores, no schema, no model, and — for pairing
— more accurate than anything an LLM would guess about this particular household. Pairing reads
through the same archive-wide path as the year view (`kitchen_ids_for`, which spans kitchens you have
left), so it survives moving house.

**Why they wait: the ranking *is* the feature, and it is computed from history there isn't yet.**
With one or two weeks of plans, the chips are close to arbitrary and the pairing has nothing to
remember. That is worse than shipping neither — a suggestion row you learn to ignore in week one
does not get a second look in week ten, and the first wrong pairing teaches you the feature is noise.
Shipping them early spends the one chance they have to feel uncanny.

Nothing is missing in the meantime. The manual-add box already autocompletes against the whole
vocabulary (that half of Phase B shipped), and adding a second dish to a slot is two taps.

**Trigger:** roughly **ten closed weeks** of plans in the kitchen. Or, sooner, either of these
becoming a felt annoyance — retyping the same extras every week, or re-finding the same guarnición
every week. All three are answerable with one query when the question comes up.

---

## Queue as of 2026-09-07

Agreed order, replacing "pick whichever item looks interesting":

| | | |
| --- | --- | --- |
| **0** | Plan the meal planner | ✅ done — [`./meal-planner-plan.md`](./meal-planner-plan.md) + [ADR 0007](../adr/0007-a-dish-is-a-recipe-without-instructions.md) |
| **1** | Profile UX rework | ✅ done 2026-09-07 — [`./ux-refresh-plan.md`](./ux-refresh-plan.md) §1 |
| **2** | UX pass: dashboard chips, brand-voice trim, the dine ordering control, cuisine colour | ✅ done 2026-09-07 — [`./ux-refresh-plan.md`](./ux-refresh-plan.md) §2, §3, §5, §6 |
| **3** | English / Spanish / Catalan switch, and all copy out of the code | ✅ done 2026-09-07 — [`./ux-refresh-plan.md`](./ux-refresh-plan.md) §4 |
| **4** | mise.cooking pattern research | [`./ux-refresh-plan.md`](./ux-refresh-plan.md) §7 — a week of phone use, not a design task. **Did not block the planner**: PLAN became a third world in the existing bottom bar, which is where §7's own bottom-nav candidate would put it anyway |
| **5** | Build the meal planner | ✅ **done 2026-09-11** — [`./meal-planner-plan.md`](./meal-planner-plan.md) §8. Phases A–D shipped, v1 complete: data fix, backend, week view, shopping list, sharing and the year archive. Post-v1: the week moved to Sat→Fri (§8.9), the filter row is now shared with `/dashboard` with a new by-author axis (§8.10), the list stopped being downstream of the calendar (§8.11), and sharing became a **kitchen** — a week belongs to a household rather than to a person, with no owner and no guest (§8.12) |
| **6** | AI ingredient capture + the grocery vocabulary | ✅ **done 2026-09-18** — [`./ingredient-capture-plan.md`](./ingredient-capture-plan.md). Phases A–F shipped, plus §6.1's cross-language merge. G and `Frecuentes` deferred to 13 |
| later | Prices (10), page-file split (11) | 11 becomes urgent if the planner copies the page-orchestration pattern a fourth time |
| parked | Search (4), Redis (5), toasts (12), history-ranked suggestions (13) | 13 has a real trigger — ten closed weeks of plans; the others have none, and 12 may simply be deleted |

**Reconciliation note (2026-09-11).** [`./improvement-plan.md`](./improvement-plan.md) was closed
on this date and its Phase 4 status table reconciled against the code — it had been stale since
2026-09-01, still listing the map as "not started" and skeletons as "partial" when both had
shipped. Its two genuinely-unbuilt items became 11 and 12 above. **The lesson worth keeping: when
work migrates to a dedicated plan, the plan it came from stops being updated.** This roadmap is
the one document that should always be current.

**Why the UX work comes before the feature that motivated it:** the planner needs a home in the
navigation, an archive surface in the profile, and a recipe picker. Building those into a layout
already known to be wrong means building them twice.
