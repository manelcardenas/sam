# Meal plan redesign — Phase 1 (web, tested on real Saturdays)

> **Status: Ready to start** — agreed 2026-11-17. The decisions and their reasons are in
> [ADR-0009](../adr/0009-a-meal-is-recipes-products-and-notes.md); this file is what gets built
> and in which order. Phases 2 and 3 are in
> [`../todo/TODO_weekly-plan-redesign.md`](../todo/TODO_weekly-plan-redesign.md).

## Goal

Planning a week of simple meals should cost about as much as writing it on paper, and the list
should come out right: one line per product, no amount and unit to type unless you want to.

Built in the current web app (ADR-0009 §9 explains the exception to ADR-0008), then used for
**2–3 Saturdays** before Phase 2 starts in Expo.

## How we will know it worked

Measured with read-only SQL on production, before and after, for the weeks planned with Phase 1:

| | Before (19 Sep → 7 Nov) | Target |
|---|---|---|
| Weeks with the calendar used | 3 of 8 | every week tested |
| Planned dishes that are free-text notes | ~⅓ | only leftovers, eating out, frozen |
| Products on the list twice, split by unit | 2 (carne, patata) | 0 |
| Dishes in a filled week that put nothing on the list | 8 (10 Oct, a retroactive diary) | only "Solo al calendario" and notes |

And one question for the person who plans: **did planning the week feel quicker than before?**

## Not in Phase 1

Drag and drop, the "Sin día" tray, moving between weeks, tags shown across the app, emojis per
ingredient, supermarket products and prices, photos (all Phase 2, Expo); the AI filling the week
(Phase 3). The deferred list with triggers is at the end of ADR-0009.

---

## Slices, in build order

Each slice ships on its own and leaves the app working. Each one that changes a table also updates
[`../data-model.md`](../data-model.md) in the same PR. The order puts the pain named first
("lines that do not merge") first, and the biggest unknown (recipe import quality) last, behind a
model comparison.

### Slice 1 — One list line per product · ~1 day

**Why first:** fixes "duplicates or lines that do not merge" on its own, and everything after it
adds lines.

Model:

- Merge key: `(plan_id, COALESCE(grocery_key, normalised_name))`. The unit leaves the key.
- A line's amounts become a map `unit → amount` (`amounts` JSONB, e.g. `{"g": 1500, "ud": 2}`),
  replacing `total_amount` + `unit`. `{}` means "no amount".
- Units are canonicalised on write: `kg → g ×1000`, `l → ml ×1000`, `cl → ml ×10`; anything else
  is trimmed and lowercased (`Lonchas → lonchas`) and kept as written.
- `list_item_sources` gets `unit`, so each dish's share can still be subtracted exactly.

Tasks:

- [ ] Domain: `merge_key()` without the unit; a pure `add_amounts(amounts, amount, unit)` with
      the conversions, tested on its own
- [ ] Migration: add `amounts`, fill it from `total_amount`/`unit`, **merge the lines that now
      share a key** (summing amounts, moving their sources onto the survivor), then recreate the
      unique index without the unit and drop the old columns. Check prod first (read-only): the
      two known pairs are carne and patata
- [ ] Repo: `add_items`, `drop_sources_for_entry`, `set_item_grocery_key` (folding into a twin)
      and the ± edit work on the map
- [ ] API schema: `amounts` on a line; the ± edits the line's main unit (the largest share)
- [ ] Frontend: render `1,5 kg`, `500 g + 2 ud`, using the locale (`lib/format.ts`); ≥ 1000 g
      shows as kg, ≥ 1000 ml as l
- [ ] Tests: Postgres integration (`SAM_TEST_POSTGRES=1`) for the merge, the unpick and the
      migration on a seeded twin; frontend formatting at 360 px in Catalan

### Slice 2 — Countable amounts round up · ~1 h

- [ ] On the list, a unit-less or `ud` amount shows rounded up (1,5 huevos → 2). Stored values
      stay exact, so removing a dish subtracts exactly what it added
- [ ] Unit test in `frontend/lib/`

### Slice 3 — Products as meal components · ~1½ days

Model (`plan_entries`):

- [ ] Add `grocery_key` (nullable), `store` (nullable: `mercadona · lidl · ametller · otro`) and
      `amount` + `unit` (nullable). An entry is a **recipe** when `recipe_id` is set, a
      **product** when `grocery_key` is set, a **note** otherwise. A check constraint forbids
      both keys at once
