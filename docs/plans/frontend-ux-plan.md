# Frontend UX plan — install, scrapbook, profile ✅ IMPLEMENTED (2026-09-01)

> **Status:** all three sections are built. Notes on what changed during the build:
> - §1 needed one thing this plan didn't anticipate: declaring `metadata.icons` in
>   `layout.tsx` *replaces* Next's file-convention detection and silently drops the
>   `apple-touch-icon` link — i.e. it reintroduces the exact bug. The file carries a
>   warning comment. Both `apple-mobile-web-app-capable` and the modern
>   `mobile-web-app-capable` are emitted, for older iOS.
> - §2 gained a serif (Fraunces) for review quotes, score numerals and section
>   headings. `font-display` and `font-sans` both resolved to Arimo, so the app had no
>   display face — the quotes needed a voice distinct from the UI.
> - §2c gained `quoteAttribution()`: without it the card printed the reviewer and date
>   in the quote and again in the footer directly below.
> - Filter chips scroll horizontally on phones instead of wrapping; at 390px with ~10
>   cuisines, wrapping pushed the list under four rows of chips.
> - Fixed in passing: `globals.css` set `font-family: var(--font-nunito)`, which nothing
>   defines, so body copy had been falling back to system UI rather than Arimo.


The concrete plan for **Phase 4** of [`./improvement-plan.md`](./improvement-plan.md) (the only
open workstream there), plus the iOS home-screen fix, which is not strictly Phase 4 but is a
small frontend defect worth clearing in the same pass.

Scoped through a grilling session on 2026-09-01. The central decision — that the restaurant
list is a **scrapbook**, not a decision aid — is recorded in
[`../adr/0005-restaurant-list-is-a-scrapbook.md`](../adr/0005-restaurant-list-is-a-scrapbook.md).

## The numbers this plan was scoped against

Taken from production on 2026-09-01, because they invalidated two of the original ideas:

| | |
|---|---|
| Restaurants | 24 — 17 Mapped, but **23 have coordinates** |
| Reviews | 37 — **max 3** on any restaurant; 10 have exactly 1; 19 carry a written comment |
| Active reviewers | 2 (Nel 21, Martina 14) of 7 accounts |
| Cuisine spread | Chinese 10, Mediterranean 5, Spanish 5, then 1–2 each |

**What this killed.** "Sort by most reviews" would rank on the values 1, 2 and 3 — noise.
"Sort by best score" at 1–2 reviews per place lets a single enthusiastic 9.5 permanently
outrank three considered 9.0s. And a typo-tolerant search engine has 24 rows to rank, which
is why this plan ships **filters** instead — see ADR-0005.

**What it enabled.** Coordinates are near-universal (23/24), so distance-based features are
viable later, and the lopsided cuisine distribution makes cuisine filters pay off immediately.

## Decisions recap

| Decision | Choice |
|---|---|
| What the dine page is for | Reliving where you've been, not deciding where to go tonight (ADR-0005) |
| Default order | Most recently visited (`visited_at` desc) |
| Sorting controls | **Deferred** — recency only for now |
| Finding things | Server-side **filters** (cuisine, price, score floor, mine-only), not a search engine |
| Carousel | A recent-visits **rail above** the grid, not a replacement for it |
| Card content | Surface existing data (last visit, who went, comment snippet). **No photos** — out of scope |
| Motion | FLIP reflow on filter change + capped entrance stagger; both disabled under reduced-motion |
| Profile | Stats strip + two sections (recipes, reviews) |
| iOS | PNG `apple-touch-icon` + manifest + standalone; no service worker |

---

## 1. iOS home-screen icon (and install quality)

### The bug

The build emits exactly one icon link, and it is an SVG:

```html
<link rel="icon" href="/icon.svg?45cc89..." type="image/svg+xml" sizes="any"/>
```

