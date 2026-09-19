# Ingredient capture and the grocery vocabulary — plan

> **Status (2026-09-18): this plan is complete. Phases A–F shipped, plus §6.1.** §5's slots,
> `guarnicion`, the vocabulary, aisle sorting, manual-add autocomplete, the parser, quick-create from
> a slot and the backfill are all in.
>
> **Phase G and the `Frecuentes` chips are deferred to v2** —
> [`./future-roadmap.md`](./future-roadmap.md) item 13, where they are one item rather than two
> because they are the same query over the same history, blocked on the same thing: there isn't any
> yet. Trigger recorded there: ten closed weeks.
>
> **§6.1 shipped 2026-09-18, late and as a bug fix.** It was written into this plan and then not
> built in Phase B, which left aisle grouping matching a line's name against a vocabulary keyed on
> `key_for(name_es)` — so 87% of Catalan names and 92% of English ones could never match, and the
> three-names-per-row design of §3.5 did nothing at all. `shopping_list_items.grocery_key` now
> exists and the merge key is `COALESCE(grocery_key, normalised_name)` as specified. **One
> deviation:** `sort_items` was left alphabetical rather than sorted by aisle. The client groups by
> aisle from the key, so a server-side sort would only change the order within a group, which is
> already alphabetical — it would buy nothing and give the entity an aisle it otherwise never needs.
>
> **Originally scoped, 2026-09-12.** Scoped by interview (`/grilling`) on 2026-09-12.
> Fulfils [`./future-roadmap.md`](./future-roadmap.md) item 9, and closes the blocker measured in
> [`./meal-planner-plan.md`](./meal-planner-plan.md) §3.
>
> **This is the project's first recurring cost.** It is roughly **five cents a month** at household
> volume (§7), and it is a deliberate exception to the everything-is-free rule rather than an
> oversight. The number is in §7 so the decision is made against the figure and not against a vibe.
>
> Two features are designed here because they were designed together and they interlock — but they
> are **independently shippable**, and only one of them needs an API key:
>
> | | | needs AI |
> | --- | --- | --- |
> | §3–§4, §6 | one **grocery vocabulary**, natural ingredient capture, a shopping list that sorts itself by supermarket aisle | yes |
> | §5 | a slot holds **more than one dish**, and simple sides live in the collection as `guarnicion` | no |
>
> §5 can ship first and alone. §3 must ship before §4.

## 1. What this is

Two complaints, one root cause.

**In `cook`:** entering ingredients is three boxes per line, so nobody fills them in. Measured in
production: `amount` on 2 lines out of 111, `unit` on 1 ([planner plan](./meal-planner-plan.md) §3).

**In `plan`:** the shopping list is one flat alphabetical column, so standing in the fruit aisle you
scan the whole thing looking for the four vegetables. And a slot holds exactly one dish, so
*carne en salsa con arroz* cannot be planned at all — you get the meat or you get the rice.

The root cause of both is that **the app has no idea what an ingredient *is*.** `"3 huevos"` is a
string. It cannot be scaled, merged, sorted or reasoned about. Everything below follows from giving
ingredients an identity.

## 2. What this is not

It is **not** a supermarket catalogue. [Roadmap](./future-roadmap.md) item 10 defers that, on the
argument that *"a shopping list is ingredients, a catalogue is products"* — SKUs, brands, prices.
Nothing here has a price or a barcode, and item 10 stays deferred on exactly the same terms.

It is **not** an ingredient database with nutritional data, substitutions or seasonality. One row
per buyable thing, five facts on it, nothing more.

---

## 3. The keystone: one grocery vocabulary

A new table, `grocery_items`. One row per thing you can buy. It is the single decision the rest of
this plan hangs off, and it collapses four separate feature requests into one table.

### 3.1 Why one table, and why it holds detergent

The instinct is two tables: ingredients that appear in recipes, and "random supermarket things" you
add by hand. That is wrong, because **almost everything is both**:

| | in a recipe? | hand-added? |
| --- | --- | --- |
| huevos | ✓ | ✓ |
| harina | ✓ | ✓ |
| iogurt | rarely | ✓ |
| azafrán | ✓ | rarely |
| **detergent** | never | ✓ |

Only detergent lives on one side, and one row whose aisle happens to be `household` is not a reason
for a second table. Split them and `huevos` exists twice with two aisles that can disagree, and the
shopping list has to join two tables to sort one screen.

So: **one vocabulary that recipe ingredients and hand-typed lines both resolve to.**

```
recipes                        grocery_items  (~650 rows)        shopping_list_items
────────────────────           ────────────────────────────      ─────────────────────
Boloñesa   (comida)            huevos       dairy_eggs           week of 13 Sep
  ingredients JSONB            cebolla      produce              ──────────────────
   {huevos,     4,  — } ──┐    espaguetis   dry_goods            Cebolla       3    produce
   {cebolla,    2,  — }   │    tomate frito canned               Espaguetis  400 g  dry_goods
   {espaguetis,400, g }   ├──▶ aceite       condiments  ·pantry  Iogurt        4    dairy_eggs
                          │    iogurt       dairy_eggs           Detergent     1    household
Arroz blanco (guarnición) │    detergent    household            ...sorted by aisle
   {arroz,     80,  g } ──┘    ...
                                    ▲  ▲
        hand-typed "iogurts" ───────┘  │
        hand-typed "detergent" ────────┘
```

Division of labour, stated once so it is not re-litigated:

- **`recipes.ingredients` (JSONB, unchanged)** holds *how much*: `{huevos, 4, —}`.
- **`grocery_items` (new)** holds *what shelf, and do I already have it*. **No quantities, ever.**
- **`shopping_list_items` (one new column)** holds *what to buy this week*.

