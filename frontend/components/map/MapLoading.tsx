"use client";

import { MapPin } from "lucide-react";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/** Placeholder shown by next/dynamic while a map chunk downloads —
 * same footprint as the map it replaces, so nothing jumps. */
export function MapLoading({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-surface-2 bg-paws ${className}`}
      role="status"
      aria-label={t("map.loading-label")}
    >
      <div className="flex flex-col items-center gap-2 text-muted">
        <MapPin className="h-7 w-7 animate-float" />
        <span className="text-sm">{t("map.loading")}</span>
      </div>
    </div>
  );
}
