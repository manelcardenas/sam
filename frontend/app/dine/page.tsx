"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
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
import { Loader } from "@/components/ui/Loader";
import { MapLoading } from "@/components/map/MapLoading";
import {
  ArrowLeft,
  Edit,
  LayoutGrid,
  Map as MapIcon,
  MapPin,
  Plus,
  Star,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";

// MapLibre needs the DOM and is heavy — keep it out of the static export
// pass and out of the initial bundle; it downloads only when a map shows.
const RestaurantsMap = dynamic(() => import("@/components/map/RestaurantsMap"), {
  ssr: false,
  loading: () => (
    <MapLoading className="h-[65vh] min-h-[420px] rounded-4xl border border-line shadow-paw" />
  ),
});
const LocationMap = dynamic(() => import("@/components/map/LocationMap"), {
  ssr: false,
  loading: () => <MapLoading className="h-full w-full" />,
});

type View = "list" | "detail" | "add-restaurant" | "edit-restaurant" | "add-review" | "edit-review";
type ListMode = "cards" | "map";

/** Price as €…€€€€ with the unused tier dimmed. */
function PriceLevel({ level }: { level: number }) {
  return (
    <span className="font-semibold tracking-tight" aria-label={`Price level ${level} of 4`}>
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={n <= level ? "text-fg" : "text-muted/40"}>
          €
        </span>
      ))}
    </span>
  );
}

/** Render a date-only "YYYY-MM-DD" string in the viewer's locale without the
 * UTC-midnight shift of new Date(string) — which shows the previous day in
 * timezones west of UTC. */
function formatVisitedDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-fg">{value != null ? value.toFixed(1) : "—"}</span>
    </div>
  );
}

