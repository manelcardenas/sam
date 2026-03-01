export const FOOD_TYPES = [
  { value: "comida", label: "Comida", emoji: "🍽️", description: "Platos principales y guisos" },
  { value: "bebida", label: "Bebida", emoji: "🥤", description: "Batidos, zumos y cócteles" },
  { value: "postre", label: "Postre", emoji: "🍰", description: "Dulces y postres" },
  { value: "aperitivo", label: "Aperitivo", emoji: "🥗", description: "Snacks y entrantes" },
] as const;

export type FoodType = (typeof FOOD_TYPES)[number]["value"];