iOS "Add to Home Screen" **ignores SVG favicons** and looks for `<link rel="apple-touch-icon">`
with a raster image. Finding none, it screenshots the page — which is why SAM's face is missing
there. Android Chrome supports SVG favicons, hence the platform difference. `frontend/app/icon.svg`
is currently the only icon asset in the repo and there is no web manifest at all.

### The fix

1. **Generate rasters from the existing SVG** — `sharp` is already in `frontend/node_modules`
   (Next ships it), so a throwaway script converts `app/icon.svg` at build-prep time. No new
   dependency, and `icon.svg` stays the single source of truth for the artwork.

   | File | Size | Purpose |
   |---|---|---|
   | `app/apple-icon.png` | 180×180 | Next emits `<link rel="apple-touch-icon">` — **this is the actual bug fix** |
   | `public/icon-192.png` | 192×192 | Android install |
   | `public/icon-512.png` | 512×512 | Android splash / store listing |
   | `public/icon-maskable-512.png` | 512×512 | Android adaptive icon — needs ~10% safe-area padding or the face gets cropped by the circle mask |

2. **`app/manifest.ts`** (Next's `MetadataRoute.Manifest`; works under `output: 'export'`, emitted
   as a static `manifest.webmanifest` at build time):

   ```ts
   name: "SAM — Cook & Dine"
   short_name: "SAM"
   display: "standalone"
   theme_color: "#E4572E"      // tomato, from tailwind.config.ts
   background_color: "#FBF7EF" // cream, matches icon.svg's own plate
   ```

3. **`appleWebApp` in the root layout's `metadata`** — easy to miss and required:
   **iOS ignores the manifest's `display: standalone` entirely.** Chrome-less launch on iOS comes
   from `<meta name="apple-mobile-web-app-capable" content="yes">`, which Next emits from
   `metadata.appleWebApp`. Without this, step 2 fixes Android's install and leaves iOS opening in
   a Safari tab with the address bar.

### Verification

Real devices, not just the build output: add to home screen on an iPhone (face appears, launches
chrome-less) and on Android (face appears, no "download app" banner regression). `frontend/out/index.html`
should carry `apple-touch-icon`, `manifest` and `apple-mobile-web-app-capable` links.

---

## 2. "Where shall we eat?" — the scrapbook rebuild

The page is failing as a **scrapbook**: `RestaurantCard.tsx` shows name, price, cuisines, address,
star and review count — every one of them a fact about the *venue*. Nothing on the card came from
you or Martina, even though 19 of 37 reviews have written comments and every review has a
`visited_at`. The content exists; the list just never surfaces it.

### 2a. Backend — richer aggregates

`ReviewAggregate` today carries only `review_count` and the five averages. It gains:

```python
last_visited_at:     date | None    # newest visited_at across the restaurant's reviews
last_comment:        str  | None    # comment from that same newest review (may be null)
last_reviewer_name:  str  | None    # display_name of its author
reviewer_names:      list[str]      # distinct reviewers, for "Nel + Martina"
```

Implementation notes:
- In `postgres_review_repo.aggregate_for_restaurants`, add a `DISTINCT ON (restaurant_id) … ORDER BY
  restaurant_id, visited_at DESC, created_at DESC` subquery joined to the existing `GROUP BY`
  aggregate. **One query, not N+1** — the existing method already batches by id list, keep that shape.
  `created_at` is the tiebreaker so two reviews on the same visit date resolve deterministically.
- `reviewer_names` needs the join to `users` for `display_name`, the same join
  `list_reviews_for_restaurant` already does to populate `Review.reviewer_name`.
- Mirror all of it in `in_memory_review_repo` — the unit tests run against it.
- `RestaurantDetail` inherits the new fields automatically (it already merges `ReviewAggregate`
  via `model_dump()`), so `GetRestaurant` and `SearchRestaurants` both benefit with no signature change.
- **No migration.** All derived from existing columns.

### 2b. Backend — filters

`search_restaurants` currently takes only `query`. It gains optional, combinable filters, all applied
in SQL:

