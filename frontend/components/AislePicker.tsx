"use client";

import type { Aisle } from "@/lib/api-client";
import { AisleIcon } from "@/components/AisleIcon";
import { Chip } from "@/components/ui/Chip";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { AISLES } from "@/lib/grocery";

/**
 * The eleven aisles as a row of pills, in walking order.
 *
 * Shared by the shopping list and the recipe review table because it is one
 * question in both — *where in the shop is this?* — and its answer lands in the
 * same place: the shared vocabulary. Pills rather than a `<select>` because on a
 * phone a native select is a full-screen wheel for an eleven-option choice you
 * can see all at once.
 *
 * `Other` is offered like the rest. Sometimes it is the honest answer, and a
 * picker that refused it would push people to file things somewhere wrong.
 */
export function AislePicker({ current, onPick, disabled = false }: { current?: Aisle; onPick: (aisle: Aisle) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t("grocery.pick-aisle")} aria-disabled={disabled} className={`flex flex-wrap gap-1.5 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      {AISLES.map((aisle) => (
        <Chip key={aisle} active={aisle === current} onClick={() => onPick(aisle)}>
          <AisleIcon aisle={aisle} className="h-4 w-4 shrink-0" />
          {t(`aisle.${aisle}`)}
        </Chip>
      ))}
    </div>
  );
}
