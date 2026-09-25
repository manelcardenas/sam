"use client";

import { useState } from "react";
import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { apiClient, type Aisle, type ParsedIngredientLine } from "@/lib/api-client";
import { AisleIcon } from "@/components/AisleIcon";
import { AislePicker } from "@/components/AislePicker";
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
  /**
   * The vocabulary row this line was matched to — what an aisle correction is
   * written to. Dropped the moment the name is edited by hand: the row no longer
   * describes what is in the box, and moving its aisle would move somebody
   * else's ingredient.
   */
  groceryKey?: string;
  /** Vocabulary facts, absent on a hand-added or unparsed row. */
  aisle?: Aisle;
  isPantry?: boolean;
  isNew?: boolean;
  didYouMean?: string[];
  /**
   * What the vocabulary says this is normally measured in — `g`, `ml`, or absent
   * for something counted.
   *
   * It does two jobs and **neither one writes data behind your back**. Its
   * presence is what makes the row ask `¿cuánto?`, because only a measured thing
   * has a missing quantity worth chasing — nobody needs to be asked how much
   * salt. And it fills the unit box the moment you type an amount, where you can
   * see it and change it.
   *
   * That is the opposite of the rule deleted on 2026-09-18, which applied this
   * server-side to any amount arriving without a unit and turned `1 patata` into
   * `1 g`. The difference is not the value, it is who can see it.
   */
  defaultUnit?: string;
}

/** A measured row with nothing in the amount box — what the nudge counts. */
export function needsAmount(row: CaptureRow): boolean {
  return Boolean(row.defaultUnit) && !row.amount.trim();
}

