"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { Minus, Plus, Users } from "lucide-react";
import type { IngredientItem, IngredientsData } from "@/lib/api-client";

/** Flat rounding to 2 decimals, no unit-aware whole-number logic — see docs/adr/0001. */
function scale(amount: number, baseServings: number, desiredServings: number): number {
  return Math.round(((amount / baseServings) * desiredServings) * 100) / 100;
}

function formatItem(item: IngredientItem): string {
  if (item.amount == null) return item.name;
  const amount = Number(item.amount.toFixed(2));
  return item.unit ? `${amount} ${item.unit} ${item.name}` : `${amount} ${item.name}`;
}

/** Renders a recipe's ingredient list with a live "adjust servings" control.
 * Recalculation is purely client-side and never persisted — the stored
 * recipe always stays at its original `servings`/`amount` values. */
export default function IngredientsPanel({ ingredients }: { ingredients: IngredientsData }) {
  const { t } = useI18n();
  const baseServings = ingredients.servings;
  const [desiredServings, setDesiredServings] = useState(baseServings ?? 1);

  const items = ingredients.items.map((item) =>
    item.amount != null && baseServings
      ? { ...item, amount: scale(item.amount, baseServings, desiredServings) }
      : item,
  );

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
          {t("ingredients-panel.heading", { count: ingredients.items.length })}
        </h2>

        {baseServings && (
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface-2 py-1 pl-2.5 pr-1">
            <Users className="mr-1 h-3.5 w-3.5 text-muted" />
            <button
              type="button"
              onClick={() => setDesiredServings((s) => Math.max(1, s - 1))}
              aria-label={t("ingredients-panel.fewer-servings")}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-accent/15 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <Minus className="h-3 w-3" />
            </button>
            <input
              type="number"
              min={1}
              step={1}
              value={desiredServings}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                setDesiredServings(Number.isFinite(n) && n >= 1 ? n : 1);
              }}
              aria-label={t("ingredients-panel.servings-count")}
              className="w-9 bg-transparent text-center text-sm font-semibold text-fg focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={() => setDesiredServings((s) => s + 1)}
              aria-label={t("ingredients-panel.more-servings")}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-accent/15 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <Plus className="h-3 w-3" />
            </button>
            <span className="pr-1 text-xs text-muted">{t("ingredients-panel.servings")}</span>
          </div>
        )}
      </div>

      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className={`flex items-start gap-2.5 ${item.optional ? "text-muted" : "text-fg/90"}`}>
            {/* An optional ingredient gets a hollow dot and the word: it is
                there, but it starts unticked on the list. */}
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${item.optional ? "border border-accent" : "bg-accent"}`} />
            <span>
              {formatItem(item)}
              {item.optional && <span className="ml-1.5 text-xs font-semibold">· {t("recipe-form.optional").toLowerCase()}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