It is named `grocery_items` rather than `ingredients` because detergent is not an ingredient, and
rather than `catalogue` because [roadmap](./future-roadmap.md) item 10 already uses that word for
the product catalogue it is deferring. Two meanings of "catalogue" in one repo is a document nobody
can read.

### 3.2 The columns

| Column | What it is | Example |
| --- | --- | --- |
| `key` (PK) | The merge key. Lowercase, accents stripped, whitespace collapsed — **the function `shopping_list.py::normalise_ingredient_name` already computes**. Never shown. | `platano` |
| `name_es` / `name_ca` / `name_en` | How it is written, per language. See §3.5. | `Plátano` |
| `aisle` | Which section of the shop. Enum, §3.3. | `produce` |
| `is_pantry` | Whether it is normally already at home. See §3.4 — this is subtler than it looks. | `false` |
| `default_unit` | The unit this is normally measured in. A **hint to the model**, so it writes `g` and never `gramos`. | `null` (counted) |
| `source` | `seed` / `ai` / `human`. Exists so every guess the model made is findable. | `seed` |
| `confirmed_at` | When a person last vouched for the row. `null` = nobody has checked. | `null` |

`default_unit` earns its place three times over: it keeps units consistent so lines merge, it decides
whether a missing amount is worth a nudge (§4.5), and it makes `20 g de huevos` detectable as a
mistake because eggs are counted.

> **Corrected 2026-09-18, on the backfill's first real run.** It was also being applied *server-side*
> as a fallback — an amount arriving with no unit took the row's `default_unit` — which sounded
> harmless and was not. Over the real recipes that rule fired exactly **twice and was wrong twice**:
> `1 patata` became *1 g* of potato and `2 de vainilla` became *2 ml* of extract. Every unit that
> came out right came from the raw text, which the model had read and the rule had not.
>
> The flaw is that the rule could only see *that* an amount existed, never whether the cook was
> counting or weighing — and those are the two readings of a bare number. So `default_unit` is now a
> fifth column in the prompt's vocabulary block, where the raw text is visible too, and the parser
> passes the model's answer straight through. **A bare `100 aceite` now stays unitless**, which is
> vague where the old answer was wrong — and wrong is worse, because the shopping list merges on the
> unit, so `Patata 1 g` and `Patata 2` were two lines for one potato problem.

### 3.3 `aisle` — eleven values, and they are a route

It is not a food taxonomy. It is **the order you walk the shop**, and the test is: *can I go
top-to-bottom and never double back?*

```
produce · bakery · meat_fish · dairy_eggs · frozen · canned
dry_goods · condiments · drinks · household · other
```

| Enum | On screen (es) |
| --- | --- |
| `produce` | Fruta y verdura |
| `bakery` | Panadería |
| `meat_fish` | Carnicería y pescadería |
| `dairy_eggs` | Lácteos y huevos |
| `frozen` | Congelados |
| `canned` | Conservas |
| `dry_goods` | Pasta, arroz, legumbres, harina |
| `condiments` | Aceites, especias y salsas |
| `drinks` | Bebidas |
| `household` | Droguería y limpieza |
| `other` | Otros |

Three decisions inside that list:

- **Meat and fish are one value.** Adjacent counters, walked in one pass.
- **`household` is in, and personal care folds into it.** An earlier draft cut it on the grounds that
  this is a food planner. That was wrong: if detergent falls into `other`, then `other` becomes an
  aisle you actually shop, and the sorting fails precisely where it was wanted. Splitting droguería
  from perfumería later is one enum value.
- **The enum's declaration order *is* the sort order.** Not alphabetical. `meal_plan.py` already
  carries a comment about this exact trap — `"dinner" < "lunch"` renders every day backwards — and
  the same mistake here would sort `bakery` before `produce` and `other` into the middle.

Five values (`verduras, lácteos, carne, conservas, otros`) was the starting proposal and fails the
route test: `otros` would swallow pasta, rice, flour, oil, spices, bread, frozen and drinks, which is
most of a real list.

### 3.4 `is_pantry` unticks a line. It never hides one.

The tempting definition — *"pantry items are never added from a recipe"* — is **wrong**, and a cake
is the proof. A tablespoon of oil should not go on the list; **1 kg of sugar for a tarta should.**
Same ingredient, opposite answers.

Fixing that by quantity needs a per-item threshold column full of numbers nobody can know
(*"more than 200 g of sugar is a shopping quantity"*), guessed once and wrong for anyone whose
baking differs from the guess.

The existing confirm popup already solves it. [Planner plan](./meal-planner-plan.md) §4.6:
*"Every popup starts fully ticked."* So `is_pantry` **flips that default for one line**:

```
Tarta de manzana · para 8

  ✓ Manzana            1,2 kg     Fruta y verdura
  ✓ Nata               400 ml     Lácteos y huevos
  ✓ Canela              10 g      Aceites y especias
  ☐ Azúcar               1 kg     Aceites y especias   · de casa
  ☐ Harina             500 g      Pasta y arroz        · de casa
  ☐ Mantequilla        200 g      Lácteos y huevos     · de casa
```

You see 1 kg of sugar sitting there unticked, you know the cupboard has 200 g in it, you tap. **The
decision is made by the person who knows what is in the cupboard, at the only moment they can make
it, with the quantity in front of them.**

Two consequences worth stating:

- **Nothing in this design hides a row.** That is ADR-0007's amendment as a standing rule, not a
  coincidence — *"the lens also hid rows… which is a worse failure than the orphan heading this ADR
  was written to fix."*
- **It makes the kitchen question cheap.** `grocery_items` is global, like `recipes` and `cuisines`,
  but `is_pantry` is really a household fact — you always have olive oil, someone else may not. With
  the line always visible, being wrong costs exactly **one tap**, which is cheap enough that a global
  flag is fine. A per-kitchen override is a small join table, added only if it ever annoys anybody.

