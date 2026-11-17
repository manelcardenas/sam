"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock, FileText, Link2, Lock, NotebookPen, RotateCcw, Save, X } from "lucide-react";
import type { FoodType } from "@/lib/constants";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { apiClient, type CreateRecipeInput, type GroceryItem, type RecipeTag, type Visibility } from "@/lib/api-client";
import { compareReadings, hasAmounts, ingredientsPayload, rowsFromDraft, scaleRows, unscaleRows, type ReviewRow } from "@/lib/recipe-review";
import { isQuick } from "@/lib/recipe-tags";
import type { DraftOrigin } from "@/components/recipes/RecipeStart";
import { IngredientReview } from "@/components/recipes/IngredientReview";
import { ServingsField } from "@/components/recipes/ServingsField";
import { TagPicker } from "@/components/recipes/TagPicker";
import { FoodTypePicker } from "@/components/FoodTypePicker";
import SourceLink from "@/components/SourceLink";
import ConfirmModal from "@/components/ConfirmModal";
import { Button, FormActions } from "@/components/ui/Button";

/** Add https:// if the user typed a bare host, then validate. Returns the normalized URL, or null if blank/invalid. */
function normalizeUrl(raw: string): { url: string | null; invalid: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { url: null, invalid: false };
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return { url: new URL(withProto).toString(), invalid: false };
  } catch {
    return { url: null, invalid: true };
  }
}

/** Everything the form holds, as it starts — from a draft, a saved recipe, or nothing. */
export interface RecipeFormValues {
  title: string;
  instructions: string;
  food_type: FoodType;
  source_url: string;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  tags: RecipeTag[];
  visibility: Visibility;
  servings: number | null;
  /** The number came from the source and nobody has changed it yet. */
  servingsFromSource: boolean;
  rows: ReviewRow[];
  /** The source's ingredient lines, for the counter; empty for a recipe written by hand. */
  lines: string[];
}

interface RecipeFormProps {
  initial: RecipeFormValues;
  /** Where a draft came from: shown alongside, and read again when it was text. */
  origin?: DraftOrigin;
  /** A simple recipe: per person, no method unless you ask for one. */
  simple?: boolean;
  vocabulary: GroceryItem[];
  nextId: () => number;
  onSubmit: (data: CreateRecipeInput) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}

const fieldClass =
  "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

const labelClass = "mb-1.5 block text-sm font-semibold text-fg";

/** The undo for the last change of servings: what the amounts were before the scaling began. */
interface ServingsUndo {
  count: number;
  previous: number;
  before: Map<number, string>;
  written: Map<number, string>;
}

/**
 * Writing or reviewing a recipe (docs/plans/meal-plan-phase-1.md §1.3–1.6).
 *
 * One form for every way in — a draft read from text, a link or a photo; a
 * simple recipe per person; a saved recipe to edit — so they cannot drift.
 * The order is the order of the decisions: what it is, what goes in it and for
 * how many, how it is made, what it is like, and who sees it.
 *
 * **Leaving is asked about once there is something to lose**: a reviewed draft
 * is minutes of work, and the back button is one stray tap away.
 */
