# Migration Plan — Lambda → EC2 (Docker)

> **Prerequisite:** the [Neon migration](./neon-migration-plan.md) is fully done — Aurora destroyed, Lambda already talking to Neon. This plan does **not** touch the database; only the compute layer.
>
> **End state:** a single tiny EC2 (`t4g.nano` or `t4g.micro`) running the backend in Docker, behind Caddy (HTTPS), pulling Neon DSN from SSM. Lambda + API Gateway destroyed. ~$2-3/month after Free Tier.

---

## 0. What this plan borrows from `job_local/joblocal-replatforming-ai/infra`

Five patterns from the joblocal CDK to adopt verbatim. These are the things that make their setup feel like a real codebase rather than a personal project:

### 0a. `Constants` + `NamingConvention` utilities

A `Constants` class holds **predictable resource names** (`recipemanager-vpc`, `recipemanager-ec2-host`, `recipemanager-app-secrets`) used as the source of truth for both creating and looking up resources. A `NamingConvention` class generates CDK construct IDs in the form `<Prefix><Name>-<env>`.

```ts
// infra/lib/utils/constants.ts
export class Constants {
  constructor(private readonly env: EnvironmentVariables) {}
  readonly RECIPE_MANAGER_VPC_NAME = `recipemanager-vpc-${this.env.getEnv()}`;
  readonly RECIPE_MANAGER_INSTANCE_NAME = `recipemanager-ec2-${this.env.getEnv()}`;
  readonly RECIPE_MANAGER_SG_NAME = `recipemanager-sg-${this.env.getEnv()}`;
  readonly RECIPE_MANAGER_APP_SECRETS_NAME = `recipemanager-app-secrets-${this.env.getEnv()}`;
}
```

**Why:** when a stack needs to *find* an existing resource, it asks for it by this predictable name (see §0c), not by importing the stack that created it. That breaks the cross-stack dependency tangle.

### 0b. `EnvironmentVariables` per-environment via CDK context

A single `--context env=production` (or `staging`) flag drives everything. `cdk.json` holds a context map keyed by env name:

```json
// cdk.json (excerpt)
{
  "context": {
    "env": "production",
    "staging":    { "env": "staging",    "domain": "api.staging.example.com",    "sslCertificateArn": "arn:aws:acm:..." },
    "production": { "env": "production", "domain": "api.example.com",            "sslCertificateArn": "arn:aws:acm:..." }
  }
}
```

```ts
// infra/lib/utils/environment-variables.ts
export class EnvironmentVariables {
  private readonly envObj: { env: string; domain: string; sslCertificateArn: string; };
  constructor(stack: Stack) {
    const envName = stack.node.tryGetContext("env") as string;
    this.envObj = stack.node.tryGetContext(envName);
  }
  getEnv() { return this.envObj.env; }
  getDomain() { return this.envObj.domain; }
  getSslCertArn() { return this.envObj.sslCertificateArn; }
  isStaging() { return this.envObj.env === "staging"; }
}
```

**Why:** one CDK source tree, two deployment outputs — `cdk deploy --context env=staging` vs `--context env=production`. No duplicated code, no forking.

### 0c. Stack independence via `fromLookup` instead of constructor wiring

In your current `infra/`, `LambdaApiStack` takes `auroraStack` and `cognitoStack` as constructor args. That creates CloudFormation cross-stack exports — you can't `cdk destroy` one without touching the others.

The joblocal pattern: every stack uses `fromLookup` / `fromXxxName` to find shared resources by their predictable name:

```ts
// Anywhere we need the VPC:
const vpc = Vpc.fromLookup(this, "Vpc", { vpcName: constants.RECIPE_MANAGER_VPC_NAME });

// Anywhere we need the secrets:
const dbSecret = Secret.fromSecretNameV2(this, "DbSecrets", constants.RECIPE_MANAGER_APP_SECRETS_NAME);

// Anywhere we need the ECR repo:
const repo = Repository.fromRepositoryName(this, "Repo", constants.ECR_REPO_NAME);
```