`is_pantry` affects **exactly one behaviour**: the default tick in the recipe confirm popup. It does
not hide the row, does not affect autocomplete, does not stop you adding it by hand.

### 3.5 Three names per row, because merging is the point

Not internationalisation — **merging**. If you type `huevos` and someone else types `eggs`, a
single-language vocabulary gives you two lines on one shopping list. Three name columns give you one
line, rendered in each reader's own language.

Capped at the app's existing three (`es` / `ca` / `en`), not "whatever the user speaks". The model
fills all three when it proposes a row — one extra field in the tool schema, negligible cost. Doing
it at seed time is free; retrofitting means re-running the model over the whole table and
reconciling duplicates that already exist.

### 3.6 The seed

**400–600 rows before anybody can create one.** Precedent and pattern: `CuisineModel` is already
documented as *"Curated, extensible cuisine vocabulary. New entries are a data insert, not a
migration."* This is the same shape, one size up, plus ~50 `household` rows.

Generated, then reviewed by a human, then pointed at the 111 existing production ingredient lines so
that what you actually cook is in there on day one.

**But seeding is not what protects the vocabulary from fragmenting.** No seed contains `calçots` or
`salsa teriyaki`. The defence is §4.4 — the user never names the ingredient, the model matches it.

---

## 4. Capture: one box in, a review table out

### 4.1 The four steps

**Step 1 — one box.** The three-column row grid (`RecipeForm.tsx:264-282`) is replaced by a single
textarea. This is the entire point of the feature: §3 of the planner plan diagnosed the empty fields
as *"one box is pleasant and three boxes are tedious"*, and any design that still has three boxes on
the way **in** has not fixed it.

```
Ingredientes *

┌─────────────────────────────────────────────┐
│ 400g espaguetis                             │
│ 500 g carne picada                          │
│ 2 cebollas                                  │
│ tomate triturado 800g                       │
│ queso parmesano                             │
│ aceite, sal, pimienta                       │
└─────────────────────────────────────────────┘
Escribe como quieras — una línea por
ingrediente, o todos seguidos.

Para  [ 4 ]  personas          [ Estructurar → ]
```

**Step 2 — one call for the whole list.** See §4.2.

**Step 3 — the review table, in place.** Same form, same save button, no navigation.

```
Revisa los ingredientes                     Para 4 personas

  Espaguetis         400   g    Pasta y arroz         ✦ nuevo
  Carne picada       500   g    Carnicería            ✦ nuevo
  Cebolla              2   —    Fruta y verdura
  Tomate triturado   800   g    Conservas             ✦ nuevo
  Queso parmesano      —   —    Lácteos y huevos      ✦ nuevo  · ¿cuánto?
  Aceite de oliva      —   —    Aceites y especias    · de casa
  Sal                  —   —    Aceites y especias    · de casa
  Pimienta             —   —    Aceites y especias    · de casa

  [ + Añadir ingrediente ]
  [ ← Volver al texto ]                        [ Guardar ]
```

Every cell editable in place. The name cell is a combobox searching `grocery_items`, so correcting
`Cebolla` to `Cebolla tierna` picks the **existing** row rather than inventing one.

**Step 4 — when both providers are down.** One row per line, raw text as the name, no amounts, a
quiet *"no hemos podido estructurarlo, revísalo a mano"*, every cell editable, save still works.
**Non-negotiable: an unreachable third-party API must never stop you saving a recipe.** The same path
covers a timeout, a rate limit and a cold start.

**Editing an existing recipe** opens straight into the review table. No re-parse, no API call.
`← Volver al texto` is the escape hatch back to the box.

**The manual row is on the way out, never on the way in.** `+ Añadir ingrediente` exists because
adding a seventh line by hand is a normal thing to want once you are already looking at the table.
The reason the data does not re-rot is that you cannot *start* there — a parallel manual path would
always be faster for one ingredient, so people would use it, and §3's measurement would repeat
itself with an AI feature bolted on the side.

### 4.2 One call, not one per ingredient

Per-ingredient parsing as you type is the tempting design. It is wrong here, in order of weight:

- **`aceite, sal, pimienta` is three ingredients on one line.** A per-line call structurally cannot
  see that.
- **Context disambiguates.** Knowing the list holds carne picada and espaguetis tells the model
  `tomate triturado` is the tinned kind.
- **Cost:** one call pays the system-prompt overhead once instead of six times.
- **Latency:** one 2s spinner beats six staggered ones, and validation firing on every keystroke pause
  reads as a judgement.

### 4.3 What goes in the request

The vocabulary goes **first**, as a stable prefix, so the provider's context cache hits it:

```
[system]  You structure ingredient lines. Match against the vocabulary below.
          Prefer an existing row. Only propose a new one if none of them is
          the same ingredient.

[grocery] huevos|Huevos|Ous|Eggs
          cebolla|Cebolla|Ceba|Onion
          queso parmesano|Queso parmesano|Formatge parmesà|Parmesan
          ... (~650 rows, ~5k tokens)

[user]    400g espaguetis
          500 g carne picada
          ...
```

**Send the whole vocabulary. Do not build retrieval.** The prefix is byte-identical on every call and
only invalidates when the table changes, which is rare by design. Retrieval (`pg_trgm`, top-N
candidates) would cut ~$0.0004 to ~$0.0001 per call and cost: a Postgres extension, a similarity
implementation in the in-memory fake so the two adapters agree, and — the real price — **the chance
of retrieving the wrong candidates and hiding the right row from the model.** Sending everything has
perfect recall by construction.

Concrete trigger for revisiting: **past ~1,500 rows, or past ~4s per call.** A household hits neither.

