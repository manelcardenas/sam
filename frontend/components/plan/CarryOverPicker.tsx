"use client";

import { Check } from "lucide-react";
import type { ShoppingListItem } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * What you didn't get, offered to next week — shown inside the "Done shopping"
 * confirmation (docs/plans/meal-planner-plan.md §8.11).
 *
 * **This lives in the confirm rather than after it** because closing the list is
 * one-way. Once the plan is `list_closed` every write is refused, so a
 * carry-over asked about afterwards would have nowhere to read the lines from —
 * and one asked about *before* is the last moment the question can still be
 * answered honestly.
 *
 * Everything starts ticked. The common reason a line is unbought is that the
 * shop was out of it, which is exactly the case for bringing it along; the
 * uncommon one is that you changed your mind, and that is the one worth a tap.
 * Defaulting the other way would quietly drop the sugar that started all this.
 */
export function CarryOverPicker({
  items,
  chosen,
  onToggle,
}: {
  /** The unticked lines, in list order. Never empty — the caller renders nothing instead. */
  items: ShoppingListItem[];
  chosen: Set<string>;
  onToggle: (itemId: string) => void;
}) {
  const { t, tp } = useI18n();

  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface-2/60 p-3">
      <p className="px-1 font-display text-sm font-bold text-fg">{tp("plan.carry-over-heading", items.length)}</p>
      <p className="mt-0.5 px-1 text-xs text-muted">{t("plan.carry-over-body")}</p>

      {/* Capped and scrollable: a fortnight of forgotten things must not push
          the modal's own buttons off a phone screen. */}
      <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
        {items.map((item) => {
          const on = chosen.has(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onToggle(item.id)}
                role="checkbox"
                aria-checked={on}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition-colors ${
                    on ? "border-tomato bg-tomato text-white" : "border-line"
                  }`}
                  aria-hidden
                >
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${on ? "text-fg" : "text-muted"}`}>
                  {item.display_name}
                </span>
                {item.total_amount != null && (
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {item.total_amount}
                    {item.unit ? ` ${item.unit}` : ""}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
