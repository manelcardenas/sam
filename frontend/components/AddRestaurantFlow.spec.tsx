import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AddRestaurantFlow, { metresBetween } from "./AddRestaurantFlow";
import { apiClient, type Area, type Place, type RestaurantDetail } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";

/**
 * Adding a restaurant: one search box over one map. MapLibre does not run in
 * jsdom, so the map is swapped for its pins as plain buttons plus one "tap the
 * map" button — what is under test is the flow around it, not the tiles.
 */
const TAPPED = { lat: 41.4041, lon: 2.1751 };

vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeMap({
      places,
      onSelect,
      onDrop,
    }: {
      places: Place[];
      onSelect: (id: string | null) => void;
      onDrop: (coords: { lat: number; lon: number }) => void;
    }) {
      return (
        <div data-testid="map">
          {places.map((p) => (
            <button key={p.external_place_id} type="button" onClick={() => onSelect(p.external_place_id)}>
              pin {p.name}
            </button>
          ))}
          <button type="button" onClick={() => onDrop(TAPPED)}>
            tap the map
          </button>
          <button type="button" onClick={() => onDrop({ lat: TAPPED.lat + 0.001, lon: TAPPED.lon })}>
            drag the pin
          </button>
        </div>
      );
    },
}));

const YOU = { lat: 41.4036, lon: 2.1744 };

const casaPepe: Place = {
  external_place_id: "osm-1",
  name: "Casa Pepe",
  address: "Carrer de Mallorca 401, Barcelona",
  latitude: 41.4037,
  longitude: 2.1745,
  cuisines: ["tapas"],
  distance_m: 14,
};
const barLuz: Place = { ...casaPepe, external_place_id: "osm-2", name: "Bar Luz", cuisines: [], distance_m: 60 };
const zaragoza: Area = { name: "Zaragoza", label: "Zaragoza, Aragón, España", latitude: 41.65, longitude: -0.88 };

/** Only `geolocation` is replaced — the rest of `navigator` (languages, for the locale) stays real. */
function stubGeolocation(getCurrentPosition: Geolocation["getCurrentPosition"]) {
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
}

function locateAt(coords = YOU) {
  stubGeolocation((ok) => ok({ coords: { latitude: coords.lat, longitude: coords.lon } } as GeolocationPosition));
}

function denyLocation() {
  stubGeolocation((_ok, fail) => fail?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError));
}

function setup(archive: RestaurantDetail[] = []) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onSelectExisting = vi.fn();
  render(
    <LocaleProvider>
      <AddRestaurantFlow archive={archive} onSubmit={onSubmit} onCancel={vi.fn()} onSelectExisting={onSelectExisting} />
    </LocaleProvider>,
  );
  return { onSubmit, onSelectExisting };
}

