"use client";

import { useRef, useState } from "react";
import { Save, X, Link2, Users } from "lucide-react";
import type { FoodType } from "@/lib/constants";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { CreateRecipeInput, IngredientsData } from "@/lib/api-client";
import { IngredientCapture, type CaptureRow } from "@/components/IngredientCapture";
import { FoodTypePicker } from "@/components/FoodTypePicker";
import SourceLink from "@/components/SourceLink";

/** Add https:// if the user typed a bare host, then validate. Returns the
 * normalized URL, or null if blank/invalid. */
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

interface RecipeFormInitialData {
  title: string;
  /** `null` when nobody wrote the method down — the form shows it as empty. */
  instructions: string | null;
  /** `servings` may be null — recipes created before this field existed. */
  ingredients: IngredientsData;
  food_type: FoodType;
  source_url?: string;
  prep_time_minutes?: number | null;
  cook_time_minutes?: number | null;
}

interface RecipeFormProps {
  initialData?: RecipeFormInitialData;
  onSubmit: (data: CreateRecipeInput) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}

/**
 * Existing ingredients, as review rows.
 *
 * **Empty for a new recipe**, which is what puts `IngredientCapture` into its
 * text box; editing a saved recipe opens straight into the table with no parse
 * and no API call. The old version seeded one blank row here, back when a blank
 * row *was* the entry point.
 */
function rowsFromIngredients(ingredients?: IngredientsData): CaptureRow[] {
  return (ingredients?.items ?? []).map((item, idx) => ({
    id: idx,
    name: item.name,
    amount: item.amount != null ? String(item.amount) : "",
    unit: item.unit ?? "",
  }));
}

const fieldClass =
  "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

const labelClass = "mb-1.5 block text-sm font-semibold text-fg";

export default function RecipeForm({
  initialData,
  onSubmit,
  onCancel,
  submitLabel,
}: RecipeFormProps) {
  const { t } = useI18n();
  const [formData, setFormData] = useState({
    title: initialData?.title ?? "",
    instructions: initialData?.instructions ?? "",
    food_type: initialData?.food_type ?? ("comida" as FoodType),
  });
  const [servings, setServings] = useState(
    initialData?.ingredients.servings != null ? String(initialData.ingredients.servings) : "",
  );
  const [rows, setRows] = useState<CaptureRow[]>(() => rowsFromIngredients(initialData?.ingredients));
  const nextRowId = useRef(rows.length);
  const nextId = () => nextRowId.current++;
  const [sourceUrl, setSourceUrl] = useState(initialData?.source_url ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const source = normalizeUrl(sourceUrl);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (source.invalid) {
      setError(t("recipe-form.invalid-url"));
      return;
    }
    const servingsNum = Math.round(Number(servings));
    if (!servings.trim() || !Number.isFinite(servingsNum) || servingsNum < 1) {
      setError(t("recipe-form.invalid-servings"));
      return;
    }
    const items = rows
      .map((row) => ({
        name: row.name.trim(),
        amount: row.amount.trim() ? Number(row.amount) : undefined,
        unit: row.unit.trim() || undefined,
      }))
      .filter((item) => item.name.length > 0);
    if (items.length === 0) {
      setError(t("recipe-form.need-an-ingredient"));
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        ...formData,
        // Blank becomes null rather than "": one spelling of "no method" on the
        // wire, so the ADR-0007 lens is a single test everywhere behind it. The
        // API normalises this too — doing it here as well means the optimistic
        // local copy agrees with what comes back.
        instructions: formData.instructions.trim() || null,
        ingredients: { servings: servingsNum, items },
        // Omit the key when empty so the backend stores NULL (clears it on edit).
        source_url: source.url ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.something-went-wrong"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
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
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className={fieldClass}
          placeholder={t("recipe-form.title-placeholder")}
        />
      </div>

      <div>
        <label className={labelClass}>
          {t("recipe-form.type")} {t("common.required-marker")}
        </label>
        <FoodTypePicker value={formData.food_type} onChange={(food_type) => setFormData({ ...formData, food_type })} />
      </div>

      {/* Optional, and the hint below says why rather than leaving the marker
          to imply "you forgot": a recipe you already know how to make is worth
          saving for its ingredients alone, and the method can be written in
          later (docs/adr/0007). */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <label htmlFor="instructions" className="block text-sm font-semibold text-fg">
            {t("recipe-form.instructions")}{" "}
            <span className="font-normal text-muted">{t("common.optional-marker")}</span>
          </label>
        </div>
        <textarea
          id="instructions"
          rows={3}
          value={formData.instructions}
          onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
          className={`${fieldClass} resize-none`}
          placeholder={t("recipe-form.instructions-placeholder")}
          aria-describedby="instructions-hint"
        />
        <p id="instructions-hint" className="mt-1.5 text-xs text-muted">
          {t("recipe-form.instructions-hint")}
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="block text-sm font-semibold text-fg">
          {t("recipe-form.ingredients")} {t("common.required-marker")}
        </span>
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-muted" />
            <label htmlFor="servings" className="text-xs font-semibold text-muted">
              {t("recipe-form.servings")} {t("common.required-marker")}
            </label>
            <input
              id="servings"
              type="number"
              min={1}
              step={1}
              required
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              className="w-14 rounded-lg border border-line bg-surface px-2 py-1 text-center text-sm font-semibold text-fg focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
              placeholder={t("recipe-form.servings-placeholder")}
            />
          </div>
        </div>
        <p className="mb-2.5 text-xs text-muted">
          {t("recipe-form.servings-hint")}
        </p>

        <IngredientCapture rows={rows} onRowsChange={setRows} servings={Math.max(1, Math.round(Number(servings)) || 1)} nextId={nextId} />
      </div>

      {/* Source — optional. Stored as a clean link, shown as the site's name. */}
      <div className="rounded-2xl border border-dashed border-line p-4">
        <label
          htmlFor="source_url"
          className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg"
        >
          <Link2 className="h-4 w-4 text-muted" />
          {t("recipe-form.source")}{" "}
          <span className="font-normal text-muted">{t("common.optional")}</span>
        </label>
        <p className="mb-2.5 text-xs text-muted">
          {t("recipe-form.source-hint")}
        </p>
        <input
          id="source_url"
          type="text"
          inputMode="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className={
            source.invalid
              ? "w-full rounded-2xl border border-amber bg-surface px-4 py-3 text-fg focus:outline-none focus:ring-2 focus:ring-amber/40"
              : fieldClass
          }
          placeholder={t("recipe-form.source-placeholder")}
        />
        {source.invalid ? (
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber">
            {t("recipe-form.invalid-url-inline")}
          </p>
        ) : (
          source.url && (
            <div className="mt-2.5 flex items-center gap-2 text-xs text-muted">
              <span>{t("recipe-form.preview")}</span>
              <SourceLink url={source.url} />
            </div>
          )
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-tomato py-3 px-4 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <Save className="h-4 w-4" />
          {submitting ? t("common.saving") : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-5 py-3 font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <X className="h-4 w-4" />
          Cancel
        </button>
      </div>
    </form>
  );
}
