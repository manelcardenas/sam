import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

/**
 * ESLint 9 flat config, replacing `.eslintrc.json` and `next lint`.
 *
 * `next lint` was deprecated in Next 15 and is removed in Next 16, and it was
 * also the only reason the legacy `.eslintrc.json` format still worked here —
 * ESLint 9 wants flat config.
 *
 * FlatCompat is a bridge, not a workaround we picked: `eslint-config-next`
 * 15.5 still ships legacy configs only (core-web-vitals.js, typescript.js, no
 * flat export), so this is the same thing create-next-app generates. It can be
 * deleted the day that package ships native flat configs.
 */
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // `next lint` linted a fixed list of directories. `eslint .` lints
    // everything, so build output has to be excluded explicitly.
    ignores: ["**/.next/**", "**/out/**", "**/node_modules/**", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
