# Meal plan redesign — Phase 1 (web, tested by hand, then on real Saturdays)

> **Status: In progress** — agreed 2026-11-17, reshaped the same day into two blocks. The
> decisions and their reasons are in
> [ADR-0009](../adr/0009-a-meal-is-recipes-products-and-notes.md); this file is what gets built
> and in which order. Phases 2 and 3 are in
> [`../todo/TODO_weekly-plan-redesign.md`](../todo/TODO_weekly-plan-redesign.md).

## Goal

Planning a week of simple meals should cost about as much as writing it on paper, and the list
should come out right. Two blocks, one after the other:

1. **Recipes.** Creating one (by text, link or photo, or a simple one by hand) must keep every
   ingredient, in the unit it is bought in, with the back-and-forth of editing made easy. Built
   first, because what a simple recipe looks like decides how the plan works.
2. **The plan.** Putting recipes, products and "we eat out" into the week, and getting one clean
   list out of it. Designed in detail once Block 1 has been tried.

Built in the current web app (ADR-0009 §9 explains the exception to ADR-0008).

## How Block 1 is tested

1. **By hand, locally:** the person who plans adds recipes of their own through the UI,
   including the awkward back-and-forth, and we adjust.
2. **Then on the real recipes** in production: re-import them and compare. Only after the flow
   is right, so the run is not wasted on a broken flow.

No model comparison up front: the model is `deepseek-flash` (cheap; text and photos; strict tool
schema). A heavier model is only tried if the hand test shows flash cannot do it.

## Block 1 — Recipes

Each item has its tests, its copy in `en`/`es`/`ca`, and passes the copy-fits e2e at 360 px in
Catalan. The UI is designed with the design skills to the repo's patterns (`components/ui/`,
the pastel palette), and is meant to carry over to Expo in spirit, not in code.

### 1.1 The model call · backend

- [ ] `deepseek-flash` through the existing OpenAI-compatible adapter
      (`infra/adapters/parsing/`), with a **strict tool schema** instead of prompt-and-parse.
      `LLM_PRIMARY_MODEL` moves from `deepseek-chat` (no longer listed by DeepSeek) once the new
      call is proven
- [ ] One schema for the whole recipe: title, servings (only if the text states it), prep and
      cook time, tags, method, and one ingredient row **per original line** with `source_line`,
      `name`, `amount`, `unit`, `optional`
- [ ] **Unit context:** before the call, each line is matched to the vocabulary by normalised
      name (no AI). The prompt gets each match's `default_unit` and how the kitchen's own
      recipes wrote it ("patata: g in 6 recipes"), with the rule "use that unit unless the text
      clearly says another"
- [ ] **Never fewer rows than lines:** a line the model drops comes back as a row holding only
      its text; a test proves it with a fake model that drops one
- [ ] **No vocabulary writes before save:** `POST /ingredients/parse` stops writing
      `source=ai` rows and returns proposals; saving the recipe writes them
- [ ] Rate limit: the new endpoint(s) join the firewall rule on paid endpoints

### 1.2 Three ways in · backend + frontend

- [ ] **Text:** pasted, sent to the model
- [ ] **Link:** fetched server-side (https only, no internal addresses, time and size limits);
      its `schema.org/Recipe` JSON-LD is read without AI when present, and its ingredient lines
      still go through the unit pass; without JSON-LD, the page text goes to the model
- [ ] **Photo:** sent to the model as an image and discarded; nothing stored

### 1.3 The review screen · frontend

- [ ] The original text alongside the rows (side by side on wide screens, a toggle on phones)
- [ ] Each row: name (with catalog suggestions while typing, no AI), amount, unit, optional,
      and under it the line it came from ("de: 1 cebolla grande picada")
- [ ] **Line counter:** "9 líneas → 9 ingredientes", and "(1 quitada por ti)" when you delete
- [ ] **"Separar"** a row ("sal y pimienta" → two)
- [ ] **Grams proposed** for products bought by weight when a line came in pieces ("4 patatas"
      → "≈ 800 g"), one tap to accept
