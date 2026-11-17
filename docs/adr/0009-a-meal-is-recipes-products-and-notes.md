# ADR-0009: A meal is recipes, products and notes; the list has one line per product

- **Status:** Accepted (2026-11-17)
- **Context:** the design session of 2026-11-14 → 17 on recipes and the weekly plan;
  [`../todo/TODO_weekly-plan-redesign.md`](../todo/TODO_weekly-plan-redesign.md) (production
  numbers), [`../plans/meal-plan-phase-1.md`](../plans/meal-plan-phase-1.md) (what gets built)
- **Amends:** [ADR-0007](./0007-a-dish-is-a-recipe-without-instructions.md) (one entity stays, but
  a meal is no longer only recipes),
  [ADR-0008](./0008-expo-app-replaces-the-web-frontend.md) (one exception to "the web app is
  frozen")
- **Keeps:** [ADR-0001](./0001-ingredient-scaling-by-servings.md) (scale by servings on the
  client)

## Context

Recipes and the plan are too tightly coupled. To put anything on a Tuesday that should reach the
shopping list, you have to make a recipe: a title, a food type, ingredients with an amount and a
unit. That fits paella. It does not fit what a kitchen of two actually eats on most days:
"ensalada con carne", "bocatas", "tortilla de Mercadona". So people typed a free-text note
instead, and a note buys nothing.

What production shows (2026-09-19 → 11-07, one kitchen of two):

- The calendar was used 3 weeks out of 8 and dropped after 24 Oct. The list is used every week.
- About a third of planned dishes are free-text notes, mostly generic: "Carne" ×11, "Pollo",
  "Butifarra".
- 85 % of list lines have no unit (88 of 104) and 47 have no amount. The units people do use are
  g ×6, bolsa ×3, kg ×2, l ×2, Lonchas ×2, bandejas ×1.
- Two products sit on the list twice, split only by their unit: carne (none / kg) and patata
  (none / g).
- 71 % of recipe ingredient lines belong to recipes with no servings, so they cannot be scaled.

The routine the app has to fit: one person plans the whole week in one sitting of ~15 minutes,
Friday evening or Saturday morning, on a phone, and shops on Saturday at Mercadona, Lidl or
Ametller Origen. Mid-week the plan changes, and the app stops matching what happens.

The two worst moments, in the user's words: **typing an amount and a unit**, and **duplicates or
lines that do not merge**. Behind both is the same problem: simple meals cost as much as complex
ones.

## Decision

### 1. A meal holds components of three kinds

A slot (`plan, date, meal`) already holds a flat list of `plan_entries`. Each entry becomes one
**component**, and there are three kinds:

| Kind | Example | What it puts on the list |
|---|---|---|
| **Recipe** | Lentejas | Its ingredients, scaled to the slot's servings (ADR-0001) |
| **Product** | Carne; Tortilla · Mercadona | One line for that product, with the amount you set or its typical portion |
| **Note** | Sobras, Cena fuera | Nothing |

"Ensalada con carne" is a meal with two product components (lechuga, carne) or one recipe, as
you prefer. A product component points at the vocabulary (`grocery_items`) by key and may name a
store. Choosing "Solo al calendario" still adds a recipe or product without touching the list,
for food that is already cooked or frozen.

This replaces the "ready-made" recipe of meal-planner-plan §8.14, a fake recipe whose only
ingredient was its own title. **A product is never a recipe** (§8.15 A, now decided).

### 2. Quick recipes belong to the kitchen; full recipes stay public

A meal you put together can be kept with **"Guardar como receta"**: a title and its products,
amounts optional, no method. That is a **quick recipe**, and only your kitchen sees it.
"Bocatas" is not interesting to anybody else; a carefully written recipe is, so recipes with a
method stay visible to everyone, as today.

`recipes` gains a visibility (`public` or `kitchen`) and the kitchen it belongs to. Nothing else
about a quick recipe differs: it is the same entity (ADR-0007), and writing a method in later is
an edit that can also make it public.

### 3. Each product has a typical portion

`grocery_items` gains a typical portion per person ("carne: 150 g"). The AI proposes it,
marked **"sin confirmar"** until a person accepts or edits it, and it never changes anything
without being seen. When a product component has no amount, the list uses portion × servings.
When the product has no portion either, the line says **"para N comidas"** instead of inventing
a number.

The portion is part of the shared vocabulary, like the aisle. Revisit with a per-kitchen
override **when a second kitchen disagrees with the first**.

### 4. Scaling stays as ADR-0001, with two changes

- **Servings are required on every new recipe**, quick ones included (prefilled with the
  kitchen's size). Existing recipes without them keep passing through unscaled.
- **Countable amounts round up in the list total.** Totals are stored exact; a line in pieces
  shows 2 when the dishes add up to 1.5 eggs.

### 5. One list line per product

The merge key drops the unit: it becomes `(plan, COALESCE(grocery_key, normalised_name))`.
Amounts on one line are kept per unit, with g↔kg and ml↔l converted, so 500 g + 1 kg of carne
is "1,5 kg". What does not convert stays on the same line: "500 g + 2 ud".

The two pairs already split in production (carne, patata) are merged by the migration.

Changing a line's unit by hand stays out. Revisit **if, after 2–3 Saturdays of testing, quick
recipes and rounding still leave lines in a unit nobody buys in**.

### 6. One search to pick what goes in a meal

The slot's picker searches your kitchen's recipes, the products, and recipes from other people
("De otros") in one list. The recipe book still shows recipes only.

### 7. Recipes carry tags from a fixed set

🍱 tupper, 🔥 horno, 🌀 airfryer, 🥗 sin cocinar, stored on the recipe; ⚡ rápida is derived
from the total time, never stored. **Tupper is positive**: a recipe without it is eaten at home.
It exists to keep the Phase 3 AI from proposing a soup for a lunch that travels. The recipe
import proposes tags in Phase 1; showing them across the app is Phase 2.

### 8. Nothing enters the vocabulary until a recipe is saved

Today parsing a recipe's ingredients writes AI-proposed rows into `grocery_items` straight away,
and drops lines it could not match. From now on parsing proposes and **saving writes**: every
original line is kept, and the vocabulary only grows when a person saves.

### 9. Phase 1 is built on the web, as an exception to ADR-0008

ADR-0008 froze the web app: fixes only. Phase 1 of this redesign is built there anyway, because:

- it is mostly the backend and the model, which Expo will use unchanged;
- its UI changes are small (the picker, a button, a list line, the recipe import);
- it can be tested on 2–3 real Saturdays now, instead of after the Expo app exists, and the
  answers decide what Phase 2 builds.

The bigger UI (drag and drop, a "Sin día" tray, tags with emojis, supermarket prices, photos) is
Phase 2, in Expo.

## Consequences

- **The list's merge index changes shape again**, three days after
  [`d1f3a7c58e20`](../../backend/alembic/versions/d1f3a7c58e20_unit_merge_key_ignores_case.py)
  made it case-insensitive. Its migration merges existing duplicates first, or the index will not
  build.
- **A `plan_entries` row gets a third shape** (product: grocery key, optional store, optional
  amount), alongside recipe and note. Every reader of entries (the slot sheet, the week view,
  "add to the list", removing a dish) handles three kinds.
- **`GET /recipes` filters by visibility.** Today it returns every user's recipes; quick recipes
  must not leak to other kitchens.
- **The vocabulary carries a new AI-proposed field.** The portion needs the same
  "sin confirmar → confirmed" handling the aisle already has.
- **Phase 2 (Expo) depends on this model, not on the web UI.** Drag and drop, the tray, tags,
  stores and photos are designed on top of components and one-line-per-product.

## Deferred, each with its trigger

| What | Revisit when |
|---|---|
| Changing a line's unit by hand | Phase 1 testing still shows lines in units nobody buys in |
| Per-kitchen typical portions | A second kitchen disagrees with the first |
| Calories per serving (Mercadona's data carries nutrition) | Supermarket prices (Phase 2) are in, since they share the data source |
| Lidl Plus receipts and Mercadona email tickets as price sources | Mercadona and Ametller prices are in use and Lidl is the gap people feel |
| Freezer inventory | Batch cooking keeps being logged by hand after Phase 2; today a "Solo al calendario" component covers it |
| Cooking mode (step by step, screen awake) | The Expo app is in daily use |
| Price-drop alerts | Weekly prices have been stored for a few months |
| AI fills the week from history | Phase 3, after Phase 2 is in daily use |