export default function DinePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");

  const [restaurants, setRestaurants] = useState<RestaurantDetail[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [view, setView] = useState<View>("list");
  const [listMode, setListMode] = useState<ListMode>("cards");
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewToDelete, setReviewToDelete] = useState<Review | null>(null);
  const [reviewToEdit, setReviewToEdit] = useState<Review | null>(null);

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
        await loadRestaurants();
        setLoading(false);
      } catch {
        router.push("/");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Data ────────────────────────────────────────────────────────────────────

  const loadRestaurants = async () => {
    try {
      setError("");
      setRestaurants(await apiClient.searchRestaurants());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load restaurants");
    }
  };

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

  const handleCreateRestaurant = async (data: CreateRestaurantInput) => {
    const { restaurant, alreadyExisted } = await apiClient.createRestaurant(data);
    await loadRestaurants();
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
    await loadRestaurants();
    await openRestaurant(selectedRestaurant);
  };

  const handleCreateReview = async (data: CreateReviewInput) => {
    if (!selectedRestaurant) return;
    await apiClient.createReview(selectedRestaurant.id, data);
    await openRestaurant(selectedRestaurant);
  };

  const handleUpdateReview = async (data: CreateReviewInput) => {
    if (!reviewToEdit || !selectedRestaurant) return;
    await apiClient.updateReview(selectedRestaurant.id, reviewToEdit.id, data);
    setReviewToEdit(null);
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
    await openRestaurant(selectedRestaurant);
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const visibleRestaurants = query.trim()
    ? restaurants.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()))
    : restaurants;

  const mappedVisible = visibleRestaurants.filter((r) => r.latitude != null && r.longitude != null);
  const unmappedVisible = visibleRestaurants.length - mappedVisible.length;

  // ── Navigation helpers ───────────────────────────────────────────────────────

  const goBack = () => {
    if (view === "add-review" || view === "edit-review" || view === "edit-restaurant") {
      setReviewToEdit(null);
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

  if (loading) return <Loader />;

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
          <header className="mb-6">
            <h1 className="font-display text-3xl font-bold text-fg sm:text-4xl">
              Where shall we eat?
            </h1>
            <p className="mt-1 text-muted">Every place the pack has reviewed.</p>
          </header>

          {restaurants.length > 0 && (
            <div className="mb-5 flex items-stretch gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search restaurants…"
                className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
              />
              <div
                role="group"
                aria-label="View as"
                className="flex shrink-0 items-center gap-1 rounded-2xl border border-line bg-surface p-1"
              >
                <button
                  type="button"
                  onClick={() => setListMode("cards")}
                  aria-pressed={listMode === "cards"}
                  className={`flex h-full cursor-pointer items-center gap-1.5 rounded-xl px-3 font-display text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
                    listMode === "cards" ? "bg-tomato text-white shadow-pop" : "text-muted hover:text-fg"
                  }`}
                >
                  <LayoutGrid className="h-4 w-4" />
                  <span className="hidden sm:inline">Cards</span>
                </button>
                <button
                  type="button"
                  onClick={() => setListMode("map")}
                  aria-pressed={listMode === "map"}
                  className={`flex h-full cursor-pointer items-center gap-1.5 rounded-xl px-3 font-display text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
                    listMode === "map" ? "bg-tomato text-white shadow-pop" : "text-muted hover:text-fg"
                  }`}
                >
                  <MapIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Map</span>
                </button>
              </div>
            </div>
          )}

          {restaurants.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line bg-surface py-16 text-center">
              <UtensilsCrossed className="mx-auto mb-3 h-10 w-10 text-muted" />
              <p className="text-muted">No restaurants yet.</p>
              <button
                onClick={() => setView("add-restaurant")}
                className="mt-5 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-tomato px-4 py-2.5 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95"
              >
                <Plus className="h-4 w-4" />
                Add the first one
              </button>
            </div>
          ) : visibleRestaurants.length === 0 ? (
            <p className="py-10 text-center text-muted">No restaurants match &ldquo;{query}&rdquo;.</p>
          ) : listMode === "map" ? (
            mappedVisible.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-line bg-surface py-16 text-center">
                <MapPin className="mx-auto mb-3 h-10 w-10 text-muted" />
                <p className="mx-auto max-w-sm text-muted">
                  None of these restaurants have a location yet. Pick a match from the map
                  search when adding one and it&rsquo;ll show up here.
                </p>
              </div>
            ) : (
              <>
                <RestaurantsMap restaurants={visibleRestaurants} onOpenRestaurant={openRestaurant} />
                {unmappedVisible > 0 && (
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-sm text-muted">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {unmappedVisible} {unmappedVisible === 1 ? "restaurant has" : "restaurants have"} no
                    location and {unmappedVisible === 1 ? "isn't" : "aren't"} on the map.
                  </p>
                )}
              </>
            )
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {visibleRestaurants.map((r) => (
                <RestaurantCard key={r.id} restaurant={r} onClick={() => openRestaurant(r)} />
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

            {selectedRestaurant.latitude != null && selectedRestaurant.longitude != null && (
              <div className="relative h-48 border-b border-line sm:h-56">
                <LocationMap
                  name={selectedRestaurant.name}
                  latitude={selectedRestaurant.latitude}
                  longitude={selectedRestaurant.longitude}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 px-6 py-5 sm:grid-cols-3">
              <div className="col-span-2 flex flex-col items-center justify-center rounded-3xl bg-tomato/10 py-4 sm:col-span-1">
                <span className="flex items-center gap-1 font-display text-3xl font-bold text-tomato">
                  <Star className="h-6 w-6 fill-current" />
                  {selectedRestaurant.average_overall != null ? selectedRestaurant.average_overall.toFixed(1) : "—"}
                </span>
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
                        <p className="mt-0.5 text-xs text-muted">
                          Visited {formatVisitedDate(review.visited_at)}
                        </p>
                      </div>
                      {review.user_id === currentUserId && (
                        <div className="flex shrink-0 items-center">
                          <button
                            onClick={() => {
                              setReviewToEdit(review);
                              setView("edit-review");
                            }}
                            title="Edit review"
                            aria-label="Edit review"
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-amber/15 hover:text-amber-700 dark:hover:text-amber focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setReviewToDelete(review)}
                            title="Delete review"
                            aria-label="Delete review"
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-tomato/15 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
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
                latitude: selectedRestaurant.latitude,
                longitude: selectedRestaurant.longitude,
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

      {/* ── EDIT REVIEW ── */}
      {view === "edit-review" && selectedRestaurant && reviewToEdit && (
        <div className="mx-auto max-w-xl">
          <h1 className="mb-1 font-display text-2xl font-bold text-fg sm:text-3xl">Edit your review</h1>
          <p className="mb-6 text-muted">{selectedRestaurant.name}</p>
          <div className="rounded-4xl border border-line bg-surface p-6 shadow-paw">
            <ReviewForm
              initialData={{
                location_score: reviewToEdit.location_score,
                food_score: reviewToEdit.food_score,
                service_score: reviewToEdit.service_score,
                value_score: reviewToEdit.value_score,
                comment: reviewToEdit.comment ?? undefined,
                visited_at: reviewToEdit.visited_at,
              }}
              submitLabel="Save changes"
              onSubmit={handleUpdateReview}
              onCancel={goBack}
            />
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
