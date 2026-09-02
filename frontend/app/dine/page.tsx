"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { configureAmplify } from "@/lib/amplify";
import {
  apiClient,
  type Restaurant,
  type RestaurantDetail,
  type Review,
  type CreateRestaurantInput,
  type CreateReviewInput,
} from "@/lib/api-client";
import { AppShell } from "@/components/shell/AppShell";
import { RestaurantCard } from "@/components/RestaurantCard";
import RestaurantForm from "@/components/RestaurantForm";
import ReviewForm from "@/components/ReviewForm";
import ConfirmModal from "@/components/ConfirmModal";
import { RecentVisitsRail } from "@/components/dine/RecentVisitsRail";
import {
  EMPTY_FILTERS,
  RestaurantFilters,
  fromSearchParams,
  isFiltered,
  toQuery,
  toSearchParams,
  type FilterState,
} from "@/components/dine/RestaurantFilters";
import { DineSkeleton } from "@/components/dine/DineSkeleton";
import { PriceLevel, ScoreBadge } from "@/components/dine/atoms";
import { formatRelativeDate, formatVisitedDate } from "@/lib/format";
import { useFlipGrid } from "@/lib/useFlipGrid";
import { ArrowLeft, Edit, MapPin, Plus, SearchX, Star, Trash2, UtensilsCrossed } from "lucide-react";

type View = "list" | "detail" | "add-restaurant" | "edit-restaurant" | "add-review";

/** How long to sit on a keystroke before asking the server. */
const SEARCH_DEBOUNCE_MS = 250;

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-semibold tabular-nums text-fg">{value != null ? value.toFixed(1) : "—"}</span>
    </div>
  );
}

