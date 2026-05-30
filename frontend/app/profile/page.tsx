"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import { apiClient, ApiError, type Recipe } from "@/lib/api-client";
import { FOOD_TYPES } from "@/lib/constants";
import { ArrowLeft, User } from "lucide-react";

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [myRecipes, setMyRecipes] = useState<Recipe[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    configureAmplify();
    (async () => {
      try {
        await getCurrentUser();
        const [me, recipes] = await Promise.all([apiClient.getMe(), apiClient.listRecipes()]);
        setEmail(me.email);
        setDisplayName(me.display_name);
        setSavedName(me.display_name);
        setMyRecipes(recipes.filter((r) => r.created_by === me.id));
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
      setSavedName(updated.display_name);
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard")}
            className="p-1.5 -ml-1 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Back to recipes"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <User className="w-6 h-6 text-indigo-600 shrink-0" />
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Profile</h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Display-name editor */}
        <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Account</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
            Your display name is shown as the author of your recipes.
          </p>

          {error && (
            <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          {saved && !error && (
            <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded-lg text-sm">
              Saved.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
              <input
                type="email"
                value={email}
                disabled
                className="block w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              />
            </div>
            <div>
              <label
                htmlFor="displayName"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
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
                className="appearance-none block w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent dark:bg-gray-700"
                placeholder="e.g. Manel"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !dirty}
              className="px-4 py-2.5 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </form>
        </section>

        {/* My recipes */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Your recipes <span className="text-gray-400 dark:text-gray-500 font-normal">({myRecipes.length})</span>
          </h2>

          {myRecipes.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400">You haven&apos;t created any recipes yet.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {myRecipes.map((recipe) => {
                const meta = FOOD_TYPES.find((f) => f.value === recipe.food_type);
                return (
                  <li key={recipe.id}>
                    <button
                      onClick={() => router.push(`/recipes?id=${recipe.id}`)}
                      className="w-full flex items-center justify-between px-5 py-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-indigo-200 dark:hover:border-indigo-700 hover:shadow-sm transition-all text-left group"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="text-lg shrink-0">{meta?.emoji}</span>
                        <span className="font-medium text-gray-900 dark:text-white group-hover:text-indigo-700 dark:group-hover:text-indigo-300 truncate transition-colors">
                          {recipe.title}
                        </span>
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 ml-4">
                        {recipe.ingredients.items.length} ingredients
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
