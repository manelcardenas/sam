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
ready.

| # | Task | Size | Depends on | Why here |
|---|---|---|---|---|
| ✅ | [Shared UI components](./TODO_ui-components.md) (A only), [web or mobile](./TODO_web-or-mobile-decision.md), [quick wins](./TODO_quick-wins.md) 1–2 | — | — | Done; B and C of the UI components were cancelled by the ADR |
| 1 | [Backend off Lambda](./TODO_backend-off-lambda.md) — spike Vercel, then migrate | spike ½ day, migration 2–3 days | — | The slowness people feel: 10 of 10 sessions start with a 3.4–6.7 s request. Independent of the frontend |
| 1b | [Quick win 3](./TODO_quick-wins.md) — the duplicate list line that returns 500 | hours | — | A backend bug, so it survives the move to Expo |
| 2 | Expo app setup — mywally-app conventions, same backend and Cognito | to size | 1 | The base everything else is built on |
| 3 | [Weekly plan redesign](./TODO_weekly-plan-redesign.md), built in Expo | the big one | 2 | The calendar was used 3 weeks out of 8 and dropped after 24 Oct |
| 4 | APK on the Android phone, daily use | small | 3 | Real use before porting the rest |
| 5 | [Better ingredient capture](./TODO_ingredient-capture-v2.md) | 1–2 days | 2, ideally inside 3 | DeepSeek text-only parsing is weak |
| 6 | Cook and Dine to parity in Expo (the map last) | to size | 3 | Needed before the web app can go |
| 7 | Pay Apple (99 $/year) and Google Play (25 $), ship to the stores, Expo web replaces Next.js | small | 6 | Money only once the app is worth it |
| — | [Heavy dependency migrations](./TODO_dependency-migrations.md) — only #71 (maplibre security) | small | — | The web app stays live until 7 |

**Why the backend first?** It depends on no product decision, it is the pain felt on every
visit, and both the current web app and the Expo app call the same API, so it pays off twice.