beforeEach(() => {
  vi.spyOn(apiClient, "listCuisines").mockResolvedValue([
    { id: "c-es", name: "Spanish" },
    { id: "c-it", name: "Italian" },
  ] as never);
  vi.spyOn(apiClient, "nearbyPlaces").mockResolvedValue([casaPepe, barLuz]);
  vi.spyOn(apiClient, "reverseGeocode").mockResolvedValue({ address: "Carrer de Sardenya 300, Barcelona" });
  vi.spyOn(apiClient, "searchRestaurants").mockResolvedValue([]);
  vi.spyOn(apiClient, "searchPlaces").mockResolvedValue([]);
  vi.spyOn(apiClient, "searchAreas").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("picking a restaurant on the map", () => {
  it("opens on you, with the restaurants around you as pins", async () => {
    locateAt();
    setup();
    expect(await screen.findByRole("button", { name: "pin Casa Pepe" })).toBeInTheDocument();
    expect(apiClient.nearbyPlaces).toHaveBeenCalledWith(YOU, 500);
  });

  it("shows what a pin is and lets you say no", async () => {
    locateAt();
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "pin Casa Pepe" }));

    expect(screen.getByRole("heading", { name: "Casa Pepe" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "No, another one" }));
    expect(screen.queryByRole("heading", { name: "Casa Pepe" })).not.toBeInTheDocument();
  });

  it("fills name, address and cuisine from the pin, leaving price to you", async () => {
    locateAt();
    const { onSubmit } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "pin Casa Pepe" }));
    fireEvent.click(screen.getByRole("button", { name: "This is it" }));

    // Name and address are shown, not asked for.
    expect(screen.getByText("Casa Pepe")).toBeInTheDocument();
    expect(screen.getByText("Carrer de Mallorca 401, Barcelona")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument();
    // "tapas" is Spanish.
    await waitFor(() => expect(screen.getByRole("button", { name: /Spanish/ })).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByRole("button", { name: "Price level 2 of 4" }));
    fireEvent.click(screen.getByRole("button", { name: /Add restaurant/ }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Casa Pepe",
        address: "Carrer de Mallorca 401, Barcelona",
        price_level: 2,
        cuisines: ["Spanish"],
        external_place_id: "osm-1",
        latitude: casaPepe.latitude,
        longitude: casaPepe.longitude,
      }),
    );
  });

  it("the list under the map selects the same place as its pin", async () => {
    locateAt();
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /^Bar Luz/ }));
    expect(screen.getByRole("heading", { name: "Bar Luz" })).toBeInTheDocument();
  });

  it("offers to open a pin that is already on SAM instead of adding it again", async () => {
    locateAt();
    const existing = { id: "r-1", name: "Casa Pepe", external_place_id: "osm-1" } as RestaurantDetail;
    const { onSelectExisting } = setup([existing]);
    fireEvent.click(await screen.findByRole("button", { name: "pin Casa Pepe" }));

    // Said on the card and on its row in the list.
    expect(screen.getAllByText("Already on SAM")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /open it/ }));
    expect(onSelectExisting).toHaveBeenCalledWith(existing);
  });
});

describe("pointing at the map, for a place the provider does not know", () => {
  it("shows the address of wherever you tap, then asks only for the name", async () => {
    locateAt();
    const { onSubmit } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "tap the map" }));

    expect(await screen.findByText("Carrer de Sardenya 300, Barcelona")).toBeInTheDocument();
    expect(apiClient.reverseGeocode).toHaveBeenCalledWith(TAPPED);
    fireEvent.click(screen.getByRole("button", { name: "It's here" }));

    const name = screen.getByLabelText(/^Name/);
    expect(name).toHaveValue("");
    expect(screen.getByLabelText(/^Address/)).toHaveValue("Carrer de Sardenya 300, Barcelona");

    fireEvent.change(name, { target: { value: "El Racó de la Iaia" } });
    fireEvent.click(screen.getByRole("button", { name: /Add restaurant/ }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "El Racó de la Iaia",
          address: "Carrer de Sardenya 300, Barcelona",
          external_place_id: undefined,
          latitude: TAPPED.lat,
          longitude: TAPPED.lon,
        }),
      ),
    );
  });

  it("follows the pin when you drag it, keeping only the latest address", async () => {
    locateAt();
    let resolveFirst: (v: { address: string | null }) => void = () => {};
    vi.mocked(apiClient.reverseGeocode)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ address: "Carrer Nou 1, Barcelona" });
    setup();

    fireEvent.click(await screen.findByRole("button", { name: "tap the map" }));
    fireEvent.click(screen.getByRole("button", { name: "drag the pin" }));
    expect(await screen.findByText("Carrer Nou 1, Barcelona")).toBeInTheDocument();

    // The first lookup answering late must not overwrite the second.
    resolveFirst({ address: "Carrer Vell 9, Barcelona" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Carrer Vell 9, Barcelona")).not.toBeInTheDocument();
  });

  it("will not accept the spot until its address has been looked up", async () => {
    locateAt();
    vi.mocked(apiClient.reverseGeocode).mockImplementation(() => new Promise(() => {}));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "tap the map" }));
    expect(screen.getByRole("button", { name: "It's here" })).toBeDisabled();
  });

  it("refuses to save without a name", async () => {
    locateAt();
    const { onSubmit } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "tap the map" }));
    await screen.findByText("Carrer de Sardenya 300, Barcelona");
    fireEvent.click(screen.getByRole("button", { name: "It's here" }));
    fireEvent.submit(screen.getByRole("button", { name: /Add restaurant/ }).closest("form")!);

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("warns about places already on SAM right where you pointed", async () => {
    locateAt();
    const nextDoor = { id: "r-2", name: "Bar Pinotxo", latitude: TAPPED.lat + 0.0002, longitude: TAPPED.lon } as RestaurantDetail;
    const farAway = { id: "r-3", name: "Far Away", latitude: TAPPED.lat + 0.01, longitude: TAPPED.lon } as RestaurantDetail;
    const { onSelectExisting } = setup([nextDoor, farAway]);
    fireEvent.click(await screen.findByRole("button", { name: "tap the map" }));

    fireEvent.click(await screen.findByRole("button", { name: /Bar Pinotxo/ }));
    expect(onSelectExisting).toHaveBeenCalledWith(nextDoor);
    expect(screen.queryByText("Far Away")).not.toBeInTheDocument();
  });
});

