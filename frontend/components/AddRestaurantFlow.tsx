"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Check, LocateFixed, MapPin, Pencil, Save, Search, X } from "lucide-react";
import {
  apiClient,
  type Area,
  type CreateRestaurantInput,
  type Cuisine,
  type Place,
  type Restaurant,
  type RestaurantDetail,
} from "@/lib/api-client";
import { MapLoading } from "@/components/map/MapLoading";
import {
  CuisinePicker,
  PricePicker,
  fieldClass,
  formatDistance,
  labelClass,
  matchCuisines,
  type PriceLevel,
} from "@/components/restaurant-fields";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { MessageKey } from "@/lib/i18n/dictionary";

const AddPlaceMap = dynamic(() => import("@/components/map/AddPlaceMap"), {
  ssr: false,
  loading: () => <MapLoading className="h-[22rem] w-full rounded-3xl border border-line sm:h-96" />,
});

/** How far `/places/nearby` looks. The restaurant you are in is metres away; 500 m covers a bad GPS fix. */
const NEARBY_RADIUS_M = 500;
/** A SAM restaurant this close to a dropped pin is probably the one you are about to re-create. */
const SAME_SPOT_M = 75;
/** Rows in the list under the map — the rest are still pins. */
const LIST_SIZE = 8;
/** Pan further than this from the last search and "Search this area" appears. */
const SEARCH_HERE_AFTER_M = 250;
/** Below this zoom a 500 m nearby search is a dot on the map — offer it only at street level. */
const SEARCH_HERE_MIN_ZOOM = 14;
/** Where the map opens without your location: all of Spain, where the archive lives. */
const NO_LOCATION_START = { center: { lat: 40.2, lon: -3.7 }, zoom: 5 };

type Coords = { lat: number; lon: number };
type Locate = "locating" | "ok" | "denied" | "unavailable";
/** A spot you pointed at on the map; `address` is undefined while it is looked up. */
type Spot = { coords: Coords; address: string | null | undefined };
/** What the details step is filling in: a place the provider knows, or a spot you chose. */
type Origin = { kind: "place"; place: Place } | { kind: "spot"; coords: Coords; address: string | null };
type Results = { sam: RestaurantDetail[]; places: Place[]; areas: Area[] };

/**
 * Adding a restaurant: one search box over one map.
 *
 * **Why this shape.** The first version was a form — name, "where is it?",
 * "near me", a city field, "drop a pin", address — six controls for one
 * question: *which place is it?* Map apps answer that with a single box over a
 * map, and so does this:
 *
 * - **The map opens on you**, with the restaurants the provider knows around
 *   you as pins. Nearly every place is added from inside it (docs/adr/0005:
 *   the archive is a record of meals), so the usual path is one tap on a pin
 *   and one on "This is it".
 * - **The map is also the pin.** Tap anywhere — or on your own blue dot — and a
 *   pin drops there with the address under it; drag it to adjust. That replaces
 *   both "drop a pin" and "use my current location", and it is editable, which
 *   a fixed "current location" was not.
 * - **The box searches everything at once**: restaurants already on SAM
 *   (dedup), restaurants the provider knows, and areas. Picking an area flies
 *   the map there and loads its restaurants — which is what the separate city
 *   field did, without being a field.
 * - **Panning offers "Search this area"**, the way map apps do, rather than
 *   refetching on every drag.
 * - **The address is never asked for.** It comes from the place or from the
 *   pin, and is editable on the next step if the geocoder got it wrong.
 *
 * The details step then asks only what nobody else knows: price, cuisine and —
 * for a dropped pin — the name.
 *
 * Location denied or unavailable is not a dead end: the map opens on Spain and
 * the search box does the work.
 */
