"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import { apiClient, ApiError, type Recipe, type UserReview, type UserStats } from "@/lib/api-client";
import { FOOD_TYPES } from "@/lib/constants";
import { AppShell } from "@/components/shell/AppShell";
import { Loader } from "@/components/ui/Loader";
import { StatsStrip } from "@/components/profile/StatsStrip";
import { QuoteBlock, ScoreBadge } from "@/components/dine/atoms";
import { formatRelativeDate, formatVisitedDate } from "@/lib/format";
import { Check, UtensilsCrossed } from "lucide-react";

const fieldClass =
  "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [myRecipes, setMyRecipes] = useState<Recipe[]>([]);
  const [myReviews, setMyReviews] = useState<UserReview[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    configureAmplify();
    (async () => {
      try {
        await getCurrentUser();
        const [me, recipes, reviews, userStats] = await Promise.all([
          apiClient.getMe(),
          apiClient.listRecipes(),
          apiClient.listMyReviews(),
          apiClient.getMyStats(),
        ]);
        setEmail(me.email);
        setDisplayName(me.display_name ?? "");
        setSavedName(me.display_name ?? "");
        // TODO: recipes are still filtered client-side because /recipes has no
        // `mine` filter yet — unlike reviews, which are fetched already scoped.
        // Worth adding for symmetry once the recipe list grows.
        setMyRecipes(recipes.filter((r) => r.created_by === me.id));
        setMyReviews(reviews);
        setStats(userStats);
        setLoading(false);
      } catch {
        router.replace("/");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      const updated = await apiClient.updateDisplayName(displayName.trim());
      setSavedName(updated.display_name ?? "");
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("That name is already taken — pick another.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to save your name.");
      }
    } finally {
      setSaving(false);
    }
  };

  const trimmed = displayName.trim();
  const dirty = trimmed.length > 0 && trimmed !== savedName;

  if (loading) return <Loader />;

  return (
    <AppShell userName={savedName || displayName}>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">Your profile</h1>
        <p className="mt-1 text-muted">Everything you&apos;ve cooked up, and everywhere you&apos;ve eaten.</p>
      </header>

      <div className="space-y-8">
        {stats && <StatsStrip stats={stats} />}
        {/* Account editor */}
        <section className="rounded-4xl border border-line bg-surface p-6 shadow-paw">
          <h2 className="font-display text-lg font-semibold text-fg">Account</h2>
          <p className="mb-5 mt-0.5 text-sm text-muted">
            Your display name is shown as the author of your recipes.
          </p>

          {error && (
            <div className="mb-4 rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
              {error}
            </div>
          )}
          {saved && !error && (
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber">
              <Check className="h-4 w-4" />
              Saved.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-fg">Email</label>
              <input
                type="email"
                value={email}
                disabled
                className="w-full cursor-not-allowed rounded-2xl border border-line bg-surface-2 px-4 py-3 text-muted"
              />
            </div>
            <div>
              <label htmlFor="displayName" className="mb-1.5 block text-sm font-semibold text-fg">
                Display name
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                required
                maxLength={50}
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setSaved(false);
                }}
                className={fieldClass}
                placeholder="e.g. Manel"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !dirty}
              className="cursor-pointer rounded-full bg-tomato py-3 px-5 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </form>
        </section>

        {/* My recipes */}
        <section>
          <SectionHeading title="Your recipes" count={myRecipes.length} />

          {myRecipes.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line bg-surface py-12 text-center text-muted">
              You haven&apos;t created any recipes yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {myRecipes.map((recipe, i) => {
                const meta = FOOD_TYPES.find((f) => f.value === recipe.food_type);
                return (
                  <li
                    key={recipe.id}
                    className="will-fetch animate-fetch-in"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <button
                      onClick={() => router.push(`/recipes?id=${recipe.id}`)}
                      className="group flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-5 py-4 text-left transition-all hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg"
                          style={{ backgroundColor: `${meta?.accent ?? "#E4572E"}22` }}
                        >
                          {meta?.emoji}
                        </span>
                        <span className="truncate font-display font-semibold text-fg transition-colors group-hover:text-tomato">
                          {recipe.title}
                        </span>
                      </span>
                      <span className="ml-4 shrink-0 text-xs text-muted">
                        {recipe.ingredients.items.length} ingredients
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* My reviews — fetched already scoped to the signed-in user. */}
        <section>
          <SectionHeading title="Your reviews" count={myReviews.length} />

          {myReviews.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line bg-surface px-6 py-12 text-center">
              <UtensilsCrossed className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden />
              <p className="text-muted">You haven&apos;t reviewed anywhere yet.</p>
              <button
                onClick={() => router.push("/dine")}
                className="mt-4 inline-flex cursor-pointer items-center rounded-full border border-line bg-surface px-4 py-2.5 font-display text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                Find somewhere to eat
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {myReviews.map((review, i) => (
                <li
                  key={review.id}
                  // Stagger capped: past the first screenful the cascade reads as lag.
                  className={i < 8 ? "will-fetch animate-fetch-in" : undefined}
                  style={i < 8 ? { animationDelay: `${i * 40}ms` } : undefined}
                >
                  <article className="group relative rounded-3xl border border-line bg-surface p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-display text-[1.05rem] font-semibold leading-snug text-fg transition-colors group-hover:text-tomato">
                          <button
                            type="button"
                            onClick={() => router.push("/dine")}
                            className="block w-full cursor-pointer text-left focus:outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-2 focus-visible:after:ring-tomato/50"
                          >
                            <span className="line-clamp-2">{review.restaurant_name}</span>
                          </button>
                        </h3>
                        <p
                          className="mt-1 text-[0.8rem] text-muted"
                          title={formatVisitedDate(review.visited_at)}
                        >
                          Visited {formatRelativeDate(review.visited_at)}
                        </p>
                      </div>
                      <ScoreBadge score={review.overall} />
                    </div>

                    {review.comment && (
                      <QuoteBlock comment={review.comment} className="mt-4" />
                    )}
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

/** Shared heading for the profile's list sections. */
function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-4 flex items-baseline gap-2 font-serif text-xl font-semibold italic text-fg">
      {title}
      <span className="font-sans text-sm font-semibold not-italic tabular-nums text-muted">
        {count}
      </span>
    </h2>
  );
}
