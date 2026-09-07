import { ChefHat, UtensilsCrossed } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// SAM's two "worlds". Adding a third later = one more entry here, plus its two
// strings in each copy file.
//
// The label is *not* here any more: it was an English string in the code, and
// copy belongs in `messages/*.json`. Callers translate `worlds.<id>.label`.
//
// A `blurb` field went with it, and was deleted rather than translated —
// nothing had ever rendered it.
export type WorldId = "cook" | "dine";

export interface World {
  id: WorldId;
  href: string;
  icon: LucideIcon;
}

export const WORLDS: World[] = [
  { id: "cook", href: "/dashboard", icon: ChefHat },
  { id: "dine", href: "/dine", icon: UtensilsCrossed },
];
