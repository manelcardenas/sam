# A dish is a recipe without instructions — one entity, two lenses

The meal planner needs something to put in a calendar slot: a named thing with a list of
ingredients and a headcount those ingredients are sized for. That is almost exactly what `Recipe`
already is. The temptation was to add a second entity — `Dish` — on the grounds that the two are
conceptually different: a recipe is a complex thing you want written down, a dish is
"spaghetti bolognese, 400g mince, two onions, a tin of tomatoes" that you already know how to
cook and only care about because of what it puts on the shopping list.

We rejected the second entity, on one argument that settles it: **a complex recipe must also be
plannable.** Wanting paella on Saturday is not a different kind of wanting from wanting pasta on
Tuesday. If both can occupy a calendar slot, then a separate `Dish` table means every calendar
slot, every shopping-list aggregation, every API response and every picker in the UI handles two
shapes forever, in exchange for a distinction that is not structural. `Recipe` already carries
`Ingredients` with `servings` — "the headcount the ingredient amounts are sized for" — which is
the precise primitive the planner needs, and `ADR 0001` already established scaling by servings
as the way amounts are interpreted.

So there is one entity. `instructions` becomes nullable, and **the difference between a dish and
a recipe is whether anybody bothered to write the instructions down.** That is genuinely the
distinction as described, rather than a proxy for it.

The two surfaces become two lenses on one table. `/dashboard` shows entries **with**
instructions; the planner's picker shows everything. The property this buys, and the reason it
was preferred over an explicit `kind` column, is that **a dish graduates into a recipe by being
written up**: add lentejas to the planner as a bare ingredient list, work out months later how
you actually like making it, type the instructions in, and it appears in the recipe collection on
its own. No flag to set at creation time, when you least know the answer, and no migration when
you change your mind.

## Consequences

**Update 2026-09-07:** the Recipes / Dishes chip proposed in
[`../plans/ux-refresh-plan.md`](../plans/ux-refresh-plan.md) §2 was deliberately **not** built
with the rest of that section. The lens is derived from `instructions` being empty, but
`RecipeModel.instructions` is `NOT NULL` and `RecipeForm` requires the field — so all 19 recipes
in production have instructions and **zero are dishes** (checked against Neon, 2026-09-07). The
chip would be permanently empty, which is exactly the dead end §2 removed for the Bebida tile. It
ships when dishes can exist, i.e. with the planner.

The lens rule is **derived state, not a column** — "empty instructions means it is a dish". That
is simpler than a `kind` field and impossible to get out of sync, but it is invisible in the
schema, which is why it is written here. Anything that lists recipes must apply the filter
deliberately; `list_recipes` grows a parameter alongside the existing `created_by`.

`dashboard/page.tsx` renders an **Instructions** heading unconditionally, so an instruction-less
entry currently shows an orphan heading over nothing, and `RecipeForm` requires the field. Both
need to accept empty.

The migration is one `ALTER COLUMN instructions DROP NOT NULL`, and it is one-way in practice:
once instruction-less rows exist, the constraint cannot come back without deleting data.

**The cost this decision does not pay for itself is data quality.** Of 111 ingredient lines
across 19 recipes, `amount` is filled on 2 and `unit` on 1, while 56% of names *start with a
digit* — people write `"3 huevos"` in the name field. One entity makes the planner possible; it
does not make `"3 huevos"` add up to five eggs. That is a separate problem, addressed in
[`../plans/meal-planner-plan.md`](../plans/meal-planner-plan.md) §3, and it is the real blocker
rather than this modelling choice.
