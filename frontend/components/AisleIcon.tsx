import { Beef, Carrot, Croissant, CupSoda, Droplet, Milk, Package, Snowflake, Soup, SprayCan, Wheat, type LucideIcon } from "lucide-react";
import type { Aisle } from "@/lib/api-client";

/**
 * One picture per aisle, so a long list of ingredients can be scanned by shape
 * before it is read. A `Record` rather than a switch so a twelfth aisle fails
 * the type check here instead of rendering nothing.
 */
const ICONS: Record<Aisle, LucideIcon> = {
  produce: Carrot,
  bakery: Croissant,
  meat_fish: Beef,
  dairy_eggs: Milk,
  frozen: Snowflake,
  canned: Soup,
  dry_goods: Wheat,
  condiments: Droplet,
  drinks: CupSoda,
  household: SprayCan,
  other: Package,
};

export function AisleIcon({ aisle, className }: { aisle: Aisle; className?: string }) {
  const Icon = ICONS[aisle];
  return <Icon className={className} aria-hidden />;
}
