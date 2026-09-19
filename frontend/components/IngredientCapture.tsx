"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { apiClient, type Aisle, type ParsedIngredientLine } from "@/lib/api-client";
import { DeepSeekMark } from "@/components/brand/DeepSeekMark";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { nameFor } from "@/lib/grocery";

/**
 * Ingredients in one box, structured rows out
 * (docs/plans/ingredient-capture-plan.md §4).
 *
 * **Why the three-column grid is gone.** Measured in production: `amount` was
 * filled on 2 ingredient lines out of 111 and `unit` on 1, while 56% of names
 * started with a digit. People type `"3 huevos"` into the one box that is
 * pleasant to fill in. Making three fields mandatory would have re-rotted the
 * data the moment the novelty wore off, so the fix is to let people keep typing
 * the way they already do and have a model structure it.
 *
 * **The manual row is on the way out, never on the way in.** Adding a seventh
 * line by hand is a normal thing to want once you are already looking at the
 * table; a parallel manual *entry* path would always be faster for one
 * ingredient, so people would use it and the measurement above would repeat
 * itself with an AI feature bolted on the side.
 *
 * **An unreachable provider must never stop you saving a recipe.** When both
 * fail, every line becomes a row with the raw text as its name and a quiet note.
 * Every cell is editable and the form still submits. The same path covers a
 * timeout, a rate limit and a cold start.
 */

export interface CaptureRow {
  id: number;
  name: string;
  amount: string;
  unit: string;
  /** Vocabulary facts, absent on a hand-added or unparsed row. */
  aisle?: Aisle;
  isPantry?: boolean;
  isNew?: boolean;
  didYouMean?: string[];
  /** Whether the vocabulary expects a quantity here — drives the `¿cuánto?` nudge. */
  expectsAmount?: boolean;
}

export function rowsFromParsed(lines: ParsedIngredientLine[], locale: string, nextId: () => number): CaptureRow[] {
  return lines.map((line) => ({
    id: nextId(),
    name: nameFor(line.item, locale),
    amount: line.amount != null ? String(line.amount) : "",
    unit: line.unit ?? "",
    aisle: line.item.aisle,
    isPantry: line.item.is_pantry,
    isNew: line.is_new,
    didYouMean: line.did_you_mean,
    expectsAmount: line.item.default_unit != null,
  }));
}

/** One row per line, name only — what a failed parse degrades to. */
export function rowsFromRawText(text: string, nextId: () => number): CaptureRow[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ id: nextId(), name: line, amount: "", unit: "" }));
}

const fieldClass =
  "rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/60 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

export function IngredientCapture({
  rows,
  onRowsChange,
  servings,
  nextId,
}: {
  rows: CaptureRow[];
  onRowsChange: (rows: CaptureRow[]) => void;
  /** Context for the model — never arithmetic. ADR-0001 scales at display time. */
  servings: number;
  nextId: () => number;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // The box is the entry point whenever there is nothing to review yet. Editing
  // an existing recipe therefore opens straight into the table, with no parse
  // and no API call.
  const reviewing = rows.length > 0;

  const structure = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setFailed(false);
    try {
      const parsed = await apiClient.parseIngredients(text, servings);
      onRowsChange(rowsFromParsed(parsed.lines, locale, nextId));
    } catch {
      // Deliberately not surfacing which provider failed or why: the answer is
      // the same either way, and "DeepSeek returned 429" is not a sentence
      // anybody cooking wants to read.
      setFailed(true);
      onRowsChange(rowsFromRawText(text, nextId));
    } finally {
      setBusy(false);
    }
  };

  const update = (id: number, patch: Partial<CaptureRow>) => onRowsChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const remove = (id: number) => onRowsChange(rows.filter((row) => row.id !== id));
  const add = () => onRowsChange([...rows, { id: nextId(), name: "", amount: "", unit: "" }]);

  if (!reviewing) {
    return (
      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          // 4,000 matches the server's cap, so a runaway paste is refused where
          // it is pasted rather than after a round trip.
          maxLength={4000}
          aria-label={t("recipe-form.ingredients")}
          placeholder={t("recipe-form.ingredients-placeholder")}
          className={`${fieldClass} w-full resize-y leading-relaxed`}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">{t("recipe-form.ingredients-hint")}</p>
          <button
            type="button"
            onClick={structure}
            disabled={!draft.trim() || busy}
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-tomato px-4 py-2 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <DeepSeekMark className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`} />
            {busy ? t("recipe-form.structuring") : t("recipe-form.structure")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {failed && <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">{t("recipe-form.parse-failed")}</p>}

      {rows.map((row) => (
        <div key={row.id} className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={row.name}
              onChange={(e) => update(row.id, { name: e.target.value })}
              aria-label={t("recipe-form.ingredient-name")}
              className={`${fieldClass} min-w-0 flex-1`}
            />
            <input
              type="number"
              step="any"
              value={row.amount}
              onChange={(e) => update(row.id, { amount: e.target.value })}
              placeholder="—"
              aria-label={t("recipe-form.amount")}
              className={`${fieldClass} w-20 text-center`}
            />
            <input
              type="text"
              value={row.unit}
              onChange={(e) => update(row.id, { unit: e.target.value })}
              placeholder="—"
              aria-label={t("recipe-form.unit")}
              className={`${fieldClass} w-20`}
            />
            <button
              type="button"
              onClick={() => remove(row.id)}
              aria-label={`${t("recipe-form.remove-ingredient")}: ${row.name}`}
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {/* The annotations, in the order they matter. `nuevo` is passive and is
              also the typo detector — you have added eggs twenty times, so seeing
              it beside `Huveos` is wrong in a way you spot instantly. `¿cuánto?`
              is a nudge and **never blocks the save**: a save blocked on a
              missing amount would rebuild the exact friction that rotted the
              data in the first place. */}
          {(row.aisle || row.isNew || row.isPantry) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-3 text-[0.7rem] text-muted">
              {row.aisle && <span>{t(`aisle.${row.aisle}`)}</span>}
              {row.isNew && <span className="font-semibold text-tomato">✦ {t("recipe-form.new-item")}</span>}
              {row.isPantry && <span>· {t("recipe-form.from-home")}</span>}
              {row.expectsAmount && !row.amount.trim() && <span>· {t("recipe-form.how-much")}</span>}
              {row.didYouMean?.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => update(row.id, { name, isNew: false, didYouMean: [] })}
                  className="cursor-pointer rounded-full border border-line px-2 py-0.5 font-semibold text-fg transition-colors hover:border-tomato hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  {t("recipe-form.did-you-mean", { name })}
                </button>
              ))}
            </p>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={add}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-line px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("recipe-form.add-ingredient")}
        </button>
        <button
          type="button"
          onClick={() => {
            onRowsChange([]);
            setFailed(false);
          }}
          className="cursor-pointer text-xs font-semibold text-muted underline underline-offset-4 transition-colors hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          ← {t("recipe-form.back-to-text")}
        </button>
      </div>
    </div>
  );
}
