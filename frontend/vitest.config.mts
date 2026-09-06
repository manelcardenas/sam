import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest is to this frontend what pytest is to the backend: the test runner.
 *
 * `.mts` on purpose — the nearest package.json has no `"type": "module"`, so a
 * plain `.ts` config gets loaded as CommonJS and Vite warns about the ESM
 * syntax in it.
 *
 * Pinned to the Vitest 4 line rather than 5: both pull rolldown for their
 * transform, and 4 is the settled one. Nothing here is version-specific, so
 * moving up later is a one-line change.
 */
export default defineConfig({
  // JSX for component tests. Pure modules don't need it, but it costs nothing.
  plugins: [react()],
  resolve: {
    // Reads the same tsconfig the app builds with, so `@/lib/...` can never
    // mean one thing to Next and another to the tests.
    tsconfigPaths: true,
  },
  test: {
    // Node has no `document`. jsdom supplies one so component tests can run
    // without a browser.
    environment: "jsdom",
    // describe/it/expect without importing them, matching pytest's feel.
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Colocated: `thing.spec.ts` sits beside `thing.ts`. A test next to its
    // subject gets updated with it; one in a parallel tree gets forgotten.
    include: ["**/*.spec.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "out/**"],
  },
});