export default function DinePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");

  const [restaurants, setRestaurants] = useState<RestaurantDetail[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Filters are the list's narrowing controls; the unfiltered set is kept
  // separately so the "Lately" rail and the chip vocabulary stay stable while
  // you filter — a rail that empties as you narrow would be disorienting, and
  // chips that vanish when deselected are a dead end.
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [archive, setArchive] = useState<RestaurantDetail[]>([]);
  const [pending, startTransition] = useTransition();

  const [view, setView] = useState<View>("list");
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewToDelete, setReviewToDelete] = useState<Review | null>(null);

  // ── Data ────────────────────────────────────────────────────────────────────

  const loadRestaurants = useCallback(async (state: FilterState) => {
    try {
      setError("");
      const results = await apiClient.searchRestaurants(toQuery(state));
      setRestaurants(results);
      // The unfiltered fetch doubles as the archive snapshot.
      if (!isFiltered(state)) setArchive(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load restaurants");
    }
  }, []);

  // ── Auth ────────────────────────────────────────────────────────────────────

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
        setCurrentUserId(me.id);
        // Restore a shared/refreshed filtered view from the URL.
        const restored = fromSearchParams(new URLSearchParams(window.location.search));
        setFilters(restored);
        await loadRestaurants(restored);
        if (isFiltered(restored)) await loadArchive();
        setLoading(false);
      } catch {
        router.push("/");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The unfiltered set, for the rail and the chip vocabulary. */
  const loadArchive = useCallback(async () => {
    try {
      setArchive(await apiClient.searchRestaurants());
    } catch {
      // Non-fatal: the rail and chips just stay as they were.
    }
  }, []);

  // Re-query when filters change. Debounced, because `q` fires per keystroke
  // while the chips are instant — one timer covers both, and a chip tap simply
  // waits out a short delay rather than needing its own path.
  const firstRun = useRef(true);
  useEffect(() => {
    if (loading) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = setTimeout(() => {
      // Non-urgent: keeps chip presses feeling instant while the list catches up.
      startTransition(() => {
        void loadRestaurants(filters);
      });
      const qs = toSearchParams(filters);
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters, loading, loadRestaurants]);

  const openRestaurant = async (restaurant: Restaurant) => {
    try {
      setError("");
      setNotice("");
      const [detail, restaurantReviews] = await Promise.all([
        apiClient.getRestaurant(restaurant.id),
        apiClient.listReviews(restaurant.id),
      ]);
      setSelectedRestaurant(detail);
      setReviews(restaurantReviews);
      setView("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load restaurant");
    }
  };

  /** Refresh both the filtered list and the archive snapshot the rail reads from. */
  const refreshLists = useCallback(async () => {
    await Promise.all([loadRestaurants(filters), isFiltered(filters) ? loadArchive() : Promise.resolve()]);
  }, [filters, loadRestaurants, loadArchive]);

  const handleCreateRestaurant = async (data: CreateRestaurantInput) => {
    const { restaurant, alreadyExisted } = await apiClient.createRestaurant(data);
    await refreshLists();
    await openRestaurant(restaurant);
    if (alreadyExisted) {
      setNotice(`${restaurant.name} was already on SAM — here's the existing entry.`);
    }
  };

  const handleSelectExisting = async (restaurant: Restaurant) => {
    await openRestaurant(restaurant);
  };

  const handleUpdateRestaurant = async (data: CreateRestaurantInput) => {
    if (!selectedRestaurant) return;
    await apiClient.updateRestaurant(selectedRestaurant.id, data);
    await refreshLists();
    await openRestaurant(selectedRestaurant);
  };

  const handleCreateReview = async (data: CreateReviewInput) => {
    if (!selectedRestaurant) return;
    await apiClient.createReview(selectedRestaurant.id, data);
    await refreshLists();
    await openRestaurant(selectedRestaurant);
  };

  const handleDeleteReview = async () => {
    if (!reviewToDelete || !selectedRestaurant) return;
    try {
      await apiClient.deleteReview(selectedRestaurant.id, reviewToDelete.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete review");
      return;
    }
    setReviewToDelete(null);
    await refreshLists();
    await openRestaurant(selectedRestaurant);
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  // Chip vocabularies come from the archive, not the current results, so a chip
  // never disappears the moment you use it. Sorted by frequency: the cuisines
  // you actually eat lead, which at this data's distribution is a real difference.
  const cuisineOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of archive) for (const c of r.cuisines) counts.set(c, (counts.get(c) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  }, [archive]);

  const priceOptions = useMemo(
    () => [...new Set(archive.map((r) => r.price_level).filter((p): p is 1 | 2 | 3 | 4 => p != null))].sort(),
    [archive],
  );

  const filtering = isFiltered(filters);

  // Re-runs the FLIP measurement whenever the rendered set changes identity.
  const gridRef = useFlipGrid<HTMLDivElement>(restaurants.map((r) => r.id).join(","));

  // ── Navigation helpers ───────────────────────────────────────────────────────

  const goBack = () => {
    if (view === "add-review" || view === "edit-restaurant") {
      setView("detail");
      return;
    }
    if (view === "detail" || view === "add-restaurant") {
      setSelectedRestaurant(null);
      setView("list");
      return;
    }
    setView("list");
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <AppShell>
        <header className="mb-7">
          <h1 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-[2.5rem] sm:leading-[1.1]">
            Where shall we eat?
          </h1>
          <p className="mt-1.5 text-muted">Fetching the record…</p>
        </header>
        <DineSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell userName={userName}>
      <div className="mb-6 flex items-center justify-between gap-3">
        {view !== "list" ? (
          <button
            onClick={goBack}
            className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        ) : (
          <span />
        )}

        {view === "list" && (
          <button
            onClick={() => setView("add-restaurant")}
            className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full bg-tomato px-4 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <Plus className="h-4 w-4" />
            New restaurant
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
          {error}
        </div>
      )}

      {notice && (
        <div className="mb-6 rounded-2xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber">
          {notice}
        </div>
      )}

      {/* ── LIST ── */}
      {view === "list" && (
        <div>
          <header className="mb-7">
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-[2.5rem] sm:leading-[1.1]">
              Where shall we eat?
            </h1>
            <p className="mt-1.5 text-muted">
              {archive.length > 0
                ? `${archive.length} place${archive.length === 1 ? "" : "s"} the pack has eaten at.`
                : "Every place the pack has reviewed."}
            </p>
          </header>

          {/* The reel of recent visits — hides itself when there's too little to
              reel through, so an empty-ish account doesn't get a broken-looking rail. */}
          <RecentVisitsRail restaurants={archive} onSelect={openRestaurant} />

          {archive.length > 0 && (
            <>
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h2 className="font-serif text-xl font-semibold italic text-fg sm:text-2xl">
                  {filtering ? "Matching" : "Everywhere"}
                </h2>
                <span className="shrink-0 text-sm tabular-nums text-muted">
                  {restaurants.length} of {archive.length}
                </span>
              </div>

              <RestaurantFilters
                value={filters}
                cuisines={cuisineOptions}
                priceLevels={priceOptions}
                onChange={setFilters}
                resultCount={restaurants.length}
                busy={pending}
              />
            </>
          )}

          {archive.length === 0 ? (
            <EmptyState
              icon={<UtensilsCrossed className="mx-auto mb-3 h-10 w-10 text-muted" aria-hidden />}
              title="Nothing on the menu yet."
              body="Add the first restaurant and SAM will start keeping the record."
              action={
                <button
                  onClick={() => setView("add-restaurant")}
                  className="mt-5 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-tomato px-4 py-3 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add the first one
                </button>
              }
            />
          ) : restaurants.length === 0 ? (
            <EmptyState
              icon={<SearchX className="mx-auto mb-3 h-10 w-10 text-muted" aria-hidden />}
              title="Nothing matches that."
              body="Try loosening a filter — or add the place if it isn't here yet."
              action={
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="mt-5 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-3 font-display text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <div
              ref={gridRef}
              // Dimmed but not replaced while re-querying: the previous results
              // stay readable and in place, so a chip tap never blanks the page.
              className={`grid gap-4 transition-opacity duration-200 sm:grid-cols-2 ${pending ? "opacity-60" : "opacity-100"}`}
            >
              {restaurants.map((r, i) => (
                <div
                  key={r.id}
                  data-flip-id={r.id}
                  // Stagger only the first screenful: past ~8 the cascade stops
                  // reading as lively and starts reading as slow.
                  className={i < 8 ? "will-fetch animate-fetch-in" : undefined}
                  style={i < 8 ? { animationDelay: `${i * 40}ms` } : undefined}
                >
                  <RestaurantCard restaurant={r} onClick={() => openRestaurant(r)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── DETAIL ── */}
      {view === "detail" && selectedRestaurant && (
        <div className="space-y-6">
          <article className="overflow-hidden rounded-4xl border border-line bg-surface shadow-paw">
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-bold text-fg sm:text-3xl">{selectedRestaurant.name}</h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  {selectedRestaurant.cuisines.length > 0 && <span>{selectedRestaurant.cuisines.join(", ")}</span>}
                  {selectedRestaurant.address && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      {selectedRestaurant.address}
                    </span>
                  )}
                  {selectedRestaurant.price_level && <PriceLevel level={selectedRestaurant.price_level} />}
                </div>
              </div>
              <button
                onClick={() => setView("edit-restaurant")}
                title="Edit restaurant"
                aria-label="Edit restaurant"
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-amber/15 hover:text-amber-700 dark:hover:text-amber focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <Edit className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 px-6 py-5 sm:grid-cols-3">
              <div className="col-span-2 flex flex-col items-center justify-center gap-1.5 rounded-3xl bg-tomato/10 py-4 sm:col-span-1">
                <ScoreBadge score={selectedRestaurant.average_overall} size="lg" />
                <span className="text-xs text-muted">
                  {selectedRestaurant.review_count} {selectedRestaurant.review_count === 1 ? "review" : "reviews"}
                </span>
              </div>
              <div className="col-span-2 space-y-1.5 rounded-3xl border border-line px-4 py-3">
                <ScoreRow label="Location & decoration" value={selectedRestaurant.average_location} />
                <ScoreRow label="Food" value={selectedRestaurant.average_food} />
                <ScoreRow label="Service" value={selectedRestaurant.average_service} />
                <ScoreRow label="Value" value={selectedRestaurant.average_value} />
              </div>
            </div>

            <div className="border-t border-line px-6 py-5">
              <button
                onClick={() => setView("add-review")}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-tomato py-3 px-4 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <Plus className="h-4 w-4" />
                Write a review
              </button>
            </div>
          </article>

          <div>
            <h2 className="mb-3 font-display text-lg font-semibold text-fg">
              Reviews {reviews.length > 0 && `(${reviews.length})`}
            </h2>
            {reviews.length === 0 ? (
              <p className="rounded-3xl border border-dashed border-line bg-surface py-10 text-center text-muted">
                No reviews yet — be the first!
              </p>
            ) : (
              <ul className="space-y-3">
                {reviews.map((review) => (
                  <li key={review.id} className="rounded-3xl border border-line bg-surface p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-1.5 font-display font-semibold text-fg">
                          <Star className="h-4 w-4 fill-current text-amber" />
                          {review.overall.toFixed(1)}
                          <span className="font-normal text-muted">
                            · {review.reviewer_name ?? "Unknown"}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted" title={formatVisitedDate(review.visited_at)}>
                          Visited {formatRelativeDate(review.visited_at)}
                        </p>
                      </div>
                      {review.user_id === currentUserId && (
                        <button
                          onClick={() => setReviewToDelete(review)}
                          title="Delete review"
                          aria-label="Delete review"
                          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-sm sm:grid-cols-4">
                      <ScoreRow label="Location" value={review.location_score} />
                      <ScoreRow label="Food" value={review.food_score} />
                      <ScoreRow label="Service" value={review.service_score} />
                      <ScoreRow label="Value" value={review.value_score} />
                    </div>

                    {review.comment && <p className="mt-3 text-sm leading-relaxed text-fg/90">{review.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── ADD RESTAURANT ── */}
      {view === "add-restaurant" && (
        <div className="mx-auto max-w-xl">
          <h1 className="mb-6 font-display text-2xl font-bold text-fg sm:text-3xl">New restaurant</h1>
          <div className="rounded-4xl border border-line bg-surface p-6 shadow-paw">
            <RestaurantForm
              onSubmit={handleCreateRestaurant}
              onCancel={goBack}
              onSelectExisting={handleSelectExisting}
              submitLabel="Add restaurant"
            />
          </div>
        </div>
      )}

      {/* ── EDIT RESTAURANT ── */}
      {view === "edit-restaurant" && selectedRestaurant && (
        <div className="mx-auto max-w-xl">
          <h1 className="mb-6 font-display text-2xl font-bold text-fg sm:text-3xl">Edit restaurant</h1>
          <div className="rounded-4xl border border-line bg-surface p-6 shadow-paw">
            <RestaurantForm
              initialData={{
                name: selectedRestaurant.name,
                address: selectedRestaurant.address,
                price_level: selectedRestaurant.price_level,
                cuisines: selectedRestaurant.cuisines,
              }}
              onSubmit={handleUpdateRestaurant}
              onCancel={goBack}
              submitLabel="Save changes"
            />
          </div>
        </div>
      )}

      {/* ── ADD REVIEW ── */}
      {view === "add-review" && selectedRestaurant && (
        <div className="mx-auto max-w-xl">
          <h1 className="mb-1 font-display text-2xl font-bold text-fg sm:text-3xl">Review</h1>
          <p className="mb-6 text-muted">{selectedRestaurant.name}</p>
          <div className="rounded-4xl border border-line bg-surface p-6 shadow-paw">
            <ReviewForm onSubmit={handleCreateReview} onCancel={goBack} />
          </div>
        </div>
      )}

      {/* ── DELETE REVIEW MODAL ── */}
      {reviewToDelete && (
        <ConfirmModal
          title="Delete review"
          message="Are you sure you want to delete this review? This can't be undone."
          onConfirm={handleDeleteReview}
          onCancel={() => setReviewToDelete(null)}
        />
      )}
    </AppShell>
  );
}


/** Consistent empty/no-match panel — same shape for "nothing yet" and "nothing matches". */
function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="rounded-4xl border border-dashed border-line bg-surface px-6 py-16 text-center">
      {icon}
      <p className="font-display text-lg font-semibold text-fg">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action}
    </div>
  );
}
