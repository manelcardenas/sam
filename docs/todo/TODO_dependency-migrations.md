# TODO — Heavy dependency migrations

> **Status: Proposed — not started.** Waits for [web or mobile](./TODO_web-or-mobile-decision.md):
> if Expo replaces the Next.js frontend, most of these disappear.

Dependabot PRs left open on purpose (2026-11-01). Next is already on 16 in production (#96
merged it as a postcss security fix; builds, deploys and smoke tests passed).

| PR | Upgrade | What breaks |
|---|---|---|
| #63 | eslint-config-next 16, React 19.3 | ESLint config (`FlatCompat` → native flat config) |
| #71 | maplibre-gl 5 → 6 | No default export: every `import maplibregl from "maplibre-gl"` |
| #81 | Tailwind 3 → 4 | Config moves to CSS; a rewrite of the setup |
| #83 | TypeScript 5 → 7 | Type-check in frontend and infra |

- [ ] #63 first (smallest now that Next is on 16)
- [ ] #71, then test the map by hand
- [ ] #81 and #83 only if the Next.js frontend stays
- [ ] Minimatch alert: bundled inside `aws-cdk-lib`, build-time only; goes away with CDK or the move off AWS