| Param | Behaviour |
|---|---|
| `q` | Existing ILIKE on name — **now actually called by the list page** |
| `cuisines` | Any-of match against `restaurant_cuisines` |
| `price_levels` | Any-of match on `price_level` |
| `min_score` | Floor on the computed average overall; restaurants with no reviews are excluded when set |
| `reviewed_by_me` | Restaurants the caller has reviewed |
| `sort` | `recent` (default) \| `name` — the wider sort control is deferred, but the param is where it will land |

Default ordering changes from `ORDER BY name` to **last visit desc, nulls last, name as tiebreaker**.
Restaurants with no reviews therefore sink to the bottom rather than being hidden — they still need
to be findable to get their first review.

> Filtering and ordering both now depend on review data, so `search_restaurants` can no longer
> fetch restaurants and aggregates independently. Expect the repo method to join rather than
> the use case to compose — this is the main structural change in the backend.

### 2c. Frontend — the page

```
Where shall we eat?

Lately                                    <- rail, ~6-8 most recent, snap-scroll
  [ Hong Kong Garden ][ Bar Nou ][ La Mafia ] ->

[All] [Chinese] [Spanish] [Mediterranean] [EE] [Mine]   <- filter chips

  Hong Kong Garden        EE      * 8.8 . 2 reviews     <- grid, full archive
  Carrer de Blai 12
  "the dumplings were unreal, we ordered a second round"
  Nel + Martina . 3 weeks ago
```

**The rail (`RecentVisitsRail.tsx`, new)** — the ~6–8 most recent visits in larger cards.
`scroll-snap-type: x mandatory` with `snap-center` children, `overscroll-behavior-x: contain` so a
horizontal swipe doesn't trigger browser back-navigation. Snap rails are a known **keyboard trap**:
give it `role="region"`, an `aria-label`, real focusable cards, and left/right arrow-key handling that
scrolls by one card. Desktop gets visible prev/next buttons — swipe is not discoverable with a mouse.
Hide the rail entirely when there are fewer than ~4 restaurants, or it looks broken.

**The card (`RestaurantCard.tsx`, rewritten)** — keeps its current strong bones (the `<article>` with a
stretched-`after` button inside a real `<h3>`, and the `min-w-0` truncation discipline; both are correct
and load-bearing, don't regress them). Adds: the comment snippet as the visual centrepiece (2 lines,
`line-clamp-2`, quoted, in the reading-text colour rather than muted), and a footer line of
`reviewer_names` + relative last-visit date. Falls back to today's layout when a restaurant has no reviews.

**The filter chips (`RestaurantFilters.tsx`, new)** — **min 44px touch targets** (nothing in the current
UI is sized for thumbs). Toggle chips for the cuisines actually in use, price, and mine-only. Chips reflect
into the URL query string so a filtered view is shareable and survives refresh. Filter changes go through
`startTransition` so tapping a chip never blocks the tap feedback.

**Delete** the client-side `visibleRestaurants` filter at `dine/page.tsx:162`. Search moves server-side
to the `?q=` that already exists — today the weaker of two implementations is the one being used.

### 2d. Motion — deliberately restrained

The UX guidance is explicit that "animate 1–2 key elements per view maximum", and a sliding rail plus
24 staggering cards plus reflow on every chip tap is precisely the anti-pattern. So:

- **FLIP reflow on filter/sort change only** — measure, apply the inverted transform, animate to zero.
  `transform`/`opacity` only, never width/height. ~200ms, `ease-out` entering and `ease-in` leaving.
- **Entrance stagger capped at the first 8 cards** (~40ms apart), reusing the existing `animate-fetch-in`
  / `.will-fetch` pattern. Beyond 8 it reads as sluggish, not lively.
- **No continuous or decorative animation anywhere.**
- **Reduced motion:** `globals.css` already has a global `prefers-reduced-motion` block that flattens
  animation and transition durations — but **it cannot stop a JS FLIP animation**, because
  `element.animate()` ignores CSS duration overrides. The FLIP helper must check
  `matchMedia("(prefers-reduced-motion: reduce)")` itself and skip straight to the final position.
