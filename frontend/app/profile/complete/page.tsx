"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import { apiClient, ApiError } from "@/lib/api-client";
import { SamMascot } from "@/components/brand/SamMascot";
import { Loader } from "@/components/ui/Loader";

const fieldClass =
  "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

export default function CompleteProfilePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    configureAmplify();
    (async () => {
      try {
        await getCurrentUser();
        const me = await apiClient.getMe();
        // Already chosen a name — nothing to do here.
        if (me.display_name) {
          router.replace("/dashboard");
          return;
        }
        setChecking(false);
      } catch {
        router.replace("/");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiClient.updateDisplayName(displayName.trim());
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("That name is already taken — pick another.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to save your name.");
      }
      setSaving(false);
    }
  };

  if (checking) return <Loader />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg bg-paws p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <SamMascot className="mx-auto h-44 w-44" />
          <h1 className="mt-4 font-display text-3xl font-bold text-fg">
            One more sniff!
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-balance text-muted">
            What should SAM call you? This is how you&apos;ll appear as the author of
            your recipes.
          </p>
        </div>

        <div className="rounded-4xl border border-line bg-surface p-7 shadow-paw sm:p-8">
          {error && (
            <div className="mb-5 rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
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
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={fieldClass}
                placeholder="e.g. Manel"
              />
            </div>

            <button
              type="submit"
              disabled={saving || displayName.trim().length === 0}
              className="flex w-full cursor-pointer items-center justify-center rounded-full bg-tomato py-3 px-4 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              {saving ? "Saving…" : "Let's go"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
