# Frontend tooling & tests — plan

> **Status (2026-09-06): COMPLETE — all four phases shipped.** Phase 3 still wants a confirmed
> Amplify build; everything else is verified. Written as a learning
> document, so it explains *what each tool is for* before proposing it — the point is to
> understand the choices, not to copy a config.
>
> Trigger: [`./routing-and-latency-plan.md`](./routing-and-latency-plan.md) §6 flagged that the
> URL work added three pure, edge-case-heavy modules to a frontend with **no test runner at
> all**. Picked up together with `future-roadmap.md` item 3 (the npm workflow), because both are
> tooling and share a work session.
>
> Reference used throughout: `joblocal-replatforming-backoffice-web`, a production Next.js repo
> with a mature setup. **It is a reference, not a target** — §5 lists what we are deliberately
> not copying and why.

## 1. What's actually wrong today

Five concrete problems, in rough order of how much they'll bite.

### 1a. The frontend has no tests, and just grew logic that needs them

| Project | Tests |
| --- | --- |
| `backend/` | **112** |
| `infra/` | 1 |
| `frontend/` | **0** |

That asymmetry was defensible while the frontend was mostly JSX. It isn't now. Three pure,
branch-heavy modules landed in the last session:

- `lib/dashboard-url.ts` — encode/decode five view states, validate a hand-editable `?category=`
- `lib/dine-url.ts` — six view states sharing a query string with the filters
- `components/dine/RestaurantFilters.tsx` — `toSearchParams` / `fromSearchParams`, already
  parsing untrusted URL input before any of this

These are exactly the kind of code tests are *good* at: pure functions, no DOM, no network,
lots of edge cases. I verified the first two with an 18-case round-trip script during the URL
work — **and then deleted it, because there was nowhere to put it.** That is the gap.

### 1b. `next lint` is deprecated — this one is forced

Every build currently prints:

```
`next lint` is deprecated and will be removed in Next.js 16.
```

We're on Next 15.5.12, so this is a countdown, not a suggestion. The linter has to move to the
ESLint CLI (or something else) before the next major. Doing it deliberately now beats doing it
under pressure during a Next 16 upgrade.

There's a second half: `frontend/.eslintrc.json` is the **legacy** config format. ESLint 9 (which
is what's installed) wants **flat config** (`eslint.config.mjs`). `next lint` has been papering
over that; the CLI won't.

### 1c. Three lockfiles, and two independent `next` pins

```
./package-lock.json            ← root
./frontend/package-lock.json
./infra/package-lock.json
```

This is why every build prints:

```
⚠ Next.js inferred your workspace root, but it may not be correct.
  We detected multiple lockfiles…
```

Worse than the warning: `next` is declared **twice**, in `package.json` *and*
`frontend/package.json`. They agree today (both `15.5.12`) and **nothing enforces that.** The
root copy is not decoration — its comment explains it exists "solely to satisfy AWS Amplify
WEB_COMPUTE platform detection". If the two ever drift, Amplify could detect one version and
build with another.

### 1d. Node version is undeclared, and CI disagrees with this machine

CI pins `node-version: "20"` in both workflows. This machine runs **Node 24.8.0**. There is no
`.nvmrc` and no `engines` field, so nothing says which is correct. Today it doesn't matter;
the day a dependency needs Node 22+, it will matter in CI only, which is the worst place to
find out.

### 1e. There is no single command for anything

The backend has a good story — `uv run start` does migrate + seed + serve. The frontend and
infra have nothing equivalent, and there is no way to run the whole stack or all the checks:

```
cd backend  && uv run start                 # terminal 1
cd frontend && npm install && npm run dev   # terminal 2
cd infra    && npm install && npx cdk ...   # when touching infra
```

Before committing, the full check is six commands across three directories. The reference repo
collapses its equivalent into one: `pnpm all-checks`.

## 2. The pnpm question

**Recommendation: no — use npm workspaces instead.** Worth explaining properly, because the
reference repo does use pnpm and the reasoning is about *our* situation, not about pnpm being
bad.

