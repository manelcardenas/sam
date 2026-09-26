"use client";

import type { Cuisine } from "@/lib/api-client";
import { cuisineAccent } from "@/lib/cuisines";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";

/**
 * The fields every way of adding or editing a restaurant shares — price and
 * cuisine — so the edit form and the add-from-where-you-are flow cannot drift
 * into two versions of the same question.
 */

export type PriceLevel = 1 | 2 | 3 | 4;

export const fieldClass =
  "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

export const labelClass = "mb-1.5 block text-sm font-semibold text-fg";

/** "120 m" / "1.4 km" for nearby results. */
export function formatDistance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * OSM tags that unambiguously mean one of the curated cuisines. The tags are a
 * folksonomy — a real sample of 19 places around the Sagrada Família carried
 * "tapas", "tex-mex" and "burger", none of which is a vocabulary name — so an
 * exact match alone prefills almost nothing. Only tags with one honest answer
 * are listed: "noodle" or "asian" could be three cuisines and stay unmatched.
 */
const TAG_ALIASES: Record<string, string> = {
  tapas: "Spanish",
  paella: "Spanish",
  catalan: "Spanish",
  basque: "Spanish",
  pizza: "Italian",
  pasta: "Italian",
  sushi: "Japanese",
  ramen: "Japanese",
  "tex-mex": "Mexican",
  tacos: "Mexican",
  burrito: "Mexican",
  burger: "American",
  greek: "Mediterranean",
  lebanese: "Mediterranean",
  "dim sum": "Chinese",
  curry: "Indian",
  vegan: "Vegan/Vegetarian",
  vegetarian: "Vegan/Vegetarian",
};

/**
 * The curated cuisines a provider's tags name — directly ("italian") or by an
 * unambiguous alias ("pizza"). Anything else is dropped rather than guessed at;
 * it is a prefill you can untick, not a classification.
 */
export function matchCuisines(providerTags: string[], options: Cuisine[]): string[] {
  const wanted = new Set(providerTags.map((tag) => TAG_ALIASES[tag] ?? tag));
  return options.filter((c) => wanted.has(c.name) || wanted.has(c.name.toLowerCase())).map((c) => c.name);
}

export function PricePicker({ value, onChange }: { value: PriceLevel | null; onChange: (next: PriceLevel | null) => void }) {
  const { t } = useI18n();
  return (
    <div>
      <span className={labelClass}>
        {t("restaurant-form.price-level")} <span className="font-normal text-muted">{t("common.optional")}</span>
      </span>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label={t("restaurant-form.price-level")}>
        {([1, 2, 3, 4] as const).map((level) => {
          const selected = value === level;
          return (
            <button
              key={level}
              type="button"
              aria-pressed={selected}
              aria-label={t("dine-filters.price-level", { level })}
              onClick={() => onChange(selected ? null : level)}
              className={`cursor-pointer rounded-2xl border-2 py-3 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40 ${
                selected ? "border-tomato bg-tomato/10 text-fg shadow-pop" : "border-line text-muted hover:border-tomato/40 hover:text-fg"
              }`}
            >
              {"€".repeat(level)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CuisinePicker({
  options,
  value,
  onChange,
}: {
  options: Cuisine[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useI18n();
  if (options.length === 0) return null;
  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((c) => c !== name) : [...value, name]);

  return (
    <div>
      <span className={labelClass}>
        {t("restaurant-form.cuisine")} <span className="font-normal text-muted">{t("restaurant-form.cuisine-hint")}</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((c) => {
          const selected = value.includes(c.name);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={selected}
              onClick={() => toggle(c.name)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40 ${
                selected ? "border-tomato bg-tomato/10 text-fg" : "border-line text-muted hover:border-tomato/40 hover:text-fg"
              }`}
            >
              {/* The colour the place will wear on the map and its card. */}
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cuisineAccent(c.name) }} />
              {t(`cuisines.${c.name}` as MessageKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
