# Meal planner and shopping list — plan

> **Status (2026-09-12): DONE.** Scoped by interview (`/grilling`) on 2026-09-06; implementation
> design added as §8 on 2026-09-11, which closes §6's open questions. **Phases A–D are shipped, v1
> is complete, and five post-v1 changes have landed on top of it:**
>
> | | |
> | --- | --- |
> | §8.9 | the week runs Saturday→Friday, seven days — which also delivered §5.2's deferred weekend slots |
> | §8.10 | one filter vocabulary shared with `/dashboard`, plus a new filter by who added a recipe |
> | §8.11 | the list stopped being downstream of the calendar — a week can start from either end |
> | §8.12 | **sharing became a kitchen**: a week belongs to a household, not a person. This supersedes §4.2 in part, §4.3, §5.1's last bullet, §8.3's `plan_shares` and all of §8.7 |
> | §8.13 | week headings put the day before the month — a formatting bug, filed separately because it predates the kitchen |
>
> Everything still open is listed as a deferral with its trigger, in the section that deferred it:
> reopening a closed calendar (§5.2), three small things about leaving and being invited (§8.12.2),
> prices (§7) and AI ingredient capture ([roadmap](./future-roadmap.md) item 9). Nothing here is
> blocked and nothing is half-built.
>
> The queue position this plan was written under is spent: the profile rework and the UI/UX pass in
> [`./ux-refresh-plan.md`](./ux-refresh-plan.md) went first, as intended, and this moved into the
> house they tidied.
>
> Companion decision: [`../adr/0007-a-dish-is-a-recipe-without-instructions.md`](../adr/0007-a-dish-is-a-recipe-without-instructions.md).
>
> **Vocabulary note (2026-09-11, after v1 shipped): "dish" is no longer a thing in the product.**
> This document was written while the plan was to show one table through two lenses — Recipes and
> Dishes — and it uses "dish" throughout as the word for a plannable item. That distinction was
> removed the same day v1 shipped: there is one collection, everything in it is a **recipe**, and
> `instructions` is simply optional. See the amendment at the top of
> [ADR 0007](../adr/0007-a-dish-is-a-recipe-without-instructions.md) for what went and why.
>
> The prose below is left as written, because it is the record of the design conversation rather
> than a description of the UI. Read "dish" as "recipe" everywhere. The one identifier that
> genuinely survives is `dish_name` (§8.3a) — it is a *snapshot of the name at the time you
> planned it*, deliberately not a join, so renaming it to `recipe_name` would name it after the
> thing it exists in order not to depend on.

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

### 4.1 One entity

A plannable item is a `Recipe`, and `instructions` is optional. Full reasoning in
[ADR 0007](../adr/0007-a-dish-is-a-recipe-without-instructions.md).

> **Superseded in part, 2026-09-11.** This section originally read "one entity, **two lenses**":
> `/dashboard` filtered to entries that had instructions, the planner's picker showed everything,
> and writing the method "promoted a dish into the recipe collection". The single entity stands —
> the two lenses do not. One list holds everything; the picker and `/dashboard` now see the same
> rows. What the lens actually did was hide recipes with no method behind a chip, which is worse
> than the orphan Instructions heading it was introduced to avoid.

### 4.2 Recipes are shared; the plan belongs to a person

> **Superseded in part, 2026-09-11 — see §8.12.** A plan belongs to a **kitchen**, not to a person.
> The argument below is what made that cheap, so it is kept: *per-user → shared is additive* turned
> out to be true one step further than it claimed. Going from an owner to a household was a column
> swap and a new join table, not a retrofit deciding retroactively who owns what — which is exactly
> what starting global would have cost.

Recipes are already shared — `list_recipes` returns everything with `?mine=true` as an
opt-in filter, the same pattern as `/dine`'s "reviewed by me". The **plan and its list are owned
by a user.**

The technical argument decided this: **shared → per-user is a painful retrofit, per-user →
shared is additive.** With an owner from day one, sharing is a later join table. Start global and
you have to decide retroactively who owns what. It also means the app's other five accounts
(four of them empty test users) never appear in your shopping list.

### 4.3 Sharing is in v1, read-and-tick only

> **Superseded, 2026-09-11 — see §8.12.** Read-and-tick had a direction, and a two-person household
> has no owner. A week now belongs to a **kitchen** and everybody in it can change everything. The
> paragraph below is kept because its upgrade path is exactly what happened, a step further than it
> predicted: `can_edit` never became a column, the owner stopped existing instead.

The scenario is Martina plans the week and you *both shop*. That needs you to see her calendar
and tick items off the list — not to edit her Wednesday. Read-plus-tick is most of the value and
avoids the hard part: two people editing one plan, and what "reopen a closed calendar" means when
it is shared.

Upgrade path stays clean — "can edit" becomes a column on the share row, alongside the reopen
feature parked in §6.

### 4.4 Entries are keyed to real dates

An entry is `(date, meal, dish, servings)`. The grid is how a week renders, not what it is. A `date`
column costs nothing over a weekday enum and buys history, a weekend that is a display toggle
rather than a migration, holiday-style features, and the year view in §5.3.

The alternative — one rolling week, overwritten each week — is simpler but forgets everything,
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
- Week view, Sat–Fri × {Lunch, Dinner}, one week at a time, previous/next
- Assign a dish to a slot with a headcount; **create a dish inline** without leaving the planner
- Per-dish ingredient popup, all ticked, annotated with what is already on the list
- Aggregated list with per-dish breakdown; manual extras; ticking
- Close calendar → close list → archived
- Share a plan with named users, **read and tick** — superseded by §8.12's kitchen

### 5.2 Explicitly not in v1