export function rowsFromParsed(lines: ParsedIngredientLine[], locale: string, nextId: () => number): CaptureRow[] {
  return lines.map((line) => ({
    id: nextId(),
    name: nameFor(line.item, locale),
    amount: line.amount != null ? String(line.amount) : "",
    unit: line.unit ?? "",
    groceryKey: line.item.key,
    aisle: line.item.aisle,
    isPantry: line.item.is_pantry,
    isNew: line.is_new,
    didYouMean: line.did_you_mean,
    defaultUnit: line.item.default_unit ?? undefined,
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

/** Matches the server's cap, so a runaway paste is refused where it is pasted. */
const MAX_CHARS = 4000;

/**
 * Where the counter appears — the last 10%.
 *
 * `maxLength` alone truncates a long paste **silently**: you paste 5,000
 * characters, 4,000 arrive, and nothing on screen says the rest is gone. That is
 * the failure this exists for, so the counter has to be visible *before* the
 * limit as well as at it. Showing it from character one would just be noise on
 * the seven-line recipes that are the normal case.
 */
const COUNT_FROM = MAX_CHARS * 0.9;

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
  const { t, tp, locale } = useI18n();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Which row's aisle picker is open. One at a time: the table is already dense.
  const [picking, setPicking] = useState<number | null>(null);
  const [filing, setFiling] = useState(false);

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

  /**
   * Patch one row, filling the unit the first time an amount appears.
   *
   * **A unit with no amount is worse than neither.** The shopping list merges on
   * `(identity, unit)`, so an `Aceite` line carrying `ml` and no number would sit
   * beside `Aceite 150 ml` as a second row for the same bottle. So the unit
   * arrives with the number, never before it — and only into an empty box, so it
   * can never overwrite what you typed.
   */
  const update = (id: number, patch: Partial<CaptureRow>) =>
    onRowsChange(
      rows.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.amount?.trim() && !next.unit.trim() && next.defaultUnit) next.unit = next.defaultUnit;
        return next;
      }),
    );
  const remove = (id: number) => onRowsChange(rows.filter((row) => row.id !== id));

  /**
   * Correct the aisle the parser (or the seed) gave this ingredient.
   *
   * Written straight to the shared vocabulary rather than held with the recipe:
   * a recipe stores names, not aisles, so an aisle kept here would be forgotten
   * on save. Only updated on the row once the server agrees — a picker that
   * showed an aisle the vocabulary never took would be lying about the list.
   */
  const fileAisle = async (row: CaptureRow, aisle: Aisle) => {
    if (!row.groceryKey) return;
    setFiling(true);
    try {
      const saved = await apiClient.setGroceryAisle(row.groceryKey, aisle);
      update(row.id, { aisle: saved.aisle });
      setPicking(null);
    } catch {
      // Left open, so it is plain the pick did not take and can be tried again.
    } finally {
      setFiling(false);
    }
  };
  const add = () => onRowsChange([...rows, { id: nextId(), name: "", amount: "", unit: "" }]);

  if (!reviewing) {
    const remaining = MAX_CHARS - draft.length;
    // The hint is spent by the time you are 3,600 characters in — you plainly
    // know you can write however you like — so the counter takes its place
    // rather than crowding the row on a phone.
    const counting = draft.length >= COUNT_FROM;
    return (
      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          maxLength={MAX_CHARS}
          aria-label={t("recipe-form.ingredients")}
          placeholder={t("recipe-form.ingredients-placeholder")}
          className={`${fieldClass} w-full resize-y leading-relaxed`}
        />
        <div className="flex items-center justify-between gap-3">
          <p
            // Polite rather than assertive: it should be announced when you
            // pause, not interrupt you mid-word.
            aria-live="polite"
            className={`text-xs ${remaining === 0 ? "font-semibold text-tomato" : "text-muted"}`}
          >
            {!counting
              ? t("recipe-form.ingredients-hint")
              : remaining === 0
                ? t("recipe-form.chars-full", { max: MAX_CHARS })
                : tp("recipe-form.chars-left", remaining)}
          </p>
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

  const missing = rows.filter(needsAmount).length;

  return (
    <div className="space-y-2.5">
      {failed && <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">{t("recipe-form.parse-failed")}</p>}

      {rows.map((row) => (
        <div key={row.id} className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={row.name}
              onChange={(e) => update(row.id, { name: e.target.value, groceryKey: undefined })}
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
              // The box itself carries the ask, so the row reads as incomplete
              // at a glance without having to find the words underneath.
              className={`${fieldClass} w-20 text-center ${needsAmount(row) ? "border-amber bg-amber/5" : ""}`}
            />
            <input
              type="text"
              value={row.unit}
              onChange={(e) => update(row.id, { unit: e.target.value })}
              // The vocabulary's unit as ghost text, not as a value: it shows
              // what is expected without putting anything in the row.
              placeholder={row.defaultUnit ?? "—"}
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
              {row.aisle &&
                (row.groceryKey ? (
                  <button
                    type="button"
                    onClick={() => setPicking(picking === row.id ? null : row.id)}
                    aria-expanded={picking === row.id}
                    aria-label={`${t("grocery.change-aisle")}: ${t(`aisle.${row.aisle}`)}`}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full underline decoration-dotted underline-offset-2 transition-colors hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                  >
                    <AisleIcon aisle={row.aisle} className="h-3 w-3 shrink-0" />
                    {t(`aisle.${row.aisle}`)}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <AisleIcon aisle={row.aisle} className="h-3 w-3 shrink-0" />
                    {t(`aisle.${row.aisle}`)}
                  </span>
                ))}
              {row.isNew && <span className="font-semibold text-tomato">✦ {t("recipe-form.new-item")}</span>}
              {row.isPantry && <span>· {t("recipe-form.from-home")}</span>}
              {/* Amber rather than tomato, and this is the one place the two are
                  easy to confuse. Tomato is the brand accent: it is the submit
                  button and it is `✦ nuevo` on this very row, so a second tomato
                  thing here would read as the same kind of thing. Amber is also
                  the honest severity — this is unfinished, not broken, and the
                  save goes through either way. Icon *and* colour *and* words,
                  because colour alone carries nothing to a colourblind reader. */}
              {needsAmount(row) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber/15 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber">
                  <CircleAlert className="h-3 w-3 shrink-0" />
                  {t("recipe-form.how-much")}
                </span>
              )}
              {row.didYouMean?.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => update(row.id, { name, isNew: false, didYouMean: [], groceryKey: undefined })}
                  className="cursor-pointer rounded-full border border-line px-2 py-0.5 font-semibold text-fg transition-colors hover:border-tomato hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  {t("recipe-form.did-you-mean", { name })}
                </button>
              ))}
            </p>
          )}

          {picking === row.id && row.groceryKey && (
            <div className="space-y-2 rounded-xl border border-line bg-surface-2/40 p-2.5">
              <p className="text-xs text-muted">{t("grocery.pick-aisle-hint")}</p>
              <AislePicker current={row.aisle} onPick={(aisle) => void fileAisle(row, aisle)} disabled={filing} />
            </div>
          )}
        </div>
      ))}

      {/* The consequence, once, rather than a dialog per row. A badge tells you
          something is missing; this tells you what it costs, which is the part
          that actually changes behaviour. It is also the literal truth of
          ADR-0001: scaling multiplies the amounts, so a line without one passes
          through unchanged at every headcount. */}
      {missing > 0 && (
        <p aria-live="polite" className="flex items-start gap-2 rounded-xl bg-amber/10 px-3 py-2 text-xs text-fg">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber" />
          <span>
            <span className="font-semibold">{tp("recipe-form.missing-amounts", missing)}</span>{" "}
            <span className="text-muted">{t("recipe-form.missing-amounts-why")}</span>
          </span>
        </p>
      )}

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
