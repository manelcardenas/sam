"use client";

import { ChevronRight } from "lucide-react";
import { FOOD_TYPES } from "@/lib/constants";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { Recipe } from "@/lib/api-client";

/**
 * A recipe as a list row: category plate, title, one line of metadata.
 *
 * Extracted so `/profile` and `/dashboard` render the same row. They had two
 * different designs — the profile's carried a coloured plate and an ingredient
 * count, the dashboard's was a bare title with the author on the right — which
 * is the same inconsistency at row level that §2 is fixing at page level.
 *
 * The category's accent is carried onto the plate because it is what makes a
 * long list scannable by kind without adding a second line of text to every
 * item. The label repeats it in words underneath, so colour is never the only
 * signal.
 */
export function RecipeRow({
  recipe,
  meta,
  onClick,
}: {
  recipe: Recipe;
  /** Extra metadata for the second line, e.g. the author. Category and ingredient count are always shown. */
  meta?: string;
  onClick: () => void;
}) {
  const { t, tp } = useI18n();
  const type = FOOD_TYPES.find((f) => f.value === recipe.food_type) ?? FOOD_TYPES[0];
  const Icon = type.icon;
  const count = recipe.ingredients.items.length;

  return (
    <button
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border border-line bg-surface px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105"
        style={{ backgroundColor: `${type.accent}1F`, color: type.accent }}
      >
        <Icon className="h-5 w-5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-display font-semibold text-fg transition-colors group-hover:text-tomato">
          {recipe.title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {t(`food-types.${type.value}.label`)} · {tp("recipe-row.ingredients", count)}
          {meta ? ` · ${meta}` : ""}
        </span>
      </span>

      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-tomato"
        aria-hidden
      />
    </button>
  );
}