| | Trigger to revisit |
| --- | --- |
| Reopening a closed calendar | Wanted from the start; deferred because "reopen" interacts with sharing and the list's drift rules |
| ~~Full shared *editing*~~ | ✅ shipped 2026-09-11 as §8.12's kitchen. Read-and-tick proved not to be enough on its first real household |
| Prices and Mercadona | §7 |
| AI ingredient capture | Roadmap item 9 |
| ~~Weekend slots~~, breakfast | ✅ weekends shipped 2026-09-11 with the Sat→Fri week, below. Breakfast is still an enum value away |

### 5.3 The archive

Old plans and lists are kept, and surfaced in the profile as a **year view** showing which weeks
were planned. (Originally "and which were shared with you" — §8.12 removed the distinction: a week
planned in your kitchen is your week, whichever of you filled it in.) This is the payoff for §4.4's real dates and §4.5's
saved artifact — neither is worth much on its own, and together they are the feature.

The profile is the right home for *history*. It is **not** the home for the current week: that is
a working artifact you open one-handed in a supermarket, so it belongs at the top level. See
[`./ux-refresh-plan.md`](./ux-refresh-plan.md).

## 6. Open questions — CLOSED (2026-09-11)

All three are answered in §8. Summary:

- **The state machine** is written out in §8.2. Three states, not four: `archived` is not a state,
  it is what `list_closed` is called in the UI. Transitions are one-way in v1 and the UI says so
  at the point of no return.
- **A slot with no dish** is normal and not an error. Confirmed as assumed — an empty slot is the
  default state of every slot, and a week where you only plan three dinners is a correct week.
- **One dish per slot in v1.** Confirmed as assumed, and enforced by one unique index
  (`plan_id, date, meal`), so allowing starter-plus-main later is a one-line migration rather
  than a redesign.

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

## 8. Implementation design (2026-09-11)

§1–§7 decided *what* and *why*. This section decides *how*, and closes §6.

### 8.1 Phases

| | | |
| --- | --- | --- |
| **A** | The §3 data blocker — `instructions` nullable, real `amount`/`unit`, the backfill (the Dishes lens shipped here too, and was removed later the same day) | ✅ 2026-09-11 |
| **B** | Planner backend — schema, entities, repos, use cases, routes | ✅ 2026-09-11 |
| **C** | Planner frontend — week view, picker, ingredient popup, list | ✅ 2026-09-11 |
| **D** | Sharing (§4.3) and the year-view archive (§5.3) | ✅ 2026-09-11 |

A is separable and ships on its own: it makes method-less recipes *possible* and fixes recipe data
that is wrong today regardless of whether the planner ever exists. B–D are the feature.

**There is no Phase E.** §8.9–§8.12 are changes to a shipped product rather than remaining phases,
which is why they are recorded where the decision was made instead of as rows here. §8.12 is the
one that *replaces* a phase: Phase D's sharing is gone, not extended.

### 8.2 The state machine

Three states. **`archived` is not a fourth state** — it is what `list_closed` is called in the
UI, and collapsing it removes a state nothing could distinguish.

```
          ┌──────────────┐  finish calendar  ┌────────────────┐  close list  ┌─────────────┐
          │   planning   │ ────────────────▶ │ calendar_closed│ ───────────▶ │ list_closed │
          └──────────────┘                   └────────────────┘              └─────────────┘
   assign/remove dishes ✓            calendar frozen                    everything frozen
   list accretes        ✓            add manual extras  ✓               read-only forever (v1)
   tick items           ✓            tick items         ✓               "archived" in the UI
```

**`calendar_closed` is the shopping state**, which is why ticking stays open there and why the
list is still editable: §2's flow closes the calendar *before* you leave the house, and the last
edits (fruit, yoghurt, the things no dish implies) happen on the way out. `list_closed` is what
you do when the shopping is home.

**Transitions are one-way in v1** (§5.2 defers reopening). The rule that follows, and it is a UI
rule rather than a schema one: **each transition is confirmed, and the confirmation says what you
are giving up** — "Finish the week? You won't be able to change the dishes afterwards." A dead end
the user discovers by tapping is the failure mode §6 named, and it costs one sentence to avoid.

The server enforces the machine; the client does not get to be the only guard. Every write
checks the plan's state and returns **409 Conflict** — not 403 — when the state forbids it. 403
means "not yours", 409 means "not now", and a client that cannot tell them apart shows the wrong
message.

### 8.3 Schema — five tables

```
meal_plans          id · owner_id → users · week_start date · status · timestamps
plan_entries        id · plan_id → meal_plans ⟲ · date · meal · recipe_id → recipes (SET NULL)
                       · dish_name (snapshot) · servings
shopping_list_items id · plan_id ⟲ · normalised_name · display_name · unit · total_amount
                       · is_checked · is_manual
list_item_sources   id · item_id → shopping_list_items ⟲ · entry_id → plan_entries (SET NULL)
                       · dish_name (snapshot) · amount
plan_shares         plan_id ⟲ · user_id → users     (PK on both; Phase D)
```

> **Amended, 2026-09-11 — see §8.12.** `meal_plans.owner_id` is now `kitchen_id` plus a
> `created_by` that gates nothing, the unique key moved to `(kitchen_id, week_start)`,
> `plan_entries` and `shopping_list_items` gained a `created_by`, and `plan_shares` is gone in
> favour of `kitchens` and `kitchen_members`.

Four decisions inside that are not obvious from the table:

**(a) History is snapshotted, not joined.** `plan_entries.dish_name` and
`list_item_sources.dish_name` duplicate what a join to `recipes` would give. That is deliberate
and it is §4.5's argument extended from the list to the calendar: *"deleting a dish silently
rewrites history."* `recipe_id` is nullable with `ON DELETE SET NULL`, so deleting a recipe
leaves last August's plan still saying you ate tortilla on the Monday — it just stops linking
anywhere. The alternative, `ON DELETE CASCADE`, would let a tidy-up of the recipe collection
quietly empty the archive. **A snapshot that can go stale beats a join that can vanish.**

