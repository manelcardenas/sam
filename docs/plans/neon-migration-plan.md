# Migration Plan — Aurora → Neon

> **Scope of THIS plan:** only the database swap. Lambda + API Gateway + Amplify + Cognito stay exactly where they are. After this migration is verified, you'll have **Lambda → Neon (Postgres in Frankfurt)** with Aurora deleted. The EC2 backend migration is a separate phase, planned afterwards.

---

## 0. Three things to clear up first

### 0a. The Lambda + Neon + NAT-gateway question — debunked

You asked: "we can not have lambda + neon because we would need a NAT gateway no?"

**No NAT gateway is needed.** The confusion is conflating "Lambda" with "Lambda inside a VPC."

- A Lambda function with no `vpc` config in CDK runs **outside any VPC**.
- Lambdas outside a VPC have **free outbound internet access** — they can reach Cognito, Stripe, GitHub, Neon, anything public.
- Your current Lambda is already in this configuration (`lambda-api-stack.ts:61`: *"No vpc config — Lambda is outside the VPC"*).
- It currently reaches Aurora over Aurora's **public** endpoint because you set `publiclyAccessible: true` and put Aurora in a public subnet (that's why `natGateways: 0` works for you today).

A NAT gateway is only required when:
1. Your Lambda *is* attached to a VPC (`vpc:` set), **and**
2. That Lambda needs to reach the public internet (or AWS service endpoints outside the VPC).

You have neither condition. **Lambda → Neon works with the exact same zero-NAT networking shape you use today.** Only the hostname in the env var changes.

### 0b. Custom domain vs raw URL — what it actually means

Right now your API URL looks like:

```
https://abc123xyz.execute-api.eu-west-3.amazonaws.com/recipes
```

That's an **AWS-generated subdomain** of `execute-api.eu-west-3.amazonaws.com`. It works, it has HTTPS, but the hostname is ugly and AWS-owned. If you ever swap from API Gateway to an EC2, this URL changes — your frontend `NEXT_PUBLIC_API_URL` has to change, builds have to redeploy, etc.

A **custom domain** means you own a hostname (e.g. `api.recipes.cardenas.dev`) and point it at whichever AWS resource currently hosts the API. What you need:

| Piece | What it is | Cost |
| ----- | ---------- | ---- |
| **Domain name** | The actual `cardenas.dev` — buy from any registrar (Route 53, Cloudflare, Namecheap). | ~$12/year |
| **Route 53 hosted zone** | An AWS-managed DNS zone for your domain. AWS provides nameservers; you tell the registrar to use them. | $0.50/mo |
| **DNS records inside the zone** | `api.cardenas.dev → CNAME → abc123xyz.execute-api.eu-west-3.amazonaws.com` (or A record to EC2 IP later). | free |
| **ACM certificate** | TLS cert for `api.cardenas.dev`. Renewed automatically. | **free** |

When you swap Lambda → EC2 next phase, only the DNS record value changes. The frontend keeps calling `https://api.cardenas.dev`. That's why custom domains matter: **they decouple the URL from the underlying compute.**

**For the Neon migration: not needed yet.** The current `execute-api...amazonaws.com` URL keeps working. Punt this to the EC2 phase.

### 0c. Caddy / NGINX — what they are and why

They're **reverse proxies / web servers** that sit in front of your application. The flow is:

```
Browser ──HTTPS:443──► Caddy / NGINX ──HTTP:9000──► uvicorn / FastAPI
                          │
                          └─► handles TLS, gzip, request size limits, rate limits
```

Why they're needed (in the EC2 phase, not today):

- **FastAPI on uvicorn listens on plain HTTP** (`:9000`). Browsers refuse to send Cognito tokens over HTTP — they require HTTPS.
- **TLS termination has to happen somewhere.** API Gateway does it today (managed). On EC2 you do it yourself — that's what Caddy or NGINX is for.

The difference between the two:

| | Caddy | NGINX |
| --- | --- | --- |
| HTTPS setup | **One line** — auto-issues + renews Let's Encrypt cert | Need `certbot` + cron + config blocks |
| Config syntax | Simple, modern | Older, more directives, more powerful |
| Performance | Excellent for personal-scale | Excellent for any scale |
| What employers know | Lesser-known | **Industry standard** — looks good on a CV |
| Effort | Low | Medium |

**For the Neon migration: not needed yet.** API Gateway handles HTTPS for Lambda. Punt to the EC2 phase.

---

## 1. Goal for this migration

