# TODO — Backend off Lambda

> **Status: In progress** — 2026-11-14: the API runs on Vercel (`sam-api`, Frankfurt) and the
> production web app calls it. Lambda stays deployed as the rollback until it is removed.

## What is actually slow (measured 2026-11-08)

| | Number |
|---|---|
| Frontend (Amplify, static) | 0.1–0.17 s per page — **not the problem** |
| API warm, handler p50 | 294 ms |
| Lambda Init on a cold start | ~3.4 s average (22 cold starts in 7 days) |
| First request of a session | **10 of 10 sessions started cold: 3.4–6.7 s** |
| Cold starts per session | ~2: the page fires requests in parallel and each gets its own cold Lambda |

So the felt slowness is the backend cold start. Warm requests are fine.

### Why moving between pages is slow too (measured 2026-11-08, 14 days of logs)

**One Lambda instance serves one request at a time.** A page that fires 4 requests in parallel
(the plan page: recipes, carry-forward, grocery items, kitchen) needs 4 warm instances. If fewer
are warm, Lambda starts new ones, and each pays the ~3.5 s Init. So cold starts happen mid-session
too, not only on the first page:

| Time (8 Nov) | What happened |
|---|---|
| 19:27:51 | Session starts: 2 cold instances |
| 19:31:21 | Plan page, 4 parallel requests, only 2 warm → **2 more cold starts, page ~4 s** |
| 19:31:57 | Same page again, 4 instances warm → all requests 100–240 ms |

- 139 requests in 14 days, **43 cold (31 %)**; 8 Nov alone: 3 sessions, 10 cold starts.
- **Not CPU or memory:** 1024 MB configured, 232 MB max used. A warm request spends its time
  waiting on the network, not computing.
- **Neon is a multiplier, not the cause:** each query costs ~15–25 ms, almost all of it the
  Paris → Frankfurt round trip. A request makes 2–10 queries (GET /plans ~7, carry-forward ~10),
  so about half of a warm request (p50 177 ms) is DB wait. Same region would cut that to a few ms
  per query.
- `GET /places/nearby` (Google Places, when adding a restaurant) takes 0.6–3.7 s on its own. That
  is an external API, unrelated to Lambda.

**What fixes it:** a runtime where one instance serves many requests at once (a normal uvicorn
process on Fargate or a VM, or Vercel's Fluid compute) plus the API in the same region as Neon.
A `/health` keep-warm ping keeps only **one** instance warm, so it would not fix a 4-request
page. Provisioned concurrency for 4 instances costs ~40 $/month. September's latency work ([`../plans/routing-and-latency-plan.md`](../plans/routing-and-latency-plan.md))
fixed warm latency and left Init open on purpose; more memory did not reduce it.

Neon plays a smaller part: the database is in Frankfurt (`aws-eu-central-1`), the Lambda in Paris
(`eu-west-3`), and the free compute suspends after 5 min idle (a wake of a few hundred ms).

## What the spike measured (2026-11-14)

The plan page's four GETs fired together, from a laptop in Spain:

| | Lambda (Paris) | Vercel (Frankfurt) |
|---|---|---|
| Cold, after 20 min idle | 5.46 s | **2.94 s** — the four requests shared one instance |
| Both warm | 0.72 s | 0.67 s |

Inside a warm Vercel request (the app's own `evt: req` line): connect to Neon 23 ms (was 60–90),
a query ~1–2 ms (was 15–25), handlers 27–240 ms. Most of the 0.7 s seen from outside is TLS
from the client.

**The cold start missed the ~1.5 s bar**, so it is the next thing to work on. The `evt: boot`
line splits it: Python start + imports **1.2–1.4 s** (0.4–0.7 s on a Mac), `create_app`
0.14–0.17 s, first Neon connect 0.08–0.10 s; the remaining ~1 s is the platform's. Fluid
compute does not always share: one of four parallel requests can still start a second, cold
instance.

## Plan

- [x] **Spike:** FastAPI deployed unchanged to Vercel Hobby, `fra1`, Fluid compute on. Faster
      than Lambda cold and warm, slower than the 1.5 s bar cold — migrated anyway (ADR 0008:
      free, next to Neon, deploys without GitHub Actions) with the cold start as a follow-up.
- [x] Project `sam-api`: Git-connected to `manelcardenas/sam`, Root Directory `backend`,
      region pinned to `fra1` in the project too. **Builds only `main`, and only when `backend/`
      changed** (the project's ignore command). Env vars set from SSM/Lambda (sensitive ones
      marked sensitive); `CORS_ALLOW_ORIGINS` = the Amplify domain + `http://localhost:8080`,
      since API Gateway's CORS no longer sits in front.
- [x] Migrations + grocery seed in Vercel's build (`scripts/vercel_build.py`, production only,
      direct endpoint) — verified: at head, 281 items upserted.
- [x] The whole web app against Vercel locally: 11 screens, 43 calls to 12 endpoints, all 200
      (the prod test user got a display name, "Test", so it is no longer bounced to
      `/profile/complete`).
- [x] Production web app switched: Amplify `NEXT_PUBLIC_API_URL` → `https://sam-api-five.vercel.app`
      (by hand, and `infra/cdk.json` so a CDK deploy keeps it). **Rollback:** set it back to
      `https://xbm9t398cd.execute-api.eu-west-3.amazonaws.com` and rebuild.
- [x] Cold start, part 1 (2026-11-14): **lazy imports were measured and dropped** — the
      only optional ones are `httpx` (12 ms locally) and `mangum` (6 ms) of 345 ms; SQLAlchemy,
      FastAPI and Pydantic are half the import time and every request needs them. Instead the
      boot does *more*: it fetches Cognito's JWKS (~250 ms, was paid by the first signed-in
      request), and the web app pings `/health` as it opens (and after 4+ min in the
      background) plus a `preconnect`, so the boot overlaps the sign-in form. Python pinned to
      3.13 (Vercel had picked 3.14 while CI tests 3.13).
