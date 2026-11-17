"use client";

import { ChevronRight, Lock } from "lucide-react";
import { FOOD_TYPES } from "@/lib/constants";
import { isQuick, QuickIcon, tagIcon } from "@/lib/recipe-tags";
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
      className="group flex w-full cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border border-line bg-surface px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-paw focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105"
        style={{ backgroundColor: `${type.accent}1F`, color: type.accent }}
      >
        <Icon className="h-5 w-5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-display font-semibold text-fg transition-colors group-hover:text-accent">
          {recipe.title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {t(`food-types.${type.value}.label`)} · {tp("recipe-row.ingredients", count)}
          {meta ? ` · ${meta}` : ""}
        </span>
      </span>

      <RecipeMarks recipe={recipe} />

      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent"
        aria-hidden
      />
    </button>
  );
}

/**
 * A recipe's tags as small icons at the end of its row — quick first, then the
 * tags, then the lock of a kitchen-only recipe — so a list can be scanned for
 * "something for the tupper" without opening anything. Three at most, then a
 * count: a row is not where a recipe describes itself in full.
 */
export function RecipeMarks({ recipe }: { recipe: Recipe }) {
  const { t } = useI18n();
  const marks = [
    ...(isQuick(recipe) ? [{ key: "quick", icon: QuickIcon, label: t("recipe-tags.quick") }] : []),
    ...(recipe.tags ?? []).map((tag) => ({ key: tag, icon: tagIcon(tag), label: t(`recipe-tags.${tag}`) })),
  ];
  const shown = marks.slice(0, 3);
  const kitchenOnly = recipe.visibility === "kitchen";
  if (shown.length === 0 && !kitchenOnly) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-muted">
      {shown.map(({ key, icon: Icon, label }) => (
        <span key={key} title={label}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{label}</span>
        </span>
      ))}
      {marks.length > shown.length && <span className="text-xs font-semibold tabular-nums">+{marks.length - shown.length}</span>}
      {kitchenOnly && (
        <span title={t("recipe-form.kitchen-only")}>
          <Lock className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{t("recipe-form.kitchen-only")}</span>
        </span>
      )}
    </span>
  );
}