**Why:** stacks become independently deployable. `cdk destroy RecipeManagerVpcStack-staging` doesn't take down the EC2 stack at synth time — the EC2 stack just can't be re-deployed until the VPC is back. Loose coupling, real-world shape.

### 0d. SSM-based deployment versioning

This is the killer pattern. The flow:

1. CI builds the Docker image, tags it with the git SHA (`sha-abc1234`), pushes to ECR.
2. CI runs the **app deploy script** which: triggers the deploy on the running infra (e.g. `aws ecs update-service`, or for EC2: SSH + `git checkout <sha> && docker compose up -d`).
3. CI writes the SHA to SSM Parameter Store: `/recipemanager/deployments/<env>/api/version`.
4. The CDK `Ec2BackendStack` reads that SSM parameter at synth time via `StringParameter.valueForStringParameter`, and uses it as the image tag in UserData.

```ts
// infra/lib/utils/deployment-version.ts
export class DeploymentVersion {
  constructor(
    private readonly scope: Construct,
    private readonly env: string,
    private readonly service: string,
  ) {}
  getLastDeployedVersion(): string {
    return StringParameter.valueForStringParameter(
      this.scope,
      `/recipemanager/deployments/${this.env}/${this.service}/version`,
    );
  }
}
```

**Why this is powerful:**
- `cdk deploy` becomes idempotent: re-deploying without a code change rebuilds the EC2 with the *current* released version, not "latest" (which would drift).
- Rolling back is a 1-liner: `aws ssm put-parameter --value sha-of-previous-good` + `cdk deploy`.
- CDK and "what's actually running" never diverge — SSM is the single source of truth.

### 0e. Three-layer stack split

```
Foundation       ──  rarely changes, deploy once
   ├─ GithubOidcProviderStack       (one-time, account-wide)
   ├─ CiRoleStack                   (IAM role for GitHub Actions)
   └─ CognitoStack                  (auth — already exists, keep)

Infrastructure   ──  changes occasionally
   ├─ VpcStack                      (or "default VPC" — see §1 trade-off)
   └─ AppSecretsStack               (SSM/Secrets Manager for Neon DSN, Cognito IDs)

Application      ──  changes per deploy
   └─ Ec2BackendStack               (the box itself + Caddy + Docker)
```

Each layer is independently deployable. The Application layer has no compile-time dependency on the others — only `fromLookup` at deploy time. This is the shape that makes feature work feel safe and one-off teardowns possible.

---

## 1. Goal for this migration

| | Before (post-Neon) | After (this plan) |
| --- | --- | --- |
| **Compute** | Lambda + API Gateway | EC2 (`t4g.nano` Graviton) + Caddy + Docker |
| **DB** | Neon Postgres (unchanged) | Neon Postgres (unchanged) |
| **FE** | Amplify (unchanged) | Amplify (unchanged) |
| **Auth** | Cognito (unchanged) | Cognito (unchanged) |
| **CDK structure** | Flat, cross-stack args | 3-layer with `fromLookup` |
| **Deploy versioning** | None | SSM-based, joblocal pattern |
| **Custom domain** | none | `api.<domain>` via Route 53 + ACM |
| **TLS** | API Gateway managed | Caddy + Let's Encrypt |
| **CI/CD** | `cdk deploy` Lambda | Build image → push to ECR → SSH + restart |
| **Cost** | $0/mo | ~$2-3/mo (Free Tier first 12 months) |

