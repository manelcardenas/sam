import { CalendarDays, ChefHat, UtensilsCrossed } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// SAM's three "worlds". Adding one = a single entry here plus its label in each
// copy file, and it appears in both the desktop switch and the mobile tab bar.
//
// PLAN joined them with the meal planner (docs/plans/meal-planner-plan.md §8).
// It is a top-level destination rather than a corner of COOK because the week's
// list is a working artifact you open one-handed in a supermarket — the profile
// is the right home for *history*, not for the week you are shopping for.
//
// The label is *not* here any more: it was an English string in the code, and
// copy belongs in `messages/*.json`. Callers translate `worlds.<id>.label`.
//
// A `blurb` field went with it, and was deleted rather than translated —
// nothing had ever rendered it.
export type WorldId = "cook" | "dine" | "plan";

export interface World {
  id: WorldId;
  href: string;
  icon: LucideIcon;
}

export const WORLDS: World[] = [
  { id: "cook", href: "/dashboard", icon: ChefHat },
  { id: "dine", href: "/dine", icon: UtensilsCrossed },
  { id: "plan", href: "/plan", icon: CalendarDays },
];
