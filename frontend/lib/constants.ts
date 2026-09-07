import { CakeSlice, CupSoda, Salad, Soup } from "lucide-react";

// Recipe (COOK world) taxonomy. `accent` gives each category its own warm
// tint so lists and chips stay scannable by kind inside the brand palette.
//
// `icon` replaced an `emoji` field (docs/plans/ux-refresh-plan.md §6). Emoji
// render differently on every platform, don't inherit colour, and are the one
// thing the project's own design guidance names outright. Here the mapping is
// honest — a bowl, a cup, a cake slice and a leaf are the actual things.
export const FOOD_TYPES = [
  { value: "comida", label: "Comida", icon: Soup, description: "Platos principales y guisos", accent: "#E4572E" },
  { value: "bebida", label: "Bebida", icon: CupSoda, description: "Batidos, zumos y cócteles", accent: "#F4A024" },
  { value: "postre", label: "Postre", icon: CakeSlice, description: "Dulces y postres", accent: "#E07A9B" },
  { value: "aperitivo", label: "Aperitivo", icon: Salad, description: "Snacks y entrantes", accent: "#7FA650" },
] as const;

export type FoodType = (typeof FOOD_TYPES)[number]["value"];
