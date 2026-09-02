# Routing & Latency — diagnosis and plan

> **Status (2026-09-02): DIAGNOSED, NOT SCOPED.** The measurements in §1–§2 are real and
> taken from production. The fix list in §4 is ordered by payoff but has **not** had a
> grilling pass, and §5 lists the decisions that need one before anything is implemented.
>
> Raised by Manel after Phase 4 shipped: (a) the app keeps every page state on one URL,
> (b) navigation is sometimes very slow even when the Lambda is warm. Hard constraint on
> everything below: **no new recurring cost.** Staying on Lambda is settled
> ([`./ec2-migration-plan.md`](./ec2-migration-plan.md) is shelved).

## 1. Measured baseline

CloudWatch, `recipe-manager-api`, 7 days to 2026-09-02 (184 sampled `REPORT` lines):

| Metric | Value |
| --- | --- |
| Cold-start **init** | **~3.3 s** average (22 cold starts sampled) |
| Cold-start handler duration | ~2.2 s *on top of* init |
| Warm handler duration | **~540 ms** average, p90 **2.1–4.1 s**, max 4.3 s |
| Memory used | **233 MB of 512** — memory is not the constraint |
| Invocations | **481 per 30 days** |

Two things to read carefully:

- The Lambda `Duration` metric **excludes** `Init Duration`. So the ~540 ms average is the
  *warm* path — the time to serve a simple `SELECT` with the container already up. That is
  the number that matches "slow even after the cold start", and it is the real target.
- 481 invocations/month against a perpetual free tier of 1M requests and 400,000 GB-seconds
  means the function currently consumes **~130 GB-s, i.e. 0.03% of the free allowance.**
  This makes §4.6 free rather than merely cheap.

## 2. Diagnosis — where the warm 540 ms goes

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
3. **One fresh TCP+TLS+Postgres-auth handshake per repository method.** `NullPool` holds no
   connections, and every repo method opens its own `with self._session_factory()`. So
   `GET /restaurants` opens **three** separate connections: `ensure_user`,
   `search_restaurants`, `aggregate_for_restaurants`.

Multiply by the network: the local `.env`'s Neon block is
`…eu-central-1.aws.neon.tech` (Frankfurt) while the Lambda is in **eu-west-3** (Paris). A
Postgres TLS connect is roughly 5–7 round trips, so each connection costs ~60–90 ms
cross-region rather than ~15–25 ms in-region. Three of them is ~200–270 ms of pure
handshake, and the JWKS call adds another ~50–150 ms. That accounts for most of the 540 ms.

> **Unverified:** reading the decrypted `POSTGRES_DSN_PARAM` from SSM was blocked, so the
> *production* DB region is inferred from the commented Neon block in the local `.env`.
> Confirm before acting on §4.8.

### Why the p90 is 2–4 s

Neon's free plan **autosuspends the compute after 5 minutes idle** and the suspend delay is
not configurable below that. The first connection after a pause pays the wake. That is
exactly the shape of "navigating the web is sometimes super slow" — it is not a Lambda cold
start, and it recurs all day.

A keep-alive ping is the obvious idea and is **rejected**: the free plan meters compute
hours, and pinging every 4 minutes would keep the compute awake ~24/7 and burn the
allowance. The affordable answer is to pay the wake **once** per request instead of three
times (§4.3), and to make the UI honest about it (§4.5).

### The frontend adds a second serial round trip

`dashboard/page.tsx:44` and `dine/page.tsx:90` both do:

```
getCurrentUser()  →  await apiClient.getMe()  →  await loadRecipes()/loadRestaurants()
```

Two sequential API calls before any content renders, each paying the full §2 overhead — so
a page mount is ~1.1 s warm, and several seconds if Neon was asleep. And because each page
owns this effect, navigating dashboard → dine → profile re-fetches `getMe()` **three times**
for data that cannot change.

Separately, `profile/page.tsx` fetches **every** recipe and filters client-side
(already flagged in [`./frontend-ux-plan.md`](./frontend-ux-plan.md) §2d).

## 3. The URL question

Manel's instinct — that `/dashboard` staying on one URL while the view changes is wrong,
and it should be something like `/dashboard/comida` — is **correct about the problem**, and
it is **not the cause of the latency**. Two separate issues that happen to share a file.

`/dashboard` holds a 5-way `view` state machine (`categories → recipes → detail → edit →
add`, `page.tsx:32`) and `/dine` holds another. Real costs of that today:

- Nothing is linkable. A recipe or a restaurant cannot be sent to anyone.
- Refreshing throws you back to the category grid.
- **The device back gesture leaves the app** instead of going back a view. `goBack()`
  (`dashboard/page.tsx:124`) is a hand-rolled stack that the browser knows nothing about.
  This got worse when the iOS home-screen icon started working: **standalone PWA mode has
  no browser chrome and therefore no back button at all**, so the hand-rolled one is the
  only way out of a detail view.
- `dine/page.tsx` is 576 lines and `dashboard/page.tsx` is 403.

**The constraint that decides the shape:** `next.config.ts` sets `output: 'export'` and
`amplify.yml` publishes `frontend/out` as static files. A dynamic segment like
`/recipes/[id]` requires `generateStaticParams` at **build** time, which would mean knowing
every recipe id when Amplify builds — impossible. So the clean-looking option is not
automatically available.

Three options, in increasing cost:

