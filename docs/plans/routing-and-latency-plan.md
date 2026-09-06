# Routing & Latency — diagnosis and plan

> **Status (2026-09-06): COMPLETE.** Every step in §7 is built and §4/§5 hold no open items.
> Steps 0–2 are **deployed and measured** (§0); steps 3–5 are **built and awaiting merge**, so
> their numbers are local and browser-side, not yet production.
>
> **Warm p50 540 ms → 200 ms. Connections per request 3 → 0. p90 2–4 s → 367 ms.** The p90
> mystery turned out to be Geoapify, not the database — §2.4 records the retraction.
>
> Two predictions in here were wrong and are corrected in place rather than quietly edited: the
> p90 attribution (§2.4) and the Lambda memory bump, which did nothing for Init (§0).
>
> Raised by Manel after Phase 4 shipped: (a) the app keeps every page state on one URL,
> (b) navigation is sometimes very slow even when the Lambda is warm. Hard constraint
> throughout: **no new recurring cost** — which bounds *money*, not effort. Staying on Lambda is
> settled ([`./ec2-migration-plan.md`](./ec2-migration-plan.md) is shelved).

Vocabulary — **Init**, **Warm Path**, **Wake** and **Handshake** are four different things and
this document depends on not mixing them up. Definitions in
[`../../CONTEXT.md`](../../CONTEXT.md) § Language › Latency.

## 0. Result after steps 0–2 (measured 2026-09-06, production)

Steps 0, 1 and 2 shipped together and are live. 120 invocations over ~1 hour of deliberate use.

| Metric | Baseline (§1) | After steps 0–2 | |
| --- | --- | --- | --- |
| Warm p50 | 540 ms | **200 ms** | −63% |
| p90 | 2100–4100 ms | **367 ms** | −85%, but see the caveat below |
| Connections per `GET /restaurants` | 3 | **0** | §4.3 confirmed |
| `db_connect_ms` | ~225 ms (est.) | **0** | |
| Init | ~3300 ms | **3248 ms** | **unchanged — see §4.7 correction** |
| Peak memory | 233 MB | 228 MB of 1024 | still not memory-bound |

**§2.4's suspicion is confirmed.** The unattributed p90 was Geoapify, not Neon:

```
GET /places/nearby   n=1   p90 3148 ms   query_ms 19.3   other_ms 3129.1
```

99.4% of that request happened outside the database. No amount of pooling or caching in §4
could ever have touched it.

> **Read the p90 improvement carefully.** This sample contains exactly *one* place search in
> 120 invocations, so the slow route barely moves the percentile. `/places/nearby` itself is
> no faster than before. A session with several restaurant additions would push the p90 back
> up, which is why §7 step 5 now has a concrete subject.

**Parallel page loads multiply cold starts.** At 11:43:05 four requests returned `cold: true`
within 150 ms of each other — `/users/me`, `/users/me/stats`, `/users/me/reviews`, `/recipes`,
the profile page's fan-out. Lambda spun up four containers, each paying its own ~3.2 s Init.
Fewer parallel requests therefore means fewer cold containers, which is an unbudgeted bonus for
§4.4 and §4.6.

**An unforecast finding: `GET /users/me` was 34 of ~107 requests — 32% of all traffic.** The
redundant per-page-mount `getMe()` is the single most-called route in the system. That makes
§4.4 the largest remaining win by request volume, now measured rather than estimated.

### §4.7 correction — the memory bump did not help Init

Predicted 3300 → 1500–2200 ms; observed **3248 ms**, i.e. no change, with `configured_mb`
confirming 1024 MB is live. The premise — "512 MB is ~0.3 vCPU so Init is CPU-bound" — is
**wrong**. Init is dominated by something else, most likely unpacking the deployment package
and library import I/O. Leaving it at 1024 MB costs nothing and may still help the warm path,
but it should not be described as an Init fix. Anything that genuinely targets Init would have
to attack the import graph or the package size.

## 1. Measured baseline

CloudWatch, `recipe-manager-api`, 7 days to 2026-09-02 (184 sampled `REPORT` lines):

