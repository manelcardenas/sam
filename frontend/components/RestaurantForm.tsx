"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Check, LocateFixed, MapPin, Save, Search, X } from "lucide-react";
import {
  apiClient,
  type Area,
  type Cuisine,
  type CreateRestaurantInput,
  type Place,
  type Restaurant,
  type RestaurantDetail,
} from "@/lib/api-client";
import { MapLoading } from "@/components/map/MapLoading";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";

// MapLibre is heavy and DOM-only — fetched only when someone opens the pin picker.
const PinPickerMap = dynamic(() => import("@/components/map/PinPickerMap"), {
  ssr: false,
  loading: () => <MapLoading className="h-64 w-full rounded-2xl border border-line" />,
});

interface RestaurantFormInitialData {
  name: string;
  address?: string | null;
  price_level?: 1 | 2 | 3 | 4 | null;
  cuisines: string[];
  latitude?: number | null;
  longitude?: number | null;
}

interface RestaurantFormProps {
  initialData?: RestaurantFormInitialData;
  onSubmit: (data: CreateRestaurantInput) => Promise<void>;
  onCancel: () => void;
  /** Dedup: lets the user pick an existing restaurant instead of creating a duplicate. Omit when editing. */
  onSelectExisting?: (restaurant: Restaurant) => void;
  submitLabel: string;
}

const fieldClass =
  "w-full rounded-2xl border border-line bg-surface px-4 py-3 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30";

const labelClass = "mb-1.5 block text-sm font-semibold text-fg";

const matchButtonClass =
  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-sm transition-colors hover:border-tomato/40 hover:text-tomato";

/** "120 m" / "1.4 km" for nearby results. */
function formatDistance(m: number) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

