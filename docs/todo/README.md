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

| # | Task | Size | Depends on | Why here |
|---|---|---|---|---|
| 1 | [Quick wins on the web app](./TODO_quick-wins.md) — back button in `/dine`, mobile overflow, the duplicate-line 500 | ~1 day | — | Used every day; useful whatever comes next |
| 2 | [Backend off Lambda](./TODO_backend-off-lambda.md) — spike Vercel, then migrate | spike ½ day, migration 2–3 days | — | The slowness people feel: 10 of 10 sessions start with a 3.4–6.7 s request |
| 3 | [Web or mobile app — decide](./TODO_web-or-mobile-decision.md) | ½ day, a decision | — | The plan redesign is mostly UI; deciding first avoids building it twice |
| 4 | [Weekly plan redesign](./TODO_weekly-plan-redesign.md) | the big one | 3 | The calendar was used 3 weeks out of 8 and dropped after 24 Oct |
| 5 | [Better ingredient capture](./TODO_ingredient-capture-v2.md) | 1–2 days | 3, ideally inside 4 | DeepSeek text-only parsing is weak |
| 6 | [Heavy dependency migrations](./TODO_dependency-migrations.md) — PRs #63, #71, #81, #83 | varies | 3 | Some disappear if the web frontend is replaced |

**Logic or infrastructure first?** Backend infrastructure first (2), because it does not depend
on any product decision and it is the pain felt on every visit. The UI decision (3) comes before
the logic (4), because most of the plan rework is screens. The plan's backend changes can go
either way.
