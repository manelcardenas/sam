"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import { apiClient, ApiError, type Recipe } from "@/lib/api-client";
import { FOOD_TYPES } from "@/lib/constants";
import { ArrowLeft } from "lucide-react";
import SourceLink from "@/components/SourceLink";

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
        <p className="mt-4 text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    </div>
  );
}

function RecipeDetail() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const [loading, setLoading] = useState(true);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    configureAmplify();
    (async () => {
      try {
        await getCurrentUser();
        if (!id) {
          setNotFound(true);
          return;
        }
        const data = await apiClient.getRecipe(id);
        setRecipe(data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          router.replace("/");
          return;
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <Loading />;

  const meta = recipe ? FOOD_TYPES.find((f) => f.value === recipe.food_type) : undefined;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 -ml-1 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">
            {recipe ? recipe.title : "Recipe"}
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        {notFound || !recipe ? (
          <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">This recipe doesn&apos;t exist (or was deleted).</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Back to recipes
            </button>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            {/* Title bar */}
            <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700">
              {meta && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 mb-2">
                  {meta.emoji} {meta.label}
                </span>
              )}
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{recipe.title}</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                By {recipe.created_by_name ?? "Unknown"} &middot; Created{" "}
                {new Date(recipe.created_at).toLocaleDateString()} &middot; Updated{" "}
                {new Date(recipe.updated_at).toLocaleDateString()}
              </p>
              {recipe.source_url && (
                <div className="mt-2">
                  <SourceLink url={recipe.source_url} />
                </div>
              )}
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-6">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                  Instructions
                </h3>
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                  {recipe.instructions}
                </p>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                  Ingredients ({recipe.ingredients.items.length})
                  {recipe.ingredients.servings && (
                    <span className="ml-2 font-normal text-gray-400 dark:text-gray-500">
                      · {recipe.ingredients.servings} servings
                    </span>
                  )}
                </h3>
                <ul className="space-y-1.5">
                  {recipe.ingredients.items.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-gray-700 dark:text-gray-300">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                      {item.amount != null && item.unit
                        ? `${item.amount} ${item.unit} ${item.name}`
                        : item.amount != null
                          ? `${item.amount} ${item.name}`
                          : item.name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function RecipePage() {
  // useSearchParams must be inside a Suspense boundary for static export.
  return (
    <Suspense fallback={<Loading />}>
      <RecipeDetail />
    </Suspense>
  );
}