### What pnpm actually does differently

Three things, and it's worth knowing which one you're buying:

1. **A content-addressable store.** Every version of every package is stored once on disk, in
   `~/.pnpm-store`, and linked into projects. Ten repos using React 19 store it once. npm copies
   it ten times.
2. **A strict, non-flat `node_modules`.** npm hoists every transitive dependency to the top
   level, so you can `import lodash` even if you never declared it — a **phantom dependency**
   that works locally and explodes when the parent package drops it. pnpm only exposes what you
   declared.
3. **Faster installs**, mostly a consequence of (1).

Point 2 is the real engineering argument. Points 1 and 3 are convenience.

### Why it isn't the right move here

- **The pain isn't npm — it's having three separate projects.** One install, one lockfile and
  one place to run commands is a *workspace* feature, and **npm has had workspaces since v7.**
  Switching package managers to get workspaces is solving the wrong variable.
- **The install-speed win is negligible at this size.** The frontend has 8 dependencies and 9
  dev dependencies; infra has 3 and 7. The reference repo has ~60 and ~30 — that's where pnpm's
  store pays off.
- **It touches the production deploy path.** `amplify.yml` runs `npm install` and
  `npm ci --prefix frontend`. Amplify's managed build image ships npm; pnpm needs
  `corepack enable` in `preBuild`. That's a change to how the live site is built, in exchange
  for a marginal local benefit. Bad trade.
- **It disturbs the Amplify detection hack.** The root `package.json` exists only so Amplify's
  WEB_COMPUTE platform detection finds `next` at the repo root. pnpm's strict, symlinked layout
  is precisely the thing most likely to break a heuristic that goes looking for a package in a
  specific place.
- **The pnpm features the reference leans on answer problems we don't have.** Its
  `pnpm-workspace.yaml` carries `overrides` (deduping conflicting Radix copies), `auditConfig`
  (documented CVE exceptions) and `allowBuilds`. Those are the tools of a 90-dependency app with
  a security pipeline. We have 17.

### What would change the answer

Revisit pnpm if any of these become true:

- The repo gains a genuinely shared package (say `packages/shared-types` used by frontend *and*
  infra) — pnpm's workspace protocol handles that better than npm's.
- Dependency count grows enough that CI install time is noticeable.
- A phantom-dependency bug actually bites.
- The frontend moves off Amplify, removing the deploy-path risk.

**npm workspaces gets ~80% of the benefit at ~10% of the risk, because npm is already what
Amplify and CI run.** That's the whole argument.

## 3. The plan

Four phases, ordered **value first, risk last**. Each is independently mergeable.

### Phase 1 — Vitest — SHIPPED (2026-09-06)

**What Vitest is:** a test runner, in the same family as Jest, built on Vite. It's the default
choice for Vite/Next projects now — same API as Jest (`describe`/`it`/`expect`), much faster
startup, and it understands TypeScript and path aliases (`@/lib/...`) without extra config.

Nothing about the app changes. It's a dev dependency and a config file.

**Install:**

```
vitest                      the runner
jsdom                       a fake DOM, so component tests can run in Node
@testing-library/react      render components and query them the way a user would
@testing-library/jest-dom   extra matchers: toBeInTheDocument(), toBeVisible(), …
@testing-library/user-event realistic typing/clicking
@vitest/ui                  optional browser UI for watching tests
```

**Config** — a `vitest.config.ts` close to the reference's:

