/**
 * The /dine view state machine, as query params layered on top of the filters.
 *
 * list                →  /dine?cuisine=…            (filters only)
 * detail              →  /dine?place=<id>
 * edit-restaurant     →  /dine?place=<id>&mode=edit
 * add-review          →  /dine?place=<id>&mode=review
 * add-restaurant      →  /dine?mode=new
 *
 * Filters and view share one query string, so both writers compose the whole
 * thing — otherwise whichever wrote last would erase the other's params.
 *
 * `edit-review` is deliberately *not* restorable. It needs a specific review as
 * well as a restaurant, and a URL naming a review that has since been deleted
 * is a worse outcome than landing on the restaurant. It still pushes a history
 * entry, so the back gesture dismisses the editor — it just decodes to `detail`.
 */

export type DineView =
  | "list"
  | "detail"
  | "add-restaurant"
  | "edit-restaurant"
  | "add-review"
  | "edit-review";

const MODE_BY_VIEW: Partial<Record<DineView, string>> = {
  "add-restaurant": "new",
  "edit-restaurant": "edit",
  "add-review": "review",
  "edit-review": "edit-review",
};

export function composeQuery(filterQuery: string, view: DineView, placeId: string | null): string {
  const params = new URLSearchParams(filterQuery);
  if (placeId && view !== "list" && view !== "add-restaurant") params.set("place", placeId);
  const mode = MODE_BY_VIEW[view];
  if (mode) params.set("mode", mode);
  return params.toString();
}

export function parseView(params: URLSearchParams): { view: DineView; placeId: string | null } {
  const mode = params.get("mode");
  if (mode === "new") return { view: "add-restaurant", placeId: null };

  const placeId = params.get("place");
  if (!placeId) return { view: "list", placeId: null };

  if (mode === "edit") return { view: "edit-restaurant", placeId };
  if (mode === "review") return { view: "add-review", placeId };
  // "edit-review" included: the entry exists so back works, but it restores to
  // the restaurant rather than to an editor we can't rebuild.
  return { view: "detail", placeId };
}