export default function AddRestaurantFlow({
  archive,
  onSubmit,
  onCancel,
  onSelectExisting,
}: {
  /** Everything on SAM — for "already on SAM" on pins, results and near a dropped pin. */
  archive: RestaurantDetail[];
  onSubmit: (data: CreateRestaurantInput) => Promise<void>;
  onCancel: () => void;
  onSelectExisting: (restaurant: Restaurant) => void;
}) {
  const { t } = useI18n();
  const [locate, setLocate] = useState<Locate>("locating");
  const [you, setYou] = useState<Coords | null>(null);

  // What is on the map, and where it was searched from.
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [placesFailed, setPlacesFailed] = useState(false);
  const [searchedAt, setSearchedAt] = useState<Coords | null>(null);
  const [view, setView] = useState<{ center: Coords; zoom: number } | null>(null);
  const [flyTo, setFlyTo] = useState<{ center: Coords; zoom: number; seq: number } | null>(null);
  const [fit, setFit] = useState<{ around: Coords; seq: number } | null>(null);
  const seq = useRef(0);

  // What you have picked: a known place or a dropped pin, never both.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const spotSeq = useRef(0);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [searching, setSearching] = useState(false);
  const querySeq = useRef(0);

  const [origin, setOrigin] = useState<Origin | null>(null);
  const [cuisineOptions, setCuisineOptions] = useState<Cuisine[]>([]);

  useEffect(() => {
    apiClient.listCuisines().then(setCuisineOptions).catch(() => {});
  }, []);

  const searchNearby = useCallback((center: Coords) => {
    const mine = ++seq.current;
    setSearchedAt(center);
    setPlaces(null);
    setPlacesFailed(false);
    apiClient
      .nearbyPlaces(center, NEARBY_RADIUS_M)
      .then((found) => {
        if (mine !== seq.current) return;
        setPlaces(found);
        setFit({ around: center, seq: mine });
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setPlaces([]);
        setPlacesFailed(true);
      });
  }, []);

  const findMe = useCallback(() => {
    if (!navigator.geolocation) {
      setLocate("unavailable");
      return;
    }
    setLocate((current) => (current === "ok" ? "ok" : "locating"));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
        setYou(coords);
        setLocate("ok");
        setFlyTo({ center: coords, zoom: 17, seq: ++seq.current });
        searchNearby(coords);
      },
      (err) => setLocate(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [searchNearby]);

  // The user has just tapped "New restaurant", so asking for their location now
  // is in context — which is when browsers expect the prompt, and when people
  // say yes to it.
  useEffect(() => {
    findMe();
  }, [findMe]);

  const onSam = useMemo(() => {
    const byPlaceId = new Map<string, RestaurantDetail>();
    for (const r of archive) if (r.external_place_id) byPlaceId.set(r.external_place_id, r);
    return byPlaceId;
  }, [archive]);

  const selected = places?.find((p) => p.external_place_id === selectedId) ?? null;

  const selectPlace = (id: string | null) => {
    setSelectedId(id);
    if (id) setSpot(null);
  };

  // Every drop and every drag: look the address up, keeping only the latest.
  const dropAt = (coords: Coords) => {
    setSelectedId(null);
    setSpot({ coords, address: undefined });
    const mine = ++spotSeq.current;
    apiClient
      .reverseGeocode(coords)
      .then(({ address }) => {
        if (mine === spotSeq.current) setSpot({ coords, address });
      })
      .catch(() => {
        if (mine === spotSeq.current) setSpot({ coords, address: null });
      });
  };

  // One box, three questions, asked together. Debounced because the provider
  // takes seconds per call; stale answers are dropped by sequence number.
  useEffect(() => {
    const needle = query.trim();
    const mine = ++querySeq.current;
    if (needle.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      const bias = view?.center ?? you ?? undefined;
      Promise.all([
        apiClient.searchRestaurants({ q: needle, sort: "name" }).catch(() => []),
        apiClient.searchPlaces(needle, bias).catch(() => []),
        apiClient.searchAreas(needle).catch(() => []),
      ]).then(([sam, found, areas]) => {
        if (mine !== querySeq.current) return;
        setResults({ sam: sam.slice(0, 3), places: found.slice(0, 5), areas: areas.slice(0, 3) });
        setSearching(false);
      });
    }, 350);
    return () => clearTimeout(timer);
    // Bias is read, not watched: panning must not re-run a search you typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const pickResultPlace = (place: Place) => {
    setQuery("");
    setPlaces((current) =>
      current?.some((p) => p.external_place_id === place.external_place_id) ? current : [place, ...(current ?? [])],
    );
    selectPlace(place.external_place_id);
    setFlyTo({ center: { lat: place.latitude, lon: place.longitude }, zoom: 17, seq: ++seq.current });
  };

  const pickArea = (area: Area) => {
    setQuery("");
    const center = { lat: area.latitude, lon: area.longitude };
    selectPlace(null);
    setSpot(null);
    setFlyTo({ center, zoom: 16, seq: ++seq.current });
    searchNearby(center);
  };

  const spotOnSam = useMemo(() => {
    if (!spot) return [];
    return archive
      .filter((r) => r.latitude != null && r.longitude != null)
      .map((r) => ({ restaurant: r, distance: metresBetween(spot.coords, { lat: r.latitude!, lon: r.longitude! }) }))
      .filter(({ distance }) => distance <= SAME_SPOT_M)
      .sort((a, b) => a.distance - b.distance);
  }, [archive, spot]);

  const offerSearchHere =
    view !== null &&
    view.zoom >= SEARCH_HERE_MIN_ZOOM &&
    (searchedAt === null || metresBetween(view.center, searchedAt) > SEARCH_HERE_AFTER_M);

  if (origin) {
    return (
      <DetailsStep origin={origin} cuisineOptions={cuisineOptions} onBack={() => setOrigin(null)} onSubmit={onSubmit} />
    );
  }

  const hasLocation = locate === "ok" && you !== null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold text-fg">{t("add-restaurant.where-title")}</h2>
        <p className="text-sm text-muted">{t("add-restaurant.where-body")}</p>
      </div>

      <SearchBox
        query={query}
        onQueryChange={setQuery}
        results={results}
        searching={searching}
        onSam={onSam}
        onPickExisting={onSelectExisting}
        onPickPlace={pickResultPlace}
        onPickArea={pickArea}
      />

      {locate === "locating" ? (
        <div className="space-y-2">
          <MapLoading className="h-[22rem] w-full rounded-3xl border border-line sm:h-96" />
          <p className="text-center text-sm text-muted" role="status">
            {t("add-restaurant.locating")}
          </p>
        </div>
      ) : (
        <>
          {!hasLocation && (
            <div className="flex items-start gap-2.5 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
              <LocateFixed className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <p className="min-w-0 flex-1 text-muted">
                <span className="font-semibold text-fg">{t(`add-restaurant.${locate as "denied" | "unavailable"}-title` as MessageKey)}</span>{" "}
                {t("add-restaurant.no-location-body")}
              </p>
              <button
                type="button"
                onClick={findMe}
                className="shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-sm font-bold text-tomato underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                {t("add-restaurant.try-again")}
              </button>
            </div>
          )}

          <div className="relative">
            <AddPlaceMap
              start={you ? { center: you, zoom: 17 } : NO_LOCATION_START}
              you={you}
              places={places ?? []}
              selectedId={selectedId}
              dropped={spot?.coords ?? null}
              flyTo={flyTo}
              fit={fit}
              onSelect={selectPlace}
              onDrop={dropAt}
              onMoveEnd={setView}
            />

            <p className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-5rem)] rounded-full bg-surface/95 px-3 py-1.5 text-xs font-medium text-muted shadow-paw">
              {t("add-restaurant.map-hint")}
            </p>

            <div className="absolute inset-x-0 top-14 z-10 flex justify-center">
              {offerSearchHere && view && (
                <button
                  type="button"
                  onClick={() => searchNearby(view.center)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-fg shadow-paw transition-colors hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 animate-fetch-in"
                >
                  <Search className="h-4 w-4" aria-hidden />
                  {t("add-restaurant.search-here")}
                </button>
              )}
            </div>

            {hasLocation && (
              <button
                type="button"
                onClick={findMe}
                aria-label={t("add-restaurant.recenter")}
                title={t("add-restaurant.recenter")}
                className="absolute bottom-10 right-3 z-10 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-fg shadow-paw transition-colors hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
              >
                <LocateFixed className="h-4 w-4" />
              </button>
            )}

            {/* What you tapped, and the answer. Over the map's foot rather than
                under it, so on a phone the question sits where your thumb was. */}
            {(selected || spot) && (
              <div className="absolute inset-x-2 bottom-2 z-20 animate-fetch-in">
                {selected ? (
                  <PlaceCard
                    key={selected.external_place_id}
                    place={selected}
                    existing={onSam.get(selected.external_place_id) ?? null}
                    cuisineOptions={cuisineOptions}
                    onAccept={() => setOrigin({ kind: "place", place: selected })}
                    onOpenExisting={onSelectExisting}
                    onDismiss={() => setSelectedId(null)}
                  />
                ) : (
                  spot && (
                    <SpotCard
                      spot={spot}
                      nearbyOnSam={spotOnSam}
                      onOpenExisting={onSelectExisting}
                      onAccept={() => setOrigin({ kind: "spot", coords: spot.coords, address: spot.address ?? null })}
                      onDismiss={() => setSpot(null)}
                    />
                  )
                )}
              </div>
            )}
          </div>

          {searchedAt && (
            <NearbyList
              heading={you && metresBetween(searchedAt, you) < SEARCH_HERE_AFTER_M ? t("add-restaurant.nearby") : t("add-restaurant.in-this-area")}
              places={places}
              failed={placesFailed}
              selectedId={selectedId}
              onSam={onSam}
              onSelect={(id) => {
                selectPlace(id);
                const place = places?.find((p) => p.external_place_id === id);
                if (place) setFlyTo({ center: { lat: place.latitude, lon: place.longitude }, zoom: 17.5, seq: ++seq.current });
              }}
            />
          )}
        </>
      )}

      <div className="flex justify-end">
        <SecondaryButton onClick={onCancel} icon={<X className="h-4 w-4" />}>
          {t("common.cancel")}
        </SecondaryButton>
      </div>
    </div>
  );
}

