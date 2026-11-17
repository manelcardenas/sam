# TODO — the queue

> **Status: Active** — agreed order as of 2026-11-08. This file is the source of truth for
> "what's next"; [`../plans/future-roadmap.md`](../plans/future-roadmap.md) keeps the history.

One file per task. Each opens with a status banner:

- `> **Status: Proposed — not started.**`
- `> **Status: In progress** — <what is done>`
- `> **Status: DONE — <date>.**` plus a short *Outcome* note. A done task that grew a real
  design moves to `docs/plans/`.

Tasks are checklists (`- [ ]`). Anything cut from a task is written down with the trigger to
revisit it, never just dropped.

## Order

Reordered 2026-11-14 by [ADR 0008](../adr/0008-expo-app-replaces-the-web-frontend.md): an Expo
app replaces the web frontend, the backend moves first, and the store fees wait until the app is
ready. Reordered again 2026-11-17 by [ADR 0009](../adr/0009-a-meal-is-recipes-products-and-notes.md):
Phase 1 of the plan redesign is built on the web first and tested on real Saturdays.

| # | Task | Size | Depends on | Why here |
|---|---|---|---|---|
| ✅ | [Shared UI components](./TODO_ui-components.md) (A only), [web or mobile](./TODO_web-or-mobile-decision.md), [quick wins](./TODO_quick-wins.md) 1–3 | — | — | Done; B and C of the UI components were cancelled by the ADR |
| 1 | [Backend off Lambda](./TODO_backend-off-lambda.md) — the API already runs on Vercel; remove Lambda | small | — | The slowness people feel: 10 of 10 sessions started with a 3.4–6.7 s request |
| 2 | [Weekly plan redesign](./TODO_weekly-plan-redesign.md) **Phase 1, on the web** — [spec](../plans/meal-plan-phase-1.md) | ~7 days in 6 slices, then 2–3 Saturdays of use | — | The calendar was used 3 weeks out of 8. Mostly backend and model, which Expo reuses; testing now decides Phase 2. Includes [better ingredient capture](./TODO_ingredient-capture-v2.md) |
| 3 | Expo app setup — mywally-app conventions, same backend and Cognito | to size | — | The base everything else is built on; can start while Phase 1 is being tested |
| 4 | Weekly plan redesign **Phase 2, in Expo**: drag and drop, "Sin día" tray, tags; then [supermarkets](./TODO_supermarkets.md) | the big one | 2, 3 | Built on Phase 1's model and what the test taught |
| 5 | APK on the Android phone, daily use | small | 4 | Real use before porting the rest |
| 6 | Cook and Dine to parity in Expo (the map last) | to size | 4 | Needed before the web app can go |
| 7 | Pay Apple (99 $/year) and Google Play (25 $), ship to the stores, Expo web replaces Next.js | small | 6 | Money only once the app is worth it |
| — | Weekly plan redesign **Phase 3**: the AI fills the week from history | to size | 5 | Needs the history and the 🍱 tags Phases 1–2 produce |
| — | [Photos](./TODO_photos.md) — dishes, restaurants, profiles | to size | 5 | Free on any of three stores at our size; most of the work is UI, so it waits for Expo |
| — | [Heavy dependency migrations](./TODO_dependency-migrations.md) — only #71 (maplibre security) | small | — | The web app stays live until 7 |

**Why the backend first?** It depends on no product decision, it is the pain felt on every
visit, and both the current web app and the Expo app call the same API, so it pays off twice.
