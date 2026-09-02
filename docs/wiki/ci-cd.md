# CI/CD Pipelines

How code gets tested and shipped. Everything runs in **GitHub Actions** and
authenticates to AWS via **OIDC** (no long-lived AWS keys in GitHub).

Current stack: **Lambda + API Gateway** (backend) · **Neon Postgres** (DB,
`eu-central-1`) · **Cognito** (auth) · **Amplify** (frontend). AWS region for
everything except Neon is `eu-west-3`.

---

## The three workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `pr-health-checks.yml` | `pull_request` → `main` (+ push to `main`) | Lint + test the backend **and** the infra. The merge gate. |
| `deploy-backend.yml` | push to `main` touching `backend/**` or the Lambda/Cognito CDK | Run Neon migrations → deploy the Lambda API stack. |
| `deploy-frontend.yml` | push to `main` touching `frontend/**` or the Amplify CDK | Deploy the Amplify stack → trigger an Amplify build. |

Deploys are **path-filtered**: a backend-only change never redeploys the
frontend and vice versa. A docs-only change deploys nothing. A change touching
both runs both.

---

## 1. `pr-health-checks.yml` — the merge gate

Two parallel jobs, both must pass:

- **`backend`** — `ruff check` + `ruff format --check` + `pytest` (in `backend/`).
- **`infra`** — `tsc --noEmit` + `jest` + `cdk synth --all` (in `infra/`).

The `infra` job catches a broken CDK stack at PR time instead of at deploy
time. `cdk synth` needs **no AWS credentials**: there are no `fromLookup()`
calls, and the Amplify stack only *warns* (doesn't fail) when the `githubToken`
context is absent.

Polish: `concurrency` cancels superseded runs on the same branch;
`timeout-minutes: 15`; PR triggers include
`opened`/`synchronize`/`reopened`/`ready_for_review`.

### Making it a required check (one-time GitHub setup)

GitHub only lists a status check in the ruleset UI **after it has run once**.

1. Get `pr-health-checks.yml` onto `main` and let it run once (a push or PR triggers it).
2. Repo → **Settings → Rules / Rulesets** (or branch protection) → **Require status checks to pass**.
3. Search for and add `backend` and `infra`.
4. Future PRs are now blocked until both are green.

---

## 2. `deploy-backend.yml` — migrations + Lambda

Runs on push to `main` when any of these change: `backend/**`,
`lambda-api-stack.ts`, `cognito-stack.ts`, `ci-role-stack.ts`, `constants.ts`,
`infra.ts`. Also `workflow_dispatch` (manual button).

Steps, in order:

1. Set up `uv` (Python 3.13) + Node 20, assume the OIDC role.
2. `uv sync` (backend deps, incl. Alembic).
3. **Run migrations** (see below).
4. `npm ci` + `cdk deploy RecipeManagerLambdaApiStack`.

**Expand-contract ordering**: migrations run *before* the deploy, so additive
schema changes are in place before the new code that uses them.

### How migrations reach Neon

```bash
POOLED_DSN=$(aws ssm get-parameter --name /recipe-manager/db/dsn \
  --with-decryption --query Parameter.Value --output text --region eu-west-3)
DIRECT_DSN="${POOLED_DSN/-pooler/}"
POSTGRES_DSN="$DIRECT_DSN" uv run alembic upgrade head
```

- The DSN is fetched from SSM (decrypted) — no DB secret lives in GitHub.
- **`-pooler` is stripped from the host** to get Neon's *direct* endpoint.
  Migrations must NOT go through PgBouncer transaction pooling — it breaks
  Alembic's DDL and advisory locks. (If the stored DSN is already direct, the
  strip is a harmless no-op.)
- `alembic upgrade head` is idempotent — a no-op when already at head.
- `backend/alembic/env.py` prefers `POSTGRES_DSN` when set, else falls back to
  the five `POSTGRES_*` fields (local `.env`).

**Failure behavior**: if a migration fails, the job stops — `cdk deploy` never
runs, so code is never deployed against a schema that didn't apply.

---

## 3. `deploy-frontend.yml` — Amplify

Runs on push to `main` touching `frontend/**` or `amplify-stack.ts` (or manual).

1. Node 20 + OIDC role.
2. Fetch the GitHub PAT from SSM (`/recipe-manager/github-token`) and pass it
   via `--context githubToken=…` — CloudFormation can't reference an SSM
   SecureString inside `AWS::Amplify::App`.
3. `cdk deploy RecipeManagerAmplifyStack`.
4. `aws amplify start-job … --job-type RELEASE` to kick the build (Amplify
   auto-build is disabled; builds are triggered explicitly from CI).

---

## SSM parameters

All deploy secrets live in **SSM Parameter Store** under `/recipe-manager/`,
never in GitHub. The CI role grants `ssm:GetParameter` on `/recipe-manager/*`
plus `kms:Decrypt` on the `aws/ssm` key.

| Parameter | Type | Used by |
|---|---|---|
| `/recipe-manager/db/dsn` | SecureString | Lambda runtime (cold-start fetch) + backend migrations |
| `/recipe-manager/github-token` | SecureString | Frontend deploy (Amplify PAT) |
| `/recipe-manager/google-client-id` | String | Cognito stack |
| `/recipe-manager/google-client-secret` | SecureString | Cognito stack |
| `/recipe-manager/github-oidc-provider-arn` | String | CI role bootstrap |

> The Lambda runtime fetches `/recipe-manager/db/dsn` at cold start via boto3,
> because CloudFormation can't inject an `ssm-secure` value into a Lambda env
> var. The function receives the parameter **name** (`POSTGRES_DSN_PARAM`), not
> the value. See `backend/src/infra/db/engine.py`.

The only GitHub secret is `AWS_ROLE_ARN` (the OIDC role to assume).

---

## Running migrations manually (fallback)

CI handles migrations automatically on backend deploy, but you can always run
them from your laptop against the **direct** Neon endpoint:

```bash
cd backend
# .env must point POSTGRES_HOST at the direct (non -pooler) host
uv run alembic upgrade head
```

Or pass a DSN explicitly:

```bash
POSTGRES_DSN="postgresql://neondb_owner:…@ep-…<no -pooler>…/neondb?sslmode=require" \
  uv run alembic upgrade head
```

---

## Deploying manually (fallback)

If you need to deploy outside CI (active AWS creds required):

```bash
cd infra
npm ci
npx cdk deploy RecipeManagerLambdaApiStack --require-approval never

# Frontend (needs the PAT from SSM):
GITHUB_TOKEN=$(aws ssm get-parameter --name /recipe-manager/github-token \
  --with-decryption --query Parameter.Value --output text --region eu-west-3)
npx cdk deploy RecipeManagerAmplifyStack --require-approval never \
  --context githubToken="$GITHUB_TOKEN"
```

---

## Stack list

```
RecipeManagerOidcProviderStack   foundation, one-time
RecipeManagerCiRoleStack         foundation, GitHub Actions OIDC role
RecipeManagerCognitoStack        foundation, auth
RecipeManagerLambdaApiStack      application, deployed by deploy-backend.yml
RecipeManagerAmplifyStack        application, deployed by deploy-frontend.yml
```

---

## Cross-links

- [`../plans/neon-migration-plan.md`](../plans/neon-migration-plan.md) — how the DB moved to Neon.
- [`../plans/ec2-migration-plan.md`](../plans/ec2-migration-plan.md) — a shelved Lambda→EC2 move. **Not planned** (decided 2026-09-01); Lambda is the chosen shape.