**(b) The merge key needs `COALESCE`, or it does not work at all.** §4.6 merges on
`(normalised name, unit)`, which reads as `UNIQUE (plan_id, normalised_name, unit)` — and that
constraint **would not merge the common case**, because Postgres treats NULLs as distinct in a
unique constraint and most household ingredients have no unit. Two `huevos` rows would both be
allowed. So it is a unique *index* over `COALESCE(unit, '')`, and the same expression is used by
the upsert. This is the kind of thing that works in every test with units and fails on the first
real list.

**(c) Normalisation is deterministic and stupid on purpose.** `normalised_name` is
lowercase → trim → collapse internal whitespace → strip diacritics. That is all. **No plural
stemming**, for the same reason §3 refuses unit conversion: `cebolla`/`cebollas` merging is nice
until `pimiento`/`pimienta` merge too, and a wrong merge on a shopping list means you come home
without an ingredient. Stripping diacritics is safe in a way stemming is not — it only ever
merges two spellings of one word, and phone keyboards make `platano`/`plátano` a real pair.
`display_name` keeps whatever was typed first, so the list reads in the user's own words.

**(d) The list never rewrites itself.** Assigning a dish does **not** auto-add its ingredients;
the popup does, when the user confirms. Removing an entry does **not** auto-remove them; the
client asks first (§4.5's drift rule) and then calls an explicit endpoint. Every list mutation is
a deliberate API call. This is what keeps §4.5's promise that a list cannot change while you are
holding it in the shop.

### 8.4 What Phase A actually changed

- `instructions` is nullable, in the column, the entity and both request schemas. **One-way in
  practice** — once instruction-less rows exist the `NOT NULL` cannot come back without deleting
  data, which is why it is an ADR (0007) and not a casual migration.
- `GET /recipes?kind=recipe|dish` — the ADR 0007 lens, as a query param on the existing route
  rather than a new endpoint, so no API Gateway route has to be added (the same reasoning that
  made `?mine=true` a param).
- `RecipeForm` treats instructions as optional and says what leaving it empty *means*, rather
  than just dropping the asterisk.
- The 111-line backfill ships as `backend/scripts/backfill_ingredients.py` — **a script with a
  dry run, not ad-hoc SQL**, so it is in git, re-runnable, and reviewable before it writes.

### 8.5 What Phase B actually shipped

Four tables (migration `a4e6b8c02d19`), the domain in
`src/domain/entities/meal_plan.py`, both repository adapters, eight use cases and
**seven HTTP routes**. 63 new tests; 219 in the suite.

**The route count is a design constraint, not an outcome.** API Gateway declares
routes explicitly, so every path costs a line in `lambda-api-stack.ts` and a
deploy. That is why the slot upsert is one `PUT /plans/entries` rather than a
create/update pair, and why closing the calendar and closing the list share
`POST /plans/{id}/status` with the status being left in the body.

| | |
| --- | --- |
| `GET /plans?day=` | the week containing that day, or **null** — most weeks have no plan, and an error would make an empty calendar look broken |
| `PUT /plans/entries` | assign a dish; creates the week's plan lazily on first use |
| `DELETE /plans/{id}/entries/{entry_id}?drop_from_list=` | clear a slot; the list is left alone unless asked |
| `POST /plans/{id}/items` | merge confirmed lines in |
| `PATCH /plans/{id}/items/{item_id}` | tick |
| `DELETE /plans/{id}/items/{item_id}` | remove a line |
| `POST /plans/{id}/status` | take the one transition available |

**Every mutation returns the whole plan.** One write can move several parts —
removing a dish can delete list lines, adding one can merge into an existing
line — so a client patching its own copy from a partial response would drift.
Re-reading is one round trip and cannot.

**`from_status` on the transition endpoint is not ceremony.** Transitions are
one-way in v1, so two taps on a slow connection closing *both* the calendar and
the list is unrecoverable. The client states what it believes it is leaving and a
mismatch is a 409.

Four things this phase discovered that the design above did not anticipate:

- **`"dinner"` sorts before `"lunch"`.** Ordering entries by the enum's value
  renders every day backwards. There is now one `sort_entries` in the domain that
  both adapters call, rather than a copy in each — which is how the bug existed
  in two places at once.
- **A field named `date` cannot be annotated `date`.** Pydantic fails to resolve
  its own annotation once the field name shadows the type in the class namespace.
  The planner schema annotates `datetime.date` explicitly.
- **The week must be derived from the entry's date, not passed alongside it.**
  The first version took both and guarded that they agreed; the guard was
  unreachable, because the only caller sent the same date twice. Deriving it
  makes the invariant structural instead of enforced.
- **`None` is not `0` when merging.** Two dishes that both want salt and neither
  says how much must produce a line with *no* quantity. Summing against a
  fictional zero renders "0 sal" on a list someone is reading in a shop. This is
  the one case the first test suite missed and mutation testing found.

**`tests/integration/test_gateway_routes_match.py` is new and guards a recurring
trap**: it compares the FastAPI app's routes against the paths declared in
`lambda-api-stack.ts`, in both directions. A missing gateway entry 404s *before*
the Lambda runs, which looks like anything but a routing bug — the Lambda is
healthy, CloudWatch is silent, and other endpoints work.

**The SQL adapter was unverified, and it broke on the first real request.**
Phase B shipped saying so twice; the first `PUT /plans/entries` against a real
database failed with

    invalid input value for enum plan_status_enum: "PLANNING"

**SQLAlchemy persists an enum's member *name* unless told otherwise**, while
migration `a4e6b8c02d19` created the type with the lowercase values. Both enum
columns needed
`values_callable=lambda enum: [member.value for member in enum]`. Note this
differs from `recipes.food_type`, whose type was created with uppercase *names*
back when the default was simply accepted — new enums store the value, because
the column then reads the same as the API and the docs, and food_type is left
alone because changing it now is a data migration for no behavioural gain.

Two tests came out of it, and the pair is the real fix:

- **`tests/unit/test_enum_columns_match_migrations.py`** — parses the migrations
  for every `sa.Enum(...)` and compares its labels against what the ORM will
  write. No database, runs always, and its failure message names the fix.
- **`tests/integration/test_meal_plan_postgres.py`** — the adapter against a real
  Postgres: the enum round-trip, the `COALESCE` upsert, `ON DELETE SET NULL`
  preserving a deleted dish's name on the list, the slot's unique index, and
  Decimal/None round-tripping through `Numeric`. **Skipped unless
  `SAM_TEST_POSTGRES=1`**, and it never runs migrations — it creates a throwaway
  user, writes, and deletes what it made. Reverting the fix makes it reproduce
  the production error exactly.

The lesson worth carrying: *"both adapters are written against the same domain
helpers"* was offered as mitigation for having no SQL coverage. It was not
mitigation at all — the bug was in neither helper, it was in how the ORM maps a
column, which is precisely the class of thing a fake cannot have.

### 8.6 What Phase C shipped, and the navigation call

**PLAN is a third top-level world**, beside COOK and DINE — one entry in
`lib/worlds.ts`, which puts it in the desktop switch *and* the mobile tab bar
automatically. The mobile bar now has four destinations, which
[`./ux-refresh-plan.md`](./ux-refresh-plan.md) §7 noted is exactly the count a
bottom bar suits.

**This was decided without §7's research, deliberately, and it is the low-regret
option.** §7's open question is whether the app should move to bottom navigation;
the answer here does not pre-empt it, because the bottom bar already exists and
the worlds are already its contents. If §7 concludes the navigation should
change, PLAN moves with the other two rather than needing to be extracted from
somewhere it never belonged. The alternative — parking the planner inside COOK —
would have been the decision that is expensive to undo: §5.3 is explicit that the
profile is the home for *history* and not for the week you are shopping for, and
the same argument rules out burying the working week one level down.

**The flow, as built:** tap a slot → pick a dish and a headcount in one step →
its ingredients appear **already ticked**, annotated with what the list already
holds → untick what you have → add. Picking and headcount are one step because
they are one thought: you choose spaghetti *for four*, and the amounts on the
next step depend on it.

**Skipping the ingredient step is allowed, and the week grid says so.** Each
filled slot carries a basket or a tick showing whether its ingredients ever
reached the list. Without it the only way to find out is to open every slot —
and a step that cannot be skipped is a step people learn to rush.

Four decisions worth recording:

- **Everything is a view, so everything pushes history.** The week, the list and
  the slot sheet all push, which means the phone back gesture walks out of the
  sheet and then back through the weeks instead of leaving the app. That is the
  opposite of `/dine`'s chips, and right: changing the week changes *what you are
  looking at*.
- **Ticking is optimistic.** It happens faster than a round trip in a shop, and a
  checkbox that lags reads as a dropped tap and gets pressed twice. A failure
  rolls the tick back and says so.
- **Scaling has no divisor when the recipe has no `servings`.** 71% of production
  ingredient lines are in such recipes (§3). Amounts pass through unchanged
  rather than being scaled by an invented number — confident wrong quantities are
  worse than honest unscaled ones.
- **The test suite now pins `TZ=Asia/Tokyo`.** Every date bug in this feature is a
  timezone bug, and the machine's own zone makes tests pass or fail depending on
  who ran them. **UTC is the worst choice**, because it is the one zone where
  every offset bug disappears — and CI defaults to it. A mutation replacing the
  UTC-normalised week start with a local one passes under UTC and under
  Los Angeles, and fails by a whole week under Tokyo.

**The client re-derives two server rules**, which is the standing risk in this
phase: `normaliseName` mirrors `normalise_ingredient_name`, and `findExistingLine`
mirrors `merge_key` including its `COALESCE(unit, '')`. They are tested against
the same table of inputs as the Python, because if they drift the popup's
"already on the list" annotation points at a different row than the one the
server updates — confidently wrong, which is worse than absent.

### 8.7 What Phase D shipped

> **Superseded in full, 2026-09-11 — see §8.12.** Everything below shipped and then came out again:
> `plan_shares`, the owner/guest split, the three-permission table and sharing-by-display-name. It
> is kept because the *reasons* outlived the mechanism — the three permissions are where the
> asymmetry was first written down, which is what made it obvious that the asymmetry itself was the
> bug. Read it as history, not as behaviour. The one line that is now actively false is
> "sharing is by display name": §8.12.1 replaced that with a picker.

**Sharing, read-and-tick, exactly as §4.3 scoped it.** Migration `b7d2f4a91c65`
adds `plan_shares` — a composite primary key and nothing else. §4.2's argument
paid off precisely as stated: because the plan had an owner from day one, this
was additive rather than a retrofit deciding retroactively who owns what.

**No `can_edit` column.** It would be false on every row and answer a question
nobody has asked. §5.2's trigger for full shared editing — *when read-and-tick
provably is not enough* — is still the trigger, and it is one `ALTER TABLE`.

**Three permissions now, not one.** This is the part that was easy to get wrong,
because ticking, editing the list and editing the calendar all run through
handlers that looked alike:

| | owner | guest |
| --- | --- | --- |
| see the week and the list | ✅ | ✅ |
| tick a line | ✅ | ✅ |
| add an extra, remove a line | ✅ | ❌ |
| assign or remove a dish | ✅ | ❌ |
| share, unshare, close the week | ✅ | ❌ |

Enforced in the use cases by which of `_owned` / `_visible` each one calls, and
mutation-tested: swapping either for the other fails tests, in both directions.
A guest cannot reshare, because the owner would not be the one who decided.

**Sharing is by display name**, resolved server-side. That avoids a
user-search endpoint — every route costs an API Gateway entry, and a search
endpoint is also a way to enumerate accounts. **The trade is real and worth
naming: a 404 still reveals that a name is not in use.** At six accounts who all
know each other that is the correct trade; at a thousand it would not be.
Matching is case- and whitespace-insensitive, because failing to find someone you
can see in the app reads as the feature being broken rather than as a typo.

**Two `ON DELETE CASCADE`s, both load-bearing**, and both tested against real
Postgres: deleting a plan removes its shares, and deleting a *user* removes
theirs. Without the second, a closed account leaves a row granting access to an
id that resolves to nobody — and the plan then renders a nameless guest the owner
cannot remove.

**On the front end**, the week selector appears only when there is something to
choose between, and two bugs were caught in review rather than in use: paging to
another week kept `?plan=` pointing at the previous week's plan (which rendered
correctly but left no chip active, so the control looked broken), and switching
plans left a slot sheet open addressing a date in a week you cannot write to.

