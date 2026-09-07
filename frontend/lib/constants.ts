import { CakeSlice, CupSoda, Salad, Soup } from "lucide-react";

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
] as const;

export type FoodType = (typeof FOOD_TYPES)[number]["value"];
