"use client";

import { BookOpen, ChevronRight, MessageSquareQuote } from "lucide-react";
import { StatsStrip } from "@/components/profile/StatsStrip";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { Recipe, UserReview, UserStats } from "@/lib/api-client";

/**
 * The hub: your numbers, and a way into each section.
 *
 * The two cards carry the newest item's name rather than only a count, because
 * a card that says "Reviews · 21 ›" is a menu entry while one that says
 * "latest: Casa Pepe" is a reason to tap. It also means the hub is never empty
 * for anyone who has used the app at all.
 */
export function OverviewPanel({
  stats,
  recipes,
  reviews,
  onOpenRecipes,
  onOpenReviews,
}: {
  stats: UserStats | null;
  recipes: Recipe[];
  reviews: UserReview[];
  onOpenRecipes: () => void;
  onOpenReviews: () => void;
}) {
  const { t } = useI18n();
  // Both lists arrive newest-first from the API; taking [0] rather than
  // re-sorting keeps this a display concern.
  const latestRecipe = recipes[0]?.title;
  const latestReview = reviews[0]?.restaurant_name;

  return (
    <div className="space-y-4">
      {stats && <StatsStrip stats={stats} />}

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        <SectionCard
          icon={BookOpen}
          label={t("profile.tab-recipes")}
          count={recipes.length}
          latest={latestRecipe}
          empty={t("profile.no-recipes-hint")}
          tint="tomato"
          onClick={onOpenRecipes}
        />
        <SectionCard
          icon={MessageSquareQuote}
          label={t("profile.tab-reviews")}
          count={reviews.length}
          latest={latestReview}
          empty={t("profile.no-reviews-hint")}
          tint="amber"
          onClick={onOpenReviews}
        />
      </div>
    </div>
  );
}

/** Spelled out so Tailwind's scanner sees every class it needs to generate. */
const TINTS = {
  tomato: { plate: "bg-tomato/12 text-tomato", wash: "from-tomato/[0.07]" },
  amber: { plate: "bg-amber/15 text-amber-700 dark:text-amber", wash: "from-amber/[0.07]" },
} as const;

function SectionCard({
  icon: Icon,
  label,
  count,
  latest,
  empty,
  tint,
  onClick,
}: {
  icon: typeof BookOpen;
  label: string;
  count: number;
  latest?: string;
  empty: string;
  tint: keyof typeof TINTS;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const { plate, wash } = TINTS[tint];

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex cursor-pointer items-center gap-4 overflow-hidden rounded-3xl border border-line bg-surface p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-tomato/40 hover:shadow-paw focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent ${wash}`}
      />
      <span
        aria-hidden
        className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-transform duration-200 group-hover:scale-105 ${plate}`}
      >
        <Icon className="h-5 w-5" />
      </span>

      <span className="relative min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="font-display font-semibold text-fg transition-colors group-hover:text-tomato">
            {label}
          </span>
          <span className="font-serif text-lg font-semibold tabular-nums text-muted">{count}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {latest ? t("profile.latest", { name: latest }) : empty}
        </span>
      </span>

      <ChevronRight
        className="relative h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-tomato"
        aria-hidden
      />
    </button>
  );
}
