import { CakeSlice, CupSoda, Salad, Soup, Wheat } from "lucide-react";

// Recipe (COOK world) taxonomy. `accent` gives each category its own warm
// tint so lists and chips stay scannable by kind inside the brand palette;
// `icon` replaced an `emoji` field (docs/plans/ux-refresh-plan.md §6).
//
// `value` is the API's stored `food_type` and is deliberately still Spanish —
// it is an identifier, not copy, and renaming it would be a data migration for
// no gain. The human-readable label and description used to live here in
// Spanish, which is what made the codebase bilingual by accident; they are now
// `food-types.<value>.label` / `.description` in `messages/*.json`, and the
// copy-completeness test asserts every value has both.
export const FOOD_TYPES = [
  { value: "comida", icon: Soup, accent: "#E4572E" },
  { value: "bebida", icon: CupSoda, accent: "#F4A024" },
  { value: "postre", icon: CakeSlice, accent: "#E07A9B" },
  { value: "aperitivo", icon: Salad, accent: "#7FA650" },
  // Rice, potatoes, pasta and bread are nearly all of this category, and a wheat
  // sheaf stays legible at 14px beside a soup bowl, a soda cup, a cake slice and
  // a salad bowl — `Salad` is taken and `CookingPot` would read as `comida`.
  //
  // The accent sits near 44°, in the wide gap between `bebida`'s amber (36°) and
  // `aperitivo`'s green (90°), and much less saturated than the amber so the two
  // do not read as one chip at a glance.
  { value: "guarnicion", icon: Wheat, accent: "#B98F3E" },
] as const;

export type FoodType = (typeof FOOD_TYPES)[number]["value"];
