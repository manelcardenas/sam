# Geoapify Places integration plan (Phase 2b, scope A) ✅ SCOPE A DONE

> **Status:** scope A shipped 2026-07-11/12 (PRs #42 and #43). Everything in the Backend,
> Infra and Frontend sections below is live. **Scopes B and C remain open** — see
> "Out of scope" at the foot of this document; that is now the live to-do list.
>
> **Added beyond the original scope:** area-anchored search (`GET /places/areas`, the
> `Area` entity, `search_areas`), so a user can search for a Place in a city they are not
> currently standing in — the original plan only had typed autocomplete plus "📍 near me".
> Decision recorded in [`../adr/0004-area-anchored-place-search.md`](../adr/0004-area-anchored-place-search.md).

Decisions behind this plan: `docs/adr/0003-geoapify-as-places-provider.md`. Vocabulary: **Place** and **Mapped** in `CONTEXT.md`.

**Scope A (this plan):** select-a-Place flow in the restaurant creation form — unified search (own DB + Geoapify) plus a "near me" nearby list. No map rendering. **Scope B (later):** Leaflet/OSM map display on restaurant detail / dine page.

## Decisions recap

| Decision | Choice |
|---|---|
| Provider | Geoapify (free 3k credits/day, storage permitted, no card) — see ADR-0003 |
| Identity | Nullable `external_place_id` (Geoapify `place_id`) on Restaurant + **partial unique index** |
| Conflict | Idempotent create: known `external_place_id` returns the existing Restaurant (200 vs 201), frontend shows "already on SAM" notice |
| Form UX | Unified search: name field queries own DB **and** Geoapify autocomplete (one debounce, two result groups); "📍 near me" button feeds the same list via geolocation; manual create demoted below results |
| Mandatory? | No — manual entry stays as the escape hatch (OSM doesn't know every restaurant). Restaurants are two-tier: Mapped / Unmapped |
| Prefill | name, address, lat/lng, `external_place_id`; cuisines pre-selected only on case-insensitive match against the curated vocabulary; price level always manual. Everything stays editable (ADR-0002 unchanged) |
| Auth | `/places/*` routes behind Cognito like everything else (also protects the Geoapify quota) |
| Attribution | "Powered by Geoapify · © OpenStreetMap contributors" footer under the "From the map" results |
| Geolocation denied | "near me" degrades gracefully; typed autocomplete works without bias |

## Prerequisite (manual, one-time)

1. Create a free Geoapify account → project → copy API key (no credit card).
2. Store it: `aws ssm put-parameter --name /recipe-manager/geoapify/api-key --type SecureString --value <key>`.

## Backend

1. **Migration** — add `external_place_id TEXT NULL` to `restaurants` + `UNIQUE` partial index `WHERE external_place_id IS NOT NULL`. Additive; existing rows untouched.
2. **Domain** — `Restaurant.external_place_id: str | None`; new ephemeral entity `domain/entities/place.py` (`Place`: external_id, name, address, lat, lon, cuisines list — never persisted).
3. **Port** — `domain/ports/places_provider.py`: `search(text, bias_lat?, bias_lon?) -> list[Place]`, `nearby(lat, lon, radius_m) -> list[Place]`.
4. **Adapters** — `GeoapifyPlacesAdapter` (httpx; autocomplete + `/v2/places?categories=catering.*&filter=circle:...`; key resolved at cold start from SSM, same pattern as the Neon DSN — keep any heavy imports local in `src/main.py` per the alembic-shadow lesson). `InMemoryPlacesProvider` fake for tests.
5. **Use cases** — `search_places.py`, `nearby_places.py`; extend `create_restaurant.py` to accept `external_place_id` + coords and implement idempotent-create (catch unique violation → fetch by `external_place_id` → return existing, flag `created=False`).
6. **Controller** — `GET /places/search?q=&lat=&lon=`, `GET /places/nearby?lat=&lon=`, both `Depends(get_current_user)`; `POST /restaurants` returns 200+existing vs 201+new. Schemas: `PlaceResponse`, extend `CreateRestaurantRequest`/`RestaurantResponse`.
7. **Tests** — unit: use cases against the fake provider incl. idempotent-create race path; integration: `/places/*` routes and conflict behavior.

## Infra

- SSM SecureString `/recipe-manager/geoapify/api-key`; pass **name** as `GEOAPIFY_API_KEY_PARAM` env var; `grantRead` to the Lambda (mirror the DSN wiring in `lambda-api-stack.ts`).
- **`addRoutes()` for `GET /places/search` and `GET /places/nearby`** — the gateway 404s any route not explicitly added.

## Frontend

- `lib/api-client.ts` — `searchPlaces(q, coords?)`, `nearbyPlaces(coords)`, `Place` type; `CreateRestaurantInput` gains `external_place_id?`, `latitude?`, `longitude?`; create response exposes whether an existing Restaurant was returned.
- `RestaurantForm.tsx` — the existing debounced search fans out to both `searchRestaurants` and `searchPlaces`; results render as "Already on SAM" (jump to existing) and "From the map" (prefill + attach identity, cuisines matched against loaded options); "📍 near me" button uses `navigator.geolocation` → `nearbyPlaces` into the same list; "create '<name>' manually" as secondary action below results; attribution footer.
- `dine/page.tsx` — on create response for an existing Restaurant: navigate to it + "this place was already on SAM" notice.

## Out of scope (explicitly) — and where it goes next

- **Map display (scope B)** — *also deferred by [`./frontend-ux-plan.md`](./frontend-ux-plan.md), which notes a map is arguably the strongest reliving surface and that 23 of 24 restaurants already have coordinates.* Leaflet on the restaurant detail page (and later the dine list), using **Geoapify map tiles** (prettier than raw OSM, same free credit pool) and the **Marker Icon API** for pins. Only Mapped restaurants can appear; do this once coordinates have accumulated. An intermediate cheap step: the **Static Maps API** as a single `<img>` with a pin on the detail page.
- **Place Details enrichment (scope C, optional)** — on the detail page of a Mapped restaurant, fetch the Place live by `external_place_id` (opening hours, website, phone) and display it **without storing** — ephemeral use, no schema change, cleanest ToS posture.
- Refresh-from-source of mapped facts (ADR-0002 addendum) and any editability lockdown.
- Fuzzy geo-dedup between manual and picker entries — name-`ILIKE` panel remains the only defense; accepted gap.
- Backfilling `external_place_id` onto existing rows.
