import { CakeSlice, CupSoda, Salad, Soup } from "lucide-react";

// Recipe (COOK world) taxonomy. `accent` gives each category its own warm
// tint so the bento grid feels lively while staying inside the brand palette.
//
// `icon` is the replacement for `emoji`: emoji render differently on every
// platform, don't inherit colour, and are the one thing the project's own
// design guidance names outright (docs/plans/ux-refresh-plan.md §6). The two
// coexist while the remaining `emoji` call sites are migrated — /profile is on
// `icon`, /dashboard and RecipeForm are not yet.
export const FOOD_TYPES = [
  { value: "comida", label: "Comida", emoji: "🍽️", icon: Soup, description: "Platos principales y guisos", accent: "#E4572E" },
  { value: "bebida", label: "Bebida", emoji: "🥤", icon: CupSoda, description: "Batidos, zumos y cócteles", accent: "#F4A024" },
  { value: "postre", label: "Postre", emoji: "🍰", icon: CakeSlice, description: "Dulces y postres", accent: "#E07A9B" },
  { value: "aperitivo", label: "Aperitivo", emoji: "🥗", icon: Salad, description: "Snacks y entrantes", accent: "#7FA650" },
] as const;

export type FoodType = (typeof FOOD_TYPES)[number]["value"];