- [ ] **Warning** when the method names an ingredient the list lacks, with "Añadir"
- [ ] **"Volver a leer"** after editing the original text: shows what changes ("1 ingrediente
      más, 1 menos") before replacing your rows
- [ ] **"¿Salir sin guardar?"** when leaving with changes. Drafts: later (Expo may change it)
- [ ] Nothing is saved, and nothing enters the vocabulary, until "Guardar"

### 1.4 Servings · frontend

- [ ] Required on new recipes. Empty unless the text states it, then prefilled and marked "leído
      del texto"
- [ ] **Changing it scales the amounts** (5 → 3: 500 g → 300 g), with a link right below —
      *"No, las cantidades ya eran para 3"* — that undoes the scaling and keeps the number. Same
      rule when editing a saved recipe

### 1.5 Simple recipes and optional ingredients · backend + frontend

- [ ] `recipes.visibility` (`public · kitchen`) and `kitchen_id`; `GET /recipes` returns public
      ones plus your kitchen's; another kitchen's simple recipe is a 404
- [ ] A **simple recipe** made by hand: title, servings default 1 ("por persona"), ingredients,
      optional ones, no method; saved as `kitchen`. Writing a method in later can make it public
- [ ] Ingredient `optional: bool` in the JSONB items; optional ones start **unticked** in the
      "add to the list" popup
- [ ] The recipe book marks simple recipes ("solo tu cocina")

### 1.6 Tags · backend + frontend

- [ ] `recipes.tags` from the fixed set: 🍱 tupper, 🔥 horno, 🌀 airfryer, 🥗 sin cocinar,
      ❄️ congelable, 🌶️ picante, 🍳 una sola sartén, ♨️ olla exprés. ⚡ rápida derived from
      total time ≤ 30 min, never stored
- [ ] Proposed by the model, editable in the form, shown in the recipe book and on the recipe

### 1.7 Units on the list · backend

- [ ] g↔kg and ml↔l merge into one line automatically (500 g + 1 kg = 1,5 kg). Lines in units
      that do not convert stay separate, which is acceptable now that capture keeps units
      consistent

### Later, recorded

- [ ] Tag the recipes that already exist: a one-off where the AI proposes and a person reviews
- [ ] Re-import the real recipes and compare, after the hand test

## Block 2 — The plan (designed after Block 1 is tried)

Decided already:

- **"No comemos en casa"** is a button on the meal, no typing. If only one person is out, lower
  the servings instead.
- **Cooking for later:** lentejas for 4 on Saturday, then Monday "Solo al calendario" with no
  ingredients; frozen canelones the same. This already works.
- **One search** in a meal: your kitchen's recipes, products, and "De otros". "Carne" (whatever
  the shop has) and "lomo ibérico" (for one dish) are both products.

To iterate on, with the simple recipes from Block 1 in hand:

- "Ensalada con carne" and "bocata de jamón": simple recipes picked in the plan, or built from
  products in the meal, or both. Whether "Guardar como receta" exists
- Whether a typical portion per product is still needed (ADR-0009 §3)
- Products with a store ("Tortilla · Mercadona")

## After Block 2 has been used for 2–3 Saturdays

Measured with read-only SQL on production against the weeks before:

| | Before (19 Sep → 7 Nov) | Target |
|---|---|---|
| Weeks with the calendar used | 3 of 8 | every week tested |
| Planned dishes that are free-text notes | ~⅓ | only leftovers, eating out, frozen |
| Products on the list twice, split by unit | 2 (carne, patata) | 0 |
| Dishes in a filled week that put nothing on the list | 8 (10 Oct, a retroactive diary) | only "Solo al calendario" and "no comemos en casa" |

And one question for the person who plans: **did planning the week feel quicker than before?**

## Not in Phase 1

Drag and drop, the "Sin día" tray, moving between weeks, emojis per ingredient, supermarket
products and prices, photos as content (all Phase 2, Expo); the AI filling the week (Phase 3).
The deferred list with triggers is at the end of ADR-0009.
