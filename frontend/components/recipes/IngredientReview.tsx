"use client";

import { useMemo, useState } from "react";
import { CircleAlert, ListChecks, Plus, Scale, Split, Trash2 } from "lucide-react";
import type { GroceryItem } from "@/lib/api-client";
import { nameFor, suggest } from "@/lib/grocery";
import { normaliseName } from "@/lib/plan-ingredients";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { acceptGrams, canSplit, lineCount, missingFromMethod, splitRow, withName, withProduct, type ReviewRow } from "@/lib/recipe-review";
import { AisleIcon } from "@/components/AisleIcon";
import { Button, IconButton } from "@/components/ui/Button";

const fieldClass =
  "h-11 rounded-xl border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted/60 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

/**
 * The ingredient rows of a recipe being written or reviewed
 * (docs/plans/meal-plan-phase-1.md §1.3).
 *
 * What it promises the person, in order:
 *
 * - **Nothing is lost silently.** The counter compares source lines with rows,
 *   a line the model did not understand is marked rather than dropped, and a
 *   line left with no row says so as "quitada por ti".
 * - **Every row shows where it came from**, so "where did *that* come from?"
 *   has an answer on screen.
 * - **Units follow the product**: a counted line of something bought by weight
 *   offers its grams in one tap; the unit box shows the product's usual unit as
 *   a hint.
 * - **The method is checked against the list**: a product the steps name and
 *   the list lacks is offered, not added.
 *
 * Nothing here writes anywhere. New products ride on their row until the
 * recipe is saved.
 */
export function IngredientReview({
  rows,
  onRowsChange,
  vocabulary,
  lines,
  instructions,
  nextId,
}: {
  rows: ReviewRow[];
  onRowsChange: (rows: ReviewRow[]) => void;
  vocabulary: GroceryItem[];
  /** How many ingredient lines the source had; 0 for a recipe written by hand. */
  lines: number;
  instructions: string;
  nextId: () => number;
}) {
  const { t, tp, locale } = useI18n();
  const byKey = useMemo(() => new Map(vocabulary.map((item) => [item.key, item])), [vocabulary]);
  const missing = useMemo(() => missingFromMethod(instructions, rows, vocabulary), [instructions, rows, vocabulary]);
  const count = lineCount(rows, lines);

  const replace = (id: number, next: ReviewRow | ReviewRow[]) =>
    onRowsChange(rows.flatMap((row) => (row.id === id ? next : [row])));
  const patch = (id: number, change: Partial<ReviewRow>) => onRowsChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  const remove = (id: number) => onRowsChange(rows.filter((row) => row.id !== id));
  const addBlank = () => onRowsChange([...rows, { id: nextId(), name: "", amount: "", unit: "", optional: false }]);
  const addProduct = (item: GroceryItem) =>
    onRowsChange([...rows, withProduct({ id: nextId(), name: "", amount: "", unit: "", optional: false }, item, locale)]);

  return (
    <div className="space-y-3">
      {lines > 0 && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted" aria-live="polite">
          <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="font-semibold text-fg tabular-nums">
            {tp("recipe-form.lines", count.lines)} → {tp("recipe-form.rows", count.rows)}
          </span>
          {count.removed > 0 && <span>{tp("recipe-form.removed-by-you", count.removed)}</span>}
        </p>
      )}

      <ul className="space-y-3">
        {rows.map((row) => (
          <IngredientRow
            key={row.id}
            row={row}
            vocabulary={vocabulary}
            onName={(name) => replace(row.id, withName(row, name, byKey))}
            onPick={(item) => replace(row.id, withProduct(row, item, locale))}
            onPatch={(change) => patch(row.id, change)}
            onSplit={() => replace(row.id, splitRow(row, byKey, nextId))}
            onRemove={() => remove(row.id)}
          />
        ))}
      </ul>

      {missing.length > 0 && (
        <div role="status" className="space-y-2 rounded-2xl bg-amber/10 px-3.5 py-3 text-sm text-fg">
          <p className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber" aria-hidden />
            <span>{tp("recipe-form.method-mentions", missing.length, { names: missing.map((item) => nameFor(item, locale)).join(", ") })}</span>
          </p>
          <div className="flex flex-wrap gap-2 pl-6">
            {missing.map((item) => (
              <Button key={item.key} variant="secondary" size="sm" icon={Plus} onClick={() => addProduct(item)}>
                {nameFor(item, locale)}
              </Button>
            ))}
          </div>
        </div>
      )}

      <Button variant="secondary" size="sm" icon={Plus} onClick={addBlank} className="border-dashed text-muted">
        {t("recipe-form.add-ingredient")}
      </Button>
    </div>
  );
}

