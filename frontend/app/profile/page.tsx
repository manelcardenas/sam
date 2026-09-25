"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "aws-amplify/auth";

import { useAuthGate } from "@/components/auth/useAuthGate";
import { useMe } from "@/components/auth/UserProvider";
import { apiClient, type PlanSummary, type Recipe, type UserReview, type UserStats } from "@/lib/api-client";
import { currentParams, useBrowserNavigation, writeUrl } from "@/lib/url-state";
import {
  INITIAL_STATE,
  fromQuery,
  toQuery,
  visibleTabs,
  withTab,
  type ProfileTab,
  type ProfileUrlState,
} from "@/lib/profile-url";
import { toQuery as toDashboardQuery } from "@/lib/dashboard-url";
import { composeQuery as toDineQuery } from "@/lib/dine-url";
import { AppShell } from "@/components/shell/AppShell";
import { ProfileSkeleton } from "@/components/ui/PageSkeleton";
import { ProfileHero } from "@/components/profile/ProfileHero";
import { ProfileTabs } from "@/components/profile/ProfileTabs";
import { OverviewPanel } from "@/components/profile/OverviewPanel";
import { RecipeList } from "@/components/profile/RecipeList";
import { ReviewList } from "@/components/profile/ReviewList";
import { AccountPanel } from "@/components/profile/AccountPanel";
import { PlansPanel } from "@/components/profile/PlansPanel";
import { GroceryAdminPanel } from "@/components/profile/GroceryAdminPanel";
import { toQuery as toPlanQuery } from "@/lib/plan-url";

/**
 * Your profile, as tabbed sections instead of one long scroll.
 *
 * The page it replaces rendered stats, an account form and two unbounded lists
 * top to bottom — so the form nobody edits sat above the content everybody came
 * for, and 35 rows of recipes and reviews had no filter, no search and no
 * pagination. See docs/plans/ux-refresh-plan.md §1.
 *
 * The tab lives in the URL (`?tab=recipes`), which is what makes the device
 * back gesture move between sections rather than leaving the app — the same
 * reason `/dine` and `/dashboard` encode their views
 * (routing-and-latency-plan.md §3).
 *
 * The tab strip is rendered **above** the hero rather than below it so it holds
 * the same position on every tab. Under the hero it would sit at one height on
 * the overview and another everywhere else, and jump as you switched.
 */
