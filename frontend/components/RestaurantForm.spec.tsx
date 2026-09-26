import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RestaurantForm from "./RestaurantForm";
import { apiClient } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";

/**
 * Editing a restaurant's pin. MapLibre does not run in jsdom, so the picker is
 * two buttons standing in for "tap here" and "tap there".
 */
const HERE = { lat: 41.4, lon: 2.17 };
const THERE = { lat: 41.41, lon: 2.18 };

vi.mock("next/dynamic", () => ({
  default: () =>
    function FakePicker({ onChange }: { onChange: (c: { lat: number; lon: number }) => void }) {
      return (
        <div>
          <button type="button" onClick={() => onChange(HERE)}>
            tap here
          </button>
          <button type="button" onClick={() => onChange(THERE)}>
            tap there
          </button>
        </div>
      );
    },
}));

function setup() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <LocaleProvider>
      <RestaurantForm
        initialData={{ name: "Casa Pepe", address: "Carrer Vell 1", cuisines: [], latitude: 41.39, longitude: 2.16 }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        submitLabel="Save"
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Adjust the pin" }));
  return { onSubmit };
}

beforeEach(() => {
  vi.spyOn(apiClient, "listCuisines").mockResolvedValue([]);
  vi.spyOn(apiClient, "reverseGeocode").mockImplementation(async (c) => ({
    address: c.lat === HERE.lat ? "Carrer Nou 2, Barcelona" : "Carrer Lluny 3, Barcelona",
  }));
});

afterEach(() => vi.restoreAllMocks());

describe("moving the pin", () => {
  it("says where the pin points before you move it", () => {
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Carrer Vell 1");
  });

  it("names every new spot as you tap it", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "tap here" }));
    expect(await screen.findByText("Carrer Nou 2, Barcelona")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "tap there" }));
    expect(await screen.findByText("Carrer Lluny 3, Barcelona")).toBeInTheDocument();
  });

  it("keeps the latest spot's address when an earlier lookup answers late", async () => {
    let answerFirst: (v: { address: string | null }) => void = () => {};
    vi.mocked(apiClient.reverseGeocode)
      .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce({ address: "Carrer Lluny 3, Barcelona" });
    setup();

    fireEvent.click(screen.getByRole("button", { name: "tap here" }));
    fireEvent.click(screen.getByRole("button", { name: "tap there" }));
    expect(await screen.findByText("Carrer Lluny 3, Barcelona")).toBeInTheDocument();

    answerFirst({ address: "Carrer Nou 2, Barcelona" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Carrer Nou 2, Barcelona")).not.toBeInTheDocument();
  });

  it("waits for the address before letting you confirm", () => {
    vi.mocked(apiClient.reverseGeocode).mockImplementation(() => new Promise(() => {}));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "tap here" }));
    expect(screen.getByRole("button", { name: "Use this spot" })).toBeDisabled();
  });

  it("carries the new address into the form, and both into the save", async () => {
    const { onSubmit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "tap here" }));
    await screen.findByText("Carrer Nou 2, Barcelona");
    fireEvent.click(screen.getByRole("button", { name: "Use this spot" }));

    expect(screen.getByLabelText(/^Address/)).toHaveValue("Carrer Nou 2, Barcelona");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ address: "Carrer Nou 2, Barcelona", latitude: HERE.lat, longitude: HERE.lon }),
      ),
    );
  });
});
