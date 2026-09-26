"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Check, MapPin, Save, X } from "lucide-react";
import { apiClient, type Cuisine, type CreateRestaurantInput } from "@/lib/api-client";
import { MapLoading } from "@/components/map/MapLoading";
import { CuisinePicker, PricePicker, fieldClass, labelClass, type PriceLevel } from "@/components/restaurant-fields";
import { useI18n } from "@/lib/i18n/LocaleProvider";

// MapLibre is heavy and DOM-only — fetched only when someone opens the pin picker.
const PinPickerMap = dynamic(() => import("@/components/map/PinPickerMap"), {
  ssr: false,
  loading: () => <MapLoading className="h-64 w-full rounded-2xl border border-line" />,
});

interface RestaurantFormInitialData {
  name: string;
  address?: string | null;
  price_level?: PriceLevel | null;
  cuisines: string[];
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Editing a restaurant's facts. Adding one is `AddRestaurantFlow`, which starts
 * from the map; by the time a place is being edited it already exists, so this
 * is plain fields plus a pin you can move.
 *
 * Any user may edit any restaurant (docs/adr/0002) — the facts are shared.
 */
export default function RestaurantForm({
  initialData,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initialData: RestaurantFormInitialData;
  onSubmit: (data: CreateRestaurantInput) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialData.name);
  const [address, setAddress] = useState(initialData.address ?? "");
  const [priceLevel, setPriceLevel] = useState<PriceLevel | null>(initialData.price_level ?? null);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>(initialData.cuisines);
  const [cuisineOptions, setCuisineOptions] = useState<Cuisine[]>([]);
  // pendingPin follows the marker inside the open picker; pinnedCoords is the
  // confirmed move that gets submitted.
  const [showPinMap, setShowPinMap] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ lat: number; lon: number } | null>(null);
  const [pinnedCoords, setPinnedCoords] = useState<{ lat: number; lon: number } | null>(null);
  // The address under the pin while you move it — undefined while it is looked
  // up. Without it a tap moves the pin somewhere you cannot name until after
  // you have confirmed it.
  const [pinAddress, setPinAddress] = useState<string | null | undefined>(undefined);
  const lookupSeq = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const initialCoords =
    initialData.latitude != null && initialData.longitude != null
      ? { lat: initialData.latitude, lon: initialData.longitude }
      : null;
  // A confirmed pin move wins; otherwise the stored location is left alone.
  const effectiveCoords = pinnedCoords ?? initialCoords;

  useEffect(() => {
    apiClient.listCuisines().then(setCuisineOptions).catch(() => {});
  }, []);

  const openPinMap = () => {
    lookupSeq.current += 1; // a lookup from the last time the picker was open is stale
    setPendingPin(null);
    setShowPinMap(true);
  };

  // Every tap and every drag: look the address up, keeping only the latest —
  // a slow answer for where the pin was must not overwrite where it is.
  const movePin = (coords: { lat: number; lon: number }) => {
    setPendingPin(coords);
    setPinAddress(undefined);
    const mine = ++lookupSeq.current;
    apiClient
      .reverseGeocode(coords)
      .then(({ address: found }) => {
        if (mine === lookupSeq.current) setPinAddress(found);
      })
      .catch(() => {
        if (mine === lookupSeq.current) setPinAddress(null);
      });
  };

  const confirmPin = () => {
    if (!pendingPin) {
      setShowPinMap(false); // existing pin left where it was — nothing to change
      return;
    }
    setPinnedCoords(pendingPin);
    setShowPinMap(false);
    // You moved the pin, so the address moves with it — you saw it under the
    // map before confirming, and the field below stays editable.
    if (pinAddress) setAddress(pinAddress);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError(t("restaurant-form.name-required"));
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        address: address.trim() || undefined,
        price_level: priceLevel ?? undefined,
        cuisines: selectedCuisines,
        // Omitting both leaves the stored location untouched (backend contract).
        latitude: effectiveCoords?.lat,
        longitude: effectiveCoords?.lon,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("add-restaurant.save-failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="name" className={labelClass}>
          {t("restaurant-form.name")} {t("common.required-marker")}
        </label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
          placeholder={t("restaurant-form.name-placeholder")}
        />
      </div>

      <div>
        <span className={labelClass}>{t("restaurant-form.location")}</span>
        {showPinMap ? (
          <div className="space-y-2">
            <PinPickerMap initial={effectiveCoords} onChange={movePin} />
            {/* Where the pin points, live. Before any move it is the stored
                address; after one, the address of the new spot. */}
            <p className="flex items-start gap-1.5 text-sm" role="status">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-tomato" aria-hidden />
              <span className={pendingPin && pinAddress ? "font-semibold text-fg" : "text-muted"}>
                {pendingPin
                  ? pinAddress === undefined
                    ? t("add-restaurant.finding-address")
                    : (pinAddress ?? t("add-restaurant.no-address"))
                  : address.trim() || t("map.pin-hint")}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmPin}
                disabled={(!pendingPin && !effectiveCoords) || (pendingPin !== null && pinAddress === undefined)}
                className="flex cursor-pointer items-center gap-1.5 rounded-full bg-tomato px-4 py-2 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <Check className="h-4 w-4" />
                {t("restaurant-form.use-this-spot")}
              </button>
              <button
                type="button"
                onClick={() => setShowPinMap(false)}
                className="cursor-pointer rounded-full border border-line px-4 py-2 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openPinMap}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3.5 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <MapPin className="h-4 w-4" />
            {effectiveCoords ? t("restaurant-form.adjust-pin") : t("restaurant-form.drop-pin-on-map")}
          </button>
        )}
        {pinnedCoords && !showPinMap && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-tomato" aria-hidden />
            <span className="font-semibold text-fg">{t("restaurant-form.pinned")}</span>
          </p>
        )}
      </div>

      <div>
        <label htmlFor="address" className={labelClass}>
          {t("restaurant-form.address")} <span className="font-normal text-muted">{t("common.optional")}</span>
        </label>
        <input
          id="address"
          type="text"
          value={address}
          maxLength={500}
          onChange={(e) => setAddress(e.target.value)}
          className={fieldClass}
          placeholder={t("restaurant-form.address-placeholder")}
        />
      </div>

      <PricePicker value={priceLevel} onChange={setPriceLevel} />

      <CuisinePicker options={cuisineOptions} value={selectedCuisines} onChange={setSelectedCuisines} />

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-tomato py-3 px-4 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <Save className="h-4 w-4" />
          {submitting ? t("common.saving") : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-5 py-3 font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <X className="h-4 w-4" />
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