### 8.8 The year view (§5.3)

Shipped as a fifth profile tab — `/profile?tab=plans`, `&year=2025` for anything
but the current year — served by `GET /plans/archive?year=`.

**It returns `PlanSummary`, not `MealPlan`, and that is the whole design.** A
year holds up to 53 weeks and a full plan carries every entry, every list line
and every line's sources. The view shows *which* weeks were planned and how full
they were, so sending the contents of all of them to draw that would be a few
hundred kilobytes to render a list of dates.

**Counts are correlated scalar subqueries, not joins.** Counting entries and list
lines in one joined query multiplies them together — five entries and twenty
lines give a hundred rows and two wrong numbers — and that is invisible in a
fake, where both are calls to `len()`. Tested in both adapters.

**A week belongs to the year its Saturday falls in**, which is `week_start_for`'s
rule applied once more. So a week running from 29 December into January appears
in exactly one year and never in both.

**Grouped by month, and empty months are not drawn.** A 52-cell grid of the whole
year was the obvious shape and the wrong one: most weeks are not planned, so it
would be mostly empty, and cells small enough to fit 52 across a phone are below
the 44px touch target. Listing the weeks that exist shows the same thing — when
you planned, and how consistently — at a size you can tap.

**Opening an archived week carries its plan id.** Without it the planner would
show *your current* week for those dates: a different week under the same
heading, which is the kind of wrong that looks right. (Written for a week
somebody shared with you; §8.12 removed that case and left the rule *more*
load-bearing, because a week from a kitchen you have since left is now reachable
only by id.)