Success criteria:
- [ ] `https://api.<domain>` returns 200 on `/health` and serves recipes
- [ ] Frontend points at `https://api.<domain>` and all CRUD flows work
- [ ] CI/CD redeploys the API in <5 min on push to `main`
- [ ] SSM holds the current deployed git SHA; `cdk deploy` with no changes rebuilds against that SHA (no drift)
- [ ] `Lambda + API Gateway` stacks `cdk destroy`'d with zero residue
- [ ] Old Cognito callback URLs cleaned up (API Gateway URL removed from Cognito's allowed return URLs)
- [ ] AWS Cost Explorer shows ~$2-3/mo billed (or $0 if still in Free Tier)

---

## 2. Architecture diagram

```
                          ┌─────────────────────────────┐
                          │  GitHub Actions             │
                          │  build → push → SSH deploy  │
                          └──────┬────────────┬─────────┘
                                 │            │
                       docker push│            │SSH/SSM put-parameter
                                 ▼            ▼
                         ┌─────────────┐  ┌──────────────────┐
                         │   ECR       │  │ SSM Parameter    │
                         │ recipe-api  │  │ /recipemanager/  │
                         │  :sha-...   │  │  deployments/    │
                         └──────┬──────┘  │  prod/api/version│
                                │         └──────────────────┘
                                │
              user ──HTTPS──►  ┌┴───────────────┐
                               │  EC2 t4g.nano  │
                               │  ┌──────────┐  │
                               │  │  Caddy   │  │ ── 443 + auto Let's Encrypt
                               │  │ :443/80  │  │
                               │  └────┬─────┘  │
                               │       │ :9000  │
                               │  ┌────▼─────┐  │
                               │  │ FastAPI  │  │ ── reads POSTGRES_DSN
                               │  │ uvicorn  │  │       from Secrets Manager
                               │  └──────────┘  │
                               │   Docker host  │
                               └────────────────┘
                                       │ Postgres over TLS
                                       ▼
                               ┌────────────────┐
                               │  Neon          │
                               │  eu-central-1  │
                               └────────────────┘
```

---

## 3. Open questions to resolve up-front

These are blockers for §5. Decide them, then code.

- [ ] **Custom domain — do you have one?** (`api.<yours>` is required for the Caddy + Let's Encrypt flow. If you don't own a domain yet, register one — ~$12/year on Route 53 or Cloudflare.)
- [ ] **Route 53 or external DNS?** If Route 53, the hosted zone is $0.50/mo and CDK can manage it. If Cloudflare/Namecheap, you'll create the A record manually and CDK just outputs the EC2 IP.
- [ ] **Instance size**: `t4g.nano` (0.5 GB RAM) or `t4g.micro` (1 GB)? Nano is enough for FastAPI + Caddy on a personal-traffic site, but if you ever want to run Postgres on the same box (Path B from the rearchitecture doc), you need micro.
- [ ] **Free Tier status**: was the AWS account opened <12 months ago? If yes, EC2 is genuinely free year-1. If no, plan to commit to a 1-year Reserved Instance immediately (~50% off on-demand).
- [ ] **One environment or staging+prod?** Recommended: **production only** for the migration itself, then add staging in a second pass once the patterns are settled.

---

## 4. Stack design — three layers, joblocal patterns

### Foundation layer (already exists, mostly unchanged)

| Stack | New name | Status |
| ----- | -------- | ------ |
| `GithubOidcProviderStack` | `RecipeManagerGithubOidcProviderStack` | Unchanged |
| `CiRoleStack` | `RecipeManagerCiRoleStack-${env}` | **Refactored** — drop Aurora/Lambda permissions, add EC2 + ECR + SSM + SSH key management permissions |
| `CognitoStack` | `RecipeManagerCognitoStack-${env}` | Unchanged (revisit only if splitting staging/prod auth) |

### Infrastructure layer

| Stack | Purpose |
| ----- | ------- |
| `RecipeManagerVpcStack-${env}` | A VPC with **public subnets only**, `natGateways: 0`. EC2 sits in public subnet with an Elastic IP. No private subnets needed because nothing private to host. *Alternative:* skip the VPC stack and use the default VPC — but the joblocal pattern is to own your VPC, so this is the more "real" version. |
| `RecipeManagerAppSecretsStack-${env}` | Holds: Neon DSN, Cognito user-pool ID, Cognito client ID. Sourced from `.env` at synth time, stored in AWS Secrets Manager (or SSM SecureString — cheaper at $0). Predictable secret name: `recipemanager-app-secrets-${env}`. |

### Application layer

| Stack | Purpose |
| ----- | ------- |
| `RecipeManagerEcrStack-${env}` | ECR repo for the API image. Predictable name `recipemanager-api-${env}`. `RemovalPolicy.RETAIN`. |
| `RecipeManagerEc2BackendStack-${env}` | The EC2 instance + security group + Elastic IP + Route 53 A record. UserData script bootstraps Docker, fetches secrets, reads image tag from SSM, runs `docker run`. |
| (unchanged) `RecipeManagerAmplifyStack` | Frontend hosting, unchanged. |

### Drop entirely

| Stack | Action |
| ----- | ------ |
| `LambdaApiStack` (just refactored in Neon migration) | **`cdk destroy`** at the end of this plan. |
| Old `vpc-stack.ts` (only existed for Aurora) | Already gone after Neon migration. New VPC stack supersedes. |

### Final layout

```
infra/lib/
├── foundation/
│   ├── github-oidc-provider-stack.ts        (unchanged)
│   ├── ci-role-stack.ts                     (refactored)
│   └── cognito-stack.ts                     (unchanged)
├── infrastructure/
│   ├── vpc-stack.ts                         (new — replaces deleted one)
│   └── app-secrets-stack.ts                 (new)
├── application/
│   ├── ecr-stack.ts                         (new)
│   ├── ec2-backend-stack.ts                 (new — replaces lambda-api-stack)
│   └── amplify-stack.ts                     (unchanged)
├── constructs/
│   └── ec2-backend-construct.ts             (new — UserData + IAM + SG)
└── utils/
    ├── constants.ts                         (new)
    ├── environment-variables.ts             (new)
    ├── naming-convention.ts                 (new)
    └── deployment-version.ts                (new)
```

---

## 5. Migration phases

Each phase is independently verifiable. Stop and validate before moving on.

### Phase 1 — Domain + ACM cert

If you don't own a domain yet, buy one first. The rest of the plan assumes `api.<yours>`.

1. Register the domain (Route 53 / Cloudflare / Namecheap — ~$12/yr).
2. If Route 53: create a public hosted zone (CDK can do this later, but it's fine to do it manually for the root domain).
3. **For Caddy**, no ACM cert is required — Caddy fetches Let's Encrypt itself. Done.
4. Skip ACM unless you decide on the NGINX + ALB path instead (not recommended given the $16/mo ALB cost).

**Validation:** `dig <yours>` returns the AWS nameservers (if Route 53) or Cloudflare's (if Cloudflare).

### Phase 2 — Set up the new utils layer (no AWS calls)

Create the four utility files:
- `infra/lib/utils/constants.ts` (resource names)
- `infra/lib/utils/environment-variables.ts` (context reader)
- `infra/lib/utils/naming-convention.ts` (`<Prefix><Name>-<env>`)
- `infra/lib/utils/deployment-version.ts` (SSM reader)

Add the env block to `infra/cdk.json`:

```json
{
  "context": {
    "env": "production",
    "production": {
      "env": "production",
      "domain": "api.<yours>",
      "instanceType": "t4g.nano"
    }
  }
}
```

**Validation:** `cd infra && npx cdk synth` succeeds with no AWS calls (these utils are pure TypeScript).

### Phase 3 — Foundation refactor: CiRoleStack

Strip Aurora + Lambda IAM permissions. Add:
- `ec2:*` (limited to instances tagged with `app=recipemanager`)
- `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`, etc. — scoped to the recipemanager ECR repo ARN
- `ssm:PutParameter`, `ssm:GetParameter` — scoped to `/recipemanager/deployments/*`
- Keep existing CloudFormation, Cognito, Amplify, OIDC permissions

`cdk deploy RecipeManagerCiRoleStack-production`. Smoke-test by running `aws sts get-caller-identity` from the GitHub Actions OIDC role.

### Phase 4 — Infrastructure layer

1. `infra/lib/infrastructure/vpc-stack.ts` — VPC with one public subnet per AZ, `natGateways: 0`, predictable name from `Constants`.
2. `infra/lib/infrastructure/app-secrets-stack.ts` — one secret (`recipemanager-app-secrets-${env}`) with keys:
   - `POSTGRES_DSN` (Neon)
   - `COGNITO_USER_POOL_ID`
   - `COGNITO_CLIENT_ID`
   Values pulled from `.env` at synth time via `EnvironmentVariables.getSecret(...)` (joblocal pattern).

Deploy both:
```bash
cd infra
npx cdk deploy RecipeManagerVpcStack-production
npx cdk deploy RecipeManagerAppSecretsStack-production
```

**Validation:**
- EC2 console → VPC `recipemanager-vpc-production` exists, no NAT gateway
- Secrets Manager → `recipemanager-app-secrets-production` exists with the 3 keys

### Phase 5 — Application layer: ECR + EC2

1. `infra/lib/application/ecr-stack.ts` — ECR repo, predictable name.
2. `infra/lib/application/ec2-backend-stack.ts` — Instance + SG + EIP + Route 53 record. UserData:
   ```bash
   #!/bin/bash
   dnf install -y docker
   systemctl enable --now docker
   # Install Caddy via official repo
   dnf install -y 'dnf-command(copr)' && dnf copr enable -y @caddy/caddy && dnf install -y caddy
   # Pull Neon DSN + Cognito IDs from Secrets Manager (via IAM role attached to the instance)
   aws secretsmanager get-secret-value --secret-id recipemanager-app-secrets-${env} --query SecretString --output text > /opt/app/.env
   # Read image tag from SSM (CDK puts the tag value into a templated string here)
   IMAGE_TAG="<tag-from-DeploymentVersion>"
   aws ecr get-login-password --region eu-west-3 | docker login --username AWS --password-stdin <ecr-uri>
   docker pull <ecr-uri>:$IMAGE_TAG
   docker run -d --restart always --name api --env-file /opt/app/.env -p 9000:9000 <ecr-uri>:$IMAGE_TAG
   # Caddy config:
   cat > /etc/caddy/Caddyfile <<EOF
   api.<yours> {
       reverse_proxy localhost:9000
   }
   EOF
   systemctl enable --now caddy
   ```
3. The construct reads the image tag via:
   ```ts
   const deploymentVersion = new DeploymentVersion(this, env, "api");
   const imageTag = deploymentVersion.getLastDeployedVersion();
   ```

Before first deploy: **seed SSM with an initial value** so CDK synth doesn't fail:
```bash
aws ssm put-parameter \
  --name /recipemanager/deployments/production/api/version \
  --value "bootstrap" --type String --region eu-west-3
```

Then build + push an initial image with that tag:
```bash
docker build -t <ecr-uri>:bootstrap backend/
docker push <ecr-uri>:bootstrap
```

Now deploy the EC2:
```bash
cd infra
npx cdk deploy RecipeManagerEcrStack-production
npx cdk deploy RecipeManagerEc2BackendStack-production
```

**Validation:**
- `curl https://api.<yours>/health` returns 200
- Caddy auto-fetched a Let's Encrypt cert (check via `curl -vI`)
- CloudWatch logs (if you set up a CloudWatch agent in UserData — optional) show the FastAPI starting

### Phase 6 — Update Cognito callback URLs

Cognito's User Pool Client has an allowlist of return URLs. Add `https://<yours>` (or whatever the FE will use), keep the old Amplify URL active for now so the frontend keeps working.

### Phase 7 — Update the frontend

```bash
# In Amplify console (or amplify.yml + commit):
# Set NEXT_PUBLIC_API_URL=https://api.<yours>
```

Trigger an Amplify rebuild. Smoke-test the FE end-to-end against the EC2 backend.

### Phase 8 — Rewrite the CI/CD workflow

Replace `deploy.yml` job stages:

```yaml
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: eu-west-3

      - name: Compute version tag
        id: tag
        run: echo "tag=sha-${GITHUB_SHA:0:7}" >> $GITHUB_OUTPUT

      - name: Login to ECR
        run: |
          aws ecr get-login-password --region eu-west-3 \
            | docker login --username AWS --password-stdin ${{ secrets.ECR_URI }}

      - name: Build + push image
        run: |
          docker build -t ${{ secrets.ECR_URI }}:${{ steps.tag.outputs.tag }} backend/
          docker push ${{ secrets.ECR_URI }}:${{ steps.tag.outputs.tag }}

      - name: Trigger remote deploy via SSM Run Command
        run: |
          aws ssm send-command \
            --instance-ids ${{ secrets.EC2_INSTANCE_ID }} \
            --document-name AWS-RunShellScript \
            --parameters 'commands=["docker pull ${{ secrets.ECR_URI }}:${{ steps.tag.outputs.tag }}", "docker stop api || true", "docker rm api || true", "docker run -d --restart always --name api --env-file /opt/app/.env -p 9000:9000 ${{ secrets.ECR_URI }}:${{ steps.tag.outputs.tag }}"]'

      - name: Record version in SSM (CDK source of truth)
        run: |
          aws ssm put-parameter \
            --name /recipemanager/deployments/production/api/version \
            --value ${{ steps.tag.outputs.tag }} \
            --type String --overwrite
```

Notes:
- **`aws ssm send-command` instead of SSH** — no SSH key to manage. The EC2's IAM role + SSM Agent (installed by default on Amazon Linux 2023) is enough.
- The SSM `put-parameter` at the end is the joblocal pattern: CDK will pick this up on the next `cdk deploy` and rebuild UserData if needed (idempotent).
- **No Lambda deploy step** anywhere. Amplify build step remains.

### Phase 9 — Hard delete the Lambda + API Gateway stacks

After Phase 8 has been green for 24h:

```bash
cd infra
npx cdk destroy RecipeManagerLambdaApiStack-production
```

Manual cleanup:

| Service | Check |
| ------- | ----- |
| Lambda | No `recipe-api-*` function |
| API Gateway | No `RecipeHttpApi` |
| CloudWatch → Log groups | Delete `/aws/lambda/recipe-api*` log groups (CDK leaves them on destroy) |
| Cognito → User Pool Client → Allowed callback URLs | Remove the old `execute-api...amazonaws.com` URL |

Delete the file:
```bash
rm infra/lib/application/lambda-api-stack.ts
# Remove its import + instantiation from infra/bin/infra.ts
```

### Phase 10 — Optional: add staging

Now that production is solid, add `staging` to `cdk.json`'s context map, run all stack deploys with `--context env=staging`, and you get a parallel staging environment. Costs another ~$3-4/mo if the instance is `t4g.nano` (or use a Neon branch for the staging DB to keep DB at $0).

Whether to also add a staging Cognito User Pool is the same trade-off as before: one pool to start, split later if needed.

---

## 6. Cleanup matrix

| Item | Status after this plan |
| ---- | ---------------------- |
| Lambda function | **destroyed** |
| API Gateway | **destroyed** |
| `infra/lib/application/lambda-api-stack.ts` | file deleted |
| Old Cognito callback URLs (API GW domain) | removed manually |
| CloudWatch Lambda log groups | manually deleted (CDK leaves them) |
| Neon project | unchanged |
| Amplify FE | unchanged (new `NEXT_PUBLIC_API_URL`) |
| Cognito | unchanged |
| `infra/lib/foundation/cognito-stack.ts` | unchanged |
| `infra/lib/utils/*` | **new** — 4 utility files |
| `infra/lib/infrastructure/vpc-stack.ts` | new (replaces previously-deleted one) |
| `infra/lib/infrastructure/app-secrets-stack.ts` | new |
| `infra/lib/application/ecr-stack.ts` | new |
| `infra/lib/application/ec2-backend-stack.ts` | new |
| `infra/lib/application/amplify-stack.ts` | unchanged |
| `.github/workflows/deploy.yml` | rewritten (build → push → SSM) |
| Backend code | unchanged (Mangum handler can stay as dead code or be removed) |
| Frontend code | unchanged |

Final stack list:

```
✓ RecipeManagerGithubOidcProviderStack
✓ RecipeManagerCiRoleStack-production
✓ RecipeManagerCognitoStack-production
✓ RecipeManagerVpcStack-production
✓ RecipeManagerAppSecretsStack-production
✓ RecipeManagerEcrStack-production
✓ RecipeManagerEc2BackendStack-production
✓ RecipeManagerAmplifyStack
✗ RecipeManagerLambdaApiStack-production  ← destroyed
```

---

## 7. Rollback plan

- **During Phase 5-7 (EC2 up but FE not switched):** trivial — the Lambda + API Gateway are still alive and answering. Revert by leaving `NEXT_PUBLIC_API_URL` on the old value.
- **During Phase 8 (FE switched, Lambda still up):** revert `NEXT_PUBLIC_API_URL` to the old API Gateway URL via Amplify env var; rebuild. ~3 min.
- **After Phase 9 (Lambda destroyed):** rollback is now real recovery — `cdk deploy RecipeManagerLambdaApiStack` to recreate (the file still exists in git history). Or roll forward by SSH into the EC2 and diagnose. Don't run Phase 9 until 24h+ of green on EC2.
- **Image-level rollback:** `aws ssm put-parameter --value sha-previous-good --overwrite` + `aws ssm send-command` to pull the previous tag. Sub-minute.

---

## 8. Order-of-operations recap

```
Day 0 ──  Phase 1: Buy domain (if needed), set up Route 53 / Cloudflare zone

Day 1 ──  Phase 2: New utils layer (cdk synth only, no AWS)
       ── Phase 3: Refactor CiRoleStack
       ── Phase 4: VPC + AppSecrets stacks deployed

Day 2 ──  Phase 5: ECR + EC2 stacks deployed; bootstrap image pushed; first health-check green
       ── Phase 6: Cognito callback URLs updated
       ── Phase 7: FE switched to https://api.<yours>; smoke-test

Day 3 ──  Phase 8: New deploy.yml shipped; full CI/CD flow validated end-to-end

Day 4+ Soak: 24h of normal use against EC2

Day 5+ ──  Phase 9: cdk destroy Lambda + API GW; manual cleanups; file deletions

Later ──  Phase 10 (optional): add staging
```

---

## 9. What's NOT in this plan

Out of scope, deliberately:

- **Replacing Amplify with self-hosted FE on EC2.** Amplify is free for your traffic; no reason to move.
- **Replacing Cognito.** Free up to 50k MAU; no reason to move.
- **Multiple EC2 instances / autoscaling group / ALB.** Single instance is enough for personal-scale; ALB costs $16/mo and would dominate the budget.
- **Database HA / Postgres on EC2.** Already on Neon, which handles this.
- **Observability stack (Grafana, Prometheus).** The joblocal repo has it; you don't need it yet — CloudWatch logs from Docker is enough for now.
- **Blue/green deploys.** SSM send-command does an in-place restart (~5-10s of downtime). Acceptable for personal-scale. Real blue/green needs an ALB.

---

## 10. Cross-links

- [`./neon-migration-plan.md`](./neon-migration-plan.md) — required prerequisite.
- [`../knowledge/aws-rearchitecture-options.md`](../knowledge/aws-rearchitecture-options.md) — full decision background.
- [`../knowledge/gateways-proxies-load-balancers.md`](../knowledge/gateways-proxies-load-balancers.md) — reverse-proxy / TLS-termination background reading.
- [`./improvement-plan.md`](./improvement-plan.md) — Phase 2 (restaurant reviews) — works the same on EC2.
- joblocal patterns this plan borrows: `Constants`, `NamingConvention`, `EnvironmentVariables`, `DeploymentVersion`, `fromLookup` throughout, three-layer stack split, SSM-based deployment versioning.

---

## 11. After both migrations land

The infra and platform work is essentially done. Remaining work tracked in the project lives in two places:

- [`../../TODO.md`](../../TODO.md) — user-profile follow-ups: show recipe author in the FE, profile-completion flow forcing users to set their own `display_name` instead of the auto-derived email prefix, plus the backend `PATCH /users/me` endpoint that makes that possible.
- [`./improvement-plan.md`](./improvement-plan.md) — Phases 2-4 (restaurant reviews + maps, CI/CD reusable workflow refactor, FE UI improvements). Phase 1 is already DONE; the rest of the document is the to-do list.