export default function RestaurantForm({
  initialData,
  onSubmit,
  onCancel,
  onSelectExisting,
  submitLabel,
}: RestaurantFormProps) {
  const { t } = useI18n();
  const [name, setName] = useState(initialData?.name ?? "");
  const [area, setArea] = useState("");
  const [areaSuggestions, setAreaSuggestions] = useState<Area[]>([]);
  const [selectedArea, setSelectedArea] = useState<Area | null>(null);
  const [nearYou, setNearYou] = useState(false);
  const [address, setAddress] = useState(initialData?.address ?? "");
  const [priceLevel, setPriceLevel] = useState<1 | 2 | 3 | 4 | null>(initialData?.price_level ?? null);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>(initialData?.cuisines ?? []);
  const [cuisineOptions, setCuisineOptions] = useState<Cuisine[]>([]);
  const [matches, setMatches] = useState<Restaurant[]>([]);
  const [placeMatches, setPlaceMatches] = useState<Place[]>([]);
  // Geoapify's autocomplete measures ~1.6 s from a laptop and ~3 s from the
  // Lambda, which is long enough that the UI has to say so — otherwise the
  // "no results, drop a pin instead" hint appears while the search is still
  // running. See docs/plans/routing-and-latency-plan.md step 5.
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  // Pin drop: pendingPin follows the marker inside the open picker; pinnedCoords
  // is the confirmed spot that gets submitted. Mutually exclusive with selectedPlace.
  const [showPinMap, setShowPinMap] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ lat: number; lon: number } | null>(null);
  const [pinnedCoords, setPinnedCoords] = useState<{ lat: number; lon: number } | null>(null);
  // Everything already on SAM with coordinates — shown as neutral pins in the
  // picker so nobody re-creates a restaurant that's sitting right there.
  const [pinNeighbours, setPinNeighbours] = useState<RestaurantDetail[]>([]);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic id of the most recently *issued* place search. At ~3 s per call a
  // slow earlier response can easily land after a fast later one and overwrite
  // correct results with stale ones, so responses are dropped unless they
  // belong to the latest request.
  const placeSearchSeq = useRef(0);
  const areaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last known position — set by "near me", then reused to bias typed search.
  const coordsRef = useRef<{ lat: number; lon: number } | null>(null);

  const creating = !initialData && !!onSelectExisting;

  // Edit mode: the stored pin, shown as the picker's starting marker.
  const initialCoords =
    initialData?.latitude != null && initialData?.longitude != null
      ? { lat: initialData.latitude, lon: initialData.longitude }
      : null;
  // What submit sends (edit): a confirmed pin move wins, else leave the stored one alone.
  const effectiveCoords = pinnedCoords ?? initialCoords;

  useEffect(() => {
    apiClient.listCuisines().then(setCuisineOptions).catch(() => {});
  }, []);

  // If location permission was already granted (e.g. from a past "near me"),
  // grab the position silently so typed searches are location-biased from the
  // first keystroke. Never prompts — the near-me button owns the prompt.
  useEffect(() => {
    if (!creating || coordsRef.current || !navigator.permissions) return;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((permission) => {
        if (permission.state !== "granted") return;
        navigator.geolocation.getCurrentPosition(
          (position) => {
            coordsRef.current = { lat: position.coords.latitude, lon: position.coords.longitude };
            setNearYou(true);
          },
          () => {},
        );
      })
      .catch(() => {});
  }, [creating]);

  // Unified dedup/Place search: only while creating, so editing an existing
  // restaurant never surfaces "did you mean" matches against itself.
  useEffect(() => {
    if (!creating) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = name.trim();
    // Right after picking a Place the name is set programmatically — don't
    // immediately reopen the search panel over the freshly filled form.
    if (trimmed.length < 2 || trimmed === selectedPlace?.name.trim()) {
      setMatches([]);
      setPlaceMatches([]);
      setSearchingPlaces(false);
      // Bump the sequence so any in-flight response is discarded rather than
      // repopulating a panel the user has just cleared.
      placeSearchSeq.current += 1;
      return;
    }
    debounceRef.current = setTimeout(() => {
      const seq = ++placeSearchSeq.current;
      const isStale = () => seq !== placeSearchSeq.current;
      setSearchingPlaces(true);
      // Both searches are a courtesy, not critical — each fails silently.
      apiClient
        // Dedup lookup: name match only, ordered by name so the panel is stable
        // while typing rather than reshuffling by recency.
        .searchRestaurants({ q: trimmed, sort: "name" })
        .then((found) => {
          if (!isStale()) setMatches(found);
        })
        .catch(() => {});
      // A picked Area anchors the search with real coordinates ("La Mafia" near
      // Zaragoza's center); free-typed area text falls back to narrowing the
      // geocoder query; otherwise bias by the user's own position if known.
      const placeQuery = selectedArea ? `${trimmed} ${selectedArea.name}` : area.trim() ? `${trimmed} ${area.trim()}` : trimmed;
      const bias = selectedArea ? { lat: selectedArea.latitude, lon: selectedArea.longitude } : (coordsRef.current ?? undefined);
      apiClient
        .searchPlaces(placeQuery, bias)
        .then((found) => {
          if (!isStale()) setPlaceMatches(found);
        })
        .catch(() => {})
        .finally(() => {
          if (!isStale()) setSearchingPlaces(false);
        });
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [name, area, selectedArea, creating, selectedPlace]);

  // Area autocomplete: its own debounce, so typing a city doesn't thrash the
  // place search above.
  useEffect(() => {
    if (!creating) return;
    if (areaDebounceRef.current) clearTimeout(areaDebounceRef.current);
    const trimmed = area.trim();
    if (trimmed.length < 2 || trimmed === selectedArea?.label.trim()) {
      setAreaSuggestions([]);
      return;
    }
    areaDebounceRef.current = setTimeout(() => {
      apiClient
        .searchAreas(trimmed)
        .then(setAreaSuggestions)
        .catch(() => {});
    }, 350);
    return () => {
      if (areaDebounceRef.current) clearTimeout(areaDebounceRef.current);
    };
  }, [area, creating, selectedArea]);

  const selectArea = (a: Area) => {
    setSelectedArea(a);
    setArea(a.label);
    setAreaSuggestions([]);
  };

  const clearArea = () => {
    setSelectedArea(null);
    setArea("");
    setAreaSuggestions([]);
  };

  const findNearby = () => {
    if (!navigator.geolocation) {
      setLocateError("Your browser doesn't support location.");
      return;
    }
    setLocating(true);
    setLocateError("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
        coordsRef.current = coords;
        setNearYou(true);
        try {
          const places = await apiClient.nearbyPlaces(coords);
          setPlaceMatches(places);
          if (places.length === 0) setLocateError("No restaurants found around you — type the name instead.");
        } catch {
          setLocateError("Couldn't search nearby right now — type the name instead.");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setLocateError("Location unavailable — you can still search by name.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const openPinMap = () => {
    setPendingPin(null);
    setShowPinMap(true);
    // Dedup layer, create mode only (editing shows just the restaurant's own pin).
    // Courtesy fetch — the picker works fine without it.
    if (creating) {
      apiClient
        .searchRestaurants()
        .then((all) => setPinNeighbours(all.filter((r) => r.latitude != null && r.longitude != null)))
        .catch(() => {});
    }
  };

  const confirmPin = async () => {
    if (!pendingPin) {
      setShowPinMap(false); // existing pin left where it was — nothing to change
      return;
    }
    setPinnedCoords(pendingPin);
    setShowPinMap(false);
    if (creating) setSelectedPlace(null); // a hand-dropped pin replaces the provider link
    // Courtesy prefill: never overwrite an address the user already typed.
    if (!address.trim()) {
      try {
        const { address: found } = await apiClient.reverseGeocode(pendingPin);
        if (found) setAddress(found);
      } catch {
        // prefill only — the pin itself is already set
      }
    }
  };

  const clearPin = () => {
    setPinnedCoords(null);
    setPendingPin(null);
    setShowPinMap(false);
  };

  const selectPlace = (place: Place) => {
    setSelectedPlace(place);
    setPinnedCoords(null); // the provider's coordinates take over
    setShowPinMap(false);
    setName(place.name);
    if (place.address) setAddress(place.address);
    // Prefill cuisines that match the curated vocabulary; unrecognized provider tags are dropped.
    const matched = cuisineOptions.filter((c) => place.cuisines.includes(c.name.toLowerCase())).map((c) => c.name);
    if (matched.length > 0) setSelectedCuisines((prev) => [...new Set([...prev, ...matched])]);
    setMatches([]);
    setPlaceMatches([]);
  };

  const toggleCuisine = (cuisineName: string) =>
    setSelectedCuisines((prev) =>
      prev.includes(cuisineName) ? prev.filter((c) => c !== cuisineName) : [...prev, cuisineName],
    );

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
        external_place_id: selectedPlace?.external_place_id,
        // Geoapify first: a picked Place brings its own coordinates; a hand-dropped
        // pin covers everything the provider doesn't know. Omitting both on edit
        // leaves the stored location untouched (backend contract).
        latitude: selectedPlace?.latitude ?? (creating ? pinnedCoords?.lat : effectiveCoords?.lat),
        longitude: selectedPlace?.longitude ?? (creating ? pinnedCoords?.lon : effectiveCoords?.lon),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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

        {creating && (
          <div className="mt-3">
            <span className="mb-1.5 block text-xs font-semibold text-muted">
              {t("restaurant-form.where")}{" "}
              <span className="font-normal">{t("restaurant-form.where-hint")}</span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={findNearby}
                disabled={locating}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3.5 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <LocateFixed className="h-4 w-4" />
                {locating ? t("restaurant-form.locating") : t("restaurant-form.near-me")}
              </button>
              <div className="relative min-w-0 flex-1 basis-48">
                <input
                  type="text"
                  value={area}
                  onChange={(e) => {
                    setArea(e.target.value);
                    if (selectedArea && e.target.value !== selectedArea.label) setSelectedArea(null);
                  }}
                  maxLength={150}
                  aria-label={t("restaurant-form.area-label")}
                  placeholder={t("restaurant-form.area-placeholder")}
                  className="w-full rounded-full border border-line bg-surface px-3.5 py-2.5 text-sm text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
                />
                {areaSuggestions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-2xl border border-line bg-surface shadow-paw">
                    {areaSuggestions.map((a) => (
                      <li key={`${a.label}-${a.latitude}`}>
                        <button
                          type="button"
                          onClick={() => selectArea(a)}
                          className="flex w-full cursor-pointer items-center gap-1.5 px-3.5 py-2.5 text-left text-sm text-fg transition-colors hover:bg-tomato/10 hover:text-tomato focus:outline-none focus-visible:bg-tomato/10"
                        >
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted" />
                          <span className="min-w-0 truncate">{a.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                onClick={() => (showPinMap ? setShowPinMap(false) : openPinMap())}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3.5 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <MapPin className="h-4 w-4" />
                {t("restaurant-form.drop-a-pin")}
              </button>
            </div>
            {(selectedArea || nearYou || locateError) && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                {selectedArea ? (
                  <>
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-tomato" />
                    <span className="min-w-0 truncate">
                      {t("restaurant-form.searching-around")}{" "}
                      <span className="font-semibold text-fg">{selectedArea.name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={clearArea}
                      title={t("restaurant-form.clear-area")}
                      aria-label={t("restaurant-form.clear-area")}
                      className="cursor-pointer rounded-full p-0.5 text-muted transition-colors hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : nearYou ? (
                  <>
                    <LocateFixed className="h-3.5 w-3.5 shrink-0 text-tomato" />
                    <span>{t("restaurant-form.ranked-by-distance")}</span>
                  </>
                ) : (
                  <span>{locateError}</span>
                )}
              </p>
            )}
            {!showPinMap && !pinnedCoords && !selectedPlace && name.trim().length >= 2 && searchingPlaces && (
              <p className="mt-1.5 text-xs text-muted" role="status">
                {t("common.searching")}
              </p>
            )}
            {!showPinMap &&
              !pinnedCoords &&
              !selectedPlace &&
              name.trim().length >= 2 &&
              !searchingPlaces &&
              placeMatches.length === 0 && (
              <p className="mt-1.5 text-xs text-muted">
                Can&rsquo;t find it on the map?{" "}
                <button
                  type="button"
                  onClick={openPinMap}
                  className="cursor-pointer font-semibold text-tomato underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  {t("restaurant-form.drop-a-pin")}
                </button>{" "}
                instead.
              </p>
            )}
          </div>
        )}

        {!creating && (
          <div className="mt-3">
            <span className="mb-1.5 block text-xs font-semibold text-muted">
              Location <span className="font-normal">{initialCoords ? "(shown on the map)" : "(not on the map yet)"}</span>
            </span>
            {!showPinMap && (
              <button
                type="button"
                onClick={openPinMap}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3.5 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <MapPin className="h-4 w-4" />
                {effectiveCoords ? t("restaurant-form.adjust-pin") : t("restaurant-form.drop-pin-on-map")}
              </button>
            )}
          </div>
        )}

        {showPinMap && (
          <div className="mt-3 space-y-2">
            <PinPickerMap
              initial={effectiveCoords}
              anchor={
                selectedArea
                  ? { lat: selectedArea.latitude, lon: selectedArea.longitude }
                  : coordsRef.current
              }
              onChange={setPendingPin}
              existing={creating ? pinNeighbours : []}
              onPickExisting={onSelectExisting}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmPin}
                disabled={!pendingPin && !effectiveCoords}
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
        )}

        {pinnedCoords && !selectedPlace && !showPinMap && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-tomato" />
            <span className="truncate">
              <span className="font-semibold text-fg">{t("restaurant-form.pinned")}</span>
              {!creating && " — saved with your changes"}
            </span>
            <button
              type="button"
              onClick={clearPin}
              title={t("restaurant-form.remove-pin")}
              aria-label={t("restaurant-form.remove-pin")}
              className="cursor-pointer rounded-full p-0.5 text-muted transition-colors hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {selectedPlace && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-tomato" />
            <span className="truncate">
              {t("restaurant-form.mapped-to")}{" "}
              <span className="font-semibold text-fg">{selectedPlace.name}</span>
            </span>
            <button
              type="button"
              onClick={() => setSelectedPlace(null)}
              title={t("restaurant-form.remove-map-link")}
              aria-label={t("restaurant-form.remove-map-link")}
              className="cursor-pointer rounded-full p-0.5 text-muted transition-colors hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {(matches.length > 0 || placeMatches.length > 0) && (
        <div className="rounded-2xl border border-dashed border-line p-4">
          {matches.length > 0 && (
            <>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
                <Search className="h-4 w-4 text-muted" />
                {t("restaurant-form.already-here")}
              </p>
              <p className="mb-3 text-xs text-muted">
                {t("restaurant-form.already-here-body")}
              </p>
              <ul className="space-y-2">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => onSelectExisting?.(m)} className={matchButtonClass}>
                      <span className="truncate font-semibold">{m.name}</span>
                      {m.address && <span className="ml-2 shrink-0 truncate text-xs text-muted">{m.address}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {placeMatches.length > 0 && (
            <>
              <p className={`mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg ${matches.length > 0 ? "mt-4" : ""}`}>
                <MapPin className="h-4 w-4 text-muted" />
                {t("restaurant-form.from-the-map")}
              </p>
              <p className="mb-3 text-xs text-muted">{t("restaurant-form.from-the-map-body")}</p>
              <ul className="space-y-2">
                {placeMatches.map((p) => (
                  <li key={p.external_place_id}>
                    <button type="button" onClick={() => selectPlace(p)} className={matchButtonClass}>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{p.name}</span>
                        {p.address && <span className="block truncate text-xs text-muted">{p.address}</span>}
                      </span>
                      {p.distance_m != null && (
                        <span className="ml-2 shrink-0 text-xs text-muted">{formatDistance(p.distance_m)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-right text-[10px] text-muted/70">
                {t("restaurant-form.attribution")}
              </p>
            </>
          )}
        </div>
      )}

      <div>
        <label htmlFor="address" className={labelClass}>
          {t("restaurant-form.address")}{" "}
          <span className="font-normal text-muted">{t("common.optional")}</span>
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

      <div>
        <label className={labelClass}>
          {t("restaurant-form.price-level")}{" "}
          <span className="font-normal text-muted">{t("common.optional")}</span>
        </label>
        <div className="grid grid-cols-4 gap-2">
          {([1, 2, 3, 4] as const).map((level) => {
            const selected = priceLevel === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => setPriceLevel(selected ? null : level)}
                className={`cursor-pointer rounded-2xl border-2 py-3 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40 ${
                  selected
                    ? "border-tomato bg-tomato/10 text-fg shadow-pop"
                    : "border-line text-muted hover:border-tomato/40 hover:text-fg"
                }`}
              >
                {"€".repeat(level)}
              </button>
            );
          })}
        </div>
      </div>

      {cuisineOptions.length > 0 && (
        <div>
          <label className={labelClass}>
            {t("restaurant-form.cuisine")}{" "}
            <span className="font-normal text-muted">{t("restaurant-form.cuisine-hint")}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {cuisineOptions.map((c) => {
              const selected = selectedCuisines.includes(c.name);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCuisine(c.name)}
                  className={`cursor-pointer rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/40 ${
                    selected
                      ? "border-tomato bg-tomato/10 text-fg"
                      : "border-line text-muted hover:border-tomato/40 hover:text-fg"
                  }`}
                >
                  {t(`cuisines.${c.name}` as MessageKey)}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