One thing this changed elsewhere: `ProfileTabs` hardcoded `grid-cols-4` and a
25%-wide indicator. Going to five tabs left the indicator a column too wide, so
both now derive from `PROFILE_TABS.length` — and the icon hides below `sm`,
because at five columns on a 390px phone the label is what has to survive.

**Deliberately not built:** any way to *read* an archived week's shopping list
from the profile. Tapping a week opens it in the planner, which already renders
it read-only when archived. A second read-only renderer would be a second place
for the list to look wrong.

## Cross-links

- [ADR 0007](../adr/0007-a-dish-is-a-recipe-without-instructions.md) — one entity, two lenses
- [ADR 0001](../adr/0001-ingredient-scaling-by-servings.md) — scaling by servings, which this depends on
- [`./ux-refresh-plan.md`](./ux-refresh-plan.md) — the profile and UI work that comes first
- [`./future-roadmap.md`](./future-roadmap.md) — the queue this sits in

### 8.9 The week runs Saturday to Friday

**Changed 2026-09-11**, after v1 shipped. The week was Monday–Friday: five weekday columns, no
weekend at all. It is now **Saturday–Friday**, seven days.

**Why Saturday opens the week.** §1 describes the loop as *"plan the week's meals on Saturday, and
walk into the supermarket on Sunday"*. Under a Monday week, planning on Saturday meant planning a
week that had not started yet while sitting in one that was ending — the shopping trip on Sunday
belonged to the week you had just finished. Starting on Saturday makes the planning day the first
day of the thing being planned, and puts Sunday's shop inside it.

**Why seven days and not "Saturday to Saturday".** Eight days sounds natural and breaks the
schema: Saturday the 12th would be both the last day of the week starting the 5th and the first day
of the week starting the 12th, so one real dinner would belong to two plans and
`uq_plan_entries_slot` — unique on `(plan_id, date, meal)` — could not stop it being assigned in
both. The archive would show every Saturday twice. Seven days tile.

**The weekend slots §5.2 deferred came for free.** They were listed as "a display toggle and an
enum value"; in the end they were neither, just a different range of dates, because §4.4 had
already made an entry a real `date` rather than a weekday enum. That decision paid for itself here.

**Existing plans were deleted, not migrated** (migration `d9a3f7b1e482`). Rows were keyed to
Mondays, and nothing queries a Monday `week_start` after this change — those weeks would have
looked empty while quietly still existing, and the planner would have built a second plan over the
top. Shifting each key back to its preceding Saturday was considered and would have been safe
(entries keep their real dates, and Mondays map one-to-one onto Saturdays), but the data was early
and the owner chose the clean break.

The grid is seven columns from `lg` up rather than wrapping: a calendar that breaks 4 + 3 stops
reading as a week, and the row *is* the information.

