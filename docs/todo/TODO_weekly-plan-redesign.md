# TODO — Weekly plan redesign

> **Status: Proposed — not started.** Needs a design session (grilling) before any code.

The part of the app that needs the most change: hard to navigate, unintuitive, and "what the app
lets you do" has drifted from "what we want to do".

## What production shows (kitchen of two, 2026-09-19 → 2026-11-07)

| Week | Dishes | of them notes | Meals filled | List lines | Notes |
|---|---|---|---|---|---|
| 19 Sep, 26 Sep | 0 | — | 0 | 10, 10 | List only |
| 3 Oct | 15 | 5 | 10 | 25 | The best week |
| 10 Oct | 18 | 5 | 12 | 5 | **8 recipe dishes put nothing on the list** |
| 17 Oct | 0 | — | 0 | 12 | List only (all carried over) |
| 24 Oct | 19 | 9 | 11 | 38 | Half the dishes are notes |
| 31 Oct, 7 Nov | 0 | — | 0 | 0, 4 | **Calendar dropped** |

- The calendar was used 3 weeks out of 8, and not since 24 Oct. The list is used every week.
- About a third of dishes are free-text notes, mostly generic: "Carne" ×11, "Pollo", "Butifarra".
- 4 "ready-made" recipes are reused (Salteado rústico ×6).
- One crash: a duplicate list line returned 500 three times (fixed in
  [quick wins](./TODO_quick-wins.md)).

## Inputs already on the table

- [`../plans/meal-planner-plan.md`](../plans/meal-planner-plan.md) §8.15: A ("do you cook it?",
  products are not recipes — revised after the data above: keep ready-made as recipes but mark
  them as products; notes that remember what was typed) and B (tupper / eating out per person,
  weekly routine on the kitchen).

## Plan

- [ ] Write down the real weekly routine: who plans, when, on which device, what you look at in
      the shop, what happens mid-week
- [ ] Grill a new flow against that routine, using the table above (why was the calendar
      dropped? why did 8 dishes on 10 Oct put nothing on the list?)
- [ ] Spec → ADR if the model changes → build in the frontend chosen in
      [web or mobile](./TODO_web-or-mobile-decision.md)
- [ ] Fold §8.15 A and B in, or re-cut them
