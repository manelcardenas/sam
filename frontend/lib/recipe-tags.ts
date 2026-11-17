import { AirVent, CookingPot, EggFried, Flame, Heater, Package, Salad, Snowflake, Zap, type LucideIcon } from "lucide-react";
import type { Recipe, RecipeTag } from "@/lib/api-client";

/**
 * What a recipe is like, in the order the form offers them (ADR 0009 §7).
 *
 * Drawn icons rather than the emoji the tags were named with in conversation
 * (🍱 🔥 🌀…): the rest of the app speaks lucide, one stroke and one weight, and
 * an emoji renders differently on the iPhone and the Android phone this is used
 * on. The label is always beside the icon, so nothing relies on the picture.
 *
 * Tupper first: it is the one the week planner will filter on.
 */
export const RECIPE_TAGS: readonly { value: RecipeTag; icon: LucideIcon }[] = [
  { value: "tupper", icon: Package },
  { value: "no_cook", icon: Salad },
  { value: "oven", icon: Heater },
  { value: "air_fryer", icon: AirVent },
  { value: "one_pan", icon: EggFried },
  { value: "pressure_cooker", icon: CookingPot },
  { value: "freezable", icon: Snowflake },
  { value: "spicy", icon: Flame },
];

/** ⚡ — a fact about the times, so it is computed, never stored or picked. */
export const QUICK_MINUTES = 30;
export const QuickIcon = Zap;

export function totalMinutes(recipe: Pick<Recipe, "prep_time_minutes" | "cook_time_minutes">): number {
  return (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);
}

export function isQuick(recipe: Pick<Recipe, "prep_time_minutes" | "cook_time_minutes">): boolean {
  const total = totalMinutes(recipe);
  return total > 0 && total <= QUICK_MINUTES;
}

export function tagIcon(tag: RecipeTag): LucideIcon {
  return RECIPE_TAGS.find((t) => t.value === tag)?.icon ?? Package;
}