- [ ] Unique index: one product per slot, like one recipe per slot today
- [ ] "Add to the list" for a product component: its amount if set, else typical portion ×
      servings (slice 4), else a line with no amount whose sources say how many meals want it
      ("para 3 comidas")
- [ ] Removing a product component subtracts its share, exactly as for a recipe

Frontend (`components/plan/SlotSheet.tsx`):

- [ ] **One search** in the slot: your kitchen's recipes, then products (`GET /grocery-items`),
      then "De otros" (other people's public recipes). Typing something that matches nothing
      offers "Añadir como nota" and "Añadir como producto"
- [ ] A product row in the slot shows its name, optional store ("Tortilla · Mercadona") and
      optional amount; tapping it edits those
- [ ] "Solo al calendario" works for products as it does for recipes (cooked or frozen food)
- [ ] The shopping list shows the store on a line when one was given
- [ ] Copy in `messages/en.json`, `es.json`, `ca.json`; copy-fits e2e at 360 px

### Slice 4 — Typical portion per product · ~½ day

- [ ] `grocery_items`: `portion_amount`, `portion_unit`, `portion_confirmed_at` (NULL = "sin
      confirmar"), following the aisle's existing pattern
- [ ] The AI proposes a portion when it proposes a new vocabulary row; a one-off script proposes
      them for the 274 seeded rows (dry run by default, prints the table for review)
- [ ] Shown and editable where the aisle already is (list line and admin), marked "sin
      confirmar" until someone accepts or edits it
- [ ] Nothing recalculates by itself: a confirmed portion applies from the next "add to the
      list", like every other snapshot (data-model §5)

### Slice 5 — Quick recipes, kitchen-only · ~1 day

Model (`recipes`):

- [ ] `visibility` (`public · kitchen`, default `public`) and `kitchen_id` (required when
      `kitchen`)
- [ ] `GET /recipes` returns public recipes plus your kitchen's; `GET /recipes/{id}` returns 404
      for another kitchen's quick recipe
- [ ] `servings` required on create (API and form), prefilled with the kitchen's size; existing
      rows untouched

Frontend:

- [ ] "Guardar como receta" on a slot with two or more components: title (suggested from the
      components), the products as ingredients, amounts if they had any. Saves a `kitchen`
      recipe. **The meal it came from is not rewritten**; the recipe is there for next time
- [ ] The recipe book shows quick recipes to their kitchen, with a small "solo tu cocina" mark;
      editing one can make it public
- [ ] Tests: the visibility filter in the repo (in memory and Postgres) and the controller

### Slice 6 — Recipe import: link, photo, text · ~2–3 days

**First, measure** (½ day, before writing any of the rest):

- [ ] Take ~20 real recipes from production and from links you actually use; run each through
      DeepSeek today and two candidates (a small vision-capable model, e.g. Claude Haiku 5.5 or
      Gemini Flash). Record per recipe: lines in vs rows out, wrong amounts or units, cost,
      latency. Pick on that table, written into this file

Then, three ways in, one review screen:

- [ ] **Link:** fetch the page server-side and read its `schema.org/Recipe` JSON-LD (no AI).
      When the page has none, fall back to the text path with the page's visible text
- [ ] **Photo:** the image goes to the chosen vision model and is discarded; nothing is stored
      (see [TODO_photos](../todo/TODO_photos.md), kind 1)
- [ ] **Text:** the chosen model with structured output (a JSON schema), replacing
      prompt-and-parse in `infra/adapters/parsing/`

Guarantees, each with a test:

- [ ] **One row per original line**, never fewer: a line the model cannot structure stays as a
      row with only its name
- [ ] A **line counter** ("12 líneas → 12 ingredientes") on the review screen
- [ ] The **original text alongside** the rows while reviewing
- [ ] A **warning** when the steps name an ingredient the list lacks
- [ ] **No vocabulary writes until save**: `POST /ingredients/parse` stops writing
      `source=ai` rows; it returns proposals, and saving the recipe writes them
- [ ] The model also proposes servings, prep and cook time, and tags (ADR-0009 §7:
      `tags` on `recipes`, from the fixed set); the review screen shows them editable

Both recipe forms (`components/RecipeForm.tsx` and the create step inside `SlotSheet`) use the
same import; merging the two forms into one is welcome but not required.

---

## After the 2–3 Saturdays

- [ ] Re-run the table in "How we will know it worked" and write the numbers here
- [ ] Decide the deferred "change a line's unit by hand" with that data (ADR-0009 §5)
- [ ] Move to Phase 2 in Expo, carrying over the model and anything the test changed
