// DINE world data model — scaffolding for the upcoming restaurant recommender.
// No API endpoints yet; the shape below is what the backend will return so the
// UI (RestaurantCard, /dine) is already built against it.
export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  area: string;
  priceLevel: 1 | 2 | 3 | 4; // € … €€€€
  rating: number; // 0–5
  recommendedBy?: string | null;
  mapUrl?: string | null;
  notes?: string | null;
}

// Teaser entries rendered (non-interactive) on /dine until the API lands, so
// the world feels real rather than empty.
export const PREVIEW_RESTAURANTS: Restaurant[] = [
  { id: "p1", name: "Casa Pepe", cuisine: "Tapas", area: "Gràcia", priceLevel: 2, rating: 4.6, recommendedBy: "SAM" },
  { id: "p2", name: "Noodle Bar", cuisine: "Ramen", area: "El Born", priceLevel: 1, rating: 4.4, recommendedBy: "SAM" },
  { id: "p3", name: "La Brasa", cuisine: "Grill", area: "Poble Sec", priceLevel: 3, rating: 4.8, recommendedBy: "SAM" },
];
