# Geoapify Places integration plan (Phase 2b, scope A)

Decisions behind this plan: `docs/adr/0003-geoapify-as-places-provider.md`. Vocabulary: **Place** and **Mapped** in `CONTEXT.md`.

**Scope A (this plan):** select-a-Place flow in the restaurant creation form — unified search (own DB + Geoapify) plus a "near me" nearby list. No map rendering. **Scope B (shipped):** map display on restaurant detail / dine page — see "Out of scope" section for what was built.

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

- **Map display (scope B)** — ✅ SHIPPED, with one deviation from the sketch above: **MapLibre GL + OpenFreeMap vector tiles** instead of Leaflet + Geoapify tiles. Tile requests must come from the browser, and Geoapify tiles would have put the API key in the bundle; OpenFreeMap needs no key at all (and is free/unlimited), so the key stays server-side and Geoapify remains the *places* provider only. Built: cards/map toggle on the dine list (`components/map/RestaurantsMap.tsx` — score-pill markers, tap → slide-up card → detail) and an embedded location band with a Directions deep-link on the restaurant detail view (`components/map/LocationMap.tsx`). Positron basemap; dark mode via a canvas invert filter keyed off the app's `.dark` class; MapLibre is code-split behind `next/dynamic` (ssr: false). Only Mapped restaurants appear; the map view counts the unmapped ones.
- **Pin drop (shipped alongside scope B)** — Geoapify doesn't know every restaurant, so the form also offers a hand-dropped pin (`components/map/PinPickerMap.tsx`): coordinates without a provider identity — the restaurant appears on the map but stays Unmapped (see **Pinned** in CONTEXT.md). Geoapify remains the first-class path; the pin is the fallback, nudged when a search comes up dry. Confirming a pin reverse-geocodes it (`GET /places/reverse`) to prefill the address. `PUT /restaurants/{id}` now accepts latitude/longitude as editable facts (both-or-nothing, so old payloads can't wipe a location); `external_place_id` stays non-editable.
- **Place Details enrichment (scope C, optional)** — on the detail page of a Mapped restaurant, fetch the Place live by `external_place_id` (opening hours, website, phone) and display it **without storing** — ephemeral use, no schema change, cleanest ToS posture.
- Refresh-from-source of mapped facts (ADR-0002 addendum) and any editability lockdown.
- Fuzzy geo-dedup between manual and picker entries — name-`ILIKE` panel remains the only defense; accepted gap.
- Backfilling `external_place_id` onto existing rows.