The tool schema:

```jsonc
{ "lines": [{
    "raw":           "400g espaguetis",   // the user's own words — the audit trail
    "grocery_key":   "espaguetis",        // an existing row…
    "new":            null,               // …or this, never both
    "amount":        400,
    "unit":          "g"
}, {
    "raw":           "queso parmesano",
    "grocery_key":    null,
    "new":           { "es": "Queso parmesano", "ca": "Formatge parmesà",
                       "en": "Parmesan", "aisle": "dairy_eggs", "is_pantry": false },
    "amount":         null,
    "unit":           null
}]}
```

### 4.4 Matching: aggressive on spelling, refusing on category

The two failure directions need **opposite** pressure, and this is why the decision belongs to a
model rather than to a similarity threshold.

| | Wanted | Why string similarity gets it wrong |
| --- | --- | --- |
| `spagetiis` → `Espaguetis` | **match** | it is a misspelling, not a new food |
| `queso rallado` → a **new row**, not `Queso parmesano` | **refuse** | they share the word `queso`, so every metric scores them high — and they are different things you buy in different places |

No edit-distance threshold knows that `spagetiis` is `espaguetis` while `pimiento` is not `pimienta`.

### 4.5 The three annotations, and why they are different

- **`✦ nuevo`** — this will create a `grocery_items` row. Passive badge, no interaction. It is also
  **the typo detector**: you have added eggs twenty times, so seeing `✦ nuevo` beside `huveos` is
  wrong in a way you spot instantly, on a screen you are already reading.
- **`· de casa`** — `is_pantry`, so it starts unticked in the confirm popup (§3.4). Tappable to
  override for this recipe.
- **`· ¿cuánto?`** — a nudge, **never a blocking error**, shown only where `default_unit` is set.
  `queso parmesano` gets nudged; `sal` never does. A save blocked on a missing amount would rebuild
  the exact friction that rotted the data.

### 4.6 What can go wrong, and what it costs

The four failures have completely different blast radii, and conflating them makes the risk look
larger than it is:

| Mistake | Where it lands | Cost | Spreads? |
| --- | --- | --- | --- |
| `huevos, 20 g` | the **recipe's** JSONB | one recipe, one list line | **no** |
| `huveos` as a new row | `grocery_items` | splits the shopping list in two | **yes** |
| `huevos → produce` | `grocery_items` | 30 seconds in the shop | no — one edit fixes every recipe |
| `carne → is_pantry: true` | `grocery_items` | one unticked line you can see | no — one edit fixes every recipe |

**A wrong amount cannot propagate.** The model's context is the vocabulary, and the vocabulary holds
no amounts. Nothing typed in one recipe ever appears in the prompt for another. The only thing that
travels is **name identity** — one column — and it has three defences:

1. **The `✦ nuevo` badge**, above. Free, and catches most of it.
2. **A near-duplicate check that asks rather than decides.**

   > **Corrected 2026-09-12, during Phase D.** This was specified as a *hard guard*: reject a new
   > row within edit distance 2 of an existing name and force a match. **That is wrong, and
   > measuring it is what showed why.** `pimiento` and `pimienta` are distance **1** — exactly as
   > close as `huveos` is to `huevos` — and `sal` is **2** from `col`. A blocking rule would
   > silently merge two real ingredients, which is the precise failure §4.4's second row forbids.
   >
   > The asymmetry settles it. Wrongly merging puts the wrong thing in the basket and nobody sees
   > why; wrongly allowing leaves an untidy row you fix in one place. So the check surfaces
   > *"¿Huevos?"* next to the `✦ nuevo` badge and the person answers it.

   `near_duplicates` in `domain/entities/grocery.py`. Optimal string alignment distance, so a
   two-letter swap — the commonest phone typo — scores 1 rather than 2. Names shorter than **5
   characters are never compared at all**, on either side: at that length ordinary words are one or
   two edits apart (`lima`/`limon`, `sal`/`col`) and every list would carry a question.
3. **`source` and `confirmed_at` make the junk findable.** `WHERE source = 'ai' AND confirmed_at IS
   NULL` is every unvouched row. Skimmed monthly it will be four rows. Cleanup is a small script that
   merges one key into another and rewrites affected recipes' JSONB — worth writing once, not worth a
   UI for two people.

---

## 5. The plan: a slot holds a flat list of dishes

**Ships without an API key.** Nothing in §5 depends on §3 or §4, except the quick-create form in §5.3
which reuses §4's box.

### 5.1 Not "acompañantes" — and why the hierarchy is the trap

The feature was described as main dish plus side dish. That model is wrong, and the second example
given is what disproves it.

- **"Ensalada con pollo." Which is the side?** Neither. The moment a main/side hierarchy exists, that
  question has to be answered and there is no answer.
- **Rice is not a side.** It is a side under carne en salsa on Tuesday and it is the dish itself in
  arroz a la cubana on Thursday. So "side" cannot be a property of the food.
- **A label with no behaviour is not an entity.** Ask what the app would do differently:

| | Main | Side |
| --- | --- | --- |
| Contributes ingredients to the list | yes | yes |
| Scales by servings | yes | yes |
| Shows in the archive | yes | yes |
| Deleted independently | yes | yes |

Nothing. And this codebase has already had this argument once: ADR-0007 refused a second entity when
the distinction could be a *state* of the first. A main/side split buys two code paths through the
shopping list, the archive, the year view and the delete flow, **forever**, for a distinction that
changes nothing.

**A nullable `role` column "just in case" is the same mistake with a delay on it.** It is only cashable
if a behaviour turns up that depends on the role, and none was found.

### 5.2 The change

Carne en salsa and arroz are two entries in Tuesday dinner. Equal. Ordered by when they were added.

