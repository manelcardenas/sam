# Meal planner and shopping list — plan

> **Status (2026-09-06): PROPOSED.** Scoped by interview (`/grilling`); nothing built.
> **It is deliberately third in the queue** — see [`./future-roadmap.md`](./future-roadmap.md).
> The profile rework and the UI/UX pass in [`./ux-refresh-plan.md`](./ux-refresh-plan.md) come
> first, because this feature needs a home in the app and it would rather move into a house that
> has been tidied than tidy it afterwards.
>
> Companion decision: [`../adr/0007-a-dish-is-a-recipe-without-instructions.md`](../adr/0007-a-dish-is-a-recipe-without-instructions.md).

## 1. What this is, and what it is not

Plan the week's meals on Saturday, and walk into the supermarket on Sunday with a list that built
itself.

It is **not** a second recipe app. The recipe collection answers *"how do I make this?"* The
planner answers *"what are we eating, and what do I have to buy?"* You do not want the recipe for
spaghetti bolognese — you know how to make it. You want its ingredients to end up on a list.

## 2. The flow, as described

```
Sat/Sun         plan the coming week — always exactly one week in view
  ↓ per slot    assign a dish to Lunch or Dinner, with a headcount
                → its ingredients pop up, ALL TICKED
                → untick what you already have  →  "add to list"
  ↓ all slots   "Finish"  →  the calendar CLOSES
  ↓             the list opens for last edits (fruit, yoghurt, the things no dish implies)
  ↓             "Close list"
                → archived: a closed calendar and a closed list, both kept
```

The important property, and the one that shapes the data model: **the list accretes as you plan**,
one dish at a time. It is not generated in one go at the end.

## 3. The blocker: the ingredient data cannot support this yet

Measured in production, 2026-09-06:

| | |
| --- | --- |
| Ingredient lines across 19 recipes | **111** |
| …with `amount` filled | **2** (1.8%) |
| …with `unit` filled | **1** (0.9%) |
| …whose **name starts with a digit** | **62** (56%) |
| Lines in a recipe that has `servings` set | **32** (29%) |

The structured fields exist and are empty. People type the quantity into the name: `"3 huevos"`,
`"2 vasos de azúcar"`, `"1 vaso de aceite"`.

**This breaks the two headline features.** "Spaghetti for two people" cannot scale when the
amount is inside a string and `servings` is null on 71% of lines. `"3 huevos"` and `"2 huevos"`
cannot merge into five — they are different strings.

So v1 includes a data fix:

- **Make `amount` and `unit` real fields in the form**, and require `servings` on anything
  plannable. (Not retroactively on the 19 existing recipes — forcing a headcount onto a recipe
  written without one invents data.)
- **Backfill the 111 lines.** `^(\d+)\s+(.*)` mechanically covers the 56% that start with a
  digit; a human reviews the result. The remainder are things like `"sal"` and `"vainilla"` that
  legitimately have no quantity. This is an afternoon, not a project.
- **No unit conversion, ever.** Merge only on `(normalised name, same unit)`. `"2 cebollas"` and
  `"200g cebolla"` stay two lines. Slightly untidy; never wrong. Unit reconciliation is a swamp
  and at household scale you avoid it by being consistent.

> **Why AI is not the answer here, and where it is.** Using a model to parse 111 rows is more
> setup than the work. But the *reason* the fields are empty is that one box is pleasant and
> three boxes are tedious — so making three fields mandatory will re-rot the data as soon as the
> novelty wears off. The real fix is natural ingredient capture (type or paste `3 huevos, 200g de
> harina, sal` and confirm structured rows), which is **post-v1** and carries the project's first
> recurring cost. See [`./future-roadmap.md`](./future-roadmap.md) item 9. Sequencing bonus: build
> that and the backfill is free — point it at the 111 existing lines once and this script never
> needs writing.

## 4. Decisions taken, and why

### 4.1 One entity, two lenses

A dish is a `Recipe` with no instructions. Full reasoning in
[ADR 0007](../adr/0007-a-dish-is-a-recipe-without-instructions.md). `/dashboard` filters to
entries that have instructions; the planner's picker shows everything; **writing instructions
promotes a dish into the recipe collection** with no flag to maintain.

### 4.2 Recipes are shared; the plan belongs to a person

Recipes and dishes are already shared — `list_recipes` returns everything with `?mine=true` as an
opt-in filter, the same pattern as `/dine`'s "reviewed by me". The **plan and its list are owned
by a user.**

The technical argument decided this: **shared → per-user is a painful retrofit, per-user →
shared is additive.** With an owner from day one, sharing is a later join table. Start global and
you have to decide retroactively who owns what. It also means the app's other five accounts
(four of them empty test users) never appear in your shopping list.

### 4.3 Sharing is in v1, read-and-tick only

The scenario is Martina plans the week and you *both shop*. That needs you to see her calendar
and tick items off the list — not to edit her Wednesday. Read-plus-tick is most of the value and
avoids the hard part: two people editing one plan, and what "reopen a closed calendar" means when
it is shared.

Upgrade path stays clean — "can edit" becomes a column on the share row, alongside the reopen
feature parked in §6.

### 4.4 Entries are keyed to real dates

An entry is `(date, meal, dish, servings)`. "Mon–Fri" is how it renders, not what it is. A `date`
column costs nothing over a weekday enum and buys history, a weekend that is a display toggle
rather than a migration, holiday-style features, and the year view in §5.3.

The alternative — one rolling week, overwritten each Monday — is simpler but forgets everything,
and that is the one property you cannot add later without a gap in the record.

### 4.5 The list is a saved artifact, not a computed view

