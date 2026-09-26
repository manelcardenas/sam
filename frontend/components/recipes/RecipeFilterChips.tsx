"use client";

import type { Recipe } from "@/lib/api-client";
import { AuthorSelect } from "@/components/ui/AuthorSelect";
import { Chip, ClearChip } from "@/components/ui/Chip";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";
import { authorsOf, categoriesOf, isNarrowed, type RecipeFilterState } from "@/lib/recipe-filters";

/**
 * The filter row for a list of recipes: who added it, then what kind it is.
 *
 * One component for `/dashboard` and the planner's slot picker, so a filter
 * added here exists on both. It derives everything it can offer from the recipes
 * it is given, which is what keeps it honest: no control can appear that matches
 * nothing, on either surface, without a per-page list of exceptions.
 *
 * **"Created by" leads the row, and it is the only thing here with a label.**
 * Two reasons. It is the broader cut — whose recipes, before what kind — so it
 * reads left to right as a sentence. And a horizontally scrolling row of bare
 * pills never says what it *is*; putting the one labelled control first means the
 * row introduces itself, which is what makes the filter findable rather than
 * something you discover by accident.
 *
 * **Groups render only when they can distinguish something.** One category, or
 * one author, means the control can only select the whole list — the Bebida dead
 * end in a different costume. A small collection therefore gets no row at all and
 * the picker stays a search box, which is the right shape at that size.
 */
export function RecipeFilterChips({
  recipes,
  state,
  onChange,
  currentUserId,
}: {
  /** The *unfiltered* collection — what can be offered, not what is shown. */
  recipes: Recipe[];
  state: RecipeFilterState;
  onChange: (next: RecipeFilterState) => void;
  currentUserId: string | null;
}) {
  const { t, locale } = useI18n();

  const categories = categoriesOf(recipes);
  const authors = authorsOf(recipes, currentUserId, locale);

  const showCategories = categories.length > 1;
  const showAuthors = authors.length > 1;
  if (!showCategories && !showAuthors) return null;

  return (
    <>
      {showAuthors && (
        <AuthorSelect
          label={t("common.created-by")}
          authors={authors}
          selected={state.authors}
          onChange={(next) => onChange({ ...state, authors: next })}
          currentUserId={currentUserId}
        />
      )}

      {showAuthors && showCategories && (
        <span className="mx-0.5 h-5 w-px shrink-0 self-center bg-line" aria-hidden />
      )}

      {showCategories &&
        categories.map((c) => (
          <Chip
            key={c.value}
            active={state.category === c.value}
            onClick={() => onChange({ ...state, category: state.category === c.value ? null : c.value })}
          >
            <c.icon className="h-3.5 w-3.5" aria-hidden />
            {t(`food-types.${c.value}.label` as MessageKey)}
          </Chip>
        ))}

      {isNarrowed(state) && <ClearChip onClick={() => onChange({ q: "", category: null, authors: [] })} />}
    </>
  );
}