```
- DROP  uq_plan_entries_slot        (plan_id, date, meal)
+ ADD   uq_plan_entries_slot_dish   (plan_id, date, meal, recipe_id)
        WHERE recipe_id IS NOT NULL   ← stops adding the same dish twice
```

No `position` column until somebody actually asks to reorder. `WeekGrid.entryAt` (a `.find`) becomes
`entriesAt`. `PlanEntryModel`'s existing comment already anticipates this: *"One dish per slot in v1
(§6). Starter-plus-main later is dropping this."*

**The shopping list needs no changes at all.** It already merges across entries and keeps per-entry
provenance (`ListItemSource.entry_id`). Two dishes in one slot look exactly like two dishes in two
slots to it. That the hardest part is already built is the strongest evidence the flat model is the
natural one here.

Two real costs, named:

- **The grid gets taller.** Slot cards land near 138px wide at 1024px. Stack up to 3 names, clamp each
  to one line, `+N` past that.
- **The basket indicator stops being a boolean.** `isOnList(entry)` is yes/no today. With N dishes it
  is none / some / all, and **"some" must not look like "all"** or you will think you have shopped
  when you have not.

### 5.3 `guarnicion` is a `food_type`, not a new home

`Arroz blanco` and `Patatas al horno` have to live somewhere. The instinct is a "Básicos" section in
`cook`. **ADR-0007 says no, from experience rather than theory** — that exact split shipped and was
deleted the same day, because *"the lens also hid rows: a recipe with no method was invisible on
`/dashboard` until you found a chip."*

The schema already has the answer. `FoodType` is `bebida · postre · comida · aperitivo`. Add
**`guarnicion`**.

| | `food_type = guarnicion` | a "Básicos" section |
| --- | --- | --- |
| New tables | 0 | 1 |
| New enum values | 1 | — |
| New UI | **none** — `RecipeFilterChips` already filters this axis | a second list, a second empty state |
| Hides rows | no | yes — the thing ADR-0007 reverted |
| Set by | a person, deliberately, at creation | a nullable column, incidentally |

It is honest: a `postre` is also "not a meal, a component of one", and the schema accepted that
framing four values ago. The clutter worry then solves itself with a chip that already exists — tap
**Comida** and the guarniciones are gone; leave it unfiltered and they are visible, which is what
ADR-0007 insists on.

```ts
{ value: "guarnicion", icon: Wheat, accent: "#B98F3E" },
```

`Wheat` because rice, pasta, potatoes and bread are nearly all of this category, and a wheat sheaf is
unmistakable at 14px against a soup bowl, a soda cup, a cake slice and a salad bowl (`Salad` is taken
by `aperitivo`, `CookingPot` would collide with `comida`). `#B98F3E` sits at ~44°, in the wide gap
between `bebida`'s amber (36°) and `aperitivo`'s green (90°), and far less saturated than the amber so
they do not read as one chip.

Three copy keys are **required, not optional** — the copy-completeness test asserts every `FOOD_TYPES`
value has a label and a description in all three languages:

| | label | description |
| --- | --- | --- |
| `es` | Guarnición | Lo que acompaña al plato: arroz, patatas, ensalada |
| `ca` | Guarnició | El que acompanya el plat: arròs, patates, amanida |
| `en` | Side | What goes alongside: rice, potatoes, salad |

**Quick-create from the slot is what makes this work at all.** Discovering you need `Arroz blanco`
happens *while you are planning Tuesday*. If that means abandoning the plan, navigating to `cook`,
filling a form and coming back, nobody will do it — they will type `arroz` as a one-off text entry,
which `SlotSheet` already makes effortless (`onAssign(recipe: Recipe | null, …)`) and which puts
**nothing on the shopping list**. That is not a polish gap, it is the failure mode that kills the
feature.

```
Nuevo                                      Guarnición ▾
  Arroz blanco
  ┌──────────────────────────┐
  │ 80g de arroz por persona │       ← §4's box, reused verbatim
  └──────────────────────────┘
  Para 1 persona            [ Crear y añadir ]
```

Fifteen seconds, once, forever. And it graduates: write instructions into it later and it is a
recipe, exactly as ADR-0007 describes.

> **Built 2026-09-13.** Two things the sketch above did not say, both settled while building:
>
> **It costs one extra tap, and that tap is `Estructurar`.** "Crear y añadir" stays disabled until
> the ingredient box has produced rows, because a dish with nothing to buy *is* the one-off text
> entry this screen exists to beat — it would look like a success and put nothing on the list. The
> alternative was letting the button parse the box first, which hides a two-second network call
> behind the word "Crear". The same tap is already required in `cook`, so it is a habit rather than
> a new rule.
>
> **The basis is stated, not labelled "por persona".** §5.4 asked for the words; what actually
> removes the "it feels weird to ask a quantity for rice" problem is naming the result —
> *"Se ajustarán a las 4 personas de esta comida"* under the stepper. 80 g reads as a mistake until
> you can see the multiplication, and a label saying "por persona" leaves you to do it yourself.

So there are three tiers, each earning its place by behaviour:

| | Example | Ingredients | On the shopping list |
| --- | --- | --- | --- |
| Recipe | Espaguetis a la boloñesa | yes | yes |
| **Guarnición** | Arroz blanco | yes | yes |
| One-off text | *Sobras · Cena fuera · Pizza congelada* | no | no |

The third already exists and stays — it is the right answer for a Tuesday you are not cooking.

### 5.4 Servings: per-slot in the UI, per-entry in the schema

`PlanEntry.servings` already exists per entry, and stays. But **the sheet shows one stepper per slot**
and writes it to every dish in it — *"Carne ×2, Arroz ×4"* reads as a bug to almost everybody, even
though rice for four and meat for two is a real Tuesday. The data model keeps the flexibility, so a
per-dish override is addable later with **no migration**.

