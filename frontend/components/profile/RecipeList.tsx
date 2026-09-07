"use client";

import { BookOpen, SearchX } from "lucide-react";
import { Chip, ClearChip } from "@/components/ui/Chip";
import { NarrowRow } from "@/components/ui/NarrowRow";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import { RecipeRow } from "@/components/recipes/RecipeRow";
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
          {shown.map((recipe, i) => (
            <li
              key={recipe.id}
              // Stagger capped: past the first screenful the cascade reads as lag.
              className={i < 8 ? "will-fetch animate-fetch-in" : undefined}
              style={i < 8 ? { animationDelay: `${i * 45}ms` } : undefined}
            >
              <RecipeRow recipe={recipe} onClick={() => onOpen(recipe)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
