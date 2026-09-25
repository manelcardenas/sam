# The data model

> **What this is.** Every table, who creates rows in it, and — the part that actually causes
> confusion — **which links are live and which are snapshots**. Written 2026-09-18, after
> "I'm a bit lost about which tables we have and the relations between them".
>
> The single most useful thing here is §5. Most surprises in this app ("I changed the servings and
> the shopping list didn't move") are a snapshot boundary doing exactly what it was built to do.

---

## 1. Three worlds and one vocabulary

The app is three mostly-independent products sharing a `users` table:

```
   COOK                    DINE                     PLAN
   recipes                 restaurants              kitchens
                           reviews                  kitchen_members
                           cuisines                 meal_plans
                           restaurant_cuisines      plan_entries
                                                    shopping_list_items
                                                    list_item_sources

                          ─── grocery_items ───
              a vocabulary both COOK and PLAN read, and nothing owns
```

COOK and PLAN meet in exactly one place: a `plan_entries` row may point at a `recipes` row.
DINE touches neither.

---

## 2. The tables

### `users`
Cognito's `sub` is the primary key — there is no local password, no local id. A row is written
**JIT on first authenticated request** from the `email` claim in the ID token; `display_name` stays
NULL until the profile is completed. Everything else in the database points here.

### COOK

| Table | What one row is | Created by |
| --- | --- | --- |
| `recipes` | A thing you can cook | The recipe form in `/cook`, **or** quick-create inside a plan slot |

`recipes.ingredients` is **JSONB**, not a table:
`{"servings": 4, "items": [{"name": "espaguetis", "amount": 400, "unit": "g"}]}`.
It is never queried by shape, only read whole, and a row per ingredient would buy joins nobody makes.

`instructions IS NULL` means the row is a **dish** rather than a recipe (ADR-0007). It is derived
state, not a `kind` column — writing the method in promotes it, with nothing to keep in sync.

`food_type` ∈ `comida · bebida · postre · aperitivo · guarnicion`. `guarnicion` is how `Arroz blanco`
lives in the collection without a second table (ingredient-capture-plan §5.3).

> **Careful:** `food_type_enum` stores the *uppercase member names* (`COMIDA`) because that is how it
> was first created. Every enum added since stores lowercase values. `models.py` explains why it was
> left alone.

### DINE

| Table | What one row is | Created by |
| --- | --- | --- |
| `restaurants` | A venue, mapped to Geoapify or not | Anyone; facts are editable by anyone (ADR-0002) |
| `reviews` | One visit, four 0–10 scores | Anyone, repeatedly — revisits are the point |
| `cuisines` | A curated vocabulary | A data insert, not a migration |
| `restaurant_cuisines` | Many-to-many join | Set with the restaurant |

`external_place_id` is unique **only when not NULL** (partial index), so two people picking the same
Place concurrently cannot create two rows, while hand-added venues stay unconstrained.

### PLAN

| Table | What one row is | Created by |
| --- | --- | --- |
| `kitchens` | A household | Lazily, on your first plan |
| `kitchen_members` | One person's relationship to one kitchen | Invitation, acceptance, leaving |
| `meal_plans` | One kitchen's week (Sat→Fri) | Lazily, on the first dish assigned to that week |
| `plan_entries` | **One dish in one slot**, for a headcount | Assigning in the slot sheet |
| `shopping_list_items` | One merged line on the list | "Add to the list", or typed by hand |
| `list_item_sources` | *Which dish* put how much on that line | Written with the line above |

`kitchens` has **no columns of its own** beyond an id and a timestamp. No name, no owner, no
settings. It exists so a week can belong to the household rather than to one of the two people in it.

`kitchen_members` is invitations, membership and history in one table, because they are the same fact
at three points in time: `accepted_at IS NULL` is an outstanding invitation, `left_at IS NOT NULL` is
somebody who moved out, and the rest is the household. A partial unique index enforces **one active
kitchen per person** while letting you hold an invitation and still live in your own.

`plan_entries` — a slot is `(plan, date, meal)` and it holds a **flat list** of dishes. There is no
main and no side: "ensalada con pollo" has no answer to which is which (§5.1). The unique index is
partial on `recipe_id IS NOT NULL`, so one recipe cannot be added twice to a slot, while several
one-off text entries can share one.

### The vocabulary

| Table | What one row is | Created by |
| --- | --- | --- |
| `grocery_items` | **One buyable thing**, with no quantity, ever | Seeded (274 rows); proposed by the parser; filed by hand from the list; aisle corrected by anyone; edited or deleted (non-seed only) by admins; a confirmed row is never touched by re-seeding |

Keyed on `normalise_ingredient_name(name_es)` — lowercase, whitespace-collapsed, diacritics stripped.
**No foreign keys point into it and none point out of it.** Recipes and list lines match it by
*name*, so nothing cascades and legacy rows need no migration.

It holds detergent, which is why it is not called `ingredients`. It carries `aisle` (11 values, in
walking order, not alphabetical), `is_pantry`, `default_unit`, and three names — `name_es` /
`name_ca` / `name_en` — which exist for **merging**, not translation: without them `huevos` and
`eggs` are two lines on one shopping list.

---

## 3. The four ways to put food on a Tuesday

They are genuinely different, and the difference is *what reaches the shopping list*:

| | Where you do it | Makes a `recipes` row | Ingredients | Reaches the list |
| --- | --- | --- | --- | --- |
| **Recipe** | `/cook` → new recipe | yes | yes | yes |
| **Quick-create** | slot sheet → "Create …" | yes (`guarnicion` by default) | yes | yes |
| **One-off text** | slot sheet → type, "Add to the week" | **no** | none | **no** |
| **Manual extra** | shopping list → "Add something else" | no | — | yes, as a line with no dish |

The third is not a mistake — it is the right answer for *Sobras*, *Cena fuera*, *Pizza congelada*.
But it is also the trap: typing `arroz` there is faster than anything else on the screen and buys no
rice. That is the entire reason quick-create exists.

---

## 4. The chain, and where the copies happen

```
  recipes                    plan_entries                shopping_list_items
  ─────────                  ────────────                ───────────────────
  title          ──copy──▶   dish_name
  id             ──FK────▶   recipe_id  (SET NULL)
  ingredients                servings
    .servings  ─┐
    .items     ─┴──── scaleIngredients(items, entry.servings / recipe.servings)
                             │                           display_name
                             │        "Add to the list"   normalised_name  ◀── merge key
                             └──────────────────────────▶ total_amount     (summed)
                                                          unit
                                                             ▲
                                                             │
                                                    list_item_sources
                                                      entry_id   (SET NULL)
                                                      dish_name  (copy)
                                                      amount     (this dish's share)
```

**Scaling happens in the browser, at add-to-list time** (ADR-0001). The backend never multiplies
anything; it receives already-scaled numbers and merges them. A recipe with no `servings` is passed
through unscaled rather than guessed at.

**Merging** is on `(plan_id, normalised_name, COALESCE(unit,''))`. So 400 g + 200 g of espaguetis is
one line of 600 g; `2 cebollas` and `200 g cebolla` stay two lines, because there is deliberately no
unit conversion. `sal` with no amount merges with `sal` with no amount and stays amount-less — NULL
and 0 are different totals.

**`list_item_sources` is what makes any of this reversible.** It records each dish's contribution
separately, so removing a dish can subtract exactly its share (`drop_sources_for_entry`) and delete
the line only if nobody else wanted it — while a hand-added extra survives, because you put it there.

---

## 5. Live links vs snapshots — the table to read twice

| If you change… | …does this move? | |
| --- | --- | --- |
| Recipe title | `plan_entries.dish_name` on **future** writes only | past weeks keep what you ate |
| Recipe ingredients | Nothing already planned | the plan is a record, not a view |
| Delete a recipe | `plan_entries.recipe_id` → NULL, name survives | August is not erased in November |
| Slot headcount | `plan_entries.servings`, then the sheet **offers** to rebuild the list | asked, never silent — §4.5 |
| Tick a line | That line | nothing upstream |
| Remove a dish | Asks first, then subtracts its share | §4.5: the list never rewrites itself unasked |
| `grocery_items` aisle | Every list line, immediately | matched live by name, nothing stored |

The rule underneath all of it: **the plan is a record of what you ate, and the shopping list is a
working document you edit by hand.** Neither is a live projection of the recipe collection, because
both get hand-edited and a recomputation would erase that.

The headcount row is the one place the rule needed an exception: it is the single input whose entire
purpose is to change the amounts. It gets an ask rather than an automatic rewrite — see §6.

---

## 6. Two gaps — both closed 2026-09-18

**A. Changing the headcount left the shopping list at the old amounts.** ✅ Fixed. The slot sheet now
says so and offers to rebuild — *"La lista de la compra sigue con las cantidades de 2 personas"* ·
**Actualizar** · **Dejarlas** — and `PUT /plans/{plan_id}/entries/{entry_id}/items` replaces exactly
that dish's contribution, leaving other dishes' shares and hand-added extras alone.

A **banner rather than a dialog**, because 2 → 7 is five taps and one decision. It also keeps §4.5
literal: the list does not rewrite itself, it waits to be told, and "Dejarlas" is a real answer —
you may have shopped for two already and want the difference by hand.

**B. `ingredient-capture-plan.md` §6.1 was specified but never built.** ✅ Fixed.
`shopping_list_items.grocery_key` now exists, resolved server-side on write against **all three**
names, and the merge key is `COALESCE(grocery_key, normalised_name)`. Before the fix, aisle grouping
matched `normalised_name` against a vocabulary keyed on `key_for(name_es)` — so only Spanish ever
matched:

| Name stored on the line | Matches a vocabulary row? |
| --- | --- |
| `espaguetis`, `cebolla`, `tomate triturado` | yes |
| `Tomàquet triturat`, `Ceba` (captured while browsing in Catalan) | **no — 87% of rows** |
| `Spaghetti`, `Onion` (captured while browsing in English) | **no — 92% of rows** |
| `400g espaguetis` (a pre-Phase-D recipe) | **no** — still true, and what the backfill fixes |

Two consequences beyond the aisle: `huevos` and `eggs` are now **one line**, and a matched line
renders in each reader's own language — so one row is `Cebolla` to you and `Ceba` to whoever else is
in the kitchen.

**Existing lines were not rewritten.** The migration only sets the key where the name *already* is a
key, so the coalesced value is unchanged and no two rows can start sharing one. Cross-language
merging begins with the next write, which is also the honest behaviour: a line already on your list
is one you already decided about.

**Also fixed:** a pre-Phase-D recipe line like `400g espaguetis` has the amount inside the name and
so resolves to nothing. `backend/scripts/restructure_ingredients.py` runs those lines back through
the parser once — dry run by default, and it refuses to invent vocabulary or to write a recipe that
came back shorter than it went in.

---

## 7. Where to look in the code

| | |
| --- | --- |
| Tables | `backend/src/infra/db/models.py` — every column carries its reasoning |
| Migrations | `backend/alembic/versions/` |
| Merge key & normalisation | `backend/src/domain/entities/shopping_list.py` |
| List merge & unpick | `backend/src/infra/adapters/repos/postgres_meal_plan_repo.py` |
| Scaling (client-side) | `frontend/lib/plan-ingredients.ts` |
| Aisle lookup & grouping | `frontend/lib/grocery.ts` |
| The vocabulary seed | `backend/scripts/grocery_seed_data.py` |
