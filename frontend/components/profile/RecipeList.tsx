"use client";

import { BookOpen, ChevronRight, SearchX } from "lucide-react";
import { Chip, ClearChip } from "@/components/ui/Chip";
import { NarrowRow } from "@/components/profile/NarrowRow";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import { FOOD_TYPES, type FoodType } from "@/lib/constants";
import type { Recipe } from "@/lib/api-client";

/**
 * Your recipes, narrowable by name and category.
 *
 * Rows open `/dashboard?category=…&recipe=…`, **not** `/recipes?id=…` as
 * before. That was §1c of the plan: `/recipes` is a second recipe-detail
 * surface with its own navigation that never adopted `UserProvider`, so
 * tapping your own recipe from your profile used to land you somewhere slower
 * with a different back behaviour. `/dashboard` is the one that got the URL and
 * latency work.
 *
 * `category` rides along in that link so backing out of the recipe lands on the
 * matching dashboard list rather than at the top.
 */
export function RecipeList({
  recipes,
  q,
  category,
  onQueryChange,
  onCategoryChange,
  onOpen,
  onCreate,
}: {
  recipes: Recipe[];
  q: string;
  category: FoodType | null;
  onQueryChange: (next: string) => void;
  onCategoryChange: (next: FoodType | null) => void;
  onOpen: (recipe: Recipe) => void;
  onCreate: () => void;
}) {
  const needle = q.trim().toLowerCase();
  const shown = recipes.filter(
    (r) =>
      (!category || r.food_type === category) &&
      (!needle || r.title.toLowerCase().includes(needle)),
  );

  // Only categories you actually have — an empty chip is a dead end, the same
  // rule the dine filters follow for cuisines.
  const present = FOOD_TYPES.filter((c) => recipes.some((r) => r.food_type === c.value));
  const narrowed = Boolean(needle || category);

  if (recipes.length === 0) {
    return (
      <EmptyPanel
        icon={<BookOpen className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden />}
        title="No recipes yet."
        body="Anything you write up shows here, and stays yours to edit."
        actionLabel="Write your first one"
        onAction={onCreate}
      />
    );
  }

  return (
    <>
      <NarrowRow
        q={q}
        onQueryChange={onQueryChange}
        placeholder="Search your recipes…"
        ariaLabel="Search your recipes by title"
        resultCount={shown.length}
        noun="recipe"
        chips={
          <>
            {present.map((c) => (
              <Chip
                key={c.value}
                active={category === c.value}
                onClick={() => onCategoryChange(category === c.value ? null : c.value)}
              >
                <c.icon className="h-3.5 w-3.5" aria-hidden />
                {c.label}
              </Chip>
            ))}
            {narrowed && (
              <ClearChip
                onClick={() => {
                  onQueryChange("");
                  onCategoryChange(null);
                }}
              />
            )}
          </>
        }
      />

      {shown.length === 0 ? (
        <EmptyPanel
          icon={<SearchX className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden />}
          title="Nothing matches that."
          body="Try a shorter word, or drop the category."
          actionLabel="Clear"
          onAction={() => {
            onQueryChange("");
            onCategoryChange(null);
          }}
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((recipe, i) => {
            const meta = FOOD_TYPES.find((f) => f.value === recipe.food_type) ?? FOOD_TYPES[0];
            const Icon = meta.icon;
            return (
              <li
                key={recipe.id}
                // Stagger capped: past the first screenful the cascade reads as lag.
                className={i < 8 ? "will-fetch animate-fetch-in" : undefined}
                style={i < 8 ? { animationDelay: `${i * 45}ms` } : undefined}
              >
                <button
                  onClick={() => onOpen(recipe)}
                  className="group flex w-full cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border border-line bg-surface px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  {/* The category's own colour, as a tinted plate. Carrying the
                      accent onto the row is what makes a long list scannable by
                      kind without adding a second line of text to every item. */}
                  <span
                    aria-hidden
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105"
                    style={{ backgroundColor: `${meta.accent}1F`, color: meta.accent }}
                  >
                    <Icon className="h-5 w-5" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display font-semibold text-fg transition-colors group-hover:text-tomato">
                      {recipe.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {meta.label} · {recipe.ingredients.items.length} ingredient
                      {recipe.ingredients.items.length === 1 ? "" : "s"}
                    </span>
                  </span>

                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-tomato"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
