# Future Roadmap — after `improvement-plan.md` is done

> Not scoped yet — just the ideas as raised, captured so they aren't lost. Each of these needs its own grilling/design pass before implementation, the same way Phase 2 (restaurant reviews) got one. Treat this as a backlog of topics, not a spec.

## 1. Buy a real domain

Currently the API is served from an AWS-generated `execute-api...amazonaws.com` URL and the frontend from an Amplify-generated one. Buying a domain (Route 53 or another registrar) and pointing it at both via a hosted zone + ACM certs would give stable, branded URLs that don't change if the underlying compute changes later (e.g. Lambda → EC2). This groundwork is already written up in [`neon-migration-plan.md`](./neon-migration-plan.md) section 0b — it was consciously punted there, not forgotten.

## 2. Decide: stay on Lambda, or move off it for performance

Open question: is Lambda's cold-start/perf profile good enough long-term, or does this move to EC2 (or something else)? [`ec2-migration-plan.md`](./ec2-migration-plan.md) already exists as a fully worked-out plan for the EC2 path (Caddy/NGINX reverse proxy, SSM-based deploys, single-instance no-ALB setup) — the open decision is *whether* to pull that trigger, not *how*. Worth revisiting once real usage/perf data exists to justify the move (or rule it out).

## 3. Improve the npm workflow — maybe pnpm, maybe a single entrypoint

Current friction: `npm install` + separate `npm run dev` (and remembering which directory — `frontend/` vs `infra/`) is more ceremony than the backend's `uv run` equivalent. Two separate threads to pull on:
- **pnpm instead of npm** — faster installs, stricter dependency resolution (no phantom deps), disk-space savings via content-addressable store. Would need lockfile migration in both `frontend/` and `infra/`.
- **A single command to rule them all** — something like `uv run start` on the backend side already collapses env setup + run into one step; the frontend has no equivalent. Worth exploring a root-level task runner (`just`, `make`, or an npm/pnpm workspace script) so `<tool> dev` boots frontend + backend together instead of juggling two terminals and two sets of install steps.

## 4. Improve search — Elasticsearch or similar

Today, restaurant/recipe search is a simple case-insensitive `ILIKE` query against Postgres (see the restaurant dedup search in [`improvement-plan.md`](./improvement-plan.md)). Fine for now, but doesn't scale to fuzzy matching, typo tolerance, or ranking relevance as the data grows. Options to weigh later: Postgres full-text search (`tsvector`, no new infra) as a cheap first step, vs. a dedicated search engine (Elasticsearch/OpenSearch, Meilisearch, Typesense) if requirements grow past what Postgres FTS can reasonably do. Needs a real trigger (actual search-quality complaints) before picking a direction — no sense over-engineering this before it hurts.

## 5. Redis — as a learning exercise, anchored to a real use case

Motivation here is explicitly "want to practice building with Redis," not an actual performance bottleneck today — worth being honest about that going in, so it doesn't get over-justified later. The anchor use case that would make it a real piece of the system rather than decorative: **cache computed restaurant rating aggregates.** `GetRestaurant` (`backend/src/app/use_cases/get_restaurant.py`) currently pulls every review for a restaurant and recomputes the 4 category averages + overall on every single request — caching that (invalidated on review create/delete) is a small, well-scoped, genuinely useful case. Two smaller candidates if more surface area is wanted: JWKS caching in `JWTHandler` (`backend/src/infra/security/jwt_handler.py`), currently cached per-Lambda-container instance and lost on cold start; and rate limiting on review/restaurant creation (sliding-window counters).

The more interesting open question is **where it would run**, and it connects directly to item #2 above: AWS ElastiCache requires a VPC, which reintroduces the NAT gateway cost the Aurora→Neon migration specifically avoided (see `neon-migration-plan.md` section 0a). A serverless Redis (e.g. Upstash — reachable over HTTPS, no VPC needed) fits the Lambda-outside-VPC model the same way Neon does today, and is the more natural fit unless the Lambda→EC2 move happens first.