### 8.10 One filter vocabulary for the collection and the picker

**Added 2026-09-11.** `/dashboard` and the planner's slot picker ask the same question of the same
collection — *which of my recipes am I looking for?* — and had drifted into two answers: the
dashboard had search plus category chips, the picker had search and nothing. A filter added to one
did not exist on the other, and nothing made that visible.

They now share `lib/recipe-filters.ts` (pure: what the axes mean) and
`components/recipes/RecipeFilterChips.tsx` (the row itself). Adding an axis adds it to both.

**Selection is deliberately not shared.** The picker is a bottom sheet, mounted per open, and it
always opens unnarrowed. Inheriting the dashboard's chips would show three of twenty-four recipes
with the cause on another page.

**A new axis: who added it.** Multi-select, OR within it — "Manel or Martina" — and AND against
category and search. The author list is derived from the loaded recipes rather than fetched, which
needs no endpoint and means nobody with zero recipes can be offered. You sort first because it is
your collection; everyone else by `localeCompare`, so *Àlex* lands before *Martina* rather than
after Z. An author with no `display_name` is left out: a row needs a label, and inventing one would
offer a filter for a gap in the data rather than for a person.

**It is a labelled dropdown, not one chip per person** (`components/ui/AuthorSelect.tsx`). The first
version was a chip each, which is fine at two people and unusable at ten: chips are a flat,
always-visible vocabulary that pushes everything else out of a scrolling row, gives no clue how many
people exist until you scroll, and leaves nowhere to say what the row *is*. The control spends one
control's worth of space regardless of headcount and names its own axis before you open it — which
is the difference between a filter you find and one you stumble into.

Three details that are decisions rather than styling:

- **It is a rounded rectangle among round pills.** `Chip.tsx` already writes the rule down — round
  pills toggle, rounded rectangles hold a value — so the shape was decided before this existed, and
  the shape is what tells a reader it behaves differently from the category chips beside it.
- **The label never disappears.** The trigger reads "Created by · Manel", not "Manel". A control
  that swaps its label for its value stops saying what it filters on at exactly the moment someone
  needs telling.
- **The panel is portalled and positioned from the trigger's rect.** It renders inside `rail-scroll`
  (`overflow-x: auto`) on `/dashboard` and inside the slot sheet's own `overflow-y: auto`, and an
  absolutely-positioned panel is clipped by both. That is also what lets it flip above the trigger
  near the bottom of a phone screen. Escape is handled in the capture phase and stopped, so one
  press closes the dropdown without also closing the slot sheet behind it.

A search box appears at eight people and above; below that, reading the list is faster than typing.

**Groups render only when they can distinguish something.** One category chip, or one author,
selects the whole list — the Bebida dead end in a different costume. A small collection therefore
gets no filter row at all and the picker stays a search box, which is the right shape at that size.
This is also why the dev fixture now has two recipe authors: with one, a correctly-behaving filter
looks like a missing one, and `tests/unit/test_seed_fixture.py` pins that.

The URL carries `?by=<id>,<id>` on `/dashboard`, ids rather than display names. Names are unique in
the database and would read better, but they are editable, and `plan-url.ts` already settled that
question for `?plan=`.

### 8.11 The list is not downstream of the calendar (2026-09-11)

**The complaint.** *"I'm in the middle of the week and I see we're running out of sugar. I want to
add sugar for the next week's shopping list, but I don't want to start the menus yet."*

That was impossible, and structurally so rather than by oversight. `AssignDish` was the only thing
that created a plan row — lazily, per §4.4 — and `AddToList` took a `plan_id`. No dish meant no
plan, and no plan meant no list. Remembering the sugar required inventing a meal to hang it on.

**The fix is one more way in, not a new concept.** `_plan_for_week` now backs both callers, so a
week can be started from either end: by assigning a dish, or by putting one thing on its list. The
new route is `POST /plans/items`, keyed by a *day* rather than a plan id — because there may not be
a plan — and two segments deep so it cannot collide with `/plans/{plan_id}/items`. A week holding
one line and no dishes is a real week: you are going to that shop.

The alternative considered was a floating "next shop" inbox belonging to no week, drained into
whichever week you opened next. Rejected: it is a second kind of object to explain, and it has no
answer the moment two future weeks are planned — the sugar has to go in one of them, and the app
would be guessing which.

**The home week is the one you are shopping for next.** `homeWeekOf` hands over to the following
Saturday once this week's status is `list_closed`, and stays put otherwise. So on Wednesday the
planner opens on the week the sugar belongs to, with the add box already on screen, and the
existing "Back to this week" control is the way back. Notably it does *not* advance on
`calendar_closed`: that is the state you are actually shopping in, and moving on from it would hide
the list you are holding in the shop. One hop only — two closed weeks in a row means you planned a
fortnight ahead, and walking forward until something is open would be guessing how far.

The rule lives in `lib/plan-url.ts` as a pure function rather than inside the page, because it is
the kind of thing that is only ever wrong at a boundary and those are cheap to test and expensive
to reproduce by hand.

**Carry-over rides on the transition, not after it.** `POST /plans/{plan_id}/status` takes
`carry_over`, a list of unticked line ids to copy onto next week. It has to be part of the same call
because closing the list is one-way: once the plan is `list_closed` every write is refused, so a
carry-over asked about afterwards would have nowhere to read the lines from. Asked about *before* is
the last moment the question can still be answered.

Everything starts ticked in the picker. The usual reason a line is unbought is that the shop was out
of it — exactly the case for bringing it along; the unusual one is changing your mind, and that is
the one worth a tap. Defaulting the other way would quietly drop the sugar this whole section is
about. Closing the *calendar* cannot carry anything and the server refuses it with a 422: nothing
has been shopped for yet, so every line would qualify.

