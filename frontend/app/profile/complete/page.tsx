"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthGate } from "@/components/auth/useAuthGate";
import { useMe } from "@/components/auth/UserProvider";
import { apiClient, ApiError } from "@/lib/api-client";
import { SamMascot } from "@/components/brand/SamMascot";
import { Loader } from "@/components/ui/Loader";
import { useI18n } from "@/lib/i18n/LocaleProvider";

const fieldClass =
  "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

export default function CompleteProfilePage() {
  const { t } = useI18n();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // requireDisplayName is off here: this *is* the page that collects one, so
  // the usual gate would bounce the user straight back to itself.
  const { me, status } = useAuthGate({ requireDisplayName: false });
  const { setMe } = useMe();

  useEffect(() => {
    if (status === "loading") return;
    // Already chosen a name — nothing to do here.
    if (me?.display_name) {
      router.replace("/dashboard");
      return;
    }
    if (status === "ready") setChecking(false);
  }, [status, me?.display_name, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      // Push the new profile into the session cache before navigating —
      // otherwise /dashboard reads a cached display_name of null and bounces
      // the user straight back here.
      setMe(await apiClient.updateDisplayName(displayName.trim()));
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("complete-profile.name-taken"));
      } else {
        setError(err instanceof Error ? err.message : t("complete-profile.save-failed"));
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
            {t("complete-profile.title")}
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-balance text-muted">
            {t("complete-profile.body")}
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
                {t("complete-profile.display-name")}
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
                placeholder={t("complete-profile.display-name-placeholder")}
              />
            </div>

            <button
              type="submit"
              disabled={saving || displayName.trim().length === 0}
              className="flex w-full cursor-pointer items-center justify-center rounded-full bg-tomato py-3 px-4 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              {saving ? t("common.saving") : t("complete-profile.submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
