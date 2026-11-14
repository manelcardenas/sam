# TODO — Heavy dependency migrations

> **Status: Proposed — not started.** Waits for [web or mobile](./TODO_web-or-mobile-decision.md):
> if Expo replaces the Next.js frontend, most of these disappear.

Dependabot PRs left open on purpose. Next is already on 16 in production (#96 merged it as a
postcss security fix; builds, deploys and smoke tests passed).

| PR | Upgrade | What breaks |
|---|---|---|
| #98 (was #63) | eslint-config-next 15 → 16 | Native flat config (the `FlatCompat` bridge goes, a 10-line rewrite), **and** the React Compiler lint rules turn on: 43 errors in 16 files on 2026-11-13 (21 `react-hooks/refs`, 16 `set-state-in-effect`, 3 `immutability`, 1 each `preserve-manual-memoization`, `static-components`, `purity`). Each needs a judgment, not a mechanical fix |
| #104 | eslint 9 → 10 | After #98 |
| #71 | maplibre-gl 5 → 6 | No default export: every `import maplibregl from "maplibre-gl"` |
| #81 | Tailwind 3 → 4 | Config moves to CSS; a rewrite of the setup |
| #83 | TypeScript 5 → 7 | Type-check in frontend and infra |

- [ ] #98 first: new `eslint.config.mjs` (`defineConfig` + `eslint-config-next/core-web-vitals` +
      `/typescript`, drop `@eslint/eslintrc`), then the 43 React Compiler findings
- [ ] #104 after it
- [ ] #71, then test the map by hand
- [ ] #81 and #83 only if the Next.js frontend stays
- [ ] Minimatch alert: bundled inside `aws-cdk-lib`, build-time only; goes away with CDK or the move off AWS

## Done 2026-11-13 (CI was down: verified locally)

GitHub Actions was billing-locked, so Dependabot could neither run checks nor rebase. The
non-breaking PRs were redone by hand in two branches; close the Dependabot PRs they replace.

- `chore/backend-deps-one-source` replaces #105 (starlette 1.10), #106 (cryptography 50, a
  CVE) and #108 (dnspython). 531 backend tests pass against real Postgres; `requirements.txt`
  installs clean in a fresh venv and the app builds.
- `chore/frontend-deps` replaces #99, #100, #101, #102, #103 and the React half of #98 (React
  19.3). `npm run check` and the static build pass.

**Found on the way: production and tests ran different versions.** The Lambda is built from
`backend/requirements.txt` — the CDK Python bundler (`aws-lambda-python-alpha` 2.190) reads
Pipfile, poetry.lock or requirements.txt, never `uv.lock` — while tests run on `uv.lock`.
Dependabot had been bumping only one of the two, so about 15 transitive packages differed. Now a
pre-commit hook regenerates `requirements.txt` from `uv.lock`, and a CI step fails a PR where they
disagree.

## Done 2026-11-14: security alerts

- `chore/backend-security-bumps` clears the open security alerts that have a fix:
  anyio 4.16 and certifi 2026.10.23 (both critical), Mako 1.4.3, idna 3.20, and in dev only
  virtualenv 21.15, filelock 4.2.10, Pygments 2.21. The new virtualenv lifted the cap on filelock,
  so it also replaces #97. Dependabot had not opened PRs for these alerts (open since 2026-11-01).
  531 tests pass against real Postgres.
- Still open: `python-jose` (critical, no fix released) and its `ecdsa` and `pyasn1` alerts, gone
  once the JWT handler moves to PyJWT; `maplibre-gl` (critical XSS, fixed only in 6.4.1, so #71).