A line ticked between the modal opening and the confirm landing is skipped rather than fatal — that
is the other person in the shop finding it after all, and it must not stop the week from closing. An
id that is not on the plan *does* raise, because that is a client bug or an id borrowed from someone
else's list.

**Deferred, with its trigger — ✅ closed 2026-09-11 by §8.12(e).** Carried lines arrived with no
sources and `is_manual = true`, so they read as "added by hand" rather than "you didn't get this
last week". The trigger was *when list items carry a `created_by`*, and the kitchen added exactly
that column: a carried line is now attributed to whoever closed the week it came from.

### 8.12 The week belongs to a kitchen, not to a person (2026-09-11)

**The complaint.** *"I live with my partner, we have different accounts, and we'll share the
shopping lists and the weekly menus. I don't want duplicates — but I also don't want one of us
doing it all while the other can only read."*

§4.3 shipped sharing as **read-and-tick**: Martina plans, you both shop. That was the right first
cut and the wrong final one, and the reason is in the sentence above. Read-and-tick has a
*direction*. One person is the owner and the other is a guest, and in a two-person household there
is no owner — there is a fridge. The failure mode is not a missing feature, it is that the second
person's phone shows a calendar they cannot touch, so they open their own week instead, and now
there are two plans and two shopping lists for one household. The duplication sharing existed to
prevent is exactly what it caused.

**So the owner is gone.** A plan belongs to a `kitchen`, and a kitchen is a set of people with no
roles in it. Everybody in it can assign a dish, add a line, tick, remove, and close the week. There
is no owner column, no `can_edit` flag, and nothing to promote anybody to.

```
kitchens          id · created_at                    (no other columns, and that is the point)
kitchen_members   id · kitchen_id ⟲ · user_id ⟲ · invited_by → users (SET NULL)
                     · accepted_at · left_at · created_at
                     UNIQUE (kitchen_id, user_id)
                     UNIQUE (user_id) WHERE accepted_at IS NOT NULL AND left_at IS NULL

meal_plans           kitchen_id → kitchens, owner_id renamed to created_by (attribution only)
                     UNIQUE (kitchen_id, week_start)      — was (owner_id, week_start)
plan_entries         + created_by → users (SET NULL)
shopping_list_items  + created_by → users (SET NULL)
plan_shares          dropped
```

Five decisions inside that are not obvious from the table.

**(a) One kitchen per person, enforced by a partial index rather than by a column.** Two active
kitchens would mean two answers to *"which week am I planning?"* and the planner would have to pick.
The index is partial for a specific reason: the rows left behind by leaving and the rows waiting to
be accepted must not count against it, which is what lets somebody hold an invitation while still
living in their own kitchen. Index the bare column and that becomes impossible.

*Many kitchens later is a constraint drop with no data migration.* `kitchen_members` is many-to-many
either way; "one kitchen" is this index plus the absence of a selector in the UI. That is why it was
worth building the one-kitchen version now rather than the general one.

**(b) Joining is an invitation, because it is a move.** Accepting leaves the kitchen you are in, in
the same transaction — split into two calls there would be a window in which the unique index
decides the outcome by rejecting the second half. Something with that consequence cannot happen to
somebody because another person typed their name, so `POST /kitchen/members` creates a *pending*
membership and `PATCH /kitchen/invitations/{id}` is the answer to it. Pending grants nothing: not
the week, not the list, not the archive.

**(c) Nobody can remove anybody but themselves.** With no owner and no admin, an eject button would
have to invent one — and *"we live together"* should not be a relationship one side can end
unilaterally from inside a recipe app. The single exception is withdrawing an invitation you sent,
which is undoing your own action rather than acting on somebody else, and it shares the leave route:
`DELETE /kitchen/members/{user_id}` accepts your own id or a pending invitee's, and refuses everyone
else with a 403.

**(d) What you leave behind stays yours to read.** `left_at` is set rather than the row deleted, and
the archive asks for *every kitchen you have ever accepted* — so moving out does not take last
August with it. That is the one place reading is wider than writing: those weeks render and cannot
be changed. It is also why an archive row links by `?plan=<id>` and never by date alone; by date
would show whatever your current household has for those dates, which is a different week under the
same heading.

**(e) `created_by` is attribution and never permission.** It sits on entries and list lines to
answer *"did you already get the bread, or is that still mine to buy?"*, which is the one question a
shared list cannot answer on its own. A slot's author moves when somebody reassigns it — the slot is
the identity, so whoever set what is there now is whose it is — while a merged list line keeps the
*first* name, because "who put this on the list" happened once. The badge renders only when the
answer is somebody else, which is what stops it becoming the same two initials on every row of a
solo kitchen. This also closes §8.11's deferral: carried-over lines now have a `created_by`, and are
attributed to whoever closed the week.

**Existing shares were dropped, not converted.** A share is not a membership, and converting one
would have to move the guest out of their own kitchen — taking their weeks out of the planner, and
risking a collision on the new `(kitchen_id, week_start)` key the first time both people had planned
the same week. Silently rearranging somebody's household in a migration is worse than asking them to
send one invitation. Every existing user got their own kitchen; every existing plan moved to its
owner's.

**Routes: −3, +5.** Gone are `/plans/shared` and both `/plans/{plan_id}/shares…`. Added are
`GET /kitchen`, `GET /kitchen/people`, `POST /kitchen/members`,
`DELETE /kitchen/members/{user_id}` and `PATCH /kitchen/invitations/{kitchen_id}`. Reading one week
by id is a *query parameter* on the existing `GET /plans` rather than a new `/plans/{plan_id}`,
because HTTP API matches exactly and a
greedy `/plans/{plan_id}` would sit beside the literal `/plans/archive` — the hazard
`lambda-api-stack.ts` already names.

