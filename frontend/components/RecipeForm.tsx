"use client";

import { useRef, useState } from "react";
import { Save, X, Link2, Plus, Trash2, Users } from "lucide-react";
import { FOOD_TYPES, type FoodType } from "@/lib/constants";
import type { CreateRecipeInput, IngredientsData } from "@/lib/api-client";
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
  instructions: string;
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

interface IngredientRow {
  id: number;
  name: string;
  amount: string;
  unit: string;
}

function rowsFromIngredients(ingredients?: IngredientsData): IngredientRow[] {
  const items = ingredients?.items ?? [];
  if (items.length === 0) return [{ id: 0, name: "", amount: "", unit: "" }];
  return items.map((item, idx) => ({
    id: idx,
    name: item.name,
    amount: item.amount != null ? String(item.amount) : "",
    unit: item.unit ?? "",
  }));
}

const fieldClass =
  "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

/** Denser variant for repeated ingredient-row inputs, sized via flex/width utilities instead of `w-full`. */
const rowFieldClass =
  "rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

const labelClass = "mb-1.5 block text-sm font-semibold text-fg";

export default function RecipeForm({
  initialData,
  onSubmit,
  onCancel,
  submitLabel,
}: RecipeFormProps) {
  const [formData, setFormData] = useState({
    title: initialData?.title ?? "",
    instructions: initialData?.instructions ?? "",
    food_type: initialData?.food_type ?? ("comida" as FoodType),
  });
  const [servings, setServings] = useState(
    initialData?.ingredients.servings != null ? String(initialData.ingredients.servings) : "",
  );
  const [rows, setRows] = useState<IngredientRow[]>(() => rowsFromIngredients(initialData?.ingredients));
  const nextRowId = useRef(rows.length);
  const [sourceUrl, setSourceUrl] = useState(initialData?.source_url ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const source = normalizeUrl(sourceUrl);

  const updateRow = (id: number, patch: Partial<IngredientRow>) =>
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addRow = () =>
    setRows((prev) => [...prev, { id: nextRowId.current++, name: "", amount: "", unit: "" }]);

  const removeRow = (id: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (source.invalid) {
      setError("The source link doesn't look like a valid URL.");
      return;
    }
    const servingsNum = Math.round(Number(servings));
    if (!servings.trim() || !Number.isFinite(servingsNum) || servingsNum < 1) {
      setError("Servings must be a whole number of 1 or more.");
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
      setError("Add at least one ingredient.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        ...formData,
        ingredients: { servings: servingsNum, items },
        // Omit the key when empty so the backend stores NULL (clears it on edit).
        source_url: source.url ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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
          Title *
        </label>
        <input
          id="title"
          type="text"
          required
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className={fieldClass}
          placeholder="e.g. Lasaña de verduras"
        />
      </div>

      <div>
        <label className={labelClass}>Type *</label>
        <div className="grid grid-cols-4 gap-2">
          {FOOD_TYPES.map(({ value, label, emoji, accent }) => {
            const selected = formData.food_type === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFormData({ ...formData, food_type: value as FoodType })}
                style={
                  selected
                    ? { borderColor: accent, backgroundColor: `${accent}1f` }
                    : undefined
                }
                className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 py-3 text-sm font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40 ${
                  selected
                    ? "scale-105 text-fg shadow-pop"
                    : "border-line text-muted hover:border-tomato/40 hover:text-fg"
                }`}
              >
                <span className="text-2xl">{emoji}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="instructions" className={labelClass}>
          Instructions *
        </label>
        <textarea
          id="instructions"
          required
          rows={3}
          value={formData.instructions}
          onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
          className={`${fieldClass} resize-none`}
          placeholder="Recipe steps..."
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="block text-sm font-semibold text-fg">Ingredients *</span>
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-muted" />
            <label htmlFor="servings" className="text-xs font-semibold text-muted">
              Servings *
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
              placeholder="4"
            />
          </div>
        </div>
        <p className="mb-2.5 text-xs text-muted">
          The number of people these amounts feed — lets anyone viewing the recipe scale it up or down later.
        </p>

        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                type="text"
                value={row.name}
                onChange={(e) => updateRow(row.id, { name: e.target.value })}
                placeholder={idx === 0 ? "e.g. flour" : "ingredient"}
                aria-label="Ingredient name"
                className={`${rowFieldClass} min-w-0 flex-1`}
              />
              <input
                type="number"
                step="any"
                value={row.amount}
                onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                placeholder="amount"
                aria-label="Amount"
                className={`${rowFieldClass} w-20 text-center`}
              />
              <input
                type="text"
                value={row.unit}
                onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                placeholder="unit"
                aria-label="Unit"
                className={`${rowFieldClass} w-20`}
              />
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                disabled={rows.length === 1}
                aria-label="Remove ingredient"
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="mt-2.5 flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-line px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add ingredient
        </button>
      </div>

      {/* Source — optional. Stored as a clean link, shown as the site's name. */}
      <div className="rounded-2xl border border-dashed border-line p-4">
        <label
          htmlFor="source_url"
          className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-fg"
        >
          <Link2 className="h-4 w-4 text-muted" />
          Source <span className="font-normal text-muted">(optional)</span>
        </label>
        <p className="mb-2.5 text-xs text-muted">
          Where the recipe comes from. We&apos;ll show just the site, not the full link.
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
          placeholder="recetasdecocina.elmundo.es/..."
        />
        {source.invalid ? (
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber">
            That doesn&apos;t look like a valid URL.
          </p>
        ) : (
          source.url && (
            <div className="mt-2.5 flex items-center gap-2 text-xs text-muted">
              <span>Preview:</span>
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
          {submitting ? "Saving…" : submitLabel}
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