| | Before (today) | After (this plan) |
| --- | --- | --- |
| **DB** | Aurora Serverless v2 (AWS) | Neon Postgres (Frankfurt, free tier) |
| **Backend** | Lambda + API Gateway | Lambda + API Gateway (unchanged) |
| **FE** | Amplify (Next.js static) | Amplify (unchanged) |
| **Auth** | Cognito | Cognito (unchanged) |
| **Cost** | ~$7/mo | **$0/mo** |
| **Environments** | one (prod) | one (prod) — staging deferred |

Success criteria:
- [ ] Lambda in eu-west-3 reads/writes to Neon in eu-central-1 over TLS.
- [ ] All 10 unit + integration tests green against Neon.
- [ ] Existing seeded recipes present in Neon.
- [ ] Aurora stack and VPC stack **destroyed** — `cdk destroy` with no remaining resources.
- [ ] No Aurora snapshots, secrets, or KMS keys left behind incurring cost.

---

## 2. Single-environment for this migration

Skipping the staging/prod split. One Neon project, one Lambda stack — same shape as today, just pointing at a different database.

Why not bother with staging here:

- This migration only changes the DB driver and the connection string. Nothing about Cognito, the Lambda code, API Gateway, or Amplify is moving. The risk surface doesn't justify a parallel staging path.
- If you ever want short-lived isolated DBs (per-PR previews, schema experiments), **Neon branches are free and instant** — `neon branches create staging` gives you a copy-on-write clone of prod in seconds. Use them on demand, delete them after. No need for a permanent "staging project".
- Staging as a *permanent environment* (separate Lambda + separate Cognito) belongs in the EC2 phase, where the changes are bigger and being able to test in a prod-shaped clone matters.

---

## 3. Migration phases

Each phase is independently verifiable. Stop and validate before moving on.

### Phase 1 — Set up Neon

1. Create a Neon account → free plan.
2. Create **one project** in **AWS eu-central-1 (Frankfurt)**: `recipe-manager`.
3. Set the Postgres version to **16** (matches your local + Aurora).
4. Grab the **pooled** connection string (the one with `-pooler` in the hostname — important for Lambda; explained in §6). It looks like:
   ```
   postgresql://user:pwd@ep-cool-name-12345-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
5. Save it somewhere temporary (you'll move it to SSM in Phase 5). Do **not** commit it.

**Validation:** open Neon's SQL Editor, run `SELECT version();` — confirm Postgres 16, Frankfurt region.

### Phase 2 — Schema migration into Neon

You already have Alembic migrations. Apply them to Neon.

```bash
cd backend

POSTGRES_HOST="ep-...-pooler.eu-central-1.aws.neon.tech" \
POSTGRES_PORT=5432 \
POSTGRES_DB=neondb \
POSTGRES_USER=<from Neon string> \
POSTGRES_PASSWORD=<from Neon string> \
POSTGRES_SSLMODE=require \
uv run alembic upgrade head
```

You'll need to extend `engine.py` to set `sslmode=require` (Phase 6) before the alembic command works against Neon. **Or** as a one-off, build the DSN by hand for the migration:

```bash
DATABASE_URL="postgresql+psycopg2://USER:PWD@HOST/neondb?sslmode=require" \
uv run alembic -x url="$DATABASE_URL" upgrade head
```

(Alembic supports `-x url=...` if `env.py` reads it — quick check needed.)

**Validation:** Neon SQL Editor → `\dt` should show `users`, `recipes`, `alembic_version`, and the `food_type_enum` type.

### Phase 3 — Data migration

**Option A — re-run the seed script (recommended).** Your real data is the 14 seed recipes + JIT-provisioned users. Both come back automatically:

```bash
# Recipes
POSTGRES_HOST=... POSTGRES_USER=... POSTGRES_PASSWORD=... \
  uv run python -m backend.scripts.seed

# Users: they get re-provisioned on first authenticated request after the cutover
```

You'll lose any recipes manually created by other Cognito users since the seed. Verify in Aurora first whether that matters.

**Option B — `pg_dump` Aurora and `pg_restore` into Neon** if there's real user data worth preserving:

```bash
# From a machine that can reach Aurora's public endpoint
pg_dump \
  -h <aurora-endpoint>.cluster-xxx.eu-west-3.rds.amazonaws.com \
  -U postgres -d recipe_manager \
  --data-only --inserts --no-owner --no-privileges \
  > prod_data.sql