function SearchBox({
  query,
  onQueryChange,
  results,
  searching,
  onSam,
  onPickExisting,
  onPickPlace,
  onPickArea,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  results: Results | null;
  searching: boolean;
  onSam: Map<string, RestaurantDetail>;
  onPickExisting: (restaurant: Restaurant) => void;
  onPickPlace: (place: Place) => void;
  onPickArea: (area: Area) => void;
}) {
  const { t } = useI18n();
  const open = query.trim().length >= 2;
  // A provider result that is already on SAM is shown once, under SAM.
  const places = results?.places.filter((p) => !onSam.has(p.external_place_id)) ?? [];
  const sam = [
    ...(results?.sam ?? []),
    ...(results?.places.map((p) => onSam.get(p.external_place_id)).filter((r): r is RestaurantDetail => Boolean(r)) ?? []),
  ].filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);
  const empty = results !== null && sam.length === 0 && places.length === 0 && results.areas.length === 0;

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onQueryChange("");
        }}
        aria-label={t("add-restaurant.search-label")}
        placeholder={t("add-restaurant.search-placeholder")}
        className="h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-fg placeholder:text-muted/70 transition-colors focus:border-tomato focus:outline-none focus:ring-2 focus:ring-tomato/30"
      />

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 max-h-[26rem] overflow-y-auto rounded-3xl border border-line bg-surface p-2 shadow-paw animate-fetch-in">
          {results === null || (searching && empty) ? (
            <p className="px-3 py-4 text-center text-sm text-muted" role="status">
              {t("common.searching")}
            </p>
          ) : empty ? (
            <p className="px-3 py-4 text-center text-sm text-muted">{t("add-restaurant.no-results")}</p>
          ) : (
            <>
              <ResultGroup title={t("map.already-on-sam")} show={sam.length > 0}>
                {sam.map((r) => (
                  <ResultRow key={r.id} title={r.name} detail={r.address} onClick={() => onPickExisting(r)} tone="amber" />
                ))}
              </ResultGroup>
              <ResultGroup title={t("add-restaurant.group-places")} show={places.length > 0}>
                {places.map((p) => (
                  <ResultRow key={p.external_place_id} title={p.name} detail={p.address} onClick={() => onPickPlace(p)} />
                ))}
              </ResultGroup>
              <ResultGroup title={t("add-restaurant.group-areas")} show={results.areas.length > 0}>
                {results.areas.map((a) => (
                  <ResultRow key={`${a.label}-${a.latitude}`} title={a.name} detail={a.label} onClick={() => onPickArea(a)} icon />
                ))}
              </ResultGroup>
              <p className="px-3 pb-1 pt-2 text-right text-[10px] text-muted/70">{t("restaurant-form.attribution")}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({ title, show, children }: { title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div className="py-1">
      <p className="px-3 pb-1 pt-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-muted">{title}</p>
      <ul>{children}</ul>
    </div>
  );
}

function ResultRow({
  title,
  detail,
  onClick,
  tone,
  icon,
}: {
  title: string;
  detail: string | null;
  onClick: () => void;
  tone?: "amber";
  icon?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2"
      >
        {icon && <MapPin className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
        <span className="min-w-0">
          <span className={`block truncate text-sm font-semibold ${tone === "amber" ? "text-amber-700 dark:text-amber" : "text-fg"}`}>
            {title}
          </span>
          {detail && <span className="block truncate text-xs text-muted">{detail}</span>}
        </span>
      </button>
    </li>
  );
}

function PlaceCard({
  place,
  existing,
  cuisineOptions,
  onAccept,
  onOpenExisting,
  onDismiss,
}: {
  place: Place;
  existing: Restaurant | null;
  cuisineOptions: Cuisine[];
  onAccept: () => void;
  onOpenExisting: (restaurant: Restaurant) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const cuisines = matchCuisines(place.cuisines, cuisineOptions);

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-paw">
      {existing && (
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber">{t("map.already-on-sam")}</p>
      )}
      <h3 className="min-w-0 truncate font-display text-base font-semibold text-fg">{place.name}</h3>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted">
        {[
          place.distance_m != null ? formatDistance(place.distance_m) : null,
          cuisines.map((c) => t(`cuisines.${c}` as MessageKey)).join(", ") || null,
          place.address,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {existing ? (
          <PrimaryButton onClick={() => onOpenExisting(existing)}>{t("map.this-is-it")}</PrimaryButton>
        ) : (
          <PrimaryButton onClick={onAccept} icon={<Check className="h-4 w-4" />}>
            {t("add-restaurant.this-is-it")}
          </PrimaryButton>
        )}
        <SecondaryButton onClick={onDismiss}>{t("add-restaurant.not-this-one")}</SecondaryButton>
      </div>
    </div>
  );
}

function SpotCard({
  spot,
  nearbyOnSam,
  onOpenExisting,
  onAccept,
  onDismiss,
}: {
  spot: Spot;
  nearbyOnSam: { restaurant: RestaurantDetail; distance: number }[];
  onOpenExisting: (restaurant: Restaurant) => void;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-paw">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted">{t("add-restaurant.spot-heading")}</p>
      {/* The address is what you are accepting, so it is the headline. */}
      <p className="font-display text-base font-semibold leading-snug text-fg" role="status">
        {spot.address === undefined ? t("add-restaurant.finding-address") : (spot.address ?? t("add-restaurant.no-address"))}
      </p>
      <p className="mt-0.5 text-xs text-muted">{t("add-restaurant.spot-hint")}</p>

      {nearbyOnSam.length > 0 && (
        <div className="mt-2.5 rounded-xl bg-amber/10 px-2.5 py-2">
          <p className="px-1 text-xs font-semibold text-fg">{t("add-restaurant.already-near")}</p>
          <ul className="mt-1">
            {nearbyOnSam.slice(0, 3).map(({ restaurant, distance }) => (
              <li key={restaurant.id}>
                <button
                  type="button"
                  onClick={() => onOpenExisting(restaurant)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-sm transition-colors hover:bg-amber/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
                >
                  <span className="truncate font-semibold text-fg">{restaurant.name}</span>
                  <span className="shrink-0 text-xs text-muted">{formatDistance(Math.round(distance))}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <PrimaryButton onClick={onAccept} disabled={spot.address === undefined} icon={<Check className="h-4 w-4" />}>
          {t("add-restaurant.use-this-spot")}
        </PrimaryButton>
        <SecondaryButton onClick={onDismiss}>{t("common.cancel")}</SecondaryButton>
      </div>
    </div>
  );
}

function NearbyList({
  heading,
  places,
  failed,
  selectedId,
  onSam,
  onSelect,
}: {
  heading: string;
  places: Place[] | null;
  failed: boolean;
  selectedId: string | null;
  onSam: Map<string, RestaurantDetail>;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();

  if (places === null) {
    return (
      <p className="text-sm text-muted" role="status">
        {t("add-restaurant.finding-places")}
      </p>
    );
  }
  if (places.length === 0) {
    return <p className="text-sm text-muted">{t(failed ? "add-restaurant.places-failed" : "add-restaurant.no-places")}</p>;
  }

  // The same places as the pins, as a list: pins overlap on a busy street, and
  // a list is what a screen reader and a keyboard can walk.
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{heading}</p>
      <ul className="space-y-1.5">
        {places.slice(0, LIST_SIZE).map((place) => {
          const on = place.external_place_id === selectedId;
          return (
            <li key={place.external_place_id}>
              <button
                type="button"
                onClick={() => onSelect(place.external_place_id)}
                aria-pressed={on}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50 ${
                  on ? "border-tomato bg-tomato/10" : "border-line bg-surface hover:border-tomato/40"
                }`}
              >
                <span className="min-w-0">
                  <span className={`block truncate font-semibold ${on ? "text-tomato" : "text-fg"}`}>{place.name}</span>
                  {onSam.has(place.external_place_id) && (
                    <span className="block text-xs font-semibold text-amber-700 dark:text-amber">{t("map.already-on-sam")}</span>
                  )}
                </span>
                {place.distance_m != null && (
                  <span className="shrink-0 text-xs tabular-nums text-muted">{formatDistance(place.distance_m)}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-right text-[10px] text-muted/70">{t("restaurant-form.attribution")}</p>
    </div>
  );
}

/**
 * The part only you can fill in. From a known place, that is price and cuisine —
 * the name and address are the provider's, shown and editable but out of the
 * way. From a dropped pin, the name too: nobody else knows it.
 */
function DetailsStep({
  origin,
  cuisineOptions,
  onBack,
  onSubmit,
}: {
  origin: Origin;
  cuisineOptions: Cuisine[];
  onBack: () => void;
  onSubmit: (data: CreateRestaurantInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const fromPlace = origin.kind === "place";
  const [name, setName] = useState(fromPlace ? origin.place.name : "");
  const [address, setAddress] = useState((fromPlace ? origin.place.address : origin.address) ?? "");
  // Provider facts start folded: they are right, and the form is price and cuisine.
  const [editingFacts, setEditingFacts] = useState(!fromPlace);
  const [priceLevel, setPriceLevel] = useState<PriceLevel | null>(null);
  const [cuisines, setCuisines] = useState<string[]>(fromPlace ? matchCuisines(origin.place.cuisines, cuisineOptions) : []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  // Tags can land after the step opens if the vocabulary was still loading.
  useEffect(() => {
    if (fromPlace && cuisineOptions.length > 0) {
      setCuisines((prev) => (prev.length > 0 ? prev : matchCuisines(origin.place.cuisines, cuisineOptions)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuisineOptions]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError(t("restaurant-form.name-required"));
      setEditingFacts(true);
      nameRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        address: address.trim() || undefined,
        price_level: priceLevel ?? undefined,
        cuisines,
        external_place_id: fromPlace ? origin.place.external_place_id : undefined,
        latitude: fromPlace ? origin.place.latitude : origin.coords.lat,
        longitude: fromPlace ? origin.place.longitude : origin.coords.lon,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("add-restaurant.save-failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <BackLink onClick={onBack} label={t("add-restaurant.change-place")} />

      {error && (
        <div className="rounded-2xl border border-tomato/30 bg-tomato/10 px-4 py-3 text-sm font-medium text-tomato-700 dark:text-tomato">
          {error}
        </div>
      )}

      {editingFacts ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="add-name" className={labelClass}>
              {t("restaurant-form.name")} {t("common.required-marker")}
            </label>
            <input
              id="add-name"
              ref={nameRef}
              type="text"
              required
              autoFocus={!fromPlace}
              value={name}
              maxLength={255}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
              placeholder={t("restaurant-form.name-placeholder")}
            />
          </div>
          <div>
            <label htmlFor="add-address" className={labelClass}>
              {t("restaurant-form.address")} <span className="font-normal text-muted">{t("common.optional")}</span>
            </label>
            <input
              id="add-address"
              type="text"
              value={address}
              maxLength={500}
              onChange={(e) => setAddress(e.target.value)}
              className={fieldClass}
              placeholder={t("restaurant-form.address-placeholder")}
            />
            {!fromPlace && <p className="mt-1.5 text-xs text-muted">{t("add-restaurant.address-from-pin")}</p>}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-3xl border border-line bg-surface-2/60 p-4">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-tomato" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold leading-snug text-fg">{name}</p>
            {address && <p className="mt-0.5 text-sm text-muted">{address}</p>}
          </div>
          <button
            type="button"
            onClick={() => setEditingFacts(true)}
            aria-label={t("add-restaurant.edit-facts")}
            title={t("add-restaurant.edit-facts")}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      )}

      <PricePicker value={priceLevel} onChange={setPriceLevel} />
      <CuisinePicker options={cuisineOptions} value={cuisines} onChange={setCuisines} />

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-tomato px-4 py-3 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
      >
        <Save className="h-4 w-4" />
        {submitting ? t("common.saving") : t("dine.add-restaurant")}
      </button>
    </form>
  );
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded-full text-sm font-semibold text-tomato underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

function PrimaryButton({
  onClick,
  icon,
  children,
  disabled,
}: {
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex cursor-pointer items-center gap-1.5 rounded-full bg-tomato px-4 py-2 font-display text-sm font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      {icon}
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, icon, children }: { onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
    >
      {icon}
      {children}
    </button>
  );
}

/** Haversine distance in metres — plenty accurate at "is it the same doorway" scale. */
export function metresBetween(a: Coords, b: Coords): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
