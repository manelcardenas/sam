# Frontend Deployment: AWS Amplify

## Overview

The frontend is a Next.js 15 app living in `frontend/` inside a monorepo (`manelcardenas/sam`). It is deployed to AWS Amplify as a **static site** (no SSR), served via CloudFront, with Cognito for authentication and a Lambda HTTP API as the backend.

**Live URL:** `https://main.digg8p5ivgpv8.amplifyapp.com`

---

## Why Amplify

| Requirement                | How Amplify Satisfies It                          |
| -------------------------- | ------------------------------------------------- |
| Static hosting for Next.js | Built-in, zero config for static export           |
| HTTPS + CDN                | Automatic CloudFront distribution                 |
| CI/CD from GitHub          | Connects to repo, builds on trigger               |
| Environment variables      | Injected at build time from Amplify console / CDK |
| No server to manage        | Fully managed, serverless                         |
| IaC via CDK                | `AWS::Amplify::App` CloudFormation resource       |

---

## Why Static Export (not SSR)

All pages in `frontend/app/` use `"use client"` — they are fully client-side rendered. There is no server-side data fetching (`getServerSideProps`, Server Components, etc.). Using Amplify's `WEB_COMPUTE` platform (SSR mode) was tried but caused runtime 500 errors because the SSR runtime expected a Node.js server bundle that conflicted with the monorepo setup.

**Static export** (`output: 'export'` in `next.config.ts`) is the correct choice:

- Generates pure HTML/CSS/JS in `frontend/out/`
- Served directly from CloudFront — no Lambda, no cold starts
- Simpler, faster, cheaper

---

## Monorepo Requirements

This is the most complex part. Because the frontend lives in `frontend/` (not the repo root), several things must exist or Amplify fails.

### 1. Root `package.json` with `next` listed

**File:** `package.json` (repo root)

```json
{
  "name": "sam-monorepo",
  "private": true,
  "description": "Root package.json required for Amplify pre-clone Next.js detection.",
  "dependencies": {
    "next": "15.5.12"
  }
}
```

**Why:** Amplify runs a pre-clone detection phase to identify the framework. For Next.js apps it looks for `next` in `package.json` at the **repo root**, before the repo is even cloned. Without this, Amplify rejects the build immediately with `Cannot read 'next' version in package.json`.

The version must **exactly match** what is installed in `frontend/node_modules/` — a mismatch causes SSR bundling errors.

### 2. `amplify.yml` at the repo root

**File:** `amplify.yml`

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm install # installs root next (required by Amplify bundler)
        - npm ci --prefix frontend # installs actual frontend dependencies
    build:
      commands:
        - npm run build --prefix frontend
  artifacts:
    baseDirectory: frontend/out # static export output directory
    files:
      - "**/*"
  cache:
    paths:
      - frontend/node_modules/**/*
```

**Why:** Amplify reads `amplify.yml` from the repo root after cloning and uses it as the build spec, overriding whatever is stored in CloudFormation. This is how we control the build from within the repo itself.

**Key rules for the format:**

- Must use the simple `frontend:` key — **not** `applications:` list format
- The `applications:` format (used in Amplify console UI for monorepos) causes Amplify to try to resolve `appRoot` as a filesystem path before the repo is cloned → `Build path does not exist` error
- Use `--prefix frontend` instead of `cd frontend &&` — `cd` changes are not preserved between commands in Amplify's build environment

### 3. CDK stack: `WEB` platform, not `WEB_COMPUTE`

**File:** `infra/lib/application/amplify-stack.ts`

```typescript
new CfnApp(this, "RecipeManagerApp", {
  platform: "WEB",  // static hosting - NOT WEB_COMPUTE (SSR)
  ...
});
```

`WEB_COMPUTE` is for SSR Next.js apps with server-side rendering. Using it for a static export app causes a runtime crash because the SSR runtime cannot find a valid server bundle.

---

## CDK Infrastructure

**Stack:** `RecipeManagerAmplifyStack` (`infra/lib/application/amplify-stack.ts`)

### Resources Created

| Resource               | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `AWS::Amplify::App`    | The Amplify app, connected to GitHub repo via PAT |
| `AWS::Amplify::Branch` | Tracks `main` branch, auto-build disabled         |

### Environment Variables (injected at build time)

| Variable                          | Value                                                    | Source              |
| --------------------------------- | -------------------------------------------------------- | ------------------- |
| `NEXT_PUBLIC_AWS_REGION`          | `eu-west-3`                                              | Hardcoded in CDK    |
| `NEXT_PUBLIC_USER_POOL_ID`        | `eu-west-3_USER_POOL_ID`                                 | CognitoStack output |
| `NEXT_PUBLIC_USER_POOL_CLIENT_ID` | `USER_POOL_CLIENT_ID`                                    | CognitoStack output |
| `NEXT_PUBLIC_COGNITO_DOMAIN`      | `sam-recipe-manager`                                     | Hardcoded in CDK    |
| `NEXT_PUBLIC_API_URL`             | `https://xbm9t398cd.execute-api.eu-west-3.amazonaws.com` | `cdk.json` context  |

