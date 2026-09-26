import type { RestaurantDetail } from "@/lib/api-client";

/**
 * Places you added but never reviewed — the one gap in the archive only its
 * author can close.
 *
 * **Why it matters more than an ordinary unreviewed place.** The dine list is a
 * record of meals (docs/adr/0005): adding a restaurant means you ate there. A
 * place somebody else added is an invitation to anyone; a place *you* added and
 * left blank is a meal with no memory attached, and nobody else can supply it —
 * they were not there. It also has no score, so it sinks under every rating
 * sort and shows a paw instead of a number on the map.
 *
 * Yours means `created_by`, and "reviewed" means *you* reviewed it: a friend's
 * review of a place you added does not say what you thought. Read from
 * `reviewers`, which leaves out people without a display name — nobody reaches
 * `/dine` without one, so that is never you.
 *
 * Newest first: the place you added last night is the one you remember best.
 */
export function awaitingMyReview(restaurants: RestaurantDetail[], currentUserId: string): RestaurantDetail[] {
  if (!currentUserId) return [];
  return restaurants
    .filter((r) => isAwaitingMyReview(r, currentUserId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function isAwaitingMyReview(restaurant: RestaurantDetail, currentUserId: string): boolean {
  return (
    Boolean(currentUserId) &&
    restaurant.created_by === currentUserId &&
    // `?? []`: a list served by a backend older than this field must still render.
    !(restaurant.reviewers ?? []).some((person) => person.id === currentUserId)
  );
}