- **Skeletons** for the rail and the first grid rows, replacing the current full-page `Loader`, with the
  space reserved at the right height so nothing jumps.

---

## 3. Profile — stats, recipes, reviews

### 3a. Backend — a genuinely new path

There is **no way to fetch a user's reviews today**: `ReviewRepository` has
`list_reviews_for_restaurant` and no by-user equivalent. This needs the full vertical slice:

1. `list_reviews_by_user(user_id)` on `ReviewRepository` — implemented in **both** the Postgres and
   in-memory adapters, joined to `restaurants` so each row carries the restaurant's name and id
   (otherwise the frontend N+1s to render a list).
2. A `ListUserReviews` use case.
3. A `GET /users/me/reviews` route on the user controller.
4. **A matching `addRoutes()` in `infra/lib/application/lambda-api-stack.ts`** — the API Gateway 404s
   any route not explicitly registered there. This is the standing trap in this repo; every new route
   has hit it.

A `GET /users/me/stats` endpoint (or the same fields folded onto `GET /users/me`) supplies the strip:
places reviewed, reviews written, average score given, most-reviewed cuisine. One grouped query.

### 3b. Frontend

Account editor unchanged. Above the lists, a **stats strip** — four compact figures, each a number
with a label, no chrome. Then **Your recipes (n)** and **Your reviews (n)** as two sections; review rows
show restaurant name, your overall score, visit date and a comment snippet, and click through to that
restaurant.

Also fix while in here: `profile/page.tsx:36` fetches **every** recipe and filters client-side
(`recipes.filter(r => r.created_by === me.id)`). Reviews must not repeat that mistake, and recipes
should stop doing it — either a `?mine=true` on the recipes list or a `GET /users/me/recipes` to match
the reviews route.

---

## Out of scope — explicitly deferred, not dropped

- **Sort controls (closest / best rated).** Recency is the only order this round. Distance is genuinely
  viable later (23/24 restaurants have coordinates) but needs browser geolocation, a haversine
  calculation, and a defined behaviour for the 1 restaurant without coordinates. The `sort` query
  param above is where it plugs in.
- **Map display.** A map of everywhere you've been is arguably *the* reliving surface, and the
  coordinates are already there — but it is **scope B** of
  [`./geoapify-places-plan.md`](./geoapify-places-plan.md), with its own tile-provider decision, and it
  would dominate this plan.
- **Splitting `dine/page.tsx` into real routes.** It is 434 lines with a 5-way view state machine, and
  this plan adds a rail, filters and richer cards to it. Extracting `/dine/[id]` would give shareable
  links and a maintainable file, but it is refactor work with no visible payoff — do it when the file
  next resists a change.
- **Photos**, per restaurant or per review. The one thing the data model genuinely lacks for a
  scrapbook, and a whole feature: object storage, presigned uploads, resizing, CDN, cost, and
  moderation of other people's images.
- **Full PWA / offline.** No service worker. Genuinely useful in a restaurant with bad signal, but it is
  a real feature with real cache-invalidation pain, and `output: 'export'` complicates it.
- **Fuzzy / typo-tolerant search.** See ADR-0005 and `future-roadmap.md` item 4 for the trigger that
  would justify revisiting it.

## Cross-links

- [`../adr/0005-restaurant-list-is-a-scrapbook.md`](../adr/0005-restaurant-list-is-a-scrapbook.md) — the decision behind §2.
- [`./improvement-plan.md`](./improvement-plan.md) — Phase 4, which this plan implements.
- [`./geoapify-places-plan.md`](./geoapify-places-plan.md) — scope B (map) picks up where §2 stops.
- [`./future-roadmap.md`](./future-roadmap.md) — item 4 (search) is the long-term end of §2b.
- [`../../CONTEXT.md`](../../CONTEXT.md) — Restaurant, Review, Visited At, Cuisine, Price Level, Overall.
