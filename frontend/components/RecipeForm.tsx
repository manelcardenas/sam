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
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="title"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >
          Title *
        </label>
        <input
          id="title"
          type="text"
          required
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
          placeholder="e.g. Lasaña de verduras"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          Type *
        </label>
        <div className="grid grid-cols-4 gap-2">
          {FOOD_TYPES.map(({ value, label, emoji }) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                setFormData({ ...formData, food_type: value as FoodType })
              }
              className={`flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-xl border-2 font-medium text-sm transition-all duration-150 ${
                formData.food_type === value
                  ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 shadow-sm scale-105"
                  : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-indigo-300 dark:hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              <span className="text-2xl">{emoji}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor="instructions"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >
          Instructions *
        </label>
        <textarea
          id="instructions"
          required
          rows={3}
          value={formData.instructions}
          onChange={(e) =>
            setFormData({ ...formData, instructions: e.target.value })
          }
          className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white resize-none"
          placeholder="Recipe steps..."
        />
      </div>

      <div>
        <label
          htmlFor="ingredients"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >
          Ingredients * <span className="text-gray-400 font-normal">(one per line)</span>
        </label>
        <textarea
          id="ingredients"
          required
          rows={6}
          value={ingredientsText}
          onChange={(e) => setIngredientsText(e.target.value)}
          className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white font-mono text-sm resize-none"
          placeholder={"2 cups flour\n1 cup sugar\n2 eggs"}
        />
      </div>

      {/* Source — optional. Stored as a clean link, shown as the site's name. */}
      <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-4">
        <label
          htmlFor="source_url"
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
        >
          <Link2 className="w-4 h-4 text-gray-400" />
          Source <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2.5">
          Where the recipe comes from. We&apos;ll show just the site, not the full link.
        </p>
        <input
          id="source_url"
          type="text"
          inputMode="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${
            source.invalid
              ? "border-amber-400 focus:ring-amber-400"
              : "border-gray-300 dark:border-gray-600 focus:ring-indigo-500"
          }`}
          placeholder="recetasdecocina.elmundo.es/..."
        />
        {source.invalid ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            That doesn&apos;t look like a valid URL.
          </p>
        ) : (
          source.url && (
            <div className="mt-2.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
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
          className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          <Save className="w-4 h-4" />
          {submitting ? "Saving..." : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <X className="w-4 h-4 inline mr-1" />
          Cancel
        </button>
      </div>
    </form>
  );
}
