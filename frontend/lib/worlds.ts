import { ChefHat, UtensilsCrossed } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// SAM's two "worlds". COOK is live (recipes); DINE is scaffolded (restaurants).
// Adding a third world later = one more entry here.
export type WorldId = "cook" | "dine";

export interface World {
  id: WorldId;
  label: string;
  href: string;
  blurb: string;
  icon: LucideIcon;
}

export const WORLDS: World[] = [
  { id: "cook", label: "Cook", href: "/dashboard", blurb: "Your recipes", icon: ChefHat },
  { id: "dine", label: "Dine", href: "/dine", blurb: "Find restaurants", icon: UtensilsCrossed },
];