| Metric | Value |
| --- | --- |
| **Init** | **~3.3 s** average (22 cold starts sampled) |
| Cold-start handler duration | ~2.2 s *on top of* init |
| **Warm Path** | **~540 ms** average, p90 **2.1–4.1 s**, max 4.3 s |
| Memory used | **233 MB of 512** — memory is not the constraint |
| Invocations | **481 per 30 days** |

Two things to read carefully:

- The Lambda `Duration` metric **excludes** `Init Duration`. So ~540 ms is the Warm Path — the
  time to serve a simple `SELECT` with the container already up. That is the number that
  matches "slow even after the cold start", and it is the real target.
- 481 invocations/month against a perpetual free tier of 1M requests and 400,000 GB-seconds
  means the function consumes **~130 GB-s, i.e. 0.03% of the free allowance.** This is what
  makes §4.7 free rather than merely cheap.

**These `REPORT` lines carry no route.** A slow `/places/search` and a slow `/restaurants` are
indistinguishable in this data, which is why §7 now opens with instrumentation instead of a fix.

## 2. Diagnosis — where the Warm Path goes

Every authenticated request, before any business logic:

1. **A JWKS fetch to Cognito over HTTPS — on *every* request.**
   `dependencies.py:42` constructs `JWTHandler()` inside `get_current_user`, and the cache
   lives on the instance (`jwt_handler.py:30`, `self._keys = None`). The instance dies with
   the request, so the "cached after first fetch" docstring is true and useless: the cache
   is never reused. `future-roadmap.md` item 5 describes this as "cached per-Lambda-container
   instance and lost on cold start" — **that is wrong, it is per request.**
2. **A database write on every request.** `get_current_user` calls
   `PostgresUserRepository.ensure_user`, an `INSERT … ON CONFLICT DO NOTHING`, on every
   authenticated call — including every read.
3. **One Handshake per repository method.** `NullPool` (`engine.py:72`) holds no connections,
   and every repo method opens its own `with self._session_factory()`. So `GET /restaurants`
   performs **three** separate Handshakes: `ensure_user`, `search_restaurants`,
   `aggregate_for_restaurants`.

Multiply by the network. **Confirmed 2026-09-04** via the Neon API — the project (`SAM`,
`purple-frost-33606894`) is in `aws-eu-central-1`, proxy host `c-3.eu-central-1.aws.neon.tech`,
while the Lambda is in `eu-west-3` (`infra/bin/infra.ts:14`). So each Handshake costs ~60–90 ms
cross-region rather than ~15–25 ms. Three is ~200–270 ms of pure Handshake, and JWKS adds
another ~50–150 ms. That accounts for most of the 540 ms.

> The earlier version of this section flagged the region as unverified because reading the
> decrypted `POSTGRES_DSN_PARAM` from SSM was blocked. The Neon control-plane API answers the
> same question without the secret. The inference was correct.

### 2.4 Retracted: "the p90 is Neon's Wake"

This document previously asserted that the 2–4 s p90 was Neon's free-plan autosuspend Wake.
**That does not survive checking.** Neon's own documentation puts reactivation at "a few
hundred milliseconds", and the parts only add up to about a second:

```
3 × Handshake      200–270 ms
JWKS               50–150 ms
Wake              ~500 ms
                  ─────────
                  ~750–920 ms      ... against a p90 of 2100–4100 ms
```