| Option | URLs | Cost |
| --- | --- | --- |
| **A. Query params** | `/dashboard?category=comida`, `/dine?place=<id>` | Pure frontend. Works with static export today. Delivers linkability, refresh-survival and real browser history. |
| **B. Amplify SPA rewrite** | `/dashboard/comida`, `/dine/<id>` | Add a rewrite (`/dine/<*>` → `/dine/index.html`) in Amplify console config, read the segment client-side. Free, but the routing rule lives outside the repo unless it is committed as config. |
| **C. Drop static export** | Same as B, server-rendered | Amplify SSR runs a Lambda per request. **Adds cost and latency.** Rejected under the no-cost constraint. |

Recommendation: **A**, and only after §4.4 — splitting routes before caching `me` would
multiply the redundant `getMe()` calls rather than reduce them. B is a later cosmetic
upgrade over the same code if the paths matter aesthetically.

Note this supersedes the "splitting `dine/page.tsx` into real routes" deferral in
[`./frontend-ux-plan.md`](./frontend-ux-plan.md), which assumed path segments were available.

## 4. Fix list

Ordered by payoff per unit of work. Every item is free.

### Backend — removes overhead from every request

1. **Cache `JWTHandler` at module scope** (or `@lru_cache`), so JWKS is fetched once per
   container instead of once per request. Removes an HTTPS round trip from every call.
   Roughly a one-line change and the single biggest win.
2. **Take `ensure_user` off the read path.** Provision on `GET /users/me` and on writes, not
   on every authenticated request. Removes a DB write — and a connection — from every read.
3. **One session per request, not one per repository call.** A request-scoped session
   dependency cuts `GET /restaurants` from three connections to one, which also means paying
   a Neon wake once instead of three times. This is the fix that most directly targets the
   p90.

### Frontend — removes a whole round trip per navigation

4. **Fetch `me` once per session, not once per page.** Hoist it into a context or
   `sessionStorage`, and run it in parallel with the first data fetch (`Promise.all`) instead
   of awaiting it first. Removes one serial API call from every page mount.
5. **Skeletons on the remaining wait.** `/dine` has them; `/dashboard` and `/profile` still
   blank out. This does not make anything faster, it makes the unavoidable Neon wake legible.
6. **Stop over-fetching on `/profile`** — `?mine=true` on recipes, or `GET /users/me/recipes`
   to match the reviews route.

### Infra — configuration only

7. **Raise Lambda memory 512 MB → 1024 MB.** Lambda CPU scales with memory: 512 MB is
   ~0.3 vCPU, so init and warm time are partly CPU-bound. **Cost impact is zero** — at 481
   invocations/month the function uses 0.03% of the free GB-s allowance, and even 1769 MB
   (a full vCPU) would use ~0.1%. Worth testing 1024 and 1769 and keeping the better one.
   This is the cheapest single change in the document and needs no code.
8. **Co-locate the DB and the Lambda.** If prod Neon really is in eu-central-1 while the
   Lambda is in eu-west-3, every connection pays cross-region RTT. Free either way — create
   the Neon project in eu-west-3 and dump/restore, or redeploy the stack to eu-central-1 —
   but it is a migration with a real cutover, not a config flip. Confirm the region first.
9. **Consider ARM64 (Graviton).** ~20% cheaper and usually no slower. Irrelevant to the bill
   at this volume; listed only because it is free and touches the same CDK block as §4.7.

## 5. Open decisions — need a grilling pass

- Is the target "fast enough" defined by p50 or p90? The p90 is dominated by Neon's wake,
  which no amount of application work removes. Fixing §4.1–§4.4 should take warm p50 from
  ~540 ms toward ~150–200 ms; the p90 will stay seconds-shaped until the DB is warm.
- §4.2 changes when a user row appears. What happens to a brand-new Cognito user whose very
  first call is a read? Today `ensure_user` papers over it on every request.
- §4.3 means a request-scoped session and therefore a real transaction boundary per request.
  That is arguably more correct than today's session-per-call, but it changes failure
  semantics for multi-repo use cases.
- §4.8 needs the prod DB region confirmed, and a decision on which side moves.
- Does §3 option A's `?place=<id>` want to be a modal over the list (today's behaviour) or a
  distinct full view? That is a UX decision, not a routing one.

## 6. What else is queued

From [`./future-roadmap.md`](./future-roadmap.md), unchanged and still unscoped: a real
domain (item 1), the npm/pnpm workflow (item 3), better search (item 4, parked behind
ADR-0005), and Redis as a learning exercise (item 5 — note its JWKS premise is corrected by
§2.1 above, and its aggregate-caching premise partly overlaps §4.3).

From [`./frontend-ux-plan.md`](./frontend-ux-plan.md): sort controls (closest / best rated),
photos, and full PWA/offline. (The map — scope B of
[`./geoapify-places-plan.md`](./geoapify-places-plan.md) — is no longer queued: it shipped in
PR #44 and is merged into the dine list as a cards/map toggle.)

## Cross-links

- [`./improvement-plan.md`](./improvement-plan.md) — Phase 4, now shipped.
- [`./frontend-ux-plan.md`](./frontend-ux-plan.md) — §3 here supersedes its route-splitting deferral.
- [`./ec2-migration-plan.md`](./ec2-migration-plan.md) — shelved; §4 is the "stay on Lambda" answer to latency.
- [`../knowledge/sync-vs-async.md`](../knowledge/sync-vs-async.md) — why the stack is sync, which §4.3 does not change.