### GitHub Token

The Amplify app needs a GitHub PAT to clone the repo. CloudFormation does **not** support SSM SecureString references in `AWS::Amplify::App`, so the token is:

1. Stored in SSM at `/recipe-manager/github-token`
2. Read at deploy time by CI: `aws ssm get-parameter --name /recipe-manager/github-token --with-decryption`
3. Passed to CDK via context: `--context githubToken=<value>`
4. Set as `accessToken` on the `CfnApp` resource

It is **never** stored in CloudFormation templates or committed to git.

### Cross-Stack Dependency Avoidance

The API endpoint is stored in `infra/cdk.json` context rather than referenced as a CloudFormation `Fn::ImportValue`. This prevents CloudFormation from locking the `LambdaApiStack` export, which would block independent stack updates.

```json
// infra/cdk.json
{
  "context": {
    "apiEndpoint": "https://xbm9t398cd.execute-api.eu-west-3.amazonaws.com"
  }
}
```

---

## CI/CD Pipeline

**File:** `.github/workflows/deploy.yml`

On every push to `main`:

1. Configure AWS credentials via OIDC (no static keys)
2. `cdk deploy RecipeManagerLambdaApiStack` — deploy backend
3. `cdk deploy RecipeManagerAmplifyStack` — deploy frontend infra (reads GitHub token from SSM)
4. `aws amplify start-job` — trigger Amplify build on the `main` branch
5. Print deployment URLs

### IAM Permissions Required

The GitHub Actions role (`recipe-manager-ci-role`) needs these Amplify permissions:

```typescript
new PolicyStatement({
  actions: [
    "amplify:CreateApp",
    "amplify:UpdateApp",
    "amplify:GetApp",
    "amplify:CreateBranch",
    "amplify:UpdateBranch",
    "amplify:GetBranch",
    "amplify:StartJob",
    "amplify:GetJob",
    "amplify:TagResource",
  ],
  resources: [
    `arn:aws:amplify:${region}:${account}:apps/*`,
    `arn:aws:amplify:${region}:${account}:apps/*/branches/*`,
    `arn:aws:amplify:${region}:${account}:apps/*/branches/*/jobs/*`, // required for StartJob
  ],
});
```

Note: `amplify:StartJob` requires the **branch and job** ARN level — scoping only to `apps/*` is insufficient.

---

## Auto-Build vs Manual Trigger

`enableAutoBuild: false` is set on the branch. Amplify's webhook-based auto-build requires `admin:repo_hook` scope on the GitHub PAT, which is a broad permission. Instead, builds are triggered explicitly from the CI workflow via `aws amplify start-job` after CDK deploys succeed.

---

## Deploying Locally

```bash
# 1. Get GitHub token
GITHUB_TOKEN=$(aws ssm get-parameter \
  --name /recipe-manager/github-token \
  --with-decryption \
  --query Parameter.Value \
  --output text \
  --region eu-west-3)

# 2. Deploy Amplify stack
cd infra
npx cdk deploy RecipeManagerAmplifyStack \
  --context githubToken="$GITHUB_TOKEN" \
  --require-approval never

# 3. Trigger a build manually
aws amplify start-job \
  --app-id digg8p5ivgpv8 \
  --branch-name main \
  --job-type RELEASE \
  --region eu-west-3

# 4. Monitor build
aws amplify get-job \
  --app-id digg8p5ivgpv8 \
  --branch-name main \
  --job-id <JOB_ID> \
  --region eu-west-3 \
  --query 'job.summary.status'
```

---

## AWS Resources

| Resource          | ID / Value                                               |
| ----------------- | -------------------------------------------------------- |
| Amplify App ID    | `digg8p5ivgpv8`                                          |
| Frontend URL      | `https://main.digg8p5ivgpv8.amplifyapp.com`              |
| Region            | `eu-west-3` (Paris)                                      |
| Cognito User Pool | `eu-west-3_Xq5de1iEL`                                    |
| Lambda API        | `https://xbm9t398cd.execute-api.eu-west-3.amazonaws.com` |

---

## Key Files

| File                                     | Purpose                                                              |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `amplify.yml`                            | Build spec read by Amplify after cloning                             |
| `package.json`                           | Root package — exists solely for Amplify pre-clone Next.js detection |
| `frontend/next.config.ts`                | `output: 'export'` enables static site generation                    |
| `frontend/package.json`                  | Frontend dependencies — `next` version must match root               |
| `infra/lib/application/amplify-stack.ts` | CDK stack defining the Amplify app                                   |
| `infra/lib/foundation/ci-role-stack.ts`  | IAM role for GitHub Actions with Amplify permissions                 |
| `.github/workflows/deploy.yml`           | CI pipeline: CDK deploy + trigger Amplify build                      |
