"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import { apiClient, ApiError, type Recipe } from "@/lib/api-client";
import { FOOD_TYPES } from "@/lib/constants";
import { ArrowLeft } from "lucide-react";
import SourceLink from "@/components/SourceLink";
import { AppShell } from "@/components/shell/AppShell";
import { Loader } from "@/components/ui/Loader";

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

  if (loading) return <Loader />;

  const meta = recipe ? FOOD_TYPES.find((f) => f.value === recipe.food_type) : undefined;

  return (
    <AppShell>
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      {notFound || !recipe ? (
        <div className="rounded-4xl border border-dashed border-line bg-surface py-16 text-center">
          <p className="text-muted">This recipe doesn&apos;t exist (or was deleted).</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-5 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-tomato px-4 py-2.5 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95"
          >
            Back to recipes
          </button>
        </div>
      ) : (
        <article className="overflow-hidden rounded-4xl border border-line bg-surface shadow-paw">
          <div className="border-b border-line px-6 py-5">
            {meta && (
              <span
                className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold"
                style={{ backgroundColor: `${meta.accent}22`, color: meta.accent }}
              >
                {meta.emoji} {meta.label}
              </span>
            )}
            <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">
              {recipe.title}
            </h1>
            <p className="mt-1 text-xs text-muted">
              By {recipe.created_by_name ?? "Unknown"} · Created{" "}
              {new Date(recipe.created_at).toLocaleDateString()} · Updated{" "}
              {new Date(recipe.updated_at).toLocaleDateString()}
            </p>
            {recipe.source_url && (
              <div className="mt-2">
                <SourceLink url={recipe.source_url} />
              </div>
            )}
          </div>

          <div className="space-y-6 px-6 py-6">
            <section>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                Instructions
              </h2>
              <p className="whitespace-pre-line leading-relaxed text-fg/90">
                {recipe.instructions}
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">
                Ingredients ({recipe.ingredients.items.length})
                {recipe.ingredients.servings && (
                  <span className="ml-2 font-normal normal-case tracking-normal">
                    · {recipe.ingredients.servings} servings
                  </span>
                )}
              </h2>
              <ul className="space-y-2">
                {recipe.ingredients.items.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-fg/90">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-tomato" />
                    {item.amount != null && item.unit
                      ? `${item.amount} ${item.unit} ${item.name}`
                      : item.amount != null
                        ? `${item.amount} ${item.name}`
                        : item.name}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </article>
      )}
    </AppShell>
  );
}

export default function RecipePage() {
  // useSearchParams must be inside a Suspense boundary for static export.
  return (
    <Suspense fallback={<Loader />}>
      <RecipeDetail />
    </Suspense>
  );
}
