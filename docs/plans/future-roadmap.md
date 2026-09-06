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

## 4. Improve search — Elasticsearch or similar

Today, restaurant/recipe search is a simple case-insensitive `ILIKE` query against Postgres (see the restaurant dedup search in [`improvement-plan.md`](./improvement-plan.md)). Fine for now, but doesn't scale to fuzzy matching, typo tolerance, or ranking relevance as the data grows. Options to weigh later: Postgres full-text search (`tsvector`, no new infra) as a cheap first step, vs. a dedicated search engine (Elasticsearch/OpenSearch, Meilisearch, Typesense) if requirements grow past what Postgres FTS can reasonably do. Needs a real trigger (actual search-quality complaints) before picking a direction — no sense over-engineering this before it hurts. **Reaffirmed 2026-09-01** in [`../adr/0005-restaurant-list-is-a-scrapbook.md`](../adr/0005-restaurant-list-is-a-scrapbook.md): at 24 restaurants the dine page ships *filters* instead, and this item stays parked until search quality is actually the complaint.

## 5. Redis — a learning exercise, and now *only* that

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
