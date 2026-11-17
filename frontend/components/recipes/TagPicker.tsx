"use client";

import type { RecipeTag } from "@/lib/api-client";
import { RECIPE_TAGS, QuickIcon, QUICK_MINUTES } from "@/lib/recipe-tags";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { Chip } from "@/components/ui/Chip";

/**
 * What a recipe is like, as toggles (ADR 0009 §7). The model proposes them on
 * import; this is where the person corrects it — a soup marked 🍱 is one tap.
 *
 * The app's own toggle pill (`Chip`), the one the filters use.
 *
 * ⚡ quick is shown, not offered: it is the times talking, so it appears and
 * disappears as they change, with a word on where it comes from.
 */
export function TagPicker({ value, onChange, quick }: { value: RecipeTag[]; onChange: (next: RecipeTag[]) => void; quick: boolean }) {
  const { t } = useI18n();
  const toggle = (tag: RecipeTag) => onChange(value.includes(tag) ? value.filter((v) => v !== tag) : [...value, tag]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {RECIPE_TAGS.map(({ value: tag, icon: Icon }) => {
          const on = value.includes(tag);
          return (
            <Chip key={tag} active={on} onClick={() => toggle(tag)}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {t(`recipe-tags.${tag}`)}
            </Chip>
          );
        })}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <QuickIcon className={`h-3.5 w-3.5 shrink-0 ${quick ? "text-amber-700 dark:text-amber" : ""}`} aria-hidden />
        {quick ? t("recipe-form.quick-on", { max: QUICK_MINUTES }) : t("recipe-form.quick-hint", { max: QUICK_MINUTES })}
      </p>
    </div>
  );
}
