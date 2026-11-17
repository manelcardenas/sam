# TODO — Weekly plan redesign

> **Status: In progress** — designed 2026-11-14 → 17 (grilling session); the model change is
> [ADR-0009](../adr/0009-a-meal-is-recipes-products-and-notes.md). Phase 1 is ready to build:
> [`../plans/meal-plan-phase-1.md`](../plans/meal-plan-phase-1.md).

The part of the app that needs the most change: hard to navigate, unintuitive, and "what the app
lets you do" has drifted from "what we want to do". The root of it: recipes and the plan are too
tightly coupled, so a simple meal costs as much as paella.

## What production shows (kitchen of two, 2026-09-19 → 2026-11-07)

| Week | Dishes | of them notes | Meals filled | List lines | Notes |
|---|---|---|---|---|---|
| 19 Sep, 26 Sep | 0 | — | 0 | 10, 10 | List only |
| 3 Oct | 15 | 5 | 10 | 25 | The best week |
| 10 Oct | 18 | 5 | 12 | 5 | 8 recipe dishes put nothing on the list: filled in on 16 Oct, as a diary |
| 17 Oct | 0 | — | 0 | 12 | List only (all carried over) |
| 24 Oct | 19 | 9 | 11 | 38 | Half the dishes are notes |
| 31 Oct, 7 Nov | 0 | — | 0 | 0, 4 | **Calendar dropped** |

- The calendar was used 3 weeks out of 8, and not since 24 Oct. The list is used every week.
- About a third of dishes are free-text notes, mostly generic: "Carne" ×11, "Pollo", "Butifarra".
- Weeks are planned by one person in one ~15-minute sitting, Friday evening or Saturday morning.
- 85 % of list lines have no unit; carne and patata sit on the list twice, split by unit.

## The routine it has to fit

- The list is made on Saturday for the whole week, always on a phone. Shops: Mercadona, Lidl,
  Ametller Origen.
- The calendar is the centre, but the list also stands alone for things that belong to no meal.
- Almost every weekday both people eat from a tupper. Batch cooking (e.g. 10 portions, frozen)
  is logged on later days as the same dish, with nothing to buy.
- Mid-week the plan changes, and the app stops matching what happens.

## Phase 1 — web, now · [spec](../plans/meal-plan-phase-1.md)

- [ ] Slice 1: one list line per product (g↔kg, ml↔l; merge the 2 prod pairs)
- [ ] Slice 2: countable amounts round up on the list
- [ ] Slice 3: products as meal components, one search in the slot
- [ ] Slice 4: typical portion per product, "sin confirmar" until accepted
- [ ] Slice 5: quick recipes, kitchen-only ("Guardar como receta")
- [ ] Slice 6: recipe import by link, photo and text (after comparing models on ~20 recipes);
      replaces [better ingredient capture](./TODO_ingredient-capture-v2.md)
- [ ] Use it for 2–3 Saturdays and write the before/after numbers into the spec

## Phase 2 — in Expo, after Phase 1 is tested

- [ ] A new plan screen: long-press and drag within the week (a whole meal or one component);
      "Mover a…" for another week, asking whether its unbought lines move too
- [ ] A "Sin día" tray per week; what stays there is offered the next week
- [ ] Tags shown everywhere: total time, servings, 🍱 tupper, ⚡ rápida (derived), 🔥 horno,
      🌀 airfryer, 🥗 sin cocinar. An emoji per ingredient
- [ ] [Supermarkets](./TODO_supermarkets.md): what to pick, cost per serving, cost of the list
      per shop, list split by shop
- [ ] [Photos](./TODO_photos.md) of dishes, restaurants and profiles

## Phase 3

- [ ] "Rellena la semana": the AI proposes a week from the kitchen's history, respecting 🍱 for
      tupper meals. Nothing applies until accepted. Watch it: an AI given too much freedom here
      drifts, so it proposes, never decides

## Deferred, with the trigger to revisit

| What | Revisit when |
|---|---|
| Changing a line's unit by hand | Phase 1 testing still shows lines in units nobody buys in |
| Freezer inventory | Batch cooking keeps being logged by hand after Phase 2 ("Solo al calendario" covers it today) |
| Cooking mode (step by step, screen awake) | The Expo app is in daily use |
| "Volver a 2 personas" shortcut | Not useful per the session; only if someone asks |

## Folded in from meal-planner-plan §8.15

- **A (a product is never a recipe):** decided, as product components (ADR-0009 §1).
- **B (tupper / eating out per person, weekly routine):** tupper became a recipe tag (ADR-0009
  §7), used by Phase 3; per-person states are not planned.
- Layout leftovers from the 2026-11-14 spacing pass (toolbar on three rows at 360 px, "+ Añadir
  una receta" wrapping from `lg`) are left for the Phase 2 screen.