**The UI shrank.** `SharePanel` was a section at the foot of the page with a heading, a paragraph
and a form — a permanent block of explanation for something configured once. It is now `KitchenBar`,
a portalled dropdown beside the view toggle built on `AuthorSelect`'s pattern: overlapping initials,
the word "Kitchen", a chevron. Alone, the stack shows your initials and a dashed slot where the
second person would be, which says *there is room for somebody here* without spending a word on it.
The week selector, the guest banner and `is_mine` are all gone with the concept they served.

Invitations do **not** live in that dropdown, even though it would have been the cheapest place. An
invitation is the one thing here addressed *to you*, and the dropdown is a control you may never
open because its face already answers the only question it usually has. So `InvitationCard` sits on
the page, in the slot the guest banner used to occupy, and spends its words on the part that tapping
again will not undo: accepting means leaving the kitchen you are in.

**Live updates: polling, and mostly not polling.** Two people in one shop need the list to converge,
and the constraint is that this must stay free. WebSockets need a *different* API Gateway type,
`$connect`/`$disconnect` routes and a DynamoDB table of connection ids, billed per connection-minute.
SSE needs Lambda response streaming, which works through Function URLs and **not** through API
Gateway, bills for the whole time the connection is held open, and caps at the 15-minute function
limit. gRPC is not served by HTTP API at all. So `useLivePlan` refetches on focus — the moment the
list is most likely to be stale is the moment somebody looks at it — and otherwise polls every 20s
behind four gates: the shopping list is open, somebody else is actually in the kitchen, the tab is
visible, and the page has been touched in the last five minutes. A household spends on the order of
a thousand extra requests a month against a free tier of a million.

#### 8.12.1 Inviting is a list, not a spelling test (2026-09-12)

Shipped with a text box: type the other person's display name, exactly. Two days of use and the
verdict was *"I don't want to type exactly the display name of the person I'm looking for"*. It is
the right complaint, and the interesting part is that the failure was never in the error message. A
typo came back as "nobody in SAM is called that" — a sentence explaining an answer the app already
held. The fix is not a better message or fuzzy matching; it is that there is nothing left to get
wrong.

`GET /kitchen/people` returns everybody with a display name who is not already in the caller's
kitchen and has not already been asked. Three consequences worth writing down:

- **The filtering is on the server**, because *"invitable"* is a fact about the kitchen. Shipping the
  directory plus a copy of the rule would give the rule two places to be wrong. The endpoint's
  promise is that every row it returns can actually be invited — which is a test
  (`test_every_row_it_offers_can_actually_be_invited`), not a comment.
- **It is a new `Person` entity, not `User`.** This is the one place the app hands out somebody
  else's account, and an email has no business travelling with it. `display_name` is non-optional,
  so people who have not finished signing up are absent rather than blank.
- **Inviting now takes a `user_id`.** `get_by_display_name` went with it — the name lookup existed
  only because there was nothing to choose from, and it was the whole source of the 404. The
  use case's "no such person" and "already here" checks stayed: they now guard a *race* (somebody
  accepted, or was asked, between the list being drawn and a row being tapped) rather than a typo.

This does enumerate accounts, which §8.12's by-name form deliberately did not — the earlier
docstring named that as a feature. The trade is now made the other way on purpose: at six accounts
who live together, the leak is *"these people also use SAM"*, which they already know, and what it
buys is that nobody has to spell a housemate's name.

In the panel, the rows sit under the members and the pending invitations, and the list is fetched on
**first open** rather than with the week — the planner loads every day, this list is read once.
One tap sends the invitation, with no confirm step, because the undo is already on screen: the
person immediately becomes a row under "Waiting to answer" with the ✕ that withdraws them, two lines
up from where they were tapped. A search box appears only above eight invitable people; below that
it is a row of furniture.

#### 8.12.2 What is left open

**A week planned in a kitchen you have left is readable and frozen, and the UI says so only by
having no controls** — there is no sentence explaining why. Revisit if anybody ever actually leaves
a kitchen; with one household and six accounts, writing that copy now would be writing it for
nobody.

**Leaving a kitchen gives you a new empty one, not your old one back.** Verified, not assumed: the
weeks you planned before you moved in stay *readable* in the archive for ever, but they never become
editable again, and your planner restarts blank. This is not quite an accident — "give her back her
previous kitchen" is wrong as stated, because the kitchen you most recently left is the one you just
walked out of, and somebody else still lives there. The correct rule is "the most recent previous
kitchen with no other active member", which is buildable and not built. Revisit the first time
somebody shares a kitchen, leaves it, and wants to change a week from before they moved in.

**An invitation is only visible on `/plan`.** No badge in the nav, nothing on the profile, no email.
Somebody who does not open the planner never learns they were invited. Correct at two people who
talk to each other; revisit if an invitation is ever sent to somebody who is not in the room.

### 8.13 Dates: `Intl` knows where the month goes (2026-09-12)

A week heading read **"12 – Sep 18"** in English. `formatWeekRange` built the string by hand — a
day, a dash, a day-and-month — which assumed every language writes the day first. English does not,
so the two halves came out in different orders and the result is not a date range in any locale.

`Intl.DateTimeFormat.formatRange` knows all of it: which half keeps the month, which dash the
language uses, and that it tightens to "12–18 Sept" inside one month while staying spaced across
"28 Sept – 2 Oct". The second half of the fix is that a bare `en` means American English to `Intl`,
which puts the month first — so every date in this app, not only the range, went through a
`dateLocale()` that asks for `en-GB`. Same English, the ordering the app actually means, and the
odd one out among its three languages until now.
