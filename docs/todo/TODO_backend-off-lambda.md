# TODO — Backend off Lambda

> **Status: Proposed — not started.**

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

## Plan

- [ ] **Spike (½ day):** deploy the FastAPI app unchanged to Vercel (Hobby, free — this is a
      non-commercial personal project), region `fra1` next to Neon. Measure (1) a cold first
      request and (2) **a plan-page load with 4 parallel requests after idle**: do they share one
      instance (Fluid compute) or cold-start 4? Go on only if both stay clearly below ~1.5 s.
- [ ] If it does: move env/secrets (today SSM), keep Cognito, point the frontend at the new URL,
      delete the Lambda/API Gateway stacks. The gateway-route test and `addRoutes` rule go away
      with them.
- [ ] If it doesn't: fallback inside AWS — Lambda SnapStart for Python (shrinks every Init,
      including mid-session ones), plus fewer parallel requests per page. A `/health` ping alone
      only keeps one instance warm (see above). Hours of work, ~0 €.
- [ ] Frontend hosting follows [the web-or-mobile decision](./TODO_web-or-mobile-decision.md);
      Amplify is not a speed problem, so moving it is about convenience (preview deploys per PR).
- [ ] Update `docs/wiki/ci-cd.md`, `CONTEXT.md` and an ADR for the move.

**Not a reason to stay on Lambda:** none of the work repos (mywally, joblocal, rood) runs its API
on Lambda — they use ECS Fargate + RDS, which is not free. So Lambda is not "practice for work".
