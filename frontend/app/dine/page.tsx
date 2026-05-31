"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import { apiClient } from "@/lib/api-client";
import { PREVIEW_RESTAURANTS } from "@/lib/restaurants";
import { AppShell } from "@/components/shell/AppShell";
import { RestaurantCard } from "@/components/RestaurantCard";
import { Loader } from "@/components/ui/Loader";
import { SamMascot } from "@/components/brand/SamMascot";
import { PawPrint } from "@/components/brand/PawPrint";
import { Bell } from "lucide-react";

export default function DinePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");

  // Same auth + first-login gate as the COOK world, so the two stay in lockstep.
  useEffect(() => {
    configureAmplify();
    (async () => {
      try {
        await getCurrentUser();
        const me = await apiClient.getMe();
        if (!me.display_name) {
          router.replace("/profile/complete");
          return;
        }
        setUserName(me.display_name);
        setLoading(false);
      } catch {
        router.push("/");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Loader />;

  return (
    <AppShell userName={userName}>
      {/* Hero empty-state */}
      <section className="relative overflow-hidden rounded-4xl border border-line bg-surface px-6 py-12 text-center sm:py-16">
        <div className="pointer-events-none absolute inset-0 bg-paws opacity-60" />
        <div className="relative">
          <SamMascot className="mx-auto h-44 w-44" />
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber">
            <PawPrint className="h-3.5 w-3.5" />
            Coming soon
          </span>
          <h1 className="mt-4 font-display text-3xl font-bold text-fg sm:text-4xl">
            SAM is sniffing out restaurants
          </h1>
          <p className="mx-auto mt-3 max-w-md text-balance text-muted">
            The DINE world is where you&apos;ll find and save places to eat out —
            recommendations fetched, ranked and ready. We&apos;re putting the bowl
            down now.
          </p>
          <button
            type="button"
            disabled
            className="mt-6 inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-tomato/40 px-5 py-3 font-display font-semibold text-white"
          >
            <Bell className="h-4 w-4" />
            Notify me when it&apos;s ready
          </button>
        </div>
      </section>

      {/* Teaser of what the world will hold */}
      <div className="mt-10">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-fg">
          A taste of what&apos;s coming
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PREVIEW_RESTAURANTS.map((r, i) => (
            <div
              key={r.id}
              className="will-fetch animate-fetch-in"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <RestaurantCard restaurant={r} preview />
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