export default function RecipeForm({ initial, origin, simple = false, vocabulary, nextId, onSubmit, onCancel, submitLabel }: RecipeFormProps) {
  const { t, locale } = useI18n();
  const [title, setTitle] = useState(initial.title);
  const [foodType, setFoodType] = useState<FoodType>(initial.food_type);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [showMethod, setShowMethod] = useState(!simple || Boolean(initial.instructions.trim()));
  const [prep, setPrep] = useState(initial.prep_time_minutes != null ? String(initial.prep_time_minutes) : "");
  const [cook, setCook] = useState(initial.cook_time_minutes != null ? String(initial.cook_time_minutes) : "");
  const [tags, setTags] = useState<RecipeTag[]>(initial.tags);
  const [visibility, setVisibility] = useState<Visibility>(initial.visibility);
  const [sourceUrl, setSourceUrl] = useState(initial.source_url);
  const [servings, setServings] = useState<number | null>(initial.servings);
  const [servingsFromSource, setServingsFromSource] = useState(initial.servingsFromSource);
  const [undo, setUndo] = useState<ServingsUndo | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>(initial.rows);
  const [lines, setLines] = useState<string[]>(initial.lines);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  const source = normalizeUrl(sourceUrl);
  const minutes = (raw: string) => (raw.trim() && Number.isFinite(Number(raw)) ? Math.max(0, Math.round(Number(raw))) : null);
  const quick = isQuick({ prep_time_minutes: minutes(prep), cook_time_minutes: minutes(cook) });
  const hasIngredient = rows.some((row) => row.name.trim().length > 0);

  // What "nothing to lose" means: the form still holds what it opened with.
  const snapshot = useMemo(
    () => JSON.stringify({ title, foodType, instructions, prep, cook, tags, visibility, sourceUrl, servings, rows: rows.map(({ name, amount, unit, optional }) => ({ name, amount, unit, optional })) }),
    [title, foodType, instructions, prep, cook, tags, visibility, sourceUrl, servings, rows],
  );
  const opened = useRef(snapshot);
  const dirty = snapshot !== opened.current;

  // A reload or a closed tab would drop the draft without a word; the browser's
  // own prompt is the only one that can stop that.
  useEffect(() => {
    if (!dirty || submitting) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, submitting]);

  const changeServings = (next: number) => {
    setServingsFromSource(false);
    if (servings == null || !hasAmounts(rows) || next === servings) {
      setServings(next);
      setUndo(null);
      return;
    }
    const { rows: scaled, before } = scaleRows(rows, servings, next);
    setRows(scaled);
    setServings(next);
    // A chain of changes (4 → 3 → 2) undoes to the amounts before the first:
    // "they were already for 2" means the original amounts, not the 3-person ones.
    setUndo({
      count: next,
      previous: undo?.previous ?? servings,
      before: undo ? new Map([...before, ...undo.before]) : before,
      written: new Map(scaled.map((row) => [row.id, row.amount])),
    });
  };

  const undoScaling = () => {
    if (!undo) return;
    setRows(unscaleRows(rows, undo.before, undo.written));
    setUndo(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (source.invalid) return setError(t("recipe-form.invalid-url"));
    if (servings == null || servings < 1) return setError(t("recipe-form.invalid-servings"));
    if (!hasIngredient) return setError(t("recipe-form.need-an-ingredient"));
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        // One spelling of "no method" on the wire (ADR 0007).
        instructions: instructions.trim() || null,
        food_type: foodType,
        ingredients: ingredientsPayload(rows, servings),
        source_url: source.url ?? undefined,
        prep_time_minutes: minutes(prep),
        cook_time_minutes: minutes(cook),
        tags,
        visibility,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.something-went-wrong"));
      setSubmitting(false);
    }
  };

  const cancel = () => (dirty ? setConfirmLeave(true) : onCancel());

  const original = origin && (
    <OriginalSource
      origin={origin}
      lines={lines}
      onReread={(draft) => {
        const next = rowsFromDraft(draft, locale, nextId);
        return {
          comparison: compareReadings(rows, next),
          apply: () => {
            setRows(next);
            setLines(draft.ingredient_lines);
            setUndo(null);
          },
        };
      }}
    />
  );

  return (
    <div className={origin ? "lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start lg:gap-8" : undefined}>
      <form onSubmit={handleSubmit} className="space-y-7">
        {error && (
          <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger-700 dark:text-danger">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="title" className={labelClass}>
            {t("recipe-form.title")} {t("common.required-marker")}
          </label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
            placeholder={simple ? t("recipe-form.title-placeholder-simple") : t("recipe-form.title-placeholder")}
          />
        </div>

        <div>
          <span className={labelClass}>
            {t("recipe-form.type")} {t("common.required-marker")}
          </span>
          <FoodTypePicker value={foodType} onChange={setFoodType} />
        </div>

        <section className="space-y-4" aria-labelledby="ingredients-heading">
          <div className="space-y-2">
            <h2 id="ingredients-heading" className="text-sm font-semibold text-fg">
              {t("recipe-form.ingredients")} {t("common.required-marker")}
            </h2>
            <ServingsField
              value={servings}
              onChange={changeServings}
              fromSource={servingsFromSource}
              undo={undo ? { count: undo.count, onUndo: undoScaling } : undefined}
            />
            <p className="text-xs text-muted">{simple ? t("recipe-form.servings-hint-simple") : t("recipe-form.servings-hint")}</p>
          </div>

          {original && <Disclosure label={t("recipe-form.original")} className="lg:hidden">{original}</Disclosure>}

          <IngredientReview rows={rows} onRowsChange={setRows} vocabulary={vocabulary} lines={lines.length} instructions={instructions} nextId={nextId} />
        </section>

        {showMethod ? (
          <div>
            <label htmlFor="instructions" className={labelClass}>
              {t("recipe-form.instructions")} <span className="font-normal text-muted">{t("common.optional-marker")}</span>
            </label>
            <textarea
              id="instructions"
              rows={simple ? 3 : 6}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className={`${fieldClass} resize-y leading-relaxed`}
              placeholder={t("recipe-form.instructions-placeholder")}
              aria-describedby="instructions-hint"
            />
            <p id="instructions-hint" className="mt-1.5 text-xs text-muted">
              {t("recipe-form.instructions-hint")}
            </p>
          </div>
        ) : (
          <Button variant="secondary" size="sm" icon={NotebookPen} onClick={() => setShowMethod(true)}>
            {t("recipe-form.add-steps")}
          </Button>
        )}

        <fieldset>
          <legend className={labelClass}>{t("recipe-form.times")}</legend>
          <div className="flex flex-wrap gap-3">
            <MinutesField id="prep" label={t("recipe-form.prep")} value={prep} onChange={setPrep} />
            <MinutesField id="cook" label={t("recipe-form.cook")} value={cook} onChange={setCook} />
          </div>
        </fieldset>

        <fieldset>
          <legend className={labelClass}>{t("recipe-form.tags")}</legend>
          <TagPicker value={tags} onChange={setTags} quick={quick} />
        </fieldset>

        <Switch
          checked={visibility === "kitchen"}
          onChange={(on) => setVisibility(on ? "kitchen" : "public")}
          label={t("recipe-form.kitchen-only")}
          hint={visibility === "kitchen" ? t("recipe-form.kitchen-only-on") : t("recipe-form.kitchen-only-off")}
        />

        <div className="rounded-2xl border border-dashed border-line p-4">
          <label htmlFor="source_url" className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Link2 className="h-4 w-4 text-muted" aria-hidden />
            {t("recipe-form.source")} <span className="font-normal text-muted">{t("common.optional")}</span>
          </label>
          <input
            id="source_url"
            type="text"
            inputMode="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className={source.invalid ? "w-full rounded-2xl border border-amber bg-surface px-4 py-3 text-fg focus:outline-none focus:ring-2 focus:ring-amber/40" : fieldClass}
            placeholder={t("recipe-form.source-placeholder")}
          />
          {source.invalid ? (
            <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber">{t("recipe-form.invalid-url-inline")}</p>
          ) : (
            source.url && (
              <div className="mt-2.5 flex items-center gap-2 text-xs text-muted">
                <span>{t("recipe-form.preview")}</span>
                <SourceLink url={source.url} />
              </div>
            )
          )}
        </div>

        {!hasIngredient && (
          <p id="submit-blocked" aria-live="polite" className="text-xs text-muted">
            {t("recipe-form.need-an-ingredient")}
          </p>
        )}

        <FormActions>
          <Button type="submit" icon={Save} disabled={submitting || !hasIngredient} aria-describedby={hasIngredient ? undefined : "submit-blocked"}>
            {submitting ? t("common.saving") : submitLabel}
          </Button>
          <Button variant="secondary" icon={X} onClick={cancel}>
            {t("common.cancel")}
          </Button>
        </FormActions>
      </form>

      {original && (
        <aside className="sticky top-24 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-3xl border border-line bg-surface-2/40 p-4 lg:block" aria-label={t("recipe-form.original")}>
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
            <FileText className="h-3.5 w-3.5" aria-hidden />
            {t("recipe-form.original")}
          </h2>
          {original}
        </aside>
      )}

      {confirmLeave && (
        <ConfirmModal
          title={t("recipe-form.leave-title")}
          message={t("recipe-form.leave-body")}
          confirmLabel={t("recipe-form.leave-confirm")}
          icon={<X className="h-4 w-4" aria-hidden />}
          onConfirm={async () => onCancel()}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}

/**
 * What the recipe was read from, beside the rows.
 *
 * Pasted text stays editable, and **"Volver a leer" says what would change
 * before it changes anything**: a second reading can come back different, and
 * the person's edits to the rows are worth more than the model's second opinion.
 * A link or a photo shows the lines it gave.
 */
function OriginalSource({
  origin,
  lines,
  onReread,
}: {
  origin: DraftOrigin;
  lines: string[];
  onReread: (draft: Awaited<ReturnType<typeof apiClient.importRecipe>>) => { comparison: { added: string[]; removed: string[] }; apply: () => void };
}) {
  const { t } = useI18n();
  const [text, setText] = useState(origin.kind === "text" ? origin.text : "");
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<{ comparison: { added: string[]; removed: string[] }; apply: () => void } | null>(null);

  if (origin.kind !== "text") {
    return (
      <div className="space-y-2 text-sm">
        {origin.kind === "url" && <SourceLink url={origin.url} />}
        <p className="text-xs text-muted">{origin.kind === "photo" ? t("recipe-form.original-photo") : t("recipe-form.original-link")}</p>
        <ol className="space-y-1 text-fg/90">
          {lines.map((line, i) => (
            <li key={i} className="leading-snug">
              {line}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const reread = async () => {
    setReading(true);
    setFailed(false);
    try {
      setPending(onReread(await apiClient.importRecipe({ text })));
    } catch {
      setFailed(true);
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPending(null);
        }}
        rows={10}
        aria-label={t("recipe-form.original")}
        className="w-full resize-y rounded-2xl border border-line bg-surface px-3.5 py-3 text-sm leading-relaxed text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      {pending ? (
        <div role="status" className="space-y-2.5 rounded-2xl bg-surface px-3.5 py-3 text-sm">
          {pending.comparison.added.length === 0 && pending.comparison.removed.length === 0 ? (
            <p className="text-fg">{t("recipe-form.reread-same")}</p>
          ) : (
            <ul className="space-y-1 text-fg">
              {pending.comparison.added.length > 0 && <li>{t("recipe-form.reread-added", { names: pending.comparison.added.join(", ") })}</li>}
              {pending.comparison.removed.length > 0 && <li>{t("recipe-form.reread-removed", { names: pending.comparison.removed.join(", ") })}</li>}
            </ul>
          )}
          <p className="text-xs text-muted">{t("recipe-form.reread-warning")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                pending.apply();
                setPending(null);
              }}
            >
              {t("recipe-form.reread-apply")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPending(null)}>
              {t("recipe-form.reread-keep")}
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" icon={RotateCcw} onClick={reread} disabled={reading || !text.trim()}>
          {reading ? t("recipe-start.reading") : t("recipe-form.reread")}
        </Button>
      )}
      {failed && <p className="text-xs text-amber-700 dark:text-amber">{t("recipe-start.failed")}</p>}
    </div>
  );
}

function Disclosure({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-2xl border border-line ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-2xl px-3.5 text-left text-sm font-semibold text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <span className="flex items-center gap-1.5">
          <FileText className="h-4 w-4 text-muted" aria-hidden />
          {label}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && <div className="px-3.5 pb-3.5">{children}</div>}
    </div>
  );
}

function MinutesField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (next: string) => void }) {
  const { t } = useI18n();
  return (
    <label htmlFor={id} className="flex items-center gap-2 rounded-2xl border border-line bg-surface py-1.5 pl-3.5 pr-3 text-sm text-muted focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
      <Clock className="h-4 w-4 shrink-0" aria-hidden />
      <span className="font-semibold text-fg">{label}</span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="–"
        className="h-8 w-14 bg-transparent text-right font-semibold tabular-nums text-fg focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span>{t("recipe-form.minutes")}</span>
    </label>
  );
}

/** An on/off setting with its consequence spelled out underneath. */
function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-line px-4 py-3.5">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Lock className="h-4 w-4 text-muted" aria-hidden />
          {label}
        </p>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${checked ? "bg-accent" : "bg-line"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}