# Then load into Neon
psql "postgresql://...neon...?sslmode=require" < prod_data.sql
```

`--data-only` because Phase 2 already set up the schema. `--inserts` makes it safe to re-run if anything fails halfway. `--no-owner/--no-privileges` because role names differ between Aurora and Neon.

**Validation:** `SELECT count(*) FROM recipes;` and `SELECT count(*) FROM users;` match expected counts.

### Phase 4 — Local verification against Neon

Before touching the Lambda, point your local backend at Neon and validate the full flow:

```bash
# In backend/.env (do NOT commit)
POSTGRES_HOST=ep-...-pooler.eu-central-1.aws.neon.tech
POSTGRES_PORT=5432
POSTGRES_DB=neondb
POSTGRES_USER=<from Neon>
POSTGRES_PASSWORD=<from Neon>
POSTGRES_SSLMODE=require   # new env var — see Phase 6
```

```bash
uv run uvicorn src.main:app --reload --port 9000
# In another terminal:
curl http://localhost:9000/health
# Sign in via your FE locally, POST a recipe, verify it lands in Neon.
```

**Validation:** create a recipe via local FE → it appears in Neon's SQL Editor.

### Phase 5 — Store the Neon DSN in SSM Parameter Store

Best practice: secrets don't live in CDK code. Use SSM (free for SecureString parameters under 4 KB).

```bash
aws ssm put-parameter \
  --name /recipe-manager/db/dsn \
  --type SecureString \
  --value 'postgresql+psycopg2://USER:PWD@ep-...-pooler.<region>.aws.neon.tech/neondb?sslmode=require' \
  --region eu-west-3
```

Important details for *this* setup:

- **DB name is `neondb`**, not `recipe_manager`. We migrated into Neon's default database; nobody created a `recipe_manager` DB. The DSN must end in `/neondb` or the Lambda gets `database "recipe_manager" does not exist`.
- **Use the pooled (`-pooler`) host.** This DSN runs in Lambda, and §6 requires the pooled endpoint there. (The *direct* host was correct for the one-off Alembic migration in Phase 2 — runtime is the opposite.)
- **Region is `eu-west-3`** — the param lives where the *Lambda* lives, not where Neon lives (eu-central-1).
- **Scheme `postgresql+psycopg2://`** is for SQLAlchemy. It is **not** a valid `psql` string — only the app consumes this value.
- **Drop `channel_binding`** if present on the copied Neon string; `sslmode=require` is sufficient and avoids psycopg2 handshake friction.
- **Single-quote** the `--value` so the shell doesn't interpret `?`, `&`, or `/`.
- To replace an existing parameter (e.g. after rotating the password), re-run with `--overwrite`.

Verify:

```bash
aws ssm get-parameter --name /recipe-manager/db/dsn --with-decryption \
  --region eu-west-3 --query 'Parameter.Value' --output text
```

> **Note:** this stores the DSN, but `engine.py` still reads the 5-field `POSTGRES_*` vars until **Phase 6.1** refactors `build_dsn()` to read `POSTGRES_DSN`. Nothing consumes this parameter until Phase 6 lands — that's expected.

(Or use AWS Secrets Manager — $0.40/mo per secret, so SSM SecureString is cheaper for personal-scale.)

### Phase 6 — Code + CDK changes

#### 6.1 `backend/src/infra/db/engine.py` — single DSN env var

Replace the 5-field DSN builder with a single env var. Neon gives you a complete connection string; reading it as-is is simpler and matches how every other Postgres SaaS does it.

```python
def build_dsn() -> str:
    """Read the full Postgres DSN from POSTGRES_DSN (Neon-friendly).

    Format: postgresql+psycopg2://user:pwd@host:port/db?sslmode=require
    Locally set via backend/.env; on Lambda via env vars sourced from SSM.
    """
    dsn = os.environ.get("POSTGRES_DSN")
    if dsn:
        return dsn

    # Backward-compatible path for legacy 5-field config (dev convenience).
    host = os.environ["POSTGRES_HOST"]
    port = os.environ.get("POSTGRES_PORT", "5432")
    db = os.environ["POSTGRES_DB"]
    user = os.environ["POSTGRES_USER"]
    password = os.environ["POSTGRES_PASSWORD"]
    sslmode = os.environ.get("POSTGRES_SSLMODE", "")
    suffix = f"?sslmode={sslmode}" if sslmode else ""
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}{suffix}"
```

#### 6.2 `backend/.env.example` — document the new var

```env
# Neon (recommended) — single DSN
POSTGRES_DSN=postgresql+psycopg2://user:pwd@ep-...-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require

# Legacy 5-field (still supported, for local Docker Postgres)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=recipe_manager
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
```

