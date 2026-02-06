# AWS CDK Deployment Guide - Recipe Manager API

Deploy your Recipe Manager API to AWS Lambda + DynamoDB using AWS CDK with TypeScript.

**Cost: $0/month** (Single environment, DynamoDB free tier perpetual, Lambda free tier, API Gateway free tier)

---

## Architecture Overview

```
GitHub (main branch)
       ↓
GitHub Actions (OIDC - no credentials!)
       ↓
AWS CDK Deploy
       ↓
┌─────────────────────────────────────┐
│ Production Environment (Free Tier) │
├─────────────────────────────────────┤
│ API Gateway HTTP API                │ ← FREE: 1M requests/month
│        ↓                            │
│ Lambda Function (Python 3.13)      │ ← FREE: 1M requests/month
│        ↓                            │
│ DynamoDB Table (recipes)           │ ← FREE FOREVER: 25 GB, 25M req/month
└─────────────────────────────────────┘
```

**Total Cost: $0.00/month** (for <10 requests/day = ~300/month)

---

## Infrastructure Design Principles

Following best practices:

### 1. **No Cross-Stack Dependencies**

- Use `fromLookup` with **predictable resource names**
- No CloudFormation exports = no dependency chains
- Deploy stacks independently in any order

### 2. **Layer Architecture** (by deployment frequency)

**Foundation Layer** (deploy once):

- `GithubOidcProviderStack` - OIDC provider for GitHub Actions
- `CiRoleStack` - GitHub Actions deployment role

**Infrastructure Layer** (deploy when schema/attributes change):

- `DynamoDbStack` - DynamoDB table
  - **Note:** You may deploy this frequently when adding GSIs, LSIs, or stream configurations
  - DynamoDB is schema-less, but CDK stack updates needed for: indexes, streams, TTL, etc.

**Application Layer** (deploy frequently - auto from CI/CD):

- `LambdaApiStack` - Lambda function + API Gateway

### 3. **Predictable Naming for fromLookup**

```typescript
// constants.ts - Define once, use everywhere
export class Constants {
  // DynamoDB
  readonly RECIPES_TABLE_NAME = "recipes";

  // Lambda
  readonly RECIPE_API_FUNCTION_NAME = "recipe-manager-api";

  // API Gateway
  readonly API_GATEWAY_NAME = "recipe-manager-api";

  // CI/CD
  readonly GITHUB_OIDC_PROVIDER_SSM_PARAM =
    "/recipe-manager/github-oidc-provider-arn";
  readonly CI_ROLE_NAME = "recipe-manager-ci-role";
}

// DynamoDB Stack - Create with predictable name
new Table(this, "RecipesTable", {
  tableName: this.constants.RECIPES_TABLE_NAME, // ← Predictable!
  // ...
});

// Lambda Stack - Lookup by name (NO dependency!)
const table = Table.fromTableName(
  this,
  "RecipesTable",
  this.constants.RECIPES_TABLE_NAME, // ← No CloudFormation export!
);
```

**Benefits:**

- Deploy DynamoDB and Lambda in parallel
- Update Lambda without touching DynamoDB
- No circular dependencies

---

## Project Structure

```
sam/
├── infra/                              # CDK infrastructure
│   ├── bin/
│   │   └── app.ts                      # CDK app entry point
│   ├── lib/
│   │   ├── foundation/
│   │   │   ├── github-oidc-provider-stack.ts  # OIDC (shared, deploy once)
│   │   │   └── ci-role-stack.ts               # GitHub Actions role
│   │   ├── infrastructure/
│   │   │   └── dynamodb-stack.ts              # DynamoDB table
│   │   ├── application/
│   │   │   └── lambda-api-stack.ts            # Lambda + API Gateway
│   │   ├── constructs/
│   │   │   └── lambda-api-construct.ts        # Reusable Lambda+APIGW pattern
│   │   └── utils/
│   │       ├── constants.ts                   # Predictable resource names
│   │       └── naming-convention.ts           # Resource naming helper
│   ├── package.json
│   ├── tsconfig.json
│   └── cdk.json                        # CDK config
│
├── .github/workflows/
│   └── deploy.yml                      # Auto-deploy on merge to main (OIDC)
│
├── backend/
│   ├── src/
│   │   └── main.py                     # Lambda handler (line 34)
│   └── ...
├── pyproject.toml
└── docker-compose.yml                  # Local dev only
```

