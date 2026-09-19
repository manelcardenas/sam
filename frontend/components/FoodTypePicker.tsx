"use client";

import { FOOD_TYPES, type FoodType } from "@/lib/constants";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";

/**
 * Which category a dish is — the one control `cook` and the planner share.
 *
 * Extracted from `RecipeForm` when quick-create landed in the slot sheet
 * (docs/plans/ingredient-capture-plan.md §5.3). Two copies of a grid keyed on
 * `FOOD_TYPES` would have drifted the first time a sixth category appeared:
 * `guarnicion` was the fifth, and it is what broke the old hard-coded
 * `grid-cols-4` into a ragged 4 + 1.
 *
 * **Five across at every width, not a wrap.** The row *is* the taxonomy — you
 * read it as a set of five and pick one — and a category stranded on its own
 * second line reads as a different kind of thing. At 375px that leaves ~60px a
 * tile, which clears the 44px touch target and still fits `Guarnición` at
 * `0.7rem`.
 */
export function FoodTypePicker({ value, onChange }: { value: FoodType; onChange: (next: FoodType) => void }) {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
      {FOOD_TYPES.map(({ value: candidate, icon: Icon, accent }) => {
        const selected = value === candidate;
        return (
          <button
            key={candidate}
            type="button"
            onClick={() => onChange(candidate)}
            aria-pressed={selected}
            style={selected ? { borderColor: accent, backgroundColor: `${accent}1f` } : undefined}
            className={`flex min-h-[4rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1 py-2.5 text-[0.7rem] font-semibold leading-tight transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40 ${
              selected ? "scale-105 text-fg shadow-pop" : "border-line text-muted hover:border-tomato/40 hover:text-fg"
            }`}
          >
            <Icon
              className="h-5 w-5 shrink-0"
              // The glyph takes the category's colour once selected, so the
              // choice reads from the icon as well as from the border.
              style={selected ? { color: accent } : undefined}
              aria-hidden
            />
            <span className="text-center [overflow-wrap:anywhere]">{t(`food-types.${candidate}.label` as MessageKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