#### 6.3 `infra/lib/application/lambda-api-stack.ts` — decouple from Aurora

Remove the Aurora dependency, source DSN from SSM.

```ts
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

// Constructor — drop auroraStack param
constructor(scope: Construct, id: string, props: {
  cognitoStack: CognitoStack;
}) { ... }

// Replace the POSTGRES_* environment block with:
const dsnParam = StringParameter.fromSecureStringParameterAttributes(
  this, 'DbDsn', { parameterName: '/recipe-manager/db/dsn' }
);

const recipeApi = new PythonFunction(this, 'RecipeAPI', {
  // ... same as before ...
  environment: {
    POSTGRES_DSN: dsnParam.stringValue,
    COGNITO_USER_POOL_ID: cognitoStack.userPool.userPoolId,
    COGNITO_CLIENT_ID: cognitoStack.userPoolClient.userPoolClientId,
  },
});

// Drop: auroraStack.databaseSecret.grantRead(recipeApi);
// Add: explicit SSM read permission (CDK does this automatically when you use fromSecureStringParameterAttributes? — verify)
```

(Note: `StringParameter.stringValue` resolves at deploy time, embedding the DSN in the Lambda env config. That's acceptable — the env block isn't world-readable. For stronger hygiene, use `Secret` and call SSM at cold-start; deferred to a later improvement.)

#### 6.4 `infra/bin/infra.ts` — drop the Aurora stack from the graph

Remove the Aurora stack instantiation and the `auroraStack` arg passed into `LambdaApiStack`. Single Lambda stack remains, now depending only on Cognito.

#### 6.5 `infra/lib/infrastructure/aurora-stack.ts` and `vpc-stack.ts`

**Don't delete the files yet** — see Phase 8. First deploy without them in the stack graph, then `cdk destroy` the running stacks, then delete the files.

### Phase 7 — Deploy + smoke test

```bash
cd infra
npx cdk deploy RecipeManagerLambdaApiStack --require-approval never
```

**Validation checklist:**
- [ ] `GET /health` → 200
- [ ] `GET /recipes` → returns the 14 seeded recipes
- [ ] Sign in as a fresh Cognito user, `POST /recipes` → succeeds (JIT user-provisioning still works)
- [ ] CloudWatch logs show DB connection messages with the Neon hostname (sanity)

### Phase 8 — Hard delete the Aurora + VPC stacks

Once Phase 7 is validated and stable for at least 24 h:

```bash
cd infra
# Destroy in reverse dependency order
npx cdk destroy RecipeManagerAuroraStack
npx cdk destroy RecipeManagerVpcStack
```

CDK will prompt for confirmation. Then in the AWS Console, **manually verify zero residue**:

| Service | What to check |
| ------- | ------------- |
| RDS → Databases | No `recipe-manager-aurora-cluster` |
| RDS → **Snapshots** | **Manual snapshots are NOT deleted by `cdk destroy`** (removalPolicy was `SNAPSHOT`). Delete them by hand. |
| Secrets Manager | No `recipe-manager-aurora-secret/...` |
| KMS | No customer-managed key from Aurora (if any was created) |
| EC2 → Security Groups | No `RecipeManagerVpcStack-*` SGs |
| VPC | No `recipe-manager-vpc` |
| CloudWatch → Log groups | Delete `/aws/rds/cluster/recipe-manager-aurora-cluster/postgresql` |
| CloudFormation | Both stacks gone, `DELETE_COMPLETE` |

Then delete the files:

```bash
rm infra/lib/infrastructure/aurora-stack.ts
rm infra/lib/infrastructure/vpc-stack.ts
# Remove their imports from infra/bin/infra.ts
```

**Validation:** AWS Cost Explorer → next billing day shows Aurora at $0.

---

## 4. What gets deleted vs kept (cleanup matrix)

After this migration:

