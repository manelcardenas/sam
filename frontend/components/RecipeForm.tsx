"use client";

import { useState } from "react";
import { Save, X, Link2 } from "lucide-react";
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

interface RecipeFormProps {
  initialData?: CreateRecipeInput;
  onSubmit: (data: CreateRecipeInput) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}

/** Convert IngredientsData items to a newline-separated string for the textarea. */
function itemsToText(ingredients: IngredientsData): string {
  return ingredients.items.map((item) => item.name).join("\n");
}

/** Convert a newline-separated string back to IngredientsData. */
function textToIngredients(text: string): IngredientsData {
  const items = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((name) => ({ name }));
  return { servings: null, items };
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
  const [formData, setFormData] = useState<CreateRecipeInput>({
    title: initialData?.title ?? "",
    instructions: initialData?.instructions ?? "",
    ingredients: initialData?.ingredients ?? { servings: null, items: [] },
    food_type: initialData?.food_type ?? "comida",
  });
  const [ingredientsText, setIngredientsText] = useState(
    initialData ? itemsToText(initialData.ingredients) : "",
  );
  const [sourceUrl, setSourceUrl] = useState(initialData?.source_url ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const source = normalizeUrl(sourceUrl);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (source.invalid) {
      setError("The source link doesn't look like a valid URL.");
      return;
    }
    setSubmitting(true);
    try {
      const ingredients = textToIngredients(ingredientsText);
      // Omit the key when empty so the backend stores NULL (clears it on edit).
      await onSubmit({ ...formData, ingredients, source_url: source.url ?? undefined });
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
        <label htmlFor="ingredients" className={labelClass}>
          Ingredients * <span className="font-normal text-muted">(one per line)</span>
        </label>
        <textarea
          id="ingredients"
          required
          rows={6}
          value={ingredientsText}
          onChange={(e) => setIngredientsText(e.target.value)}
          className={`${fieldClass} resize-none font-mono text-sm`}
          placeholder={"2 cups flour\n1 cup sugar\n2 eggs"}
        />
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
