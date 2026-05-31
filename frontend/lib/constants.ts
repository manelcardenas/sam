// Recipe (COOK world) taxonomy. `accent` gives each category its own warm
// tint so the bento grid feels lively while staying inside the brand palette.
export const FOOD_TYPES = [
  { value: "comida", label: "Comida", emoji: "🍽️", description: "Platos principales y guisos", accent: "#E4572E" },
  { value: "bebida", label: "Bebida", emoji: "🥤", description: "Batidos, zumos y cócteles", accent: "#F4A024" },
  { value: "postre", label: "Postre", emoji: "🍰", description: "Dulces y postres", accent: "#E07A9B" },
  { value: "aperitivo", label: "Aperitivo", emoji: "🥗", description: "Snacks y entrantes", accent: "#7FA650" },
] as const;

export type FoodType = (typeof FOOD_TYPES)[number]["value"];
