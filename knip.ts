import type { KnipConfig } from "knip";

/**
 * knip finds files, exports and dependencies that nothing reaches.
 *
 * Almost everything below is an *entry point knip cannot infer*, not a
 * suppression. Frameworks reach files by convention — a filename the router
 * knows, a string in a config, a command in a JSON file — and none of that is
 * an import, so the graph has to be told. Getting this list wrong makes knip
 * report whole subtrees as dead, which is how people conclude it's noisy and
 * turn it off.
 *
 * Genuine "keep this even though nothing imports it" entries are marked WHY.
 */
const config: KnipConfig = {
  workspaces: {
    ".": {
      entry: ["scripts/*.mjs"],
      // WHY: declared solely so AWS Amplify finds Next at the repo root. It is
      // never imported here and never will be — see the "//next" note in
      // package.json and docs/plans/tooling-and-tests-plan.md Phase 3.
      ignoreDependencies: ["next"],
      // WHY: `npm run dev:api` shells out to uv. Python's package manager is
      // not an npm dependency and never appears in one.
      ignoreBinaries: ["uv"],
    },

    frontend: {
      // The Next plugin already knows app/**/page.tsx, layout.tsx and friends.
      // These are the ones it does not infer:
      entry: [
        "scripts/*.mjs", // run by `npm run icons`, never imported
        "**/*.spec.{ts,tsx}", // Vitest collects by filename
      ],
      // WHY: eslint.config.mjs pulls these in as *strings* through FlatCompat
      // (`compat.extends("next/core-web-vitals")`), which is not an import.
      ignoreDependencies: ["eslint-config-next"],
    },

    infra: {
      // cdk.json runs `npx ts-node --prefer-ts-exts bin/infra.ts`. Nothing
      // imports it, so without this every stack looks dead.
      entry: ["bin/infra.ts"],
      // WHY: invoked by cdk.json's `app` command, not imported.
      ignoreDependencies: ["ts-node"],
    },
  },

  // WHY: both describe the public shape of the API client. `IngredientsInput`
  // is a field of the exported `CreateRecipeInput` and `CreateRestaurantResult`
  // is a public method's return type, so both are reachable by consumers even
  // though nothing imports them by name today.
  ignoreExportsUsedInFile: true,
};

export default config;