```ts
export default defineConfig({
  resolve: { tsconfigPaths: true },     // so "@/lib/dine-url" resolves
  test: {
    environment: "jsdom",
    globals: true,                       // describe/it/expect without importing
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

**What shipped — 64 tests across 4 files:**

| File | Tests | Covers |
| --- | --- | --- |
| `lib/dine-url.spec.ts` | 15 | Round trips for all six views; `edit-review` decoding to `detail` while still writing a distinct query; filters surviving every view; `mode=new` beating a stale `?place=` |
| `lib/dashboard-url.spec.ts` | 18 | Round trips for all five views; unknown `?category=` degrading to the grid; a valid recipe surviving a junk category; every real `FOOD_TYPE` |
| `components/dine/RestaurantFilters.spec.ts` | 22 | `?price=abc`, `?price=2.5`, out-of-range prices, unknown `?sort=`; and the sort-is-not-a-filter rule the component's docstring insists on |
| `components/auth/UserProvider.spec.tsx` | 9 | The cached name painting *before* the network resolves; revalidation still firing; a stale cache clearing on an expired session; one fetch under StrictMode; throwing `sessionStorage` degrading |

**The tests were mutation-checked, not just run green.** Two behaviours were deliberately broken
to confirm the suite notices:

| Behaviour removed | Test that failed |
| --- | --- |
| The `started` ref guard in `UserProvider` | *does not double-fetch under StrictMode's double-invoked effects* |
| The `readCache()` call before the network | *paints the cached name before the network resolves* |

A test that passes against correct code proves nothing on its own. This is the cheap version of
checking; worth doing once per suite, not per test.

**Convention picked:** colocated `thing.spec.ts` beside `thing.ts`, matching the reference. A
test sitting next to its subject is likelier to be updated with it than one in a parallel
`__tests__/` tree.

**Wired into CI:** a `Tests (vitest)` step in `pr-health-checks.yml`, between lint and build.

#### Three things went wrong, and all three are worth knowing

**1. The lockfile was broken, and had to be regenerated.** The first `vitest run` died with
`Cannot find native binding`. Vitest 4+ uses **rolldown** (a Rust bundler) for its transform,
which ships as one native binary per platform, declared as `optionalDependencies`. Our
`frontend/package-lock.json` listed those fifteen platform packages in rolldown's dependency
block but had **no resolved entries for any of them** — npm's long-standing optional-dependency
bug ([npm/cli#4828](https://github.com/npm/cli/issues/4828)). Deleting `node_modules` doesn't fix
it; the bad data is in the lockfile. Only `rm package-lock.json && npm install` does.

This had two consequences worth recording:

- **It bumped every caret-range dependency that had gone stale.** `next` is pinned exactly and
  did not move. These did: `aws-amplify 6.16.2 → 6.20.0`, `react`/`react-dom 19.2.4 → 19.2.8`,
  `react-icons 5.5.0 → 5.7.0`, `@lottiefiles/dotlottie-react 0.19.4 → 0.19.16`,
  `autoprefixer 10.4.24 → 10.5.5`, `eslint 9.39.2 → 9.39.5`,
  `eslint-config-next 15.5.12 → 15.5.25`. `next build` passes and the static export is byte-for-byte
  the same shape, but **`aws-amplify` is the sign-in path** — worth a real sign-in smoke test on the
  branch deploy before this reaches `main`.
- **It reduced `npm audit` from 16 findings to 3**, all of which are `next` advisories that
  predate this work.

**2. Two dependencies would have passed locally and failed in CI.** CI pins Node 20; this machine
runs Node 24.8. `jsdom@30` requires Node `^22.22.2 || ^24.15.0` and
`@testing-library/jest-dom@7` requires `>=22`. Both were caught only by reading the
`EBADENGINE` warnings that `npm install` prints and everyone scrolls past. Pinned to `jsdom@^29`
and `jest-dom@^6`, which support Node 20.

**This is problem 1d biting on day one**, and it's the argument for Phase 2's Node pinning: the
failure mode is *always* "works here, breaks in CI", which is the worst place to find out.

**3. Vitest 5 was tried and rejected.** It was the first thing installed, and it also pulls
rolldown, so it wasn't the cause of the binding failure — but it's the brand-new line and this
is the repo's first test runner. Pinned to **Vitest 4**, the settled one. Nothing in the config
or the tests is version-specific, so moving up later is a one-line change.

**Two config notes:** the config is `vitest.config.mts`, not `.ts` — the nearest `package.json`
has no `"type": "module"`, so a `.ts` config gets loaded as CommonJS and Vite warns about the
ESM syntax in it. And `vite-tsconfig-paths` was installed and then removed: Vite 8 resolves
tsconfig paths natively via `resolve.tsconfigPaths: true`.

**Deliberately out of scope:** page-level component tests for `/dine` and `/dashboard`. They're
576 and 403 lines with heavy async and auth; testing them properly is a real browser's job, not
Vitest's — see [`./future-roadmap.md`](./future-roadmap.md) item 8. Chasing them with Vitest now
buys brittle tests and a bad first impression of testing.

### Phase 2 — Off `next lint`, onto the ESLint CLI — SHIPPED (2026-09-06)

**What shipped.** `frontend/.eslintrc.json` is gone, replaced by `frontend/eslint.config.mjs`;
the `lint` script is `eslint .` (plus a `lint:fix`); `.nvmrc` pins Node once and all four CI jobs
read it.

#### The codemod was not used

The plan proposed `npx @next/codemod@canary next-lint-to-eslint-cli .`. The config it generates
is eleven lines and the migration is mechanical, so it was written by hand instead — a canary
codemod that installs its own dependencies is a bigger unknown than the thing it automates.

**`FlatCompat` is in the config for a reason, not as a workaround.** `eslint-config-next` 15.5.25
still ships legacy configs only — `core-web-vitals.js`, `typescript.js`, no flat export — so the
bridge is required, and it's what `create-next-app` generates for Next 15 too. It can be deleted
the day that package ships native flat configs.

Using it means importing `@eslint/eslintrc` directly. It was already on disk as a transitive
dependency — importing it without declaring it would have been exactly the **phantom dependency**
§2 describes, so it's now an explicit devDependency of `frontend`.

#### The CLI immediately found what `next lint` was hiding

ESLint 9's flat config turns on `reportUnusedDisableDirectives` by default; the eslintrc format
did not. First clean run reported **four stale `// eslint-disable-next-line
react-hooks/exhaustive-deps` comments** — three in `RestaurantForm.tsx`, one in
`PinPickerMap.tsx` — suppressing a rule that no longer fires there. Dead suppressions are worse
than no suppression: they hide the *next* real warning on that line.

Removed with `eslint . --fix`, which is more precise than editing by hand — a fifth directive at
`PinPickerMap.tsx:134` is still doing work and was correctly left alone. `--fix` leaves
whitespace-only lines where it strips a directive, so those were cleaned up after.

**Test files needed no special handling.** The plan anticipated adding `eslint-plugin-vitest`;
it turned out unnecessary, because the spec files import `describe`/`it`/`expect` from `vitest`
explicitly rather than relying on the `globals: true` ambient. One dependency avoided. Confirmed
they really are being linted, not silently skipped, by planting a `no-unused-vars` violation in
`dine-url.spec.ts` and watching it get reported.

#### Node: pinned to 24, not 20

`.nvmrc` now holds `24` and every workflow uses `node-version-file: .nvmrc` instead of a
hardcoded `"20"`. Root `engines` says `>=24` and is kept equal to it.

**Why 24 rather than the 20 CI was using: Node 20 reached end-of-life in April 2026.** CI was
building on an unsupported runtime. 24 is Active LTS and is what this repo is actually developed
on, which is the other half of the point — the old setup had CI on 20 and the dev machine on
24.8, agreeing about nothing.

**A deliberate limit:** `.nvmrc` holds a major, not an exact version, so CI's 24.x and a local
24.y can still differ. That's on purpose. The failure this fixes is the 20-vs-24 class — which
already bit us twice in Phase 1, via `jsdom@30` and `@testing-library/jest-dom@7` both requiring
Node ≥22. A 24.8-vs-24.20 gap is benign, and pinning exact would mean a forced local install on
every patch bump. The reference repo pins exact because a team needs byte-identical environments;
one developer does not.

Those two Phase 1 pins stay where they are (`jsdom@^29`, `jest-dom@^6`) — `jsdom@30` wants
`^24.15.0` and this machine is on 24.8, so restoring them would recreate the same local-vs-CI
split in the other direction.

#### Verified

`npm run check` and `next build` both pass, and **the deprecation banner is gone** from every
build. `eslint .` reports zero problems.

### Phase 3 — One workspace, one command — SHIPPED (2026-09-06), pending deploy verification

This is the one that touches the deploy path, so it goes last of the "definitely do" items and
gets verified carefully.

**What shipped.** Root `package.json` is now an npm workspace root over `frontend` and `infra`
(`backend/` is Python and stays with uv). Three lockfiles became one. New root scripts:

```
npm run dev             backend + frontend together (concurrently)
npm run dev:api         just the API
npm run dev:web         just the web app
npm run check           check:next-pin && lint && type-check && test, across both workspaces
npm run check:next-pin  guards the duplicate next declaration (below)
```

`infra` gained a `type-check` script so `npm run type-check` means the same thing in both.

#### The duplicate `next` pin: guarded, not removed

The plan hoped to delete the root `next` dependency. **It's still there, on purpose.** Removing
it is a bet on someone else's build heuristic that only a deploy can settle, and it does not
belong in the same change as the workspace move.

What did change is that drift is now impossible: `scripts/check-next-pin.mjs` fails the build if
the two declarations disagree, and it runs first in `npm run check` and in CI. Both failure modes
were verified by deliberately breaking them:

| Mutation | Caught |
| --- | --- |
| Root pinned to `15.5.11`, frontend to `15.5.12` | `✖ next pin mismatch` |
| Root `next` deleted entirely | `✖ package.json has no next dependency` |

**A finding while doing this, worth its own follow-up:** the CDK stack deploys
`platform: "WEB"`, *not* `WEB_COMPUTE` — `infra/lib/application/amplify-stack.ts:67`, and
`docs/wiki/frontend-deployment.md` records that WEB_COMPUTE was tried and abandoned because the
SSR runtime crashed on a static export. So **the root `next` dependency may be a leftover from
that abandoned attempt and serve no purpose at all.** Deleting it is a one-line experiment with a
one-line rollback, but it needs its own deploy to verify. Not bundled here.

#### `npm ci` had to be scoped, or every Amplify build would install the CDK

A bare root `npm ci` installs *all* workspaces. `infra/node_modules` is **216 MB** of `aws-cdk`
and `aws-cdk-lib` — none of which a frontend build needs. Every command that installs is
therefore scoped:

```
npm ci -w frontend --include-workspace-root   # amplify.yml, CI frontend job
npm ci -w infra    --include-workspace-root   # CI infra job, both deploy workflows
```

`--include-workspace-root` is not optional: the root carries the `next` pin. Measured: 14s and no
`aws-cdk-lib` on disk.

#### Two things nearly went wrong

**1. A stale duplicate of the build spec lives in the CDK stack.** `amplify-stack.ts` carries a
`buildSpec` string that is a second copy of `amplify.yml`, used as a CloudFormation fallback when
the repo's own file is missing. Updating only `amplify.yml` would have left a fallback that runs
`npm ci --prefix frontend` against a repo with no `frontend/package-lock.json` — failing at
exactly the moment you'd be relying on it. Both are updated, and the CDK copy now carries a
`KEEP IN SYNC` comment.

**2. Hoisting broke `infra`'s type-check, and it was a real latent bug.** `infra/tsconfig.json`
hardcoded `typeRoots: ["./node_modules/@types"]`. Once `@types/jest` hoisted to the root, tsc
stopped finding it — `Cannot find name 'test'`.

The fix is *not* to add `../node_modules/@types`: the frontend and infra pin **different**
`@types/node` versions (22.20.1 hoisted, 22.7.9 nested), so widening the directory search would
pull in both sets of global declarations and leak `@types/react` into the CDK project. Replaced
with `"types": ["node", "jest"]` — naming the two globals infra actually needs, and letting
normal module resolution pick the nearest copy of each.

This is the phantom-dependency class of problem §2 said npm can't prevent, showing up as soon as
the layout moved. It was latent before, not introduced here.

#### Verified

Both CI jobs were run locally from a clean tree, plus the whole thing together:

| | Result |
| --- | --- |
| `npm ci -w frontend --include-workspace-root` → pin check, lint, 64 tests, `next build` | pass, and the *multiple lockfiles* warning is gone |
| `npm ci -w infra --include-workspace-root` → `tsc --noEmit`, jest, `cdk synth --all` | pass |
| `npm ci` → `npm run check` | pass |

**Not verified, and it cannot be from here: the Amplify deploy.** Everything above is a local
proxy. `npm run dev` is also unverified on purpose — `dev:api` runs `uv run start`, which migrates
and seeds a database.

**If Amplify's build fails**, the rollback is small and known: restore `amplify.yml` and the CDK
`buildSpec` to `npm install` + `npm ci --prefix frontend`, and re-add `frontend/package-lock.json`.
Everything else — the single lockfile, the scripts, the tsconfig fix — is independent of it.

**Docs updated:** root `README.md` (three commands now `docker compose` / `npm install` /
`npm run dev`), `frontend/README.md` (install from the root), and
`docs/wiki/frontend-deployment.md` (the build spec).

### Phase 4 — knip — SHIPPED (2026-09-06)

**What knip is:** a dead-code finder. It builds a graph from your entry points and reports every
file, export and dependency nothing reaches — the tooling answer to *"if something is dead,
remove it"*, instead of noticing dead code by accident during a review.

Config lives in [`../../knip.ts`](../../knip.ts), wired into `npm run check` and given its own CI
job.

#### First run: 25 findings, and most were the config's fault

That ratio is the whole lesson. A bare run reported all eight `infra/**` files as dead, plus
`aws-cdk-lib`, `constructs` and `ts-node` — because nothing *imports* `infra/bin/infra.ts`;
`cdk.json` names it in a shell command. Declaring that one entry point resolved eleven findings
at once.

The config is therefore mostly **entry points knip cannot infer**, not suppressions:

| Told to knip | Why it couldn't know |
| --- | --- |
| `infra/bin/infra.ts` | `cdk.json` runs it via `npx ts-node`, a string in JSON |
| `scripts/*.mjs` (root and frontend) | Invoked by npm scripts, never imported |
| `**/*.spec.{ts,tsx}` | Vitest collects by filename |
| `eslint-config-next` | `eslint.config.mjs` pulls it in as a *string* through `FlatCompat` |
| `ts-node` | Same `cdk.json` command |
| `next` (root) | The deliberate Amplify declaration — never imported, by design |
| `uv` | `dev:api` shells out to Python's package manager |

`ignoreExportsUsedInFile: true` handled a whole category on its own: `parseDateOnly`,
`prefersReducedMotion`, `RecipeAPIClient` and two API-client types are all exported but only used
*within their own file*. Un-exporting each was the alternative; one setting is better, and it
keeps `IngredientsInput` and `CreateRestaurantResult` exported, which is right — they describe the
public shape of the API client even though nothing imports them by name today.

#### What was actually dead, and got deleted

| | |
| --- | --- |
| `frontend/components/brand/PawPrint.tsx` | Whole file. Nothing referenced it |
| `infra/lib/utils/naming-convention.ts` | Whole file. A `NamingConvention` class with a `RecipeManager` prefix helper, zero references |
| `SamWordmark` — `SamLogo.tsx` | Logo + wordmark lockup, never used |
| `FetchDots` — `Loader.tsx` | Inline spinner, never used |
| `export default amplifyConfig` — `lib/amplify.ts` | All three importers use the named `configureAmplify` |
| `@testing-library/user-event` | Installed in Phase 1 on the assumption component tests would need it. They didn't |

`cdk synth --all` and `next build` both still pass, which is the check that matters after
deleting a file from a CDK project.

#### Two phantom dependencies — the interesting find

Both are imports that resolve today only because **something else** happens to install them.
This is exactly the failure mode §2 says npm's flat `node_modules` cannot prevent, and neither
was visible to any other tool:

- **`sharp`**, in `frontend/scripts/generate-icons.mjs`. Its comment said *"`sharp` ships with
  Next, so this needs no extra dependency"* — documenting the phantom dependency as if it were a
  feature. `npm ls sharp` confirms it arrives **only** through `next`. The day Next drops it (it
  has been making it optional), `npm run icons` breaks with no warning. Now a declared
  devDependency, and the comment says what actually happened.
- **`source-map-support/register`**, imported at the top of `infra/bin/infra.ts` and never
  declared. Now an explicit dependency of `infra`.

#### One thing knip found that is *not* dead code

There are **two different `prefersReducedMotion` functions** — `lib/useFlipGrid.ts` and
`components/map/map-style.ts` — and they are not identical:

```ts
// lib/useFlipGrid.ts — guarded
if (typeof window === "undefined" || !window.matchMedia) return false;
return window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// components/map/map-style.ts — unguarded
return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
```

The guard was added to one copy and not the other, which is the standard fate of duplicated
code. The map version is only called from event handlers and effects, so it doesn't crash today —
but this is a static export that prerenders, and an unguarded `window` in that file is a trap
waiting for someone to call it a millisecond earlier.

**Deliberately not fixed here.** It's a small refactor, not dead code, and the honest home for it
is its own change: `map-style.ts` is under `components/`, so a shared helper belongs in `lib/`
with both importing it.

#### CI: knip needs its own job

Unlike the frontend and infra jobs, knip analyses the **whole** graph, so a scoped
`npm ci -w <workspace>` makes it report the missing workspace's dependencies as unused —
verified, not assumed: a frontend-only install produced three false findings about `infra`.
It therefore gets its own job with a plain `npm ci`.

Confirmed it actually fails the build rather than just printing: a planted dead file exits 1, a
clean tree exits 0.

## 4. Suggested order

| Phase | Risk | Why here |
| --- | --- | --- |
| 1. Vitest | ~~none~~ — see below | **Done (2026-09-06).** 64 tests. Not quite zero-risk after all: the lockfile had to be regenerated, which refreshed caret-range deps including `aws-amplify` |
| 2. ESLint CLI + Node pinning | low | **Done (2026-09-06).** Found 4 dead lint suppressions on the way, and CI turned out to be on an end-of-life Node |
| 3. npm workspaces | **touches Amplify** | **Done (2026-09-06)**, but the deploy is still the real test — merge only after a branch build succeeds |
| 4. knip | none — dev only | **Done (2026-09-06).** Deleted 2 files, 3 exports and 1 dependency; found 2 phantom dependencies |

End-to-end browser testing (**Playwright**) was considered here and deliberately moved out — it's
a bigger commitment than a tooling chore and now lives in
[`./future-roadmap.md`](./future-roadmap.md) item 8.

## 5. What we're deliberately *not* taking from the reference

Copying a mature repo's config wholesale is how you end up with tooling nobody understands.
Each of these is a good idea *there* and a bad idea *here*:

| Their choice | Why not for us |
| --- | --- |
| **pnpm** | §2 — the win is workspaces, and npm already has those |
| **oxlint / oxfmt** | Faster, but loses `eslint-config-next`'s Next-specific rules for a speed problem we don't have |
| **dependency-cruiser** | Enforces layering. The *backend* has real layers (domain/app/infra); the frontend doesn't have boundaries worth policing yet |
| **Sentry** | Error tracking is a paid service. Fails the no-recurring-cost constraint |
| **`generate:types` from OpenAPI** | Genuinely attractive — FastAPI publishes an OpenAPI schema, so `api-client.ts`'s hand-written interfaces could be generated and could never drift from the backend. But it's a real project, not a tooling chore. **Worth its own roadmap item.** |
| **Their CI depth** | Preview deploys, Slack notifiers, rollback workflows. A team's problems |

## Cross-links

- [`./routing-and-latency-plan.md`](./routing-and-latency-plan.md) §6 — where the missing test
  runner was flagged, and the URL modules that need covering.
- [`./future-roadmap.md`](./future-roadmap.md) item 3 — the npm workflow item this closes.