A guarnición is naturally per-person: `Arroz blanco`, `servings: 1`, `arroz 80 g`. Slot it for four →
320 g. The form defaults `servings` to 1 and labels it *"por persona"* when the category is
`guarnicion`, which removes the "it feels weird to ask a quantity" problem entirely. ADR-0001's
scaling does the rest, unchanged.

### 5.5 Pairing memory — free, and better than a model

*"Carne en salsa goes with rice, or potatoes, or baked potatoes"* is not a structural problem. It is a
**memory** problem: not wanting to re-find the rice every week.

**Look at what has shared a slot with this dish before.** Paired carne en salsa with arroz five times
→ adding it offers *"¿con Arroz blanco?"* as one tap. A query over plan history. No schema, no AI, and
more accurate than anything a model would guess about this household. Reads through the same
archive-wide path as the year view (`kitchen_ids_for`, which spans kitchens you have left), so it
survives moving house.

Build it **after** the flat list works, not with it.

---

## 6. The shopping list, sorted

### 6.1 The merge key changes

`huevos` and `eggs` merging into one line is the whole reason for §3.5, and it cannot happen today:
`uq_shopping_list_items_merge_key` merges on `(plan_id, normalised_name, COALESCE(unit, ''))`, and
those are two different strings.

`shopping_list_items` gains one nullable `grocery_key`, and the key becomes:

```
(plan_id, COALESCE(grocery_key, normalised_name), COALESCE(unit, ''))
```

Matched lines merge across languages and render **in each reader's own locale**. Unmatched manual
lines fall back to today's behaviour exactly — `display_name` as first typed. `merge_key()` in
`shopping_list.py` and the SQL index change **together**; both already carry comments insisting they
stay identical, and a fake that disagrees with the database is a suite that passes while production
merges wrong.

`sort_items` changes from `normalised_name` to `(aisle order, normalised_name)`. Lines with no
`grocery_key` sort as `other`, so they land at the end together rather than scattering through the
list.

**No unit conversion, still.** Planner plan §3 refuses it and nothing here changes that: 80 g and
340 g of the same thing merge to 420 g; `2 cebollas` and `200 g cebolla` stay two lines. Slightly
untidy, never wrong.

### 6.2 "Básicos" is the vocabulary, and manual add never calls the model

The request was a curated *"mis básicos"* list for quick-adding yogurts, oil, salt, flour. Three
different things were wearing that name:

| | Meaning | Where it lives |
| --- | --- | --- |
| `is_pantry` | *"already at home — start it unticked"* | §3.4 |
| `guarnicion` | *"a simple dish you plate alongside"* | §5.3 |
| **"básicos"** | *"I buy this regularly and no dish implies it"* | here |

The first two point in **opposite directions on the same items**: oil is `is_pantry` so a recipe does
not drag it in, *and* it is a thing you occasionally have to buy. So "básicos" cannot be another flag.
It is about making the manual-add box fast — `ShoppingList.tsx:112`, behind `AddToWeekList`.

**Autocomplete it against `grocery_items`.** That gives the correct name, spelling, language and —
critically — the correct **aisle**, so a hand-added yogurt sorts into Lácteos. Without it, the
sorting has a hole exactly where things are added by hand.

Ranking is by **what this kitchen has actually bought**, over past plans' `shopping_list_items`, with
a `Frecuentes` chip row above the input for zero-typing. Same pattern as §5.5, same free mechanism.
Cold start: with no history it falls back to plain matching, still better than today.

A curated list was rejected because it is a list you maintain by hand — twenty added, five used,
fifteen never pruned — and everything in it is already inferable from what you buy. An explicit
per-kitchen favourite star is the cheap upgrade **if** ranking disappoints; held until it does.

**Manual add never calls the model.** Match → name and aisle. No match → a plain line in `other`,
exactly like today, plus an optional one-tap *"¿en qué pasillo?"* to file it properly. You are
standing in a kitchen typing fast; that path stays instant and works with the API unreachable.

---

## 7. Providers, failure, and what it actually costs

### 7.1 Keys live in SSM, like everything else

SecureString parameters fetched by name at cold start — the pattern `lambda-api-stack.ts:53-68`
already uses twice, for the Neon DSN and the Geoapify key.

```
/recipe-manager/llm/primary/api-key      (SecureString)  → DeepSeek
/recipe-manager/llm/fallback/api-key     (SecureString)  → TBD
LLM_FALLBACK_BASE_URL, LLM_FALLBACK_MODEL  (plain env, not secret)
```

**Secrets Manager was considered and rejected on the facts, not on cost alone.** What it adds over
SSM SecureString is automatic rotation, cross-region replication and resource policies, for
$0.40/secret/month. Neither provider has a rotation API, so rotation is manual either way — it would
be $0.80/month for replication nobody wants. Standard-tier SSM only; Advanced parameters are
$0.05/param/month.

### 7.2 One adapter, two providers, and the fallback is a config choice

DeepSeek, Z.ai (GLM), Moonshot (Kimi) and Alibaba (Qwen) are all OpenAI-compatible, so the fallback is
**one adapter parameterised by `base_url` + `model` + a key name**, not a second implementation.
Swapping it is an SSM write plus a CDK env change — no logic redeploy. **The fallback provider is
deliberately unnamed in this plan**; it is being chosen separately and nothing here depends on which.

Structurally this mirrors the existing `PlacesProvider`: an `IngredientParser` **port**, one
OpenAI-compatible **adapter**, an in-memory **fake** for tests, and a small `FailoverParser`
decorator wrapping two instances — so the use case depends on the port and never learns there were
two.

