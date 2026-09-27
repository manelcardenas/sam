"use client";

import { useMemo, useState } from "react";
import { Check, History, Minus, Plus, ShoppingBasket, Sparkles, Tag, Trash2 } from "lucide-react";
import type { Aisle, GroceryItem, Meal, MealPlan, PlanEntry, ShoppingListItem } from "@/lib/api-client";
import { AisleIcon } from "@/components/AisleIcon";
import { AislePicker } from "@/components/AislePicker";
import { EmptyPanel } from "@/components/profile/EmptyPanel";
import { PersonMark } from "@/components/ui/PersonMark";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { byKey, displayName, groceryFor, groupByAisle, nameFor, readQuantity, suggest, type TypedLine } from "@/lib/grocery";
import { formatDayAndMonth, formatWeekday } from "@/lib/format";

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
 *
 * **Every outstanding line can be moved to another aisle**, and a line in
 * `Other` asks for one out loud (ingredient-capture-plan §6.2's *"¿en qué
 * pasillo?"*). A hand-typed line the vocabulary does not know also gets a
 * background guess from the model the moment it is added; while that runs the
 * line says so, and when it lands the line moves. The two never race in the
 * person's disfavour: the server ignores the model for a line somebody already
 * filed.
 *
 * **The list keeps going from week to week** (meal-planner-plan §8.14). A line
 * you did not buy follows you into the current week on its own and says since
 * when — "pending since 29 Aug" — so something three weeks old reads as a
 * decision to make, buy it or let it go, rather than as this week's shopping.
 *
 * **"From Lentejas" is a link** to the meal that put the line there, when that
 * meal is in this week. It is the other half of the slot sheet's "on the list ·
 * 6": one says what a dish added, this says which dish a line is for.
 *
 * **A line says how many** (§8.14). `4 manzanas amarillas` typed into the box
 * is four of them, read here as you type, and any line's number can be changed
 * from its edit panel — the same panel that moves it to another aisle, so a
 * line has one way in to "change this" rather than an icon per field.
 */
export function ShoppingList({
  plan,
  editable,
  onTick,
  onRemove,
  onAddExtra,
  onSetAmount,
  onFileAisle,
  classifying = new Set<string>(),
  currentUserId,
  vocabulary,
  onOpenSlot,
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
  /** A hand-typed line, with the quantity read out of it when there was one. */
  onAddExtra: (line: TypedLine) => Promise<void>;
  /** A new total for a line, in its own unit. */
  onSetAmount: (item: ShoppingListItem, amount: number) => Promise<void>;
  /** File a line in an aisle — its vocabulary row moves, or the typed words become one. */
  onFileAisle: (item: ShoppingListItem, aisle: Aisle) => Promise<void>;
  /** Lines the model is still placing, so they can say so instead of sitting silently in `Other`. */
  classifying?: ReadonlySet<string>;
  /** So a line somebody else added can say so, and yours stay unmarked. */
  currentUserId: string | null;
  /** Empty until it loads, and empty forever if it fails — see the note above. */
  vocabulary: GroceryItem[];
  /** Open the meal a line came from. */
  onOpenSlot: (date: string, meal: Meal) => void;
}) {
  const { t, tp, locale } = useI18n();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const items = plan?.items ?? [];
  const outstanding = items.filter((i) => !i.is_checked);
  const done = items.filter((i) => i.is_checked);

  const index = useMemo(() => byKey(vocabulary), [vocabulary]);
  const entries = useMemo(() => new Map((plan?.entries ?? []).map((e) => [e.id, e])), [plan?.entries]);
  const groups = useMemo(() => groupByAisle(outstanding, index), [outstanding, index]);
  // One unnamed group means nothing was recognised — every line fell into
  // `other`. Headings would then be a row of "Otros" above the whole list, which
  // is worse than no headings at all.
  const grouped = groups.length > 1 || (groups.length === 1 && groups[0].aisle !== "other");
  const typed = useMemo(() => readQuantity(draft), [draft]);
  // Suggest from the name alone: "4 manz" is looking for manzanas.
  const suggestions = useMemo(() => suggest(typed.name, vocabulary), [typed.name, vocabulary]);

  const renderLine = (item: ShoppingListItem) => (
    <Line
      key={item.id}
      item={item}
      editable={editable}
      onTick={onTick}
      onRemove={onRemove}
      onFileAisle={onFileAisle}
      onSetAmount={onSetAmount}
      classifying={classifying.has(item.id)}
      currentUserId={currentUserId}
      vocabulary={index}
      entries={entries}
      onOpenSlot={onOpenSlot}
    />
  );

  const add = async (line: TypedLine) => {
    if (!line.name || adding) return;
    setAdding(true);
    try {
      await onAddExtra(line);
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
    void add(typed);
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
                <h3 className="mb-1.5 flex items-center gap-1.5 px-1 font-display text-[0.7rem] font-bold uppercase tracking-wider text-muted">
                  <AisleIcon aisle={group.aisle} className="h-3.5 w-3.5 shrink-0" />
                  {t(`aisle.${group.aisle}`)}
                </h3>
                <ul className="space-y-1.5">
                  {group.items.map(renderLine)}
                </ul>
              </section>
            ))
          ) : (
            <ul className="space-y-1.5">
              {outstanding.map(renderLine)}
            </ul>
          )}

          {done.length > 0 && (
            <ul className="space-y-1.5">
              {done.map(renderLine)}
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

          {/* Said back while typing, so it is clear the 4 was understood as a
              quantity and not as part of the name. */}
          {typed.amount != null && (
            <p aria-live="polite" className="px-1 text-xs text-muted">
              {t("plan.typed-amount", { amount: formatQuantity(typed.amount, typed.unit), name: typed.name })}
            </p>
          )}

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
                    // The number typed so far comes along: "4 manz" → 4 × Manzana.
                    onClick={() => add({ ...typed, name: nameFor(item, locale) })}
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
  onFileAisle,
  onSetAmount,
  classifying,
  currentUserId,
  vocabulary,
  entries,
  onOpenSlot,
}: {
  item: ShoppingListItem;
  editable: boolean;
  onTick: (item: ShoppingListItem, checked: boolean) => void;
  onRemove: (item: ShoppingListItem) => void;
  onFileAisle: (item: ShoppingListItem, aisle: Aisle) => Promise<void>;
  onSetAmount: (item: ShoppingListItem, amount: number) => Promise<void>;
  classifying: boolean;
  currentUserId: string | null;
  vocabulary: Map<string, GroceryItem>;
  /** This week's dishes, by id — what a source can link to. */
  entries: Map<string, PlanEntry>;
  onOpenSlot: (date: string, meal: Meal) => void;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const [filing, setFiling] = useState(false);

  const grocery = groceryFor(item, vocabulary);
  // Only lines still to buy. Re-filing or recounting something already in the
  // basket is a correction nobody is standing in the shop waiting for.
  const canFile = editable && !item.is_checked;

  const file = async (aisle: Aisle) => {
    setFiling(true);
    try {
      await onFileAisle(item, aisle);
      setEditing(false);
    } finally {
      setFiling(false);
    }
  };

  // A matched line reads from the vocabulary rather than from whoever typed it
  // first: one merged line is `Cebolla` to you and `Ceba` to whoever else is in
  // the kitchen. Unmatched lines keep the words somebody actually used.
  const name = displayName(item, vocabulary, locale);

  // One per meal: two dishes can share a name across the week and are two
  // answers to "where is this from?", while the same dish counted twice is one.
  // The names are snapshots from when the week was planned (`dish_name` in the
  // API). A source whose meal is not in this week — a line carried from an
  // earlier one — stays a plain name, because there is nowhere here to go.
  const origins = [
    ...new Map(
      item.sources.map((source) => {
        const entry = source.entry_id ? entries.get(source.entry_id) : undefined;
        return [entry ? entry.id : `name:${source.dish_name}`, { name: source.dish_name, entry }] as const;
      }),
    ).values(),
  ];
  const amount = item.total_amount != null ? formatQuantity(item.total_amount, item.unit) : null;

  return (
    <li
      className={`rounded-2xl border transition-colors ${
        item.is_checked ? "border-line/60 bg-surface-2/50" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
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
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
            {origins.length === 0 ? (
              t("plan.added-by-hand")
            ) : (
              <>
                <span>{t("plan.from")}</span>
                {origins.map(({ name, entry }, i) =>
                  entry ? (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => onOpenSlot(entry.date, entry.meal)}
                      className="cursor-pointer rounded font-semibold text-fg underline decoration-line underline-offset-2 transition-colors hover:text-tomato hover:decoration-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                    >
                      {name} · {formatWeekday(entry.date, locale)} {t(`plan.${entry.meal}`).toLowerCase()}
                    </button>
                  ) : (
                    <span key={`${name}-${i}`}>{name}</span>
                  ),
                )}
              </>
            )}
          </span>
          {item.pending_since && !item.is_checked && (
            <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber">
              <History className="h-3 w-3 shrink-0" aria-hidden />
              {t("plan.pending-since", { date: formatDayAndMonth(item.pending_since, locale) })}
            </span>
          )}
          {/* The model's guess in flight, or — when there is none and nothing
              knows this line — the question, asked on the line itself. */}
          {canFile && classifying && (
            <span aria-live="polite" className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <Sparkles className="h-3 w-3 shrink-0 animate-pulse text-tomato" aria-hidden />
              {t("grocery.finding-aisle")}
            </span>
          )}
          {canFile && !classifying && !grocery && (
            <button
              type="button"
              onClick={() => setEditing((open) => !open)}
              aria-expanded={editing}
              className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-line px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:border-tomato/50 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              <Tag className="h-3 w-3" aria-hidden />
              {t("grocery.which-aisle")}
            </button>
          )}
        </span>

        {amount &&
          (canFile ? (
            <button
              type="button"
              onClick={() => setEditing((open) => !open)}
              aria-expanded={editing}
              aria-label={`${t("plan.change-amount")}: ${name}, ${amount}`}
              className="shrink-0 cursor-pointer rounded-full px-2 py-1 text-sm font-semibold tabular-nums text-fg transition-colors hover:bg-tomato/10 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              {amount}
            </button>
          ) : (
            <span className={`shrink-0 text-sm font-semibold tabular-nums ${item.is_checked ? "text-muted" : "text-fg"}`}>{amount}</span>
          ))}

        {/* Left of the amount would push the number around as names come and go.
            Here it sits in the row's quiet end, next to the delete button it will
            often share a line with. */}
        <PersonMark
          userId={item.created_by}
          name={item.created_by_name}
          currentUserId={currentUserId}
          label={(name) => t("kitchen.added-by", { name })}
        />

        {/* One quiet way in to everything about the line — how many, which
            aisle. The unfiled line's louder "which aisle?" opens the same panel. */}
        {canFile && (
          <button
            type="button"
            onClick={() => setEditing((open) => !open)}
            aria-expanded={editing}
            aria-label={`${t("plan.edit-line")}: ${name}`}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/10 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <Tag className="h-3.5 w-3.5" />
          </button>
        )}

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
      </div>

      {editing && canFile && (
        <div className="space-y-3 border-t border-line px-3 pb-3 pt-2.5">
          <AmountEditor
            item={item}
            name={name}
            onSave={async (value) => {
              await onSetAmount(item, value);
              setEditing(false);
            }}
          />
          <div className="space-y-2">
            <p className="text-xs text-muted">
              <span className="font-semibold text-fg">{t("plan.aisle")}</span> · {t("grocery.pick-aisle-hint")}
            </p>
            <AislePicker current={grocery?.aisle} onPick={(aisle) => void file(aisle)} disabled={filing} />
          </div>
        </div>
      )}
    </li>
  );
}

/** "4", "500 g", "1.5 kg" — how a quantity reads on the list. */
function formatQuantity(amount: number, unit: string | null): string {
  return `${amount}${unit ? ` ${unit}` : ""}`;
}

/**
 * How many of a line — typed, or nudged one at a time.
 *
 * **The stepper only for counted things.** One more manzana is a tap; one more
 * gram of feta is not a step anybody takes, so a line with a unit gets the
 * number box alone. The unit is shown and never changed here: "200 g" corrected
 * is still grams.
 */
function AmountEditor({ item, name, onSave }: { item: ShoppingListItem; name: string; onSave: (amount: number) => Promise<void> }) {
  const { t } = useI18n();
  const [value, setValue] = useState(item.total_amount != null ? String(item.total_amount) : "");
  const [saving, setSaving] = useState(false);

  const parsed = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
  const current = valid ? parsed : 0;
  const counted = !item.unit;

  const step = (delta: number) => setValue(String(Math.max(1, Math.floor(current) + delta)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving || parsed === item.total_amount) return;
    setSaving(true);
    try {
      await onSave(parsed);
    } finally {
      setSaving(false);
    }
  };

  const round = "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line text-fg transition-colors hover:border-tomato hover:text-tomato disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50";

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`amount-${item.id}`} className="text-xs font-semibold text-fg">
        {t("plan.amount")}
      </label>
      <div className="flex items-center gap-1.5">
        {counted && (
          <button type="button" onClick={() => step(-1)} disabled={current <= 1} aria-label={`${t("plan.amount-less")}: ${name}`} className={round}>
            <Minus className="h-4 w-4" aria-hidden />
          </button>
        )}
        <input
          id={`amount-${item.id}`}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="1"
          autoComplete="off"
          className="h-10 w-16 rounded-xl border border-line bg-surface px-2 text-center text-sm font-semibold tabular-nums text-fg focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
        />
        {item.unit && <span className="text-sm text-muted">{item.unit}</span>}
        {counted && (
          <button type="button" onClick={() => step(1)} aria-label={`${t("plan.amount-more")}: ${name}`} className={round}>
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <button
        type="submit"
        disabled={!valid || saving || parsed === item.total_amount}
        className="ml-auto rounded-full bg-tomato px-4 py-2 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
      >
        {saving ? t("common.saving") : t("plan.save-amount")}
      </button>
    </form>
  );
}