---

## Stack Implementation Details

### Stack 1: GitHub OIDC Provider (Foundation)

**Purpose:** Enable GitHub Actions to assume AWS roles without long-lived credentials.

**File:** `infra/lib/foundation/github-oidc-provider-stack.ts`

**Deploy once:**

```bash
cd infra
cdk deploy RecipeManagerOidcProviderStack
```

**Cost: $0.00** (OIDC providers are free, SSM parameters free tier: 10,000 parameters)

---

### Stack 2: CI Role (Foundation)

**Purpose:** IAM role that GitHub Actions assumes to deploy infrastructure.

**File:** `infra/lib/foundation/ci-role-stack.ts`

**Deploy once:**

```bash
cdk deploy RecipeManagerCiRoleStack
```

**Add to GitHub Secrets:**

```bash
# Copy the output role ARN
# GitHub → Settings → Secrets and variables → Actions → New repository secret
# Name: AWS_ROLE_ARN
# Value: arn:aws:iam::ACCOUNT_ID:role/recipe-manager-ci-role
```

**Cost: $0.00** (IAM roles are free)

---

### Stack 3: DynamoDB Table (Infrastructure)

**Purpose:** Create DynamoDB table with predictable name for fromLookup.

**File:** `infra/lib/infrastructure/dynamodb-stack.ts`

**Deploy:**

```bash
cdk deploy RecipeManagerDynamoDbStack
```

**Cost: $0.00/month** (DynamoDB free tier: 25 GB storage, 25M requests/month - FREE FOREVER)

---

### Stack 4: Lambda + API Gateway (Application)

**Purpose:** Lambda function running FastAPI + API Gateway HTTP API.

**File:** `infra/lib/application/lambda-api-stack.ts`

**Deploy:**

```bash
cdk deploy RecipeManagerLambdaApiStack
```

**Cost: $0.00/month** (Lambda free tier: 1M requests/month, API Gateway free tier: 1M requests/month)

---

### Utility Files

**constants.ts:**

**naming-convention.ts:**

**bin/app.ts (CDK entry point):**

---

## GitHub Actions CI/CD

**Auto-deploy on merge to main** using OIDC (no AWS credentials in GitHub!).

**File:** `.github/workflows/deploy.yml`

```yaml
name: Deploy Recipe Manager API

on:
  push:
    branches: [main] # Auto-deploy when PR merged to main
  workflow_dispatch: # Manual trigger button

permissions:
  id-token: write # ⚠️ Required for OIDC
  contents: read

jobs:
  deploy:
    name: Deploy to AWS
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "18"
          cache: "npm"
          cache-dependency-path: infra/package-lock.json

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: eu-west-3
          role-session-name: GitHubActions-RecipeManager

      - name: Install CDK dependencies
        run: |
          cd infra
          npm ci

      - name: Deploy Lambda API Stack
        run: |
          cd infra
          npx cdk deploy RecipeManagerLambdaApiStack \
            --require-approval never \
            --outputs-file outputs.json

      - name: Display API endpoint
        run: |
          cd infra
          cat outputs.json
          echo "✅ Deployment complete!"
          echo "API Endpoint: $(jq -r '.RecipeManagerLambdaApiStack.ApiEndpoint' outputs.json)"
```

**Setup:**

1. Deploy OIDC and CI role stacks (manual, one-time)
2. Add `AWS_ROLE_ARN` to GitHub Secrets
3. Push to main → auto-deploys Lambda!