| Item | Status |
| ---- | ------ |
| `infra/lib/infrastructure/aurora-stack.ts` | **DELETED** (file removed) |
| `infra/lib/infrastructure/vpc-stack.ts` | **DELETED** (file removed) |
| `infra/lib/infrastructure/` directory | empty → can be removed |
| Aurora cluster on AWS | **destroyed** |
| Aurora snapshots | **manually deleted** (CDK won't do it) |
| Aurora secret in Secrets Manager | **destroyed** with cluster |
| VPC + subnets + security groups | **destroyed** |
| `infra/lib/application/lambda-api-stack.ts` | refactored, kept |
| `infra/lib/application/amplify-stack.ts` | unchanged |
| `infra/lib/foundation/cognito-stack.ts` | unchanged |
| `infra/lib/foundation/ci-role-stack.ts` | unchanged |
| `infra/lib/foundation/github-oidc-provider-stack.ts` | unchanged |
| Backend code | one file changed (`engine.py`), `.env.example` updated |
| Frontend | unchanged |
| Cognito | unchanged |

Stack-by-stack final state:

```
✓ RecipeManagerGithubOidcProviderStack
✓ RecipeManagerCiRoleStack
✓ RecipeManagerCognitoStack
✓ RecipeManagerLambdaApiStack       ← refactored (Neon DSN from SSM, no Aurora dependency)
✓ RecipeManagerAmplifyStack
✗ RecipeManagerAuroraStack          ← destroyed
✗ RecipeManagerVpcStack             ← destroyed
```

---

## 5. Open questions to resolve before starting

- [ ] **What's the *actual* AWS bill breakdown?** Pull Cost Explorer for the last 30 d before Phase 8 so you know which services were costing what — easier to confirm post-cleanup that the savings hit.
- [ ] **Is anyone using prod recipes right now besides you?** Determines Phase 3 Option A vs B.

---

## 6. Why the *pooled* Neon endpoint matters

Neon offers two connection endpoints per project:

| Endpoint | Use when |
| -------- | -------- |
| `ep-xxx.eu-central-1.aws.neon.tech` (direct) | Long-lived processes that hold one connection (a single uvicorn server, a worker) |
| `ep-xxx-pooler.eu-central-1.aws.neon.tech` (pooled) | **Serverless / many-short-lived processes** — Lambda, edge functions, CI runs |

Each Lambda cold start opens a fresh DB connection (you're using `NullPool` in `engine.py`). Without pooling, every invocation handshakes a new Postgres connection — Postgres' connection limit is finite, and you'll see "too many connections" under spikes. The pooled endpoint runs PgBouncer in *transaction-pooling* mode, sharing physical connections across all your Lambda invocations.

**For Lambda: always use the pooled endpoint.** When you migrate to EC2, you can switch to the direct endpoint (single long-lived process) or keep the pooler — both work.

---

## 7. Rollback plan

If something breaks in Phase 7:

- Lambda env var change is the *only* thing pointing at Neon. Revert it via CDK (set DSN back to Aurora endpoint, redeploy) or temporarily via the Lambda console (immediate, but drifts from CDK).
- Aurora is **still running** until Phase 8. Rollback time = one `cdk deploy` (~3 min).
- Only after Phase 8's `cdk destroy` is Aurora gone. **Don't run Phase 8 the same day as Phase 7** — give it at least 24 h of real traffic against Neon.

---

## 8. Order-of-operations recap

```
Day 0  ──  Phase 1: Neon account + project (Frankfurt)
        ── Phase 2: Schema migration (alembic upgrade head)
        ── Phase 3: Seed data into Neon
        ── Phase 4: Local verification

Day 1  ──  Phase 5: SSM parameter store entry
        ── Phase 6: Code + CDK changes (PR + merge)
        ── Phase 7: Deploy + smoke-test

Day 1 → 2  Soak: 24 h on Neon with real usage

Day 2+ ──  Phase 8: cdk destroy aurora + vpc, manual snapshot deletion, file removal
```

---

## 9. What's NOT in this plan

Deliberately deferred to the **EC2 phase** (next doc):

- Replacing Lambda with EC2 + Caddy/NGINX + docker-compose
- Custom domain + Route 53 hosted zone + ACM cert
- Removing `lambda-api-stack.ts`, replacing with `ec2-backend-stack.ts`
- CI/CD changes for `git pull && docker compose up` style deploys
- **Permanent staging environment** (separate Lambda + separate Cognito user pool, or Neon branches per-env) — revisit when the EC2 changes make a staging-shaped test bed actually useful

---

## 10. Cross-links

- [`../knowledge/aws-rearchitecture-options.md`](../knowledge/aws-rearchitecture-options.md) — full decision background that led here.
- [`../knowledge/platform-alternatives.md`](../knowledge/platform-alternatives.md) — earlier DIY-AWS vs Vercel/Railway/Fly comparison.
- [`../knowledge/vpc-vs-no-vpc.md`](../knowledge/vpc-vs-no-vpc.md) — why the current VPC was overkill.
- [`./improvement-plan.md`](./improvement-plan.md) — Phase 2 (restaurant reviews) — works on either Aurora or Neon.
- [`./ec2-migration-plan.md`](./ec2-migration-plan.md) — next phase: replace Lambda with EC2 + Docker.
