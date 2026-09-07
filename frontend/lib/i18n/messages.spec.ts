import { describe, expect, it } from "vitest";

import ca from "@/messages/ca.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { FOOD_TYPES } from "@/lib/constants";
import { LOCALES, resolveInitialLocale } from "./locales";
import { translate, translatePlural, type MessageKey, type PluralKey } from "./dictionary";

type Node = Record<string, unknown>;

const FILES: Record<string, Node> = { en, es, ca };

function isPlural(value: unknown): boolean {
  return typeof value === "object" && value !== null && "other" in (value as Node);
}

/** Every dotted path to a leaf, where a plural object counts as one leaf. */
function paths(node: Node, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const here = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" || isPlural(value)) return [here];
    return paths(value as Node, here);
  });
}

function at(node: Node, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => (acc as Node)?.[part], node);
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

/** Every string in a leaf, whether it's a plain string or a set of plural forms. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (isPlural(value)) return Object.values(value as Node).filter((v): v is string => typeof v === "string");
  return [];
}

const EN_PATHS = paths(en);

describe("the copy files stay in step", () => {
  it("declares a file for every locale", () => {
    expect(Object.keys(FILES).sort()).toEqual([...LOCALES].sort());
  });

  for (const locale of ["es", "ca"] as const) {
    describe(locale, () => {
      const theirs = paths(FILES[locale]);

      it("has exactly the same keys as English", () => {
        // Listed rather than compared as counts, so a failure names the key.
        expect(theirs.filter((p) => !EN_PATHS.includes(p))).toEqual([]);
        expect(EN_PATHS.filter((p) => !theirs.includes(p))).toEqual([]);
      });

      it("has no empty or whitespace-only strings", () => {
        const blank = theirs.filter((p) => strings(at(FILES[locale], p)).some((s) => !s.trim()));
        expect(blank).toEqual([]);
      });

      it("keeps every {{placeholder}} English uses", () => {
        // A translator dropping {{count}} is the failure this catches: the
        // sentence still reads, so nothing else would notice.
        const broken = EN_PATHS.filter((p) => {
          const mine = placeholders(strings(at(en, p)).join(" "));
          const yours = placeholders(strings(at(FILES[locale], p)).join(" "));
          return mine.some((name) => !yours.includes(name));
        });
        expect(broken).toEqual([]);
      });

      it("agrees with English about which keys are plural", () => {
        const mismatched = EN_PATHS.filter(
          (p) => isPlural(at(en, p)) !== isPlural(at(FILES[locale], p)),
        );
        expect(mismatched).toEqual([]);
      });
    });
  }

  it("gives every plural key an `other` form, which is the fallback", () => {
    for (const [locale, file] of Object.entries(FILES)) {
      for (const p of paths(file).filter((q) => isPlural(at(file, q)))) {
        expect((at(file, p) as Node).other, `${locale}:${p}`).toBeTypeOf("string");
      }
    }
  });
});

describe("the copy covers the vocabularies it has to", () => {
  it("has a label and a description for every food type", () => {
    for (const { value } of FOOD_TYPES) {
      expect(Object.keys(en["food-types"])).toContain(value);
    }
    expect(Object.keys(en["food-types"]).sort()).toEqual(FOOD_TYPES.map((f) => f.value).sort());
  });

  it("names every cuisine in the curated vocabulary", () => {
    // Mirrors STARTER_CUISINES in migration 874c491875f4. The API rejects
    // anything outside it, so this list is complete by construction — but a
    // future migration adding one has to add it here too, and this is what
    // says so.
    expect(Object.keys(en.cuisines).sort()).toEqual(
      [
        "American",
        "Chinese",
        "French",
        "Indian",
        "Italian",
        "Japanese",
        "Mediterranean",
        "Mexican",
        "Other",
        "Spanish",
        "Thai",
        "Vegan/Vegetarian",
      ].sort(),
    );
  });
});

describe("translate", () => {
  it("returns the string for the locale", () => {
    expect(translate("en", "common.cancel")).toBe("Cancel");
    expect(translate("es", "common.cancel")).toBe("Cancelar");
    expect(translate("ca", "common.cancel")).toBe("Cancel·la");
  });

  it("substitutes named variables", () => {
    expect(translate("en", "profile.latest", { name: "Casa Pepe" })).toBe("Latest: Casa Pepe");
  });

  it("leaves an unfilled placeholder visible rather than printing undefined", () => {
    // "Latest: {{name}}" on screen is an obvious bug; "Latest: undefined"
    // looks like a data problem and gets misfiled.
    expect(translate("en", "profile.latest")).toBe("Latest: {{name}}");
  });

  it("returns the key itself for a path that resolves to nothing", () => {
    expect(translate("en", "nope.not-here" as MessageKey)).toBe("nope.not-here");
  });
});

describe("translatePlural", () => {
  it("picks singular and plural in each language", () => {
    expect(translatePlural("en", "recipe-row.ingredients", 1)).toBe("1 ingredient");
    expect(translatePlural("en", "recipe-row.ingredients", 3)).toBe("3 ingredients");
    expect(translatePlural("es", "recipe-row.ingredients", 1)).toBe("1 ingrediente");
    expect(translatePlural("es", "recipe-row.ingredients", 3)).toBe("3 ingredientes");
    expect(translatePlural("ca", "recipe-row.ingredients", 1)).toBe("1 ingredient");
    expect(translatePlural("ca", "recipe-row.ingredients", 3)).toBe("3 ingredients");
  });

  it("uses `other` for zero in all three languages", () => {
    expect(translatePlural("en", "dine-filters.results", 0)).toBe("0 restaurants");
    expect(translatePlural("es", "dine-filters.results", 0)).toBe("0 restaurantes");
    expect(translatePlural("ca", "dine-filters.results", 0)).toBe("0 restaurants");
  });

  it("falls back to `other` for a category the file doesn't author", () => {
    // Spanish and Catalan have a `many` category English lacks, but it only
    // applies from 1,000,000 up. Only `one`/`other` are authored, so this
    // proves the fallback rather than the authoring.
    expect(new Intl.PluralRules("es").select(1_000_000)).toBe("many");
    expect(translatePlural("es", "dine-filters.results", 1_000_000)).toBe("1000000 restaurantes");
  });

  it("exposes count without it having to be passed", () => {
    expect(translatePlural("en", "restaurant-card.visits-no-notes", 4)).toBe(
      "4 visits, no notes written.",
    );
  });

  it("returns the key for a path that isn't plural", () => {
    expect(translatePlural("en", "common.cancel" as unknown as PluralKey, 2)).toBe("common.cancel");
  });
});

describe("resolveInitialLocale", () => {
  it("prefers an explicit stored choice over the browser", () => {
    expect(resolveInitialLocale("ca", ["es-ES", "en"])).toBe("ca");
  });

  it("ignores a stored value that isn't a locale we speak", () => {
    expect(resolveInitialLocale("de", ["es-ES"])).toBe("es");
  });

  it("matches on the language subtag, so regional tags work", () => {
    expect(resolveInitialLocale(null, ["es-AR"])).toBe("es");
    expect(resolveInitialLocale(null, ["ca-ES"])).toBe("ca");
  });

  it("takes the first language it recognises, in the browser's own order", () => {
    expect(resolveInitialLocale(null, ["de-DE", "ca", "es"])).toBe("ca");
  });

  it("falls back to English when nothing matches", () => {
    expect(resolveInitialLocale(null, ["de-DE", "fr"])).toBe("en");
    expect(resolveInitialLocale(null, [])).toBe("en");
  });
});