**Cost: $0.00** (GitHub Actions free for public repos: 2,000 min/month)

---

## Deployment Workflow

### First-Time Setup (Manual)

```bash
# 1. Bootstrap CDK
cdk bootstrap aws://YOUR_ACCOUNT_ID/eu-west-3

# 2. Initialize CDK project
cd infra
npm install
npm install @aws-cdk/aws-lambda-python-alpha

# 3. Deploy foundation (one-time)
cdk deploy RecipeManagerOidcProviderStack
cdk deploy RecipeManagerCiRoleStack

# 4. Copy CI role ARN to GitHub Secrets
# GitHub → Settings → Secrets → Actions → New secret
# Name: AWS_ROLE_ARN
# Value: <from CfnOutput>

# 5. Deploy infrastructure (one-time)
cdk deploy RecipeManagerDynamoDbStack

# 6. Deploy application (manual first time, then CI/CD)
cdk deploy RecipeManagerLambdaApiStack
```

### After Setup (Automated)

```bash
# Local development
docker compose up -d  # Test locally
# ... make changes to backend/src/main.py ...
docker compose down

# Commit and push
git add .
git commit -m "feat: add new endpoint"
git push origin feature-branch

# Create PR, get approval, merge to main
# → GitHub Actions automatically deploys! 🚀
```

---

## Local Development

```bash
# Test locally before deploying
docker compose up -d

# API available at http://localhost:9000
curl http://localhost:9000/health

# Stop when done
docker compose down
```

---

## Monitoring & Logs

### View Lambda logs

```bash
# Stream live logs
aws logs tail /aws/lambda/recipe-manager-api --follow

# Or in AWS Console:
# CloudWatch → Log groups → /aws/lambda/recipe-manager-api
```

### View DynamoDB items

```bash
# List all recipes
aws dynamodb scan --table-name recipes

# Or AWS Console:
# DynamoDB → Tables → recipes → Explore items
```

### API Gateway metrics

```bash
# Get request count
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGatewayV2 \
  --metric-name Count \
  --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

---

## Cost Breakdown (100% Free Tier)

| Service             | Free Tier                            | Your Usage                        | Cost            |
| ------------------- | ------------------------------------ | --------------------------------- | --------------- |
| **DynamoDB**        | 25 GB storage<br>25M requests/month  | ~10 MB<br>~300 req/month          | **$0.00**       |
| **Lambda**          | 1M requests/month<br>400K GB-seconds | ~300 req/month<br>~150 GB-seconds | **$0.00**       |
| **API Gateway**     | 1M requests/month (HTTP API)         | ~300 req/month                    | **$0.00**       |
| **CloudWatch Logs** | 5 GB ingestion<br>5 GB storage       | ~1 MB/month                       | **$0.00**       |
| **IAM**             | Unlimited                            | 2 roles                           | **$0.00**       |
| **SSM Parameters**  | 10,000 parameters                    | 1 parameter                       | **$0.00**       |
| **GitHub Actions**  | 2,000 min/month (public repo)        | ~5 min/month                      | **$0.00**       |
| **TOTAL**           |                                      |                                   | **$0.00/month** |

**Free tier limits:**

- DynamoDB: FREE FOREVER (not 12-month limit!)
- Lambda: FREE FOREVER
- API Gateway: FREE FOREVER

**Your usage (<10 requests/day):**

- 0.0012% of DynamoDB free tier
- 0.03% of Lambda free tier
- 0.03% of API Gateway free tier

---

## Cleanup

### Delete everything

```bash
# Delete stacks in reverse order
cd infra
cdk destroy RecipeManagerLambdaApiStack
cdk destroy RecipeManagerDynamoDbStack  # ⚠️ Deletes all recipes!
cdk destroy RecipeManagerCiRoleStack
cdk destroy RecipeManagerOidcProviderStack
```

**Note:** DynamoDB table has `RETAIN` policy, so won't be deleted automatically. Delete manually if needed:

```bash
aws dynamodb delete-table --table-name recipes
```

---

## Troubleshooting

### Error: "Cannot find module '@aws-cdk/aws-lambda-python-alpha'"

```bash
cd infra
npm install @aws-cdk/aws-lambda-python-alpha
```

### Lambda deployment fails (can't import dependencies)

**Cause:** PythonFunction bundles from `pyproject.toml`.

**Fix:** Make sure `pyproject.toml` is in root directory (it already is).

### GitHub Actions: "User is not authorized to perform: sts:AssumeRole"

**Cause:** CI role not configured or wrong repo name in trust policy.

**Fix:** Check `ci-role-stack.ts` line with `repo:manelcardenas/sam:*`

### DynamoDB table not found in Lambda

**Cause:** `fromTableName` failed or table not created.

**Fix:**

```bash
# Verify table exists
aws dynamodb describe-table --table-name recipes