function IngredientRow({
  row,
  vocabulary,
  onName,
  onPick,
  onPatch,
  onSplit,
  onRemove,
}: {
  row: ReviewRow;
  vocabulary: GroceryItem[];
  onName: (name: string) => void;
  onPick: (item: GroceryItem) => void;
  onPatch: (change: Partial<ReviewRow>) => void;
  onSplit: () => void;
  onRemove: () => void;
}) {
  const { t, locale } = useI18n();
  // Suggestions only after a keystroke: focusing a row to fix its amount
  // should not throw a list over the rows below it.
  const [typing, setTyping] = useState(false);
  const options = typing ? suggest(row.name, vocabulary, 5).filter((item) => item.key !== row.groceryKey) : [];
  const showSource = row.sourceLine && normaliseName(row.sourceLine) !== normaliseName(row.name);
  const needsAmount = Boolean(row.defaultUnit) && !row.amount.trim() && !row.optional;

  return (
    <li className={`space-y-1.5 ${row.optional ? "opacity-80" : ""}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-2 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
          <div className="relative sm:flex-1">
            <input
              type="text"
              value={row.name}
              onChange={(e) => {
                setTyping(true);
                onName(e.target.value);
              }}
              onBlur={() => setTyping(false)}
              aria-label={t("recipe-form.ingredient-name")}
              placeholder={t("recipe-form.ingredient-placeholder")}
              className={`${fieldClass} w-full ${row.restored ? "border-amber" : ""}`}
            />
            {options.length > 0 && (
              <ul role="listbox" aria-label={t("recipe-form.suggestions")} className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-line bg-surface py-1 shadow-paw">
                {options.map((item) => (
                  <li key={item.key} role="option" aria-selected={false}>
                    <button
                      type="button"
                      // mousedown, not click: the input's blur would close the
                      // list before a click could land on it.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTyping(false);
                        onPick(item);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm text-fg hover:bg-surface-2"
                    >
                      <AisleIcon aisle={item.aisle} className="h-3.5 w-3.5 shrink-0 text-muted" />
                      {nameFor(item, locale)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={row.amount}
              onChange={(e) => onPatch({ amount: e.target.value, gramsSuggestion: undefined, unit: !row.unit && e.target.value.trim() && row.defaultUnit ? row.defaultUnit : row.unit })}
              placeholder="—"
              aria-label={t("recipe-form.amount")}
              className={`${fieldClass} w-20 text-center tabular-nums ${needsAmount ? "border-amber bg-amber/5" : ""}`}
            />
            <input
              type="text"
              value={row.unit}
              onChange={(e) => onPatch({ unit: e.target.value })}
              // The product's usual unit as ghost text, never as a value.
              placeholder={row.defaultUnit ?? "—"}
              aria-label={t("recipe-form.unit")}
              className={`${fieldClass} w-28`}
            />
          </div>
        </div>
        <IconButton icon={Trash2} label={`${t("recipe-form.remove-ingredient")}: ${row.name}`} onClick={onRemove} className="hover:bg-accent/15 hover:text-accent" />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pl-1 text-xs text-muted">
        {row.restored && (
          <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber">
            <CircleAlert className="h-3 w-3 shrink-0" aria-hidden />
            {t("recipe-form.restored")}
          </span>
        )}
        {showSource && <span className="text-muted">{t("recipe-form.from-line", { line: row.sourceLine ?? "" })}</span>}
        {row.aisle && (
          <span className="inline-flex items-center gap-1">
            <AisleIcon aisle={row.aisle} className="h-3 w-3 shrink-0" />
            {t(`aisle.${row.aisle}`)}
          </span>
        )}
        {row.newItem && !row.groceryKey && <span className="font-semibold text-accent">✦ {t("recipe-form.new-item")}</span>}
        {row.didYouMean?.map((name) => (
          <Chiplet key={name} onClick={() => onName(name)}>
            {t("recipe-form.did-you-mean", { name })}
          </Chiplet>
        ))}
        {row.gramsSuggestion != null && (
          <Chiplet onClick={() => onPatch(acceptGrams(row))} icon={<Scale className="h-3 w-3 shrink-0" aria-hidden />}>
            {t("recipe-form.use-grams", { grams: row.gramsSuggestion })}
          </Chiplet>
        )}
        {needsAmount && (
          <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber">
            <CircleAlert className="h-3 w-3 shrink-0" aria-hidden />
            {t("recipe-form.how-much")}
          </span>
        )}
        {canSplit(row) && (
          <Chiplet onClick={onSplit} icon={<Split className="h-3 w-3 shrink-0" aria-hidden />}>
            {t("recipe-form.split")}
          </Chiplet>
        )}
        <Chiplet onClick={() => onPatch({ optional: !row.optional })} pressed={row.optional} quiet>
          {t("recipe-form.optional")}
        </Chiplet>
      </div>
    </li>
  );
}

/**
 * The small actions under a row: a pill sized for the line of metadata it
 * sits in, with a 32 px hit area. Smaller than the 44 px floor on purpose and
 * only here — these are secondary edits under a row whose own fields are full
 * size, and a 44 px pill would make each ingredient twice as tall.
 */
function Chiplet({
  onClick,
  pressed,
  quiet,
  icon,
  children,
}: {
  onClick: () => void;
  pressed?: boolean;
  /** No outline until pressed — for the toggle every row has, so twelve rows do not shout it twelve times. */
  quiet?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`inline-flex min-h-8 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border px-2.5 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        pressed
          ? "border-accent bg-accent/10 text-accent"
          : quiet
            ? "border-transparent text-muted hover:border-line hover:text-fg"
            : "border-line text-fg hover:border-accent/40 hover:text-accent"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