**Primary is DeepSeek, on prefix caching rather than on list price.** ~5k tokens of vocabulary go on
every call, byte-identical, and DeepSeek caches that automatically at $0.07/M instead of $0.27/M.

### 7.3 The time budget

**API Gateway kills the integration at 30s** regardless of the Lambda timeout, and cold start plus
auth plus DB eats ~4s of it.

**8s, then 8s.** Worst case ≈17s before landing in §4.1's manual fallback. Failover triggers on
timeout, 5xx, rate limit, **and schema-invalid output** — that last one fails over rather than
retrying, because a model that just returned garbage is not the one to ask again.

12s + 12s was rejected: ≈26s worst case puts the failover itself inside the gateway's cutoff, so a
slow primary means the user sees nothing at all. Racing both in parallel was rejected too — it always
answers in ~3s and the extra cost is negligible, but it pays double on 100% of calls to save latency
on the <1% that fail, doubles the failure surface, and needs concurrency in a handler that is
otherwise entirely sync.

### 7.4 The number

| | |
| --- | --- |
| Input | ~5,000 tokens vocabulary (cached) + ~350 uncached |
| Output | ~300 tokens |
| Per recipe | **≈ $0.0008** |
| At 50 recipes/month | **≈ $0.04** |
| At 500 recipes/month | ≈ $0.40 |

**About five cents a month.** Input is capped by a max textarea length (~4,000 chars) so a runaway
paste cannot turn into a surprise.

---

## 8. Schema summary

**New table**

```
grocery_items
  key            text PK        -- normalise_ingredient_name(), the existing function
  name_es        text NOT NULL
  name_ca        text NOT NULL
  name_en        text NOT NULL
  aisle          aisle_enum NOT NULL      -- 11 values, §3.3, values_callable
  is_pantry      bool NOT NULL DEFAULT false
  default_unit   text NULL
  source         grocery_source_enum NOT NULL   -- seed | ai | human
  confirmed_at   timestamptz NULL
  created_at     timestamptz NOT NULL
```

**Changed**

| Table | Change |
| --- | --- |
| `shopping_list_items` | `+ grocery_key text NULL` (FK to `grocery_items.key`, `ON DELETE SET NULL`); merge index becomes `(plan_id, COALESCE(grocery_key, normalised_name), COALESCE(unit, ''))` |
| `plan_entries` | drop `uq_plan_entries_slot`; add partial unique `(plan_id, date, meal, recipe_id) WHERE recipe_id IS NOT NULL` |
| `food_type_enum` | `+ guarnicion` |

`recipes.ingredients` JSONB is **unchanged**. Lines resolve to `grocery_items` by normalised name —
a soft join, not a hard FK, so merging or renaming a vocabulary row never has to rewrite recipes
transactionally.

New enums use `values_callable` so the stored value is the lowercase one, per `MealPlanModel.status`'s
comment. `food_type_enum` is the exception that stays uppercase — changing it now is a data migration
for no behavioural gain.

**New routes** — each needs a matching `addRoutes()` in `lambda-api-stack.ts`, guarded by
`tests/integration/test_gateway_routes_match.py`:

```
POST /ingredients/parse          free text + servings  → structured lines
GET  /grocery-items              the vocabulary (autocomplete + the review table's combobox)
GET  /plan/pairings?recipe_id=   §5.5, last
```

---

## 9. Phases

Ordered so each one is useful on its own, and so nothing is built that a later phase throws away.