describe("the one search box", () => {
  const search = () => screen.getByRole("searchbox", { name: /Search for a restaurant, street or city/ });

  it("asks SAM, the provider and the areas at once, and groups the answers", async () => {
    locateAt();
    const onSamAlready = { id: "r-9", name: "Casa Lucio", address: "Madrid" } as RestaurantDetail;
    vi.mocked(apiClient.searchRestaurants).mockResolvedValue([onSamAlready]);
    vi.mocked(apiClient.searchPlaces).mockResolvedValue([{ ...casaPepe, external_place_id: "osm-7", name: "Casa Lucio Bis" }]);
    vi.mocked(apiClient.searchAreas).mockResolvedValue([zaragoza]);
    const { onSelectExisting } = setup();
    await screen.findByRole("button", { name: "pin Casa Pepe" });

    fireEvent.change(search(), { target: { value: "casa" } });

    expect(await screen.findByText("Restaurants")).toBeInTheDocument();
    expect(screen.getByText("Areas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Casa Lucio\s*Madrid/ }));
    expect(onSelectExisting).toHaveBeenCalledWith(onSamAlready);
  });

  it("an area flies the map there and loads that area's restaurants", async () => {
    locateAt();
    vi.mocked(apiClient.searchAreas).mockResolvedValue([zaragoza]);
    setup();
    await screen.findByRole("button", { name: "pin Casa Pepe" });

    fireEvent.change(search(), { target: { value: "zarag" } });
    fireEvent.click(await screen.findByRole("button", { name: /Zaragoza, Aragón/ }));

    await waitFor(() => expect(apiClient.nearbyPlaces).toHaveBeenLastCalledWith({ lat: 41.65, lon: -0.88 }, 500));
    expect(search()).toHaveValue("");
  });

  it("a restaurant result opens its card, ready to accept", async () => {
    locateAt();
    const lucia = { ...casaPepe, external_place_id: "osm-8", name: "Trattoria Lucia" };
    vi.mocked(apiClient.searchPlaces).mockResolvedValue([lucia]);
    setup();
    await screen.findByRole("button", { name: "pin Casa Pepe" });

    fireEvent.change(search(), { target: { value: "lucia" } });
    fireEvent.click(await screen.findByRole("button", { name: /Trattoria Lucia/ }));

    expect(screen.getByRole("heading", { name: "Trattoria Lucia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "This is it" })).toBeInTheDocument();
  });
});

describe("without your location", () => {
  it("says so, still shows the map, and leaves the search box to do the work", async () => {
    denyLocation();
    setup();

    expect(await screen.findByText("No location permission.")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(apiClient.nearbyPlaces).not.toHaveBeenCalled();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });
});

describe("metresBetween", () => {
  it("measures a block in Barcelona in metres", () => {
    expect(metresBetween(YOU, { lat: YOU.lat + 0.001, lon: YOU.lon })).toBeCloseTo(111, 0);
  });
});
