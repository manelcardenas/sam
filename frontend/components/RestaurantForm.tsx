"use client";

import { useEffect, useRef, useState } from "react";
import { Save, X, Search } from "lucide-react";
import { apiClient, type Cuisine, type CreateRestaurantInput, type Restaurant } from "@/lib/api-client";

interface RestaurantFormInitialData {
  name: string;
  address?: string | null;
  price_level?: 1 | 2 | 3 | 4 | null;
  cuisines: string[];
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

export default function RestaurantForm({
  initialData,
  onSubmit,
  onCancel,
  onSelectExisting,
  submitLabel,
}: RestaurantFormProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [address, setAddress] = useState(initialData?.address ?? "");
  const [priceLevel, setPriceLevel] = useState<1 | 2 | 3 | 4 | null>(initialData?.price_level ?? null);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>(initialData?.cuisines ?? []);
  const [cuisineOptions, setCuisineOptions] = useState<Cuisine[]>([]);
  const [matches, setMatches] = useState<Restaurant[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiClient.listCuisines().then(setCuisineOptions).catch(() => {});
  }, []);

  // Dedup search: only while creating, so editing an existing restaurant never
  // surfaces "did you mean" matches against itself.
  useEffect(() => {
    if (initialData || !onSelectExisting) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setMatches([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      apiClient
        .searchRestaurants(trimmed)
        .then(setMatches)
        .catch(() => {
          // Dedup search is a courtesy, not critical — fail silently.
        });
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [name, initialData, onSelectExisting]);

  const toggleCuisine = (cuisineName: string) =>
    setSelectedCuisines((prev) =>
      prev.includes(cuisineName) ? prev.filter((c) => c !== cuisineName) : [...prev, cuisineName],
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        address: address.trim() || undefined,
        price_level: priceLevel ?? undefined,
        cuisines: selectedCuisines,
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
          Name *
        </label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
          placeholder="e.g. Casa Pepe"
        />
      </div>

      {matches.length > 0 && (
        <div className="rounded-2xl border border-dashed border-line p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Search className="h-4 w-4 text-muted" />
            Already on SAM?
          </p>
          <p className="mb-3 text-xs text-muted">
            Someone may have added this place already — pick it instead of creating a duplicate.
          </p>
          <ul className="space-y-2">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onSelectExisting?.(m)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-sm transition-colors hover:border-tomato/40 hover:text-tomato"
                >
                  <span className="truncate font-semibold">{m.name}</span>
                  {m.address && <span className="ml-2 shrink-0 truncate text-xs text-muted">{m.address}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label htmlFor="address" className={labelClass}>
          Address <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="address"
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={fieldClass}
          placeholder="Carrer Gran de Gràcia, 1"
        />
      </div>

      <div>
        <label className={labelClass}>
          Price level <span className="font-normal text-muted">(optional)</span>
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
            Cuisine <span className="font-normal text-muted">(optional, pick any that apply)</span>
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
                  {c.name}
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
          {submitting ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-5 py-3 font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          <X className="h-4 w-4" />
          Cancel
        </button>
      </div>
    </form>
  );
}
