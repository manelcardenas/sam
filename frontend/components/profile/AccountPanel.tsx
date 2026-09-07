"use client";

import { useEffect, useRef, useState } from "react";
import { Check, LogOut } from "lucide-react";
import { apiClient, ApiError, type UserProfile } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/LocaleProvider";

const fieldClass =
  "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

/**
 * Email, display name and sign out.
 *
 * This used to sit between the stats and the content on a single-scroll page —
 * §1a of the plan: the one form nobody touches, directly above the two lists
 * everybody came for. Behind a tab it costs one tap when you want it and
 * nothing when you don't.
 *
 * Sign out is here as well as in the shell's header because a settings panel
 * without one sends you hunting; the header copy stays for the other pages.
 */
export function AccountPanel({
  me,
  onSaved,
  onSignOut,
}: {
  me: UserProfile;
  /** Lifted so the session cache and the header name update together. */
  onSaved: (updated: UserProfile) => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(me.display_name ?? "");
  const [savedName, setSavedName] = useState(me.display_name ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // The last value taken from the server, tracked in a ref rather than read
  // back out of state: this effect needs to know whether the *field* still
  // holds the server's value or the user has started typing over it, and a
  // state updater is not allowed to have side effects — under
  // `reactStrictMode` React may invoke it twice.
  const lastSynced = useRef(me.display_name ?? "");

  // Keeps the field in step when the name changes elsewhere (or arrives from a
  // background revalidation) without clobbering an edit in progress.
  useEffect(() => {
    const incoming = me.display_name ?? "";
    if (incoming === lastSynced.current) return;
    setDisplayName((current) => (current === lastSynced.current ? incoming : current));
    setSavedName(incoming);
    lastSynced.current = incoming;
  }, [me.display_name]);

  const trimmed = displayName.trim();
  const dirty = trimmed.length > 0 && trimmed !== savedName;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      const updated = await apiClient.updateDisplayName(trimmed);
      setSavedName(updated.display_name ?? "");
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("profile.name-taken"));
      } else {
        setError(err instanceof Error ? err.message : t("profile.save-failed"));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-4xl border border-line bg-surface p-6 shadow-paw">
        <h2 className="font-display text-lg font-semibold text-fg">{t("profile.account-title")}</h2>
        <p className="mb-5 mt-0.5 text-sm text-muted">
          {t("profile.account-body")}
        </p>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato"
          >
            {error}
          </div>
        )}
        {saved && !error && (
          <div
            role="status"
            className="mb-4 flex items-center gap-2 rounded-2xl border border-leaf/40 bg-leaf/10 px-4 py-3 text-sm font-medium text-leaf-700 dark:text-leaf"
          >
            <Check className="h-4 w-4" aria-hidden />
            {t("profile.saved")}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="accountEmail" className="mb-1.5 block text-sm font-semibold text-fg">
              {t("profile.email")}
            </label>
            <input
              id="accountEmail"
              type="email"
              value={me.email}
              disabled
              className="w-full cursor-not-allowed rounded-2xl border border-line bg-surface-2 px-4 py-3 text-muted"
            />
            {/* The field is disabled, so say why rather than leaving it to be
                discovered by tapping it. */}
            <p className="mt-1.5 text-xs text-muted">
              {t("profile.email-hint")}
            </p>
          </div>
          <div>
            <label htmlFor="displayName" className="mb-1.5 block text-sm font-semibold text-fg">
              {t("profile.display-name")}
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
              placeholder={t("profile.display-name-placeholder")}
            />
          </div>
          <button
            type="submit"
            disabled={saving || !dirty}
            className="cursor-pointer rounded-full bg-tomato px-5 py-3 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            {saving ? t("common.saving") : t("common.save-changes")}
          </button>
        </form>
      </section>

      <button
        type="button"
        onClick={onSignOut}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-3xl border border-line bg-surface px-4 py-3.5 font-display text-sm font-semibold text-muted transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {t("shell.sign-out")}
      </button>
    </div>
  );
}