# Redeploy DynamoDB stack
cdk deploy RecipeManagerDynamoDbStack
```

---

## Complete Stack Implementations

Copy these complete files to implement your infrastructure.

### Create `infra/lib/infrastructure/dynamodb-stack.ts`

**Directory:** Create the infrastructure directory first:

**File:** `infra/lib/infrastructure/dynamodb-stack.ts`

**Key points:**

- Uses `constants.RECIPES_TABLE_NAME` (`'recipes'`)
- `RETAIN` policy prevents accidental data loss
- `PAY_PER_REQUEST` = free tier compatible (no provisioned capacity)
- No Point-in-Time Recovery (not needed, saves cost)

**Adding attributes/indexes:** When you need to add Global Secondary Indexes (GSI) or Local Secondary Indexes (LSI), add them here:

```typescript
// Example: Add GSI for searching by title
const table = new dynamodb.Table(this, "RecipesTable", {
  // ... existing config ...
});

table.addGlobalSecondaryIndex({
  indexName: "TitleIndex",
  partitionKey: { name: "title", type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

---

### Create `infra/lib/application/lambda-api-stack.ts`

**Directory:** Create the application directory first:

**File:** `infra/lib/application/lambda-api-stack.ts`

**Key points:**

- **`entry: '../'`** - Points to project root (where `pyproject.toml` is)
- **`index: 'backend/src/main.py'`** - Path to Lambda handler within the entry directory
- **`handler: 'handler'`** - Matches Mangum handler at `main.py:34`
- **`Table.fromTableName()`** - NO CloudFormation dependency! Can deploy in parallel with DynamoDB stack
- **HTTP API** (not REST API) - Cheaper and simpler
- **Catch-all routes** - `/{proxy+}` and `/` handle all FastAPI routes

## Summary

**Manual setup (one-time):**

```bash
# 1. Bootstrap
cdk bootstrap aws://ACCOUNT_ID/eu-west-3

# 2. Deploy foundation
cd infra && npm install
cdk deploy RecipeManagerOidcProviderStack
cdk deploy RecipeManagerCiRoleStack

# 3. Add AWS_ROLE_ARN to GitHub Secrets

# 4. Deploy infrastructure
cdk deploy RecipeManagerDynamoDbStack

# 5. First Lambda deployment (then automated)
cdk deploy RecipeManagerLambdaApiStack
```

**Automated workflow:**

1. Make code changes to `backend/src/main.py`
2. Test locally: `docker compose up -d`
3. Create PR, get approval, merge to `main`
4. GitHub Actions auto-deploys in ~3 minutes
5. API live at: `https://<id>.execute-api.eu-west-3.amazonaws.com/`

**Your API is production-ready with:**

- ✅ $0.00/month cost
- ✅ Auto-deploy on merge to main
- ✅ No AWS credentials in GitHub (OIDC)
- ✅ No cross-stack dependencies (fromLookup)
- ✅ Clean architecture (Foundation → Infrastructure → Application)
- ✅ Best practices from jobLocal project

🚀 **Ready to deploy!**