export default function ProfilePage() {
  const router = useRouter();
  const { me } = useAuthGate();
  const { setMe } = useMe();

  const [loading, setLoading] = useState(true);
  const [myRecipes, setMyRecipes] = useState<Recipe[]>([]);
  const [myReviews, setMyReviews] = useState<UserReview[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);

  const [state, setState] = useState<ProfileUrlState>(INITIAL_STATE);
  const restored = useRef(false);

  // The archive is fetched per year, and only once the tab is opened — a year of
  // summaries is cheap but it is not free, and most visits to /profile never go
  // near it.
  const [archive, setArchive] = useState<PlanSummary[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const thisYear = useRef(new Date().getFullYear()).current;
  const shownYear = state.year ?? thisYear;

  // Keyed on the id so a background revalidation doesn't refetch all three lists.
  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [recipes, reviews, userStats] = await Promise.all([
          apiClient.listMyRecipes(),
          apiClient.listMyReviews(),
          apiClient.getMyStats(),
        ]);
        if (cancelled) return;
        setMyRecipes(recipes);
        setMyReviews(reviews);
        setStats(userStats);
        setLoading(false);
      } catch {
        if (!cancelled) router.replace("/");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  useEffect(() => {
    if (state.tab !== "plans" || !me?.id) return;
    let cancelled = false;
    setArchiveLoading(true);
    void apiClient
      .getPlanArchive(shownYear)
      .then((weeks) => {
        if (!cancelled) setArchive(weeks);
      })
      // An empty archive and a failed one look the same on screen, which is a
      // real shortcoming — but the alternative here is an error banner on a
      // panel most people open once, and the year pager makes a retry a tap.
      .catch(() => {
        if (!cancelled) setArchive([]);
      })
      .finally(() => {
        if (!cancelled) setArchiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state.tab, shownYear, me?.id]);

  // Restore the tab from the address bar once, after the skeleton gives way —
  // so a link straight to ?tab=reviews opens on reviews.
  useEffect(() => {
    if (restored.current || loading) return;
    restored.current = true;
    setState(fromQuery(currentParams()));
  }, [loading]);

  // Back / forward. State is a single object, so the whole view follows from
  // the query string with no reconciliation between separate variables — which
  // is why this page needs none of the applying-history guards /dashboard has.
  useBrowserNavigation((params) => setState(fromQuery(params)));

  /**
   * Tabs push a history entry (that is what makes back work); narrowing
   * replaces, so tweaking a search five times doesn't cost five back presses.
   * The convention is url-state.ts's.
   */
  const selectTab = (tab: ProfileTab) => {
    const next = withTab(tab);
    setState(next);
    writeUrl(toQuery(next), "push");
  };

  const narrow = (patch: Partial<ProfileUrlState>) => {
    const next = { ...state, ...patch };
    setState(next);
    writeUrl(toQuery(next), "replace");
  };

  const handleSignOut = async () => {
    try {
      await signOut({ global: true });
    } finally {
      router.push("/");
    }
  };

  const displayName = me?.display_name ?? "";
  const tabs = visibleTabs(Boolean(me?.is_admin));
  // A hand-typed ?tab=admin from somebody outside the group opens the overview,
  // as any unknown tab does. Hiding the tab is presentation; the admin routes
  // refuse them regardless.
  const tab: ProfileTab = tabs.includes(state.tab) ? state.tab : "overview";

  if (loading || !me) {
    return (
      <AppShell>
        <ProfileSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell userName={displayName}>
      <div className="space-y-5">
        <ProfileTabs
          tabs={tabs}
          active={tab}
          counts={{ recipes: myRecipes.length, reviews: myReviews.length }}
          onSelect={selectTab}
        />

        {/* One panel per tab, each labelled by its tab for the accessibility
            tree. Only the active one is rendered: the inactive lists hold no
            state worth preserving, and mounting all four would run three sets
            of entrance animations you never see. */}
        <div
          role="tabpanel"
          id={`profile-panel-${tab}`}
          aria-labelledby={`profile-tab-${tab}`}
        >
          {tab === "overview" && (
            <div className="space-y-5">
              <ProfileHero name={displayName} email={me.email} since={me.created_at} />
              <OverviewPanel
                stats={stats}
                recipes={myRecipes}
                reviews={myReviews}
                onOpenRecipes={() => selectTab("recipes")}
                onOpenReviews={() => selectTab("reviews")}
              />
            </div>
          )}

          {tab === "recipes" && (
            <RecipeList
              recipes={myRecipes}
              q={state.q}
              category={state.category}
              onQueryChange={(q) => narrow({ q })}
              onCategoryChange={(category) => narrow({ category })}
              // Reuses /dashboard's own encoder rather than hand-building the
              // query, so this link can't drift from what that page parses.
              onOpen={(recipe) =>
                router.push(
                  `/dashboard?${toDashboardQuery({
                    view: "detail",
                    category: recipe.food_type,
                    authors: [],
                    recipeId: recipe.id,
                    q: "",
                  })}`,
                )
              }
              onCreate={() => router.push(`/dashboard?${toDashboardQuery({ view: "add", category: null, authors: [], recipeId: null, q: "" })}`)}
            />
          )}

          {tab === "reviews" && (
            <ReviewList
              reviews={myReviews}
              q={state.q}
              sort={state.sort}
              onQueryChange={(q) => narrow({ q })}
              onSortChange={(sort) => narrow({ sort })}
              // Opens the restaurant itself. The old page pushed a bare /dine,
              // which dropped you at the top of the archive to find it again.
              onOpen={(review) => router.push(`/dine?${toDineQuery("", "detail", review.restaurant_id)}`)}
              onFindPlaces={() => router.push("/dine")}
            />
          )}

          {tab === "plans" && (
            <PlansPanel
              year={shownYear}
              weeks={archive}
              loading={archiveLoading}
              // The current year stays out of the URL, so ?tab=plans keeps
              // meaning "the archive" rather than "2026" forever.
              onYearChange={(year) => narrow({ year: year === thisYear ? null : year })}
              onOpen={(week) =>
                router.push(
                  `/plan?${toPlanQuery({
                    view: "calendar",
                    week: week.week_start,
                    slot: null,
                    // Always by id, never only by date. They are the same week
                    // for anybody who has stayed in one kitchen, and different
                    // weeks for anybody who has moved — the archive links to the
                    // row you tapped, not to whatever your household is planning
                    // for those dates now.
                    planId: week.id,
                  })}`,
                )
              }
            />
          )}

          {tab === "account" && (
            <AccountPanel me={me} onSaved={setMe} onSignOut={handleSignOut} />
          )}

          {tab === "admin" && (
            <GroceryAdminPanel
              q={state.q}
              shelf={state.shelf}
              onQueryChange={(q) => narrow({ q })}
              onShelfChange={(shelf) => narrow({ shelf })}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