Three reasons, and the first is decisive: **you want to keep old lists, and a computed list
cannot be old.** Recompute August's list in November and it reflects today's dishes, not what you
actually bought — deleting a dish silently rewrites history.

Beyond that, ticks and hand-added extras are just rows rather than special cases bolted onto a
projection; and sharing is simple, because two people read and tick the same rows instead of
reconciling ticks against a recomputed set of lines.

**The cost is drift**, and it gets an explicit answer in the UI rather than a silent one: change
Wednesday's dinner after building the list and you are *asked* — "the plan changed, add the 3 new
ingredients?" A list that rewrites itself while you are holding it in the shop is worse than one
that asks.

### 4.6 Duplicate ingredients merge, and keep their breakdown

One line per `(normalised name, unit)`, with the per-dish contributions preserved on it:

```
huevos ×9      3 for Monday tortilla · 6 for Wednesday huevos fritos
cebolla ×3     1 for Monday spaghetti · 2 for Wednesday curry
```

This is the merge of the two obvious designs — a merged total is what you need at the shelf, and
provenance is what answers *"why is there fennel on this list?"* It means a list line stores its
**sources**, not just a quantity: `[(plan_entry_id, dish, amount)]`.

Two interaction rules follow:

- **Every popup starts fully ticked**, with an annotation on anything already on the list
  (*"already added: 1"*), so you see the running total before deciding.
- **Unticks are not remembered across dishes.** Unticking tomato soup on Monday means *"I have a
  tin"*, not *"I never need tomato soup"*. If Wednesday needs one too, that is a real decision;
  remembering it would silently leave you short at the till. Being asked twice is the correct
  amount of friction, and the annotation makes the second ask quick.

Post-AI (§3), this is also where unit arithmetic becomes possible: 80g on Monday plus 340g on
Wednesday shows as 420g.

### 4.7 Lunch and Dinner only

Exactly the two slots described. Empty breakfast rows every week are noise, and the schema stores
a meal enum, so adding one later is a migration of one value.

## 5. Scope

### 5.1 v1

- `instructions` nullable; `/dashboard` filtered to entries that have them; `RecipeForm` accepts empty
- `amount` / `unit` real in the form; `servings` required on plannable entries; the 111-line backfill
- Week view, Mon–Fri × {Lunch, Dinner}, one week at a time, previous/next
- Assign a dish to a slot with a headcount; **create a dish inline** without leaving the planner
- Per-dish ingredient popup, all ticked, annotated with what is already on the list
- Aggregated list with per-dish breakdown; manual extras; ticking
- Close calendar → close list → archived
- Share a plan with named users, **read and tick**

### 5.2 Explicitly not in v1

| | Trigger to revisit |
| --- | --- |
| Reopening a closed calendar | Wanted from the start; deferred because "reopen" interacts with sharing and the list's drift rules |
| Full shared *editing* | When read-and-tick provably is not enough |
| Prices and Mercadona | §7 |
| AI ingredient capture | Roadmap item 9 |
| Weekend slots, breakfast | A display toggle and an enum value; add when missed |

### 5.3 The archive

Old plans and lists are kept, and surfaced in the profile as a **year view** showing which weeks
you planned and which were shared with you. This is the payoff for §4.4's real dates and §4.5's
saved artifact — neither is worth much on its own, and together they are the feature.

The profile is the right home for *history*. It is **not** the home for the current week: that is
a working artifact you open one-handed in a supermarket, so it belongs at the top level. See
[`./ux-refresh-plan.md`](./ux-refresh-plan.md).

## 6. Open questions

- **The state machine needs writing out properly** before implementation: `planning → calendar
  closed → list closed → archived`, and what each transition permits. §5.2 defers reopening, so
  v1's transitions are one-way — that needs to be a deliberate statement in the UI, not a dead end
  the user discovers.
- **What happens to a slot with no dish?** Assumed: nothing, an empty slot is normal and not an error.
- **Can a slot hold more than one dish?** (Starter and main.) Assumed no for v1.

## 7. Prices and Mercadona — the deferred half

Prices are a genuine motivation, not a nice-to-have, and this plan does not deliver them.

**There is no official Mercadona API.** What exists is the undocumented JSON API behind
`tienda.mercadona.es` (`/api/categories/`, `/api/products/<id>/`, no auth for the catalogue).
[`datania/mercadona-catalog`](https://github.com/datania/mercadona-catalog) (MIT) walks it and
publishes JSON to Hugging Face — and its own `api.md` notes that **`robots.txt` blocks `/api` for
crawlers, and to respect the ToS**. So it is undocumented, disallowed for crawling, and free to
change without notice. Paid wrappers exist (Apify, RapidAPI) and fail the no-recurring-cost rule.
[Open Food Facts](https://world.openfoodfacts.org/data) is legitimately open (ODbL, free) but is
barcode-and-packaged-product shaped: it answers *"what is in this jar"*, not *"400g minced beef"*.

The deeper reason this is deferred is not legal, it is architectural: **a shopping list is a list
of ingredients, and a catalogue is a list of products.** Mapping `"400g minced beef"` to a
specific SKU is a product-matching problem that buys nothing for a household list *except*
prices. Build the planner without it, and if prices still matter afterwards, that is a separate
project with its own plan — one whose first question is whether an unofficial, robots-disallowed
endpoint is a foundation worth building on.

## Cross-links

- [ADR 0007](../adr/0007-a-dish-is-a-recipe-without-instructions.md) — one entity, two lenses
- [ADR 0001](../adr/0001-ingredient-scaling-by-servings.md) — scaling by servings, which this depends on
- [`./ux-refresh-plan.md`](./ux-refresh-plan.md) — the profile and UI work that comes first
- [`./future-roadmap.md`](./future-roadmap.md) — the queue this sits in
