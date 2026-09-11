"use client";

import { useState } from "react";
import { Check, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import type { MealPlan, ShoppingListItem } from "@/lib/api-client";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * The list you walk into the shop with.
 *
 * Two things it must do that a plain checklist does not (§4.6):
 *
 * - **show a merged total**, because that is what you need at the shelf;
 * - **keep the breakdown**, because that is what answers *"why is there fennel
 *   on this list?"* — and it has to keep answering it after the recipe that put
 *   it there has been deleted, which is why each source carries a snapshot of
 *   the recipe's name rather than a link to it.
 *
 * Ticked lines sink to the bottom and fade rather than disappearing: in a shop
 * you look back to check you really got something, and a line that vanishes on
 * tap cannot be checked or untapped.
 *
 * **The plan may be null**, and that is the ordinary case for a week nobody has
 * planned yet. The list is not downstream of the calendar: you can put sugar on
 * a week that has no dishes in it, and the week gets created by the act of
 * adding. So the add box renders with or without a plan, and only the lines
 * above it depend on there being one.
 */
export function ShoppingList({
  plan,
  editable,
  canTick,
  onTick,
  onRemove,
  onAddExtra,
}: {
  /** Null for a week nothing has been put in yet — still a week you can add to. */
  plan: MealPlan | null;
  /** Owner-only: adding extras and removing lines. */
  editable: boolean;
  /**
   * Owner *or* guest. Split from `editable` because ticking is the single write
   * sharing grants (§4.3) — collapsing the two would either lock guests out of
   * the one thing they are here to do, or let them edit someone else's list.
   */
  canTick: boolean;
  onTick: (item: ShoppingListItem, checked: boolean) => void;
  onRemove: (item: ShoppingListItem) => void;
  onAddExtra: (name: string) => Promise<void>;
}) {
  const { t, tp } = useI18n();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const items = plan?.items ?? [];
  const outstanding = items.filter((i) => !i.is_checked);
  const done = items.filter((i) => i.is_checked);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      await onAddExtra(name);
      setDraft("");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-muted">{items.length > 0 ? tp("plan.list-count", outstanding.length) : ""}</p>

      {items.length === 0 ? (
        <EmptyPanel
          icon={<ShoppingBasket className="mx-auto mb-3 h-10 w-10 text-muted" aria-hidden />}
          title={t("plan.list-empty-title")}
          body={t("plan.list-empty-body")}
        />
      ) : (
        <ul className="space-y-1.5">
          {[...outstanding, ...done].map((item) => (
            <Line key={item.id} item={item} editable={editable} canTick={canTick} onTick={onTick} onRemove={onRemove} />
          ))}
        </ul>
      )}

      {editable && (
        <form onSubmit={submit} className="flex items-center gap-2">
          <label htmlFor="plan-extra" className="sr-only">
            {t("plan.add-extra")}
          </label>
          <input
            id="plan-extra"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("plan.add-extra-placeholder")}
            className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
          />
          <button
            type="submit"
            disabled={!draft.trim() || adding}
            aria-label={t("plan.add")}
            className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-tomato text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <Plus className="h-5 w-5" />
          </button>
        </form>
      )}
    </div>
  );
}

function Line({
  item,
  editable,
  canTick,
  onTick,
  onRemove,
}: {
  item: ShoppingListItem;
  editable: boolean;
  canTick: boolean;
  onTick: (item: ShoppingListItem, checked: boolean) => void;
  onRemove: (item: ShoppingListItem) => void;
}) {
  const { t } = useI18n();

  // Deduplicated: two helpings of the same recipe in one week are two sources
  // but one answer to "where is this from?". These are the names as they were
  // when the week was planned, not a live lookup — see `dish_name` in the API.
  const recipes = [...new Set(item.sources.map((s) => s.dish_name))];
  const amount = item.total_amount != null ? `${item.total_amount}${item.unit ? ` ${item.unit}` : ""}` : null;

  return (
    <li
      className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors ${
        item.is_checked ? "border-line/60 bg-surface-2/50" : "border-line bg-surface"
      }`}
    >
      <button
        type="button"
        onClick={() => onTick(item, !item.is_checked)}
        disabled={!canTick}
        role="checkbox"
        aria-checked={item.is_checked}
        aria-label={item.display_name}
        className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
          item.is_checked ? "border-leaf bg-leaf text-white" : "border-line hover:border-tomato"
        }`}
      >
        {item.is_checked && <Check className="h-4 w-4" aria-hidden />}
      </button>

      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold [overflow-wrap:anywhere] ${item.is_checked ? "text-muted line-through" : "text-fg"}`}>
          {item.display_name}
        </span>
        <span className="block truncate text-xs text-muted">
          {item.is_manual && recipes.length === 0
            ? t("plan.added-by-hand")
            : t("plan.from-recipes", { recipes: recipes.join(" · ") })}
        </span>
      </span>

      {amount && (
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${item.is_checked ? "text-muted" : "text-fg"}`}>{amount}</span>
      )}

      {editable && (
        <button
          type="button"
          onClick={() => onRemove(item)}
          aria-label={`${t("plan.remove-line")}: ${item.display_name}`}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}
