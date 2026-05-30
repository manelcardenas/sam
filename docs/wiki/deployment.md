> ⚠️ **STALE — kept for history.** This describes the old Aurora + VPC +
> DynamoDB setup, which no longer exists (DB migrated to Neon, Aurora/VPC
> destroyed, Lambda env vars replaced by an SSM DSN fetch). For the current
> pipeline see [`./ci-cd.md`](./ci-cd.md).

# Deployment Guide — Phase 1: PostgreSQL Migration

## Architecture & cost

```
Internet
   │
   ├──▶ API Gateway ──▶ Lambda (outside VPC)
   │                        │
   │                        │ TCP 5432 (password-secured)
   │                        ▼
   └──▶ Aurora public endpoint (in VPC public subnet)
```

| Resource | Cost |
|---|---|
| VPC, subnets, internet gateway | **FREE** |
| NAT Gateway | **NONE** (removed) |
| Lambda + API Gateway | Pay-per-request (~$0 for personal use) |
| Aurora Serverless v2 at 0 ACU (idle) | **FREE** |
| Aurora storage | ~$0.12/GB/month (negligible) |

**Total when idle: $0/month** — same as DynamoDB was.

---

## Prerequisites

```bash
cd infra
npm ci   # install CDK dependencies (only needed once)
```

CDK uses `ts-node` directly — no `npm run build` needed. The `.js`
files you may see in the filesystem are just artifacts from a past
`npm run build`; they're gitignored and irrelevant.

Make sure your AWS credentials are active:

```bash
aws sts get-caller-identity
```

---

## Deploy order

```
1. VpcStack    → creates the private network Aurora lives in
2. AuroraStack → creates Aurora cluster + Secrets Manager credentials
3. Migrations  → alembic upgrade head (directly from laptop, Aurora is public)
4. Seed        → load 14 recipes
5. LambdaStack → deploy the API
6. Cleanup     → destroy old DynamoDB stack
```

---

## Step 1 — VPC (already done ✅)

```bash
cdk deploy RecipeManagerVpcStack --require-approval never
```

After this, CDK writes AZ data to `cdk.context.json`. **Commit it now:**

```bash
git add infra/cdk.context.json
git commit -m "chore: add VPC lookup context"
```

---

## Step 2 — Aurora

CDK will look up the VPC by name, write its ID to `cdk.context.json`,
then create the Aurora cluster.

```bash
cdk deploy RecipeManagerAuroraStack --require-approval never
```

**After it finishes**, commit the updated context (now includes VPC ID):

```bash
git add infra/cdk.context.json
git commit -m "chore: add Aurora VPC lookup context"
```

**Fetch the generated password** (needed for Steps 3 & 4):

```bash
aws secretsmanager get-secret-value \
  --secret-id recipe-manager/aurora-credentials \
  --region eu-west-3 \
  --query SecretString \
  --output text
# → {"username":"postgres","password":"<generated-password>"}
```

Get the Aurora endpoint:

```bash
aws rds describe-db-clusters \
  --db-cluster-identifier recipe-manager-aurora-cluster \
  --region eu-west-3 \
  --query 'DBClusters[0].Endpoint' \
  --output text
# → recipe-manager-aurora-cluster.cluster-xxxx.eu-west-3.rds.amazonaws.com
```

---

## Step 3 — Run Alembic migrations

Aurora is publicly accessible — connect directly from your laptop:

```bash
POSTGRES_HOST=<aurora-endpoint> \
POSTGRES_PORT=5432 \
POSTGRES_USER=postgres \
POSTGRES_PASSWORD=<DB_PASSWORD> \
POSTGRES_DB=recipe_manager \
uv run alembic upgrade head
```

---

## Step 4 — Seed Aurora

```bash
POSTGRES_HOST=<aurora-endpoint> \
POSTGRES_PORT=5432 \
POSTGRES_USER=postgres \
POSTGRES_PASSWORD=<DB_PASSWORD> \
POSTGRES_DB=recipe_manager \
uv run python -m backend.scripts.seed
```

The seed script is idempotent — safe to run multiple times.

---

## Step 5 — Lambda API

```bash
cdk deploy RecipeManagerLambdaApiStack --require-approval never
```

CDK injects `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB` as Lambda environment variables
(resolved from Secrets Manager at deploy time).

Test it:

```bash
API=$(aws cloudformation describe-stacks \
  --stack-name RecipeManagerLambdaApiStack \
  --region eu-west-3 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

curl "$API/health"
# → {"status":"ok"}
```

---

## Step 6 — Delete the old DynamoDB stack

⚠️ Only after confirming the Lambda API works against Aurora.

```bash
cdk destroy RecipeManagerDynamoDbStack --force
```

---

## Routine re-deploys (CI/CD)

Only the Lambda stack changes on code pushes:

```bash
cdk deploy RecipeManagerLambdaApiStack --require-approval never
```

VpcStack and AuroraStack are stable — deploy only when their files change.
