"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signInWithRedirect, getCurrentUser } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import { FcGoogle } from "react-icons/fc";
import { SamMascot } from "@/components/brand/SamMascot";
import { Loader } from "@/components/ui/Loader";
import { useI18n } from "@/lib/i18n/LocaleProvider";

const fieldClass =
  "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    configureAmplify();

    getCurrentUser()
      .then(() => {
        router.push("/dashboard");
      })
      .catch(() => {
        setChecking(false);
      });
  }, [router]);

  const handleEmailPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signIn({ username: email, password: password });
      router.push("/dashboard");
    } catch (err) {
      console.error("Login error:", err);
      setError(
        err instanceof Error
          ? err.message
          : t("landing.sign-in-failed"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);

    try {
      await signInWithRedirect({ provider: "Google" });
    } catch (err) {
      console.error("Google login error:", err);
      setError(err instanceof Error ? err.message : t("landing.google-sign-in-failed"));
      setLoading(false);
    }
  };

  if (checking) return <Loader />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg bg-paws p-4">
      <div className="w-full max-w-md">
        {/* Hero */}
        <div className="mb-8 text-center">
          <SamMascot className="mx-auto h-56 w-56 sm:h-64 sm:w-64" />
          <h1 className="mt-4 font-display text-5xl font-bold tracking-tight text-fg">
            SAM
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-balance text-muted">
            {t("landing.tagline")}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-4xl border border-line bg-surface p-7 shadow-paw sm:p-8">
          {error && (
            <div className="mb-5 rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
              {error}
            </div>
          )}

          <form onSubmit={handleEmailPasswordLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-fg">
                {t("landing.email")}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClass}
                placeholder={t("landing.email-placeholder")}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-fg">
                {t("landing.password")}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClass}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full cursor-pointer items-center justify-center rounded-full bg-tomato py-3 px-4 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              {loading ? t("landing.signing-in") : t("landing.sign-in")}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-line" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-surface px-3 text-xs font-medium text-muted">
                {t("landing.or")}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-full border border-line bg-surface py-3 px-4 font-semibold text-fg transition-colors hover:border-tomato/40 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <FcGoogle className="h-5 w-5" />
            {t("landing.google-sign-in")}
          </button>

          <p className="mt-6 text-center text-sm text-muted">
            {t("landing.new-here")}{" "}
            <span className="font-semibold text-tomato">{t("landing.no-account")}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
