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

## 3. Improve the npm workflow — maybe pnpm, maybe a single entrypoint

Current friction: `npm install` + separate `npm run dev` (and remembering which directory — `frontend/` vs `infra/`) is more ceremony than the backend's `uv run` equivalent. Two separate threads to pull on:
- **pnpm instead of npm** — faster installs, stricter dependency resolution (no phantom deps), disk-space savings via content-addressable store. Would need lockfile migration in both `frontend/` and `infra/`.
- **A single command to rule them all** — something like `uv run start` on the backend side already collapses env setup + run into one step; the frontend has no equivalent. Worth exploring a root-level task runner (`just`, `make`, or an npm/pnpm workspace script) so `<tool> dev` boots frontend + backend together instead of juggling two terminals and two sets of install steps.

## 4. Improve search — Elasticsearch or similar

Today, restaurant/recipe search is a simple case-insensitive `ILIKE` query against Postgres (see the restaurant dedup search in [`improvement-plan.md`](./improvement-plan.md)). Fine for now, but doesn't scale to fuzzy matching, typo tolerance, or ranking relevance as the data grows. Options to weigh later: Postgres full-text search (`tsvector`, no new infra) as a cheap first step, vs. a dedicated search engine (Elasticsearch/OpenSearch, Meilisearch, Typesense) if requirements grow past what Postgres FTS can reasonably do. Needs a real trigger (actual search-quality complaints) before picking a direction — no sense over-engineering this before it hurts. **Reaffirmed 2026-09-01** in [`../adr/0005-restaurant-list-is-a-scrapbook.md`](../adr/0005-restaurant-list-is-a-scrapbook.md): at 24 restaurants the dine page ships *filters* instead, and this item stays parked until search quality is actually the complaint.

## 5. Redis — as a learning exercise, anchored to a real use case

Motivation here is explicitly "want to practice building with Redis," not an actual performance bottleneck today — worth being honest about that going in, so it doesn't get over-justified later. The anchor use case that would make it a real piece of the system rather than decorative: **cache computed restaurant rating aggregates.** `GetRestaurant` (`backend/src/app/use_cases/get_restaurant.py`) currently pulls every review for a restaurant and recomputes the 4 category averages + overall on every single request — caching that (invalidated on review create/delete) is a small, well-scoped, genuinely useful case. Two smaller candidates if more surface area is wanted: JWKS caching in `JWTHandler` (`backend/src/infra/security/jwt_handler.py`), currently cached per-Lambda-container instance and lost on cold start; and rate limiting on review/restaurant creation (sliding-window counters). **Correction (2026-09-02):** the JWKS claim above is wrong — the cache is per *request*, not per container, because `JWTHandler()` is constructed inside `get_current_user`. That makes it a one-line in-process fix, not a Redis use case; see [`./routing-and-latency-plan.md`](./routing-and-latency-plan.md) §2.1. The aggregate-caching anchor also partly overlaps that plan's §4.3, so re-read both before scoping this.

The more interesting open question is **where it would run**, and it connects directly to item #2 above: AWS ElastiCache requires a VPC, which reintroduces the NAT gateway cost the Aurora→Neon migration specifically avoided (see `neon-migration-plan.md` section 0a). A serverless Redis (e.g. Upstash — reachable over HTTPS, no VPC needed) fits the Lambda-outside-VPC model the same way Neon does today, and is the more natural fit unless the Lambda→EC2 move happens first.

## 6. Real URLs for page state — DIAGNOSED (2026-09-02)

`/dashboard` and `/dine` each hold a multi-way view state machine on a single URL, so nothing
is linkable, refresh loses the view, and the device back gesture exits the app — which now
matters more because the iOS home-screen install works and standalone mode has no back button.
Diagnosed, with the `output: 'export'` constraint that rules out path segments, in
[`./routing-and-latency-plan.md`](./routing-and-latency-plan.md) §3. Not the cause of item 7.

## 7. Latency after the cold start — DIAGNOSED (2026-09-02)

Warm requests average ~540 ms with a p90 of 2–4 s. Measured, attributed and costed in
[`./routing-and-latency-plan.md`](./routing-and-latency-plan.md) — the causes are a per-request
JWKS fetch, a per-request DB write, three separate connections per request under `NullPool`,
a serial `getMe()` waterfall on the frontend, and Neon's 5-minute free-plan autosuspend.
Every proposed fix is free; none of them require leaving Lambda.