- [ ] Cold start, part 2: measure the first real request after a cold open with the boot line.
      If it still waits, a keep-warm ping every ~5 min from a free external cron: Vercel bills
      provisioned memory only while a request is in flight ("nothing at all between requests",
      Fluid pricing docs), so ~8,600 pings a month is ~0.2 GB-h of the 360 included. It keeps
      Vercel warm, not Neon (that would spend Neon compute hours).
- [x] Code no longer targets Lambda: `mangum` and its `handler` removed, plus `pyjwt` (never
      imported; python-jose does the JWT work). `deploy-backend.yml` deleted with them — had
      Actions come back, it would have deployed a Lambda with no handler *and* run migrations
      alongside Vercel's build. The deployed Lambda keeps running its last bundle, so the
      rollback URL still works, frozen at that version.
- [x] Web off Amplify too (2026-11-14): Vercel project `sam-web`,
      `https://sam-web-zeta.vercel.app`, Git-connected, `main` only (`frontend/vercel.json`).
      Its origin added to Cognito (`webDomain` in `cdk.json`, stack deployed) and to the API's
      `CORS_ALLOW_ORIGINS`; the e2e walk signs in there and visits all 16 screens.
      `deploy-frontend.yml` deleted. Moving origin means signing in again and re-adding the
      app to the home screen once.
- [x] `docs/wiki/ci-cd.md` and `frontend-deployment.md` rewritten for Vercel.
- [ ] After a few days without problems, delete the frozen rollbacks and what only they use:
      the Lambda/API Gateway and Amplify stacks, `amplifyDomain` in `cdk.json` (and from
      Cognito and CORS), the CI role and OIDC provider stacks, the gateway-route test, the
      `addRoutes` rule (AGENTS.md, memory), the SSM parameters only Lambda or Amplify read
      (`/recipe-manager/github-token`, the DB DSN and LLM/Geoapify keys), and the root
      `package.json`'s `next` dependency (it existed only for Amplify's detection; drop it
      with `check:next-pin`). `CONTEXT.md`'s Cold start entry still describes Lambda.
- [ ] Previews per PR (web and API): a web preview has its own origin, which neither CORS nor
      Cognito accept, and an API preview needs its own database (a Neon branch), not
      production. **Revisit when** a PR needs testing before merge.

**Deploying from a laptop** (while GitHub Actions is locked): a CLI upload of `backend/` needs
the project's Root Directory cleared for the upload and restored afterwards; uploading from the
repo root would also send the untracked production backups in `backend/`.

**Not a reason to stay on Lambda:** none of the work repos (mywally, joblocal, rood) runs its API
on Lambda — they use ECS Fargate + RDS, which is not free. So Lambda is not "practice for work".