**So 2–3 s at the p90 is unattributed.** The leading suspect is absent from the fix list
entirely: `/places/*` calls **Geoapify's HTTP API** (`geoapify_places_provider.py`), a
third-party round trip that no amount of pooling or caching touches. Autosuspend is confirmed
fixed at 5 minutes and undisableable on free (`suspend_timeout_seconds: 0` on the project = the
API's 300 s default), so the Wake is real — it is just far too small to be the whole story.

Do not treat the p90 as explained. §7 step 0 exists to attribute it.

A keep-alive ping remains **rejected**: the free plan meters compute hours, and pinging every
4 minutes would keep the compute awake ~24/7. Verified as a live constraint — the project has
used 5,776 s of active time this billing period, and 24/7 would be ~720 h.

### The frontend adds a second serial round trip

`dashboard/page.tsx:45` and `dine/page.tsx:129` both do:

```
getCurrentUser()  →  await apiClient.getMe()  →  await loadRecipes()/loadRestaurants()
```

Two sequential API calls before any content renders, each paying the full §2 overhead. And
because each page owns this effect, `getMe()` is called from **four** separate page mounts
(`dashboard`, `dine`, `profile`, `profile/complete`) for data that cannot change mid-session.
There is **no React context anywhere in the frontend** and `layout.tsx` is a server component,
so the fix needs a client provider that does not yet exist.

`profile/page.tsx:38` already parallelises with `Promise.all` — it is `dashboard` and `dine`
that await serially. Separately, `profile/page.tsx` fetches **every** recipe and filters
client-side (already flagged in [`./frontend-ux-plan.md`](./frontend-ux-plan.md) §2d).

### Init, for completeness

Not the target, but free to shave, and "I accepted the cold start" meant *I won't pay to fix
it* rather than *leave it alone*:

- `build_dsn()` → SSM `GetParameter` + KMS decrypt (`engine.py:44`)
- `resolve_geoapify_api_key()` → a **second, sequential** SSM `GetParameter` + decrypt
  (`geoapify_places_provider.py:41`)
- `import boto3` inside both, which is expensive on Lambda
- `db.open()` → a whole connection to run `SELECT 1` (`engine.py:88`)

Honest sizing: ~1.5–2.0 s of the 3.3 s is importing FastAPI/SQLAlchemy/pydantic and is not
addressable. Batching the two SSM reads into one `get_parameters` call saves one encrypted
round trip, ~0.1–0.3 s. That is the whole prize.

`db.open()`'s `SELECT 1` should **stay**: once §4.3 lands it stops being a throwaway connection
and becomes a pre-warmed one that the first request inherits.

## 3. The URL question

Manel's instinct — that `/dashboard` staying on one URL while the view changes is wrong, and
it should be something like `/dashboard/comida` — is **correct about the problem**, and it is
**not the cause of the latency**. Two separate issues that happen to share a file.

`/dashboard` holds a 5-way `view` state machine (`categories → recipes → detail → edit → add`,
`page.tsx:32`) and `/dine` holds another. Real costs today:

- Nothing is linkable. A recipe or a restaurant cannot be sent to anyone.
- Refreshing throws you back to the category grid.
- **The device back gesture leaves the app** instead of going back a view. `goBack()`
  (`dashboard/page.tsx:124`) is a hand-rolled stack the browser knows nothing about. This got
  worse when the iOS home-screen icon started working: **standalone PWA mode has no browser
  chrome and therefore no back button**, so the hand-rolled one is the only way out.
- `dine/page.tsx` is 576 lines and `dashboard/page.tsx` is 403.

**The constraint that decides the shape:** `next.config.ts` sets `output: 'export'` and
`amplify.yml` publishes `frontend/out` as static files. A dynamic segment like `/recipes/[id]`
requires `generateStaticParams` at **build** time, which would mean knowing every recipe id
when Amplify builds — impossible. So the clean-looking option is not automatically available.

| Option | URLs | Cost |
| --- | --- | --- |
| **A. Query params** | `/dashboard?category=comida`, `/dine?place=<id>` | Pure frontend. Works with static export today. Delivers linkability, refresh-survival and real browser history. |
| **B. Amplify SPA rewrite** | `/dashboard/comida`, `/dine/<id>` | Add a rewrite (`/dine/<*>` → `/dine/index.html`) in Amplify config, read the segment client-side. Free, but the routing rule lives outside the repo unless committed as config. |
| **C. Drop static export** | Same as B, server-rendered | Amplify SSR runs a Lambda per request. **Adds cost and latency.** Rejected under the no-cost constraint. |

Recommendation: **A**, and only after §4.4 — splitting routes before caching `me` would
multiply the redundant `getMe()` calls rather than reduce them. B is a later cosmetic upgrade
over the same code if the paths matter aesthetically.

### Does routing affect performance? Asked 2026-09-06 — answer: essentially no

Worth writing down, because "clean URLs" and "faster" get conflated. A URL is an address;
changing `/dashboard` to `/dashboard?category=comida` makes no request faster.

The one genuine performance argument for route splitting is **code splitting** — each route
gets its own bundle, so people who never open the map never download MapLibre. **That argument
does not apply here: it is already solved by hand.** `RestaurantsMap`, `PinPickerMap` and
`LocationMap` all load through `next/dynamic` with a `MapLoading` placeholder, and the build
confirms it — MapLibre is absent from the 103 kB shared chunk.

Route splitting can also *hurt*. A route change unmounts the previous page, discarding
in-memory state. Today, moving category → recipe → back inside `/dashboard` keeps the fetched
list; as separate routes each navigation refetches. That is precisely why §7 sequences step 3
before the URL work.

**So the URL work is justified on the device back gesture, linkability and refresh survival —
never on milliseconds.** Judge it accordingly.

**Implemented 2026-09-06** as option A — see §7 step 4.

Note this supersedes the "splitting `dine/page.tsx` into real routes" deferral in
[`./frontend-ux-plan.md`](./frontend-ux-plan.md), which assumed path segments were available.

## 4. Fix list — all resolved

Every item below is either shipped or explicitly rejected. Kept as the record of *what* was
done and *why*, so none of it gets re-proposed from scratch.

| # | Fix | Outcome |
| --- | --- | --- |
| 4.1 | Module-scope `JWTHandler`, JWKS cached per container | **Shipped** — `@lru_cache` factory, cache keyed on `kid`, refetch rate-limited to once a minute so a forged `kid` can't turn the API into an amplifier against Cognito |
| 4.2 | Take `ensure_user` off the read path | **Rejected** — after 4.3 it's a ~20 ms query on an open socket. Removing it buys 20 ms and costs a new-user foreign-key failure path |
| 4.3 | Pool connections instead of `NullPool` | **Shipped** — 3 Handshakes per request → 0. See [ADR-0006](../adr/0006-pooled-connections-on-lambda.md) |
| 4.4 | `me` once per session, not per page mount | **Shipped** — `UserProvider` seeded from `sessionStorage`; `getMe()` now called in exactly one place |
| 4.5 | Skeletons on `/dashboard` and `/profile` | **Shipped** — `PageSkeleton.tsx` |
| 4.6 | Stop over-fetching on `/profile` | **Shipped** — `GET /recipes?mine=true`, scoped from the JWT |
| 4.7 | Lambda memory 512 → 1024 MB | **Shipped, but it did nothing** — see §0. The premise was wrong |
| 4.8 | Batch the two cold-start SSM reads | **Shipped** — one `get_parameters` call via `src/infra/ssm.py` |
| 4.9 | Co-locate the DB and the Lambda | **Rejected** — see below |
| 4.10 | ARM64 (Graviton) | **Rejected** — see below |

Also folded into 4.1 while in the file: `jwt_handler.py` built the JWKS URL from `AWS_REGION`,
**the Lambda's own region rather than the user pool's**. It worked only because the two
coincided. The region is now derived from the pool id (`eu-west-3_…`), which is one source of
truth instead of two that can drift.

### Rejected, and why — so it isn't re-proposed

- **4.9 Co-locating the DB.** Not worth it *and* not cheap. After 4.3 the cross-region cost is
  one ~20 ms RTT per query, not 200–270 ms of Handshake. And **Neon has no `eu-west-3` region**
  (Europe is Frankfurt or London), so co-location can only mean moving the *Lambda* to
  `eu-central-1` — where `infra/bin/infra.ts` pins one region for all five stacks and
  `LambdaApiStack` holds a direct reference to `CognitoStack`. **Cognito user pools cannot move
  between regions**; passwords can't be exported, so every user would re-register.
  *Revisit only if* per-query RTT ever dominates a measured p50.
- **4.10 ARM64.** ~20% cheaper on a bill that is already zero. No latency case was ever made.
- **A request-scoped `Session`.** The original plan for 4.3: 22 call sites across five
  repositories, a moved transaction boundary, and *still* one Handshake per request. Pooling
  beat it in one file. Could still be argued on correctness grounds; never again on latency.
- **A Neon keep-alive ping.** Would keep the compute awake ~24/7 and burn metered free-plan
  compute hours. The no-cost constraint rules it out permanently.
- **Provisioned concurrency and Amplify SSR.** Same reason: recurring cost.

## 5. Open decisions — RESOLVED 2026-09-04

Grilled through; nothing here blocks implementation any more.

| Question | Resolution |
| --- | --- |
| Request-scoped session, or pooling? | **Pooling only** (§4.3, ADR-0006). Re-measure before considering the 22-site refactor. |
| Is free Init work in scope, given the cold start was accepted? | **Yes** — the constraint is money, not effort. Scoped to §4.8 (batch SSM). The import weight is not addressable. |
| p50 or p90 as the target? | **Neither yet** — the p90 is 2–3 s unattributed (§2.4). Instrument first (§7 step 0), then set a target against real per-route data. |
| Provisioning, if `ensure_user` moves? | **Moot — §4.2 dropped.** The upsert stays. |
| Prod Neon region? | **`aws-eu-central-1`, confirmed** via the Neon API, no secret needed. Cross-region is real. |
| Where does `me` live? | **Context seeded from `sessionStorage`** (§4.4), because a PWA launch is a full page load. |
| Is `?place=<id>` a modal or a full view? | Still open, but it is a **UX** decision inside step 5, not a blocker for steps 0–3. |

## 6. What else is queued

Nothing from this plan. What remains elsewhere:

- **Init is still ~3.25 s and nobody has a good answer.** The memory bump did nothing (§0), so
  whatever dominates it is package unpacking and library import I/O. Attacking that means going
  after the import graph or the deployment package size — speculative, unmeasured, and cold
  starts are tolerated. *Revisit if* cold starts start being the complaint.
- **No frontend test runner.** Newly a real gap: §7 step 4's URL encode/decode and
  `RestaurantFilters`' parsing are pure, edge-case-heavy functions with no way to pin them.
  `vitest` is the cheap fix.
- **`/places/search` has never been measured in production** (§7 step 5).
- From [`./future-roadmap.md`](./future-roadmap.md): a real domain (item 1), the npm/pnpm
  workflow (item 3), better search (item 4, parked behind ADR-0005), and Redis (item 5 — now
  purely a learning exercise, both its performance anchors having been answered here for free).
- From [`./frontend-ux-plan.md`](./frontend-ux-plan.md): photos, and full PWA/offline.

## 7. Execution sequence

§4 lists fixes by payoff; this is the order to ship them, cut into independently mergeable
steps. **Each step ends with a measurement**, because the point is to stop when it is fast
enough rather than to complete the list.

The baseline to beat, from §1: **Warm Path p50 ~540 ms, p90 2–4 s, Init ~3.3 s.**

### Step 0 — instrument first — SHIPPED 2026-09-05, measured in §0

`RequestTimingMiddleware` (`src/infra/middleware/timing.py`) emits one JSON line per request;
SQLAlchemy engine events (`src/infra/observability/request_metrics.py`) supply the DB numbers.

```json
{"evt":"req","route":"GET /restaurants","status":200,"ms":50.5,
 "db_connects":3,"db_connect_ms":20.5,"db_queries":5,"db_ms":14.3,"cold":true}
```

This is first because **§2.4 means we currently cannot tell whether any later step worked.**
`REPORT` lines have no route, so the unattributed 2–3 s at the p90 could be Geoapify and we
would ship three fixes and watch the p90 not move, with no idea why. It also gives step 2 a
direct success assertion — `db_connects` falling from 3 to 0–1 — rather than an inference from
aggregate latency.

Design notes worth keeping:

- **`db_connect_ms` is separate from `db_ms`.** The pool's `connect` event fires *after* the
  handshake, so it cannot time it; a `do_connect` hook starts the clock. Handshake cost is the
  precise thing step 2 removes, so it needs its own number rather than hiding in `ms - db_ms`.
- **`route` is the matched template**, not the path, so ids don't shard the `by route` grouping.
- **`cold` flags the first request a container serves**, which separates Init effects from Warm
  Path without joining against the `REPORT` line — the ambiguity that muddied §1.
- The counters live in a ContextVar holding a *mutable* object, because endpoints are sync
  (`def`) and run in a threadpool; anyio copies the context, so a `set()` from inside the
  endpoint would never reach the middleware.

Free: at 481 invocations/month this is far inside the 5 GB CloudWatch Logs free tier. No PII —
route, status and timings only.

#### Validated locally, and it already reproduces §2

Against local Postgres with only the JWT decode stubbed (`ensure_user` left in place):

| Route | `db_connects` | `db_connect_ms` | `db_queries` | `db_ms` |
| --- | --- | --- | --- | --- |
| `GET /restaurants` | **3** | 20.5 | 5 | 14.3 |
| `GET /users/me` | 2 | 11.5 | 2 | 3.0 |
| `GET /cuisines` | 2 | 12.2 | 2 | 3.5 |

Two things this settles. §2.3's three-connection claim is **confirmed**, not inferred. And
**every** authenticated endpoint pays at least two Handshakes — `ensure_user` plus its own read
— which §2 only spelled out for `/restaurants`.

Note these are *localhost* handshakes at ~6.8 ms each and they already cost more than all five
queries combined. Production pays 60–90 ms each, cross-region.

#### Reading it in production

```
fields @timestamp, route, ms, db_connects, db_connect_ms, db_ms, cold
| filter evt = "req" and cold = 0
| stats count(*) as n,
        pct(ms, 50) as p50, pct(ms, 90) as p90,
        avg(db_connects) as conns, avg(db_connect_ms) as conn_ms, avg(db_ms) as query_ms
  by route
| sort p90 desc
```

**Measure:** use the app deliberately for a few minutes after deploying — at ~16 requests/day
natural traffic will not produce a usable p90 for over a week. The `sort p90 desc` is the line
that finally attributes §2.4: if `/places/*` tops it with `conns` near zero, the p90 is Geoapify
and steps 1–3 were never going to touch it.

> **Shipped with steps 1 and 2, not alone** (decided 2026-09-05). The cost is that production
> never shows `db_connects` falling from 3 — it will already be 0–1 — so step 2's before/after
> comes from the local probe above plus §1's aggregate baseline. What we keep is the thing that
> actually matters: per-route attribution of the p90 still works on the very first deploy.

### Step 1 — the free wins (no behaviour change) — SHIPPED 2026-09-05, measured in §0

- Module-scope `JWTHandler`, cache keyed on `kid` with one refetch on a miss (§4.1).
- Explicit `COGNITO_REGION` instead of `AWS_REGION` for the JWKS URL (§4.1) — a latent bug,
  free to fix while in the file.
- Lambda memory 512 → 1024 MB (§4.7).
- Batch the two cold-start SSM reads (§4.8).

API behaviour does not change. Two details worth recording:

- **The JWKS cache is a `@lru_cache`d factory, not a module-level instance.** `JWTHandler.__init__`
  raises when the Cognito env vars are missing; at module scope that would kill the Lambda at
  import rather than failing one request.
- **`kid`-miss refetch is rate-limited to once a minute.** `kid` comes from an *unverified* token
  header, so a naive "unknown kid → refetch" turns any unauthenticated caller into an
  amplifier: one outbound HTTPS call to Cognito per forged request. Covered by a test.

The region fix derives the region from the pool id (`eu-west-3_aBcDeFgHi`) rather than adding a
`COGNITO_REGION` env var — one source of truth, no CDK change, and the two cannot drift.

**Measure:** per-route p50 and Init. Expect the JWKS round trip to vanish from `ms` and Init to
drop.

### Step 2 — pool the connections (§4.3) — SHIPPED 2026-09-05, measured in §0

Swap `NullPool` for a bounded `QueuePool` with `pool_pre_ping` and `pool_recycle`. One file.
See [ADR-0006](../adr/0006-pooled-connections-on-lambda.md) for the dead-socket and
cost-safety reasoning.

**Measure:** `avg(db_connects)` per route — 3 → 0–1 is the assertion that it worked at all —
then `db_ms` and the p50. Watch Neon's active-time in the console for a week to confirm the
compute still suspends. It should: only a logical-replication subscriber prevents that, not an
idle client connection.

Already confirmed locally by the step 0 instrument, same probe before and after:

| Route | `ms` before → after | `db_connects` | `db_connect_ms` |
| --- | --- | --- | --- |
| `GET /restaurants` | 50.5 → **23.8** | 3 → **0** | 20.5 → **0** |
| `GET /users/me` | 20.8 → **7.0** | 2 → **0** | 11.5 → **0** |
| `GET /cuisines` | 17.7 → **2.8** | 2 → **0** | 12.2 → **0** |

Zero rather than one, because `db.open()`'s `SELECT 1` pre-warms the pool at startup and the
first request inherits that connection. Note these are *localhost* handshakes at ~7 ms;
production pays 60–90 ms each, so the absolute saving should be several times larger.

### Step 3 — stop the frontend double round trip (§4.4–§4.6) — BUILT 2026-09-06 on `feature/latency_improvement`, not yet merged

**`GET /users/me` is 32% of all backend requests** (§0), at ~82 ms each, serially in front of
content on every page mount. Largest remaining win by volume.

- `me` in a client provider seeded from `sessionStorage`, fetched in parallel with the first
  data fetch, invalidated on profile edit.
- Skeletons on `/dashboard` and `/profile`.
- `/profile` stops fetching every recipe to filter client-side.

What shipped:

- **`UserProvider`** (`components/auth/UserProvider.tsx`) in `layout.tsx`, seeded from
  `sessionStorage`. `apiClient.getMe()` now appears in exactly **one** place in the codebase.
- **`useAuthGate`** (`components/auth/useAuthGate.ts`) holds the redirect policy the four pages
  each had a copy of. `/profile/complete` opts out of the display-name gate — it *is* the page
  that collects one, so the usual rule would bounce the user back to itself.
- **Cache invalidation on both save paths.** Without it, saving a name navigates to
  `/dashboard`, whose gate reads a cached `display_name: null` and bounces straight back to
  `/profile/complete`. This was the trap §4.4 warned about, and it is a real loop, not a theory.
- **`GET /recipes?mine=true`** (§4.6) — port, both repos, use case and controller. A query param
  on the existing route, so no API Gateway route to add. `/profile` no longer downloads every
  recipe in the database to throw most of them away.
- **`DashboardSkeleton` / `ProfileSkeleton`** (§4.5), replacing a bare spinner.

Two subtleties worth not rediscovering:

- **Effects are keyed on `me?.id`, not `me`.** The background revalidation hands back a new
  object every time; depending on `me` itself would refetch the whole page on every revalidate —
  turning a fix into a regression.
- **A `useRef` guard around the initial load.** React StrictMode double-invokes effects in
  development, so without it the provider fires two `/users/me` calls on the very mount it
  exists to remove.

**Measure:** requests per navigation in the browser network panel — 2 → 1 on every page mount
after the first, and 0 extra on a PWA relaunch. In CloudWatch, `GET /users/me` should fall from
**32% of all requests** to roughly one per session. This is the change Manel will *feel* most,
independent of server p50.

### Step 4 — URLs (§3) — BUILT 2026-09-06

Query params per §3 option A, on both `/dashboard` and `/dine`.

- `lib/url-state.ts` — History API wrapper: `push` for views, `replace` for filters, a
  `popstate` subscription, and a depth counter so the in-app Back button can defer to
  `history.back()` where there is real history and fall back to a state change on a deep link.
- `lib/dashboard-url.ts` / `lib/dine-url.ts` — pure encode/decode per page.

**The URL is derived from the view state rather than pushed at each transition**, so none of
the ~14 `setView` call sites changed. Restoring runs the same mapping backwards. An
`applyingHistory` ref stops a popstate from triggering a fresh push, which would otherwise trap
the user.

Two deliberate asymmetries:

- **Filters `replace`, views `push`.** Tweaking five chips shouldn't cost five back presses.
  On `/dine` both share one query string, so a single writer composes the whole thing —
  two writers would have erased each other's params.
- **`edit-review` is not restorable.** It needs a specific review as well as a restaurant, and
  a URL naming a since-deleted review is worse than landing on the restaurant. It still pushes
  an entry so the back gesture dismisses the editor; it just decodes to `detail`.

Deep links to a missing recipe or restaurant fall back to the list rather than rendering an
empty detail view, and an unrecognised `?category=` is ignored rather than trusted.

**Not a performance change** — see §3. It buys linkability, refresh survival, and a device back
gesture that no longer exits the app from standalone PWA mode.

**Verification gap:** the encode/decode functions were checked by an 18-case round-trip script
(including hand-edited and hostile input), but the repo has **no frontend test runner**, so that
script could not be committed. Adding one — `vitest` is the cheap option — would let these
functions and `RestaurantFilters`' own parsing be pinned properly.

### Step 5 — the Geoapify wait — BUILT 2026-09-06

**Measured first, and it reframed the problem.** Timing Geoapify directly from a laptop:

| Call | avg |
| --- | --- |
| `/v2/places` — nearby, limit 20 (what the app sends) | 1028 ms |
| `/v2/places` — limit 10 | 869 ms |
| `/v1/geocode/autocomplete` — **the text search** | **1576 ms** |

So the **text search is the slower endpoint**, not `nearby` — and unlike `nearby` it fires
repeatedly while typing. Production sees ~2.9 s on `/places/nearby` (three samples: 3148, 2922,
2728 ms), roughly double the laptop figure.

**We cannot make Geoapify fast.** ~1–1.6 s is its floor, and the frontend already debounces both
searches at 350 ms, so the obvious fixes were already in place. What the latency *was* doing was
producing two real bugs, and those are fixed:

1. **The UI claimed the search had failed before it finished.** While the call was in flight
   `placeMatches.length === 0`, so `RestaurantForm` rendered "Can't find it on the map? Drop a
   pin instead." A `searchingPlaces` state now shows "Sniffing out matches…" instead.
2. **Out-of-order responses overwrote fresh results.** `.then(setPlaceMatches)` had no
   sequencing, and at ~3 s a slow earlier response landing after a fast later one is likely, not
   theoretical. Responses are now dropped unless they belong to the newest request.

Deliberately **not** done: a server-side response cache. Coordinates and half-typed names rarely
repeat, so the hit rate for a single user would be near zero — complexity without payoff.
*Revisit if* usage grows enough for repeat queries to be common.

Still unmeasured in production: `/places/search`. No logging session has triggered one, so its
real-world latency is inferred from the laptop figure.

## Cross-links

- [`../adr/0006-pooled-connections-on-lambda.md`](../adr/0006-pooled-connections-on-lambda.md) — §4.3's decision, and why the `NullPool` rationale doesn't apply here.
- [`../../CONTEXT.md`](../../CONTEXT.md) — § Language › Latency pins Init / Warm Path / Wake / Handshake.
- [`./improvement-plan.md`](./improvement-plan.md) — Phase 4, now shipped.
- [`./frontend-ux-plan.md`](./frontend-ux-plan.md) — §3 here supersedes its route-splitting deferral.
- [`./ec2-migration-plan.md`](./ec2-migration-plan.md) — shelved; §4 is the "stay on Lambda" answer to latency.
- [`../knowledge/sync-vs-async.md`](../knowledge/sync-vs-async.md) — why the stack is sync, which §4.3 does not change.
