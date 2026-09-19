"use client";

import { useMemo, useState } from "react";
import { Check, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import type { GroceryItem, MealPlan, ShoppingListItem } from "@/lib/api-client";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import { PersonMark } from "@/components/ui/PersonMark";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { byKey, displayName, groupByAisle, nameFor, suggest } from "@/lib/grocery";

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
 * **Outstanding lines group by aisle; ticked ones do not.** The grouping exists
 * so that standing in front of the vegetables you can see every vegetable at
 * once — which is a question about what is still to buy. Sorting what you have
 * already picked up into eleven headed sections would be eleven headings of
 * noise, so the done pile stays one block at the bottom.
 *
 * The vocabulary is **optional everywhere**. Before it loads, when it fails, and
 * for any line it has no row for, this renders exactly the flat list it always
 * did. The list is the thing you hold in a supermarket; it does not get to
 * depend on a second request having succeeded.
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
  onTick,
  onRemove,
  onAddExtra,
  currentUserId,
  vocabulary,
}: {
  /** Null for a week nothing has been put in yet — still a week you can add to. */
  plan: MealPlan | null;
  /**
   * Whether this week can still be changed at all — adding, ticking, removing.
   *
   * **One flag, where there used to be two.** Ticking was split out because it
   * was the single write sharing granted to a guest; §8.12 removed the guest, so
   * everybody in the kitchen reaches all three and the two flags had become the
   * same boolean passed twice.
   */
  editable: boolean;
  onTick: (item: ShoppingListItem, checked: boolean) => void;
  onRemove: (item: ShoppingListItem) => void;
  onAddExtra: (name: string) => Promise<void>;
  /** So a line somebody else added can say so, and yours stay unmarked. */
  currentUserId: string | null;
  /** Empty until it loads, and empty forever if it fails — see the note above. */
  vocabulary: GroceryItem[];
}) {
  const { t, tp, locale } = useI18n();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const items = plan?.items ?? [];
  const outstanding = items.filter((i) => !i.is_checked);
  const done = items.filter((i) => i.is_checked);

  const index = useMemo(() => byKey(vocabulary), [vocabulary]);
  const groups = useMemo(() => groupByAisle(outstanding, index), [outstanding, index]);
  // One unnamed group means nothing was recognised — every line fell into
  // `other`. Headings would then be a row of "Otros" above the whole list, which
  // is worse than no headings at all.
  const grouped = groups.length > 1 || (groups.length === 1 && groups[0].aisle !== "other");
  const suggestions = useMemo(() => suggest(draft, vocabulary), [draft, vocabulary]);

  const add = async (name: string) => {
    if (!name || adding) return;
    setAdding(true);
    try {
      await onAddExtra(name);
      setDraft("");
    } finally {
      setAdding(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Whatever was typed, verbatim. **Not the top suggestion** — silently
    // substituting `Pan` for a deliberate `Pan de centeno` would put the wrong
    // thing in the basket, and the suggestion rail is one tap away for anyone
    // who wanted it.
    void add(draft.trim());
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
        <div className="space-y-4">
          {grouped ? (
            groups.map((group) => (
              <section key={group.aisle}>
                <h3 className="mb-1.5 px-1 font-display text-[0.7rem] font-bold uppercase tracking-wider text-muted">
                  {t(`aisle.${group.aisle}`)}
                </h3>
                <ul className="space-y-1.5">
                  {group.items.map((item) => (
                    <Line key={item.id} item={item} editable={editable} onTick={onTick} onRemove={onRemove} currentUserId={currentUserId} vocabulary={index} />
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <ul className="space-y-1.5">
              {outstanding.map((item) => (
                <Line key={item.id} item={item} editable={editable} onTick={onTick} onRemove={onRemove} currentUserId={currentUserId} vocabulary={index} />
              ))}
            </ul>
          )}

          {done.length > 0 && (
            <ul className="space-y-1.5">
              {done.map((item) => (
                <Line key={item.id} item={item} editable={editable} onTick={onTick} onRemove={onRemove} currentUserId={currentUserId} vocabulary={index} />
              ))}
            </ul>
          )}
        </div>
      )}

      {editable && (
        <div className="space-y-2">
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
              // Off: the browser's own history would compete with the
              // suggestions below, which know the aisle and the spelling.
              autoComplete="off"
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

          {/* Picking one of these is what gets the line its aisle: typed text
              the vocabulary does not recognise lands in `other` and sorts last.
              A horizontal rail rather than a dropdown — it never covers the
              list, and on a phone it is thumb-height already. */}
          {suggestions.length > 0 && (
            <ul aria-label={t("grocery.suggestions")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {suggestions.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => add(nameFor(item, locale))}
                    disabled={adding}
                    className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-fg transition-colors hover:border-tomato hover:bg-tomato/5 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                  >
                    {nameFor(item, locale)}
                    {item.is_pantry && <span className="text-xs text-muted">· {t("grocery.pantry")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Line({
  item,
  editable,
  onTick,
  onRemove,
  currentUserId,
  vocabulary,
}: {
  item: ShoppingListItem;
  editable: boolean;
  onTick: (item: ShoppingListItem, checked: boolean) => void;
  onRemove: (item: ShoppingListItem) => void;
  currentUserId: string | null;
  vocabulary: Map<string, GroceryItem>;
}) {
  const { t, locale } = useI18n();

  // A matched line reads from the vocabulary rather than from whoever typed it
  // first: one merged line is `Cebolla` to you and `Ceba` to whoever else is in
  // the kitchen. Unmatched lines keep the words somebody actually used.
  const name = displayName(item, vocabulary, locale);

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
        disabled={!editable}
        role="checkbox"
        aria-checked={item.is_checked}
        aria-label={name}
        className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
          item.is_checked ? "border-leaf bg-leaf text-white" : "border-line hover:border-tomato"
        }`}
      >
        {item.is_checked && <Check className="h-4 w-4" aria-hidden />}
      </button>

      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold [overflow-wrap:anywhere] ${item.is_checked ? "text-muted line-through" : "text-fg"}`}>
          {name}
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

      {/* Left of the amount would push the number around as names come and go.
          Here it sits in the row's quiet end, next to the delete button it will
          often share a line with. */}
      <PersonMark
        userId={item.created_by}
        name={item.created_by_name}
        currentUserId={currentUserId}
        label={(name) => t("kitchen.added-by", { name })}
      />

      {editable && (
        <button
          type="button"
          onClick={() => onRemove(item)}
          aria-label={`${t("plan.remove-line")}: ${name}`}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}
