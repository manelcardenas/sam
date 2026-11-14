# CI/CD Pipelines

How code gets tested and shipped. Since ADR 0008 the split is:

- **GitHub Actions checks** the code (CI). It deploys nothing.
- **Vercel deploys** it (CD): a merge to `main` builds and ships whichever app changed.

Current stack: **Vercel** (the API `sam-api` and the web `sam-web`, both region `fra1`) ·
**Neon Postgres** (`eu-central-1`) · **Cognito** (auth, `eu-west-3`, deployed with CDK).

| App | Vercel project | Production URL | Root Directory |
|---|---|---|---|
| API (FastAPI) | `sam-api` | `https://sam-api-five.vercel.app` | `backend` |
| Web (Next.js static export) | `sam-web` | `https://sam-web-zeta.vercel.app` | `frontend` |

---

## 1. `pr-health-checks.yml` — the merge gate (GitHub Actions)

Four parallel jobs, all required by the "Sam" ruleset:

- **`backend`** — `requirements.txt` matches `uv.lock`, `ruff check`, `ruff format --check`, `pytest`.
- **`frontend`** — Next pin check, lint, tests, `next build`.
- **`knip`** — unused files, exports and dependencies.
- **`infra`** — `tsc --noEmit`, `jest`, `cdk synth --all` (no AWS credentials needed).

GitHub only lists a status check in the ruleset UI after it has run once.

> **While Actions is locked by billing** (since 2026-11-14) the ruleset is disabled and the same
> checks run locally before each merge. Re-enable the ruleset when Actions works again.

---

## 2. Deploys — Vercel's Git integration

Both projects are connected to `manelcardenas/sam` with `main` as the production branch. Each
has an **ignore command** that builds only `main`, and only when its own folder changed:

```bash
# exit 1 = build, exit 0 = skip
if [ "$VERCEL_GIT_COMMIT_REF" = "main" ] && ! git diff --quiet HEAD^ HEAD -- . ; then exit 1; else exit 0; fi
```

The web's also watches the root `package.json`/`package-lock.json` (npm workspaces). So a
backend-only merge never rebuilds the web, a docs-only merge deploys nothing, and no PR gets a
preview (see "Previews" below).

### API build: migrations first

`backend/pyproject.toml` → `[tool.vercel.scripts] build` runs `scripts/vercel_build.py` after
dependencies install and before the deployment goes live:

1. `alembic upgrade head`, then 2. the grocery seed (`scripts.seed_grocery`, an upsert).

- **Production only** (`VERCEL_ENV=production`); every other build skips both.
- **Direct endpoint:** `-pooler` is stripped from `POSTGRES_DSN`'s host. PgBouncer in
  transaction mode breaks Alembic's DDL and advisory locks.
- **A failed migration fails the build**, so production keeps serving the previous version —
  schema always lands before the code that needs it (expand-contract).

Config lives in `backend/vercel.json` (region, `maxDuration`), `backend/.python-version`
(3.13) and `backend/.vercelignore`.

### Web build

`frontend/vercel.json`: install only the frontend workspace
(`cd .. && npm ci -w frontend --include-workspace-root`, run from the repo root because `-w` paths are relative to where npm runs — a bare `npm ci` would also pull ~216 MB of
aws-cdk for `infra/`), then `next build`, which writes the static export Vercel serves from
its CDN. The five `NEXT_PUBLIC_*` values are project env vars, baked in at build time.

### Previews

Off for now. A web preview would get its own origin, which neither the API's CORS list nor
Cognito's callback URLs accept, and a backend preview needs its own database (a Neon branch),
not production. **Revisit when** a PR needs testing before merge.

---

## Secrets

| Where | What |
|---|---|
| Vercel `sam-api` env (sensitive) | `POSTGRES_DSN` (Neon pooler), LLM and Geoapify keys, Cognito ids, `CORS_ALLOW_ORIGINS` |
| Vercel `sam-web` env (plain) | `NEXT_PUBLIC_*` — public by design, they ship in the bundle |
| SSM `/recipe-manager/google-client-*` | Google sign-in for the Cognito stack (see below) |

Changing an env var does not redeploy: trigger a new production deployment afterwards. The
Vercel CLI refuses `vercel env rm` from an agent (it needs a typed confirmation); use
`vercel env update NAME production --yes` to change a value.

`CORS_ALLOW_ORIGINS` and Cognito's callback/logout URLs (`webDomain` in `infra/cdk.json`) must
both list every web origin. A new origin means updating both.

---

## Deploying by hand

- **Redeploy `main`** (e.g. after an env change): Vercel dashboard → Deployments → Redeploy,
  or create a deployment from the Git source `main` through the API.
- **Cognito** (the only AWS stack):
  `cd infra && npx cdk diff RecipeManagerCognitoStack`, then
  `npx cdk deploy RecipeManagerCognitoStack --exclusively`.
- **Migrations from a laptop**, against the direct (non-`-pooler`) endpoint:
  `cd backend && POSTGRES_DSN="postgresql://…<no -pooler>…/neondb?sslmode=require" uv run alembic upgrade head`.

---

## What is left on AWS

Only sign-in. Everything else was deleted on 2026-11-14 (Lambda + API Gateway, Amplify, the
GitHub Actions OIDC role and provider, their SSM parameters and log groups).

| Resource | Why it stays |
|---|---|
| `RecipeManagerCognitoStack` | The user pool, its web client, the Google provider and the `admins` group |
| `CDKToolkit` | CDK's bootstrap (asset bucket + roles); needed to deploy the Cognito stack |
| SSM `/recipe-manager/google-client-id`, `/recipe-manager/google-client-secret` | Read by the Cognito stack at deploy time |

**Old assets don't pile up.** Every deploy uploads its template and assets to the CDK
bucket and nothing removes them (it had reached 173 objects, 1.56 GB of old Lambda bundles).
After a deploy that drops assets, collect the ones no stack references:

```bash
cd infra && npx cdk gc aws://<account>/eu-west-3 --unstable=gc --type=all
```

The same idea as an ECR lifecycle rule. Vercel does it already: each project expires
deployments after 30 days and always keeps the 10 most recent production ones (Project →
Settings → Deployment Retention).

**Why the Google secret is an SSM `String`, not a `SecureString`.** CloudFormation resolves
`ssm-secure` references only in a short list of properties (RDS and Redshift passwords, IAM
login profiles…), and a Cognito identity provider's `ProviderDetails` is not one of them; the
deploy fails. Encrypting it would take Secrets Manager (0.40 $/month) or a custom resource.
Neither buys much: anyone with IAM access to SSM can also read the secret back from Cognito
(`describe-identity-provider`). Both are guarded by the same IAM boundary.

---

## Cross-links

- [`../adr/0008-expo-app-replaces-the-web-frontend.md`](../adr/0008-expo-app-replaces-the-web-frontend.md) — why Vercel.
- [`../plans/neon-migration-plan.md`](../plans/neon-migration-plan.md) — how the DB moved to Neon.