| | What | Ships without an API key |
| --- | --- | --- |
| **A** | `grocery_items` + the 400–600 row seed + the aisle enum. No AI, no UI. | ✓ |
| **B** | Shopping list sorts by aisle; manual add autocompletes; `Frecuentes` chips. **First visible win.** | ✓ |
| **C** | Slots hold a flat list; `guarnicion` + its icon and copy; per-slot servings stepper. | ✓ |
| **D** | The parser: port, adapter, failover, the box and the review table in `RecipeForm`. | — |
| **E** | Quick-create from the slot (reuses D's box). | ✓ — degrades to raw rows |
| **F** | Backfill the 111 existing lines through D's parser — see §9.1. ✅ `scripts/restructure_ingredients.py` | — |
| **G** | Pairing memory (§5.5). | ✓ — **deferred to v2**, roadmap item 13 |

**§6.1 was the phase table's blind spot.** It sat inside §6 rather than in a phase row, so B shipped
"the shopping list sorts by aisle" with a client-side name lookup and nothing failed. The lesson for
F and G: a specified change with no phase row is a change nobody notices is missing.

**F after A**, deliberately: the backfill links rows to a vocabulary that must already exist, and it
fixes amounts and identities in one pass. `backfill_ingredients.py` then never needs finishing —
roadmap §9 predicted exactly this sequencing bonus.

**B before D** means the aisle sorting is proven against seeded data before any model is involved. If
the parser were first, a bad sort and a bad parse would be indistinguishable.

**E turned out not to need a key after all.** It reuses §4's box, and §4's box already falls back to
one raw editable row per line when no provider answers — so a dish invented in a slot still reaches
the shopping list with the model down. The table above said `—` on the strength of the dependency
rather than the behaviour.

---

### 9.1 The 19 recipes that already exist

**Three things are wrong with the 111 existing ingredient lines. Only two of them can be fixed by
machine, and the third must be left alone on purpose.**

| | Lines | Fix |
| --- | --- | --- |
| Quantity hidden inside the name — `"3 huevos"` | **62** (56%) | the parser splits it |
| No identity — nothing links the line to a shelf | **111** (all) | the matcher resolves it |
| The recipe has no `servings` | **79** (71%) | **nothing. Deliberately.** |

The third is not an oversight. [Planner plan](./meal-planner-plan.md) §3 already ruled on it —
*"forcing a headcount onto a recipe written without one invents data"* — and the code is already
built for it: `scaleIngredients` falls back to a factor of 1 and says why in a comment. A backfill
that guessed `servings: 4` would turn "we don't know" into confident wrong numbers on the shopping
list, which is worse than the honest gap. Those recipes get a headcount the next time somebody edits
them and the form asks.

**The invariant that makes this safe: the backfill should create zero new `grocery_items` rows.**
§3.6 builds the seed partly *from* these 111 lines, so by the time the backfill runs, every name in
them is already vocabulary. If it wants to create a row, that is a signal, not a result — either the
seed missed something real or the parser is misreading a line, and both deserve a human look. Worth
asserting in the script's output rather than leaving as a hope.

**Shape: the same one `backfill_ingredients.py` documented** (deleted 2026-09-18) — dry run by default, printing
every proposed change, with anything it cannot parse confidently left untouched and listed under
SKIPPED for a person to fix by hand. That script is not extended; it is **deleted and replaced**,
because the regex it was built around is precisely what the parser makes unnecessary.

```
uv run python -m scripts.restructure_ingredients          # dry run — writes nothing
uv run python -m scripts.restructure_ingredients --apply  # writes
```

**Idempotent.** A line that already has an amount, a unit and a resolved key is skipped, so re-running
after hand-fixing the SKIPPED handful only touches what is left. Read the dry run before applying;
against production, read it twice — it rewrites rows in place and the only undo is a Neon branch
restore.

Cost of the whole run: 19 recipes ≈ **$0.015**.

> **Built 2026-09-18 as `scripts/restructure_ingredients.py`.** Three things the sketch above did
> not pin down, all of them refusals:
>
> **The zero-new-rows invariant is enforced, not asserted.** The grocery repository is wrapped
> read-only for the whole run, so the use case's normal behaviour — create the row, it is a word the
> app has now seen — cannot happen here. A recipe whose parse proposed anything is SKIPPED with the
> names printed. That behaviour is right in the app, where somebody is looking at the screen, and
> wrong in a script, where a row invented from one misread line sorts an ingredient into the wrong
> aisle forever.
>
> **A parse that comes back shorter than it went in is refused.** Longer is normal and wanted —
> `"aceite, sal, pimienta"` is one line in and three out — but shorter means something was dropped,
> and a silently shorter ingredient list is the failure nobody notices until they are cooking.
>
> **`--apply` writes the previous state to a timestamped JSON file first.** §9.1 said the only undo
> was a Neon branch restore; that was true and it did not have to be. 19 recipes is a few kilobytes.
>
> Idempotency turned out to need no state: a recipe is already done when every ingredient name
> resolves to a vocabulary key, which is a dictionary lookup and therefore free. `400g espaguetis`
> cannot resolve — the amount is inside the name — which is exactly the condition being fixed.

**Existing shopping lists need no migration at all**, and that falls out of §6.1 rather than being a
separate decision. The aisle join is on `COALESCE(grocery_key, normalised_name)` — and
`normalised_name` is *already stored in the vocabulary's key format*, because both come from the same
`normalise_ingredient_name`. So a legacy line reading `huevos` finds the `huevos` row and sorts into
Lácteos with no backfill, no new column written and no closed week rewritten. Lines whose name matches
nothing fall to `other`, which is where an unrecognised thing belongs anyway.

That also covers the gap between phases: recipes written after the seed but before **D** still use the
old form, and they degrade the same graceful way.

## 10. Deferred, with triggers

| | Trigger to revisit |
| --- | --- |
| **Voice capture.** Web Speech API is the cheap first try — ~40 lines, no backend, but it is a W3C *Community Group draft*, unsupported in Firefox, and **Safari auto-stops recognition mid-list**. Server-side Whisper is the escalation: better accuracy, fractions of a cent per dictation, but needs audio capture, an upload path and another provider. | The ingredients box is in daily use and typing is measurably the slow part. **Both write into the same textarea, so neither is wasted work** — which is why waiting costs nothing. |
| **Retrieval instead of sending the whole vocabulary** (§4.3). | Past ~1,500 rows, or past ~4s per call. |
| **Per-kitchen `is_pantry` override** (§3.4). | Two kitchens disagree often enough that the one-tap cost annoys somebody. |
| **Per-kitchen favourite star** for manual add (§6.2). | History-based ranking demonstrably puts the wrong things first. |
| **Per-dish servings override** in the UI (§5.4). | Somebody actually wants rice for four and meat for two, more than once. |
| **Reordering dishes within a slot** — no `position` column until then (§5.2). | Somebody asks. |
| **Splitting `household` into droguería and perfumería** (§3.3). | One enum value, whenever the aisle feels too broad in a real shop. |
| **Photo and URL/TikTok import** — roadmap §9's other two extensions. | After the text path is in daily use; the parser and review table are already the hard half. |
| **Prices and a supermarket catalogue** — [roadmap](./future-roadmap.md) item 10, untouched by this plan. | Unchanged: once the planner exists and you know whether you miss it. |

## Cross-links

- [`./meal-planner-plan.md`](./meal-planner-plan.md) — §3 measured the blocker this closes; §4.6 is the confirm popup §3.4 leans on; §8.12 is the kitchen this inherits
- [`./future-roadmap.md`](./future-roadmap.md) — item 9 is this plan; item 10 stays deferred
- [ADR 0007](../adr/0007-a-dish-is-a-recipe-without-instructions.md) — one entity, and why §5.3 is a `food_type` rather than a section
- [ADR 0001](../adr/0001-ingredient-scaling-by-servings.md) — scaling by servings, which §5.4 depends on
- [ADR 0003](../adr/0003-geoapify-as-places-provider.md) — the provider port/adapter shape §7.2 mirrors
