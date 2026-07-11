# Re-architecture Options — Postgres + Server-style Backend

> **Companion to:** [`platform-alternatives.md`](./platform-alternatives.md),
> [`vpc-vs-no-vpc.md`](./vpc-vs-no-vpc.md), [`aws-sql-db-networking.md`](./aws-sql-db-networking.md).
>
> **Audience:** the project owner — learning project where AWS knowledge matters, but **not at the cost of paying for AWS to do things badly**. Open to external services for parts where AWS has no free option.

---

## 0. Story so far

| Phase | Stack | Cost | Notes |
| ----- | ----- | ---- | ----- |
| v1 | Lambda + DynamoDB + Amplify + Cognito | **$0** | DynamoDB free tier is permanent. |
| v2 (now) | Lambda + Aurora Serverless v2 + Amplify + Cognito + VPC | **~$7/mo** | SQL migration cost ~$7/mo for Aurora floor. |
| v3 | TBD: server-feel backend + Postgres, near-free | ? | This doc. |

---

## 1. Constraints — locked in

1. **Postgres**, same engine local and cloud.
2. **Server-feel backend** — long-running process listening on `:3000`, containerized, deployed like a real service. **Lambda is out.**
3. **≤ $3/month after Free Tier expires.** Strict.
4. **Stay on AWS where AWS has a viable free / cheap option.** Where it doesn't, use an external service rather than paying AWS to be expensive.
5. **Strong local dev parity** — `docker compose up` must give you the whole stack.
6. **FE stays on Amplify** (free for your traffic; see §3).
7. **Cognito stays** (free up to 50k MAU).
8. **Skip services that aren't AWS career-relevant or learning-rich**: App Runner, Elastic Beanstalk, Lightsail — explicitly rejected.

---

## 2. Three questions you asked, answered

### 2a. "Lambda makes local dev weird — what do I do?"

You're already not stuck. `main.py` builds a normal FastAPI `app`; `Mangum(app)` is only invoked when Lambda runs the file. Locally:

```bash
# Option 1 — what your docker-compose already does
docker compose up
# postgres :5432 + migrate + api :9000, all on a local Docker network

# Option 2 — uvicorn directly, no Docker for the API
docker compose up postgres -d
uv run uvicorn src.main:app --reload --port 9000
```

The FastAPI app doesn't know it's on Lambda at runtime. Routing, dependencies, DB code — identical between local and Lambda. **You can already curl `http://localhost:9000/recipes` and develop normally.**

The *real* downsides of Lambda (cold starts, 15-min execution cap, no background workers/websockets, slightly weird packaging, divergent behavior from local for things like file uploads) still apply — they're just not "can I test it locally."

If you ever specifically want to test the Lambda integration (rare — almost always overkill): `sam local start-api` from AWS SAM CLI emulates API Gateway → Lambda locally. You don't need this for normal development.

### 2b. "Amplify — will I pay cents? Run it locally?"

**Cost:** For your profile, no. Amplify Hosting free tier:
- 1,000 build minutes / month (a build ≈ 2 min → ~500 deploys/mo)
- 15 GB storage
- 100 GB data transfer out / month
- SSR compute: only billed if you use SSR, which your Next.js static export does not

A personal recipe app with friends/family traffic stays comfortably inside all of these. After 12 months → these numbers don't reset to zero (they're not "free tier"; they're permanent free included quota for the Hosting service).

**Local:** there is no "Amplify local." Amplify is just managed `git push` → CDN. Your *local* version of Amplify is just running Next.js:

```bash
cd frontend
npm run dev      # http://localhost:8080 (per your README)
```

Same code, same Cognito user pool. Only `NEXT_PUBLIC_API_URL` differs (point it at `http://localhost:9000` for local, the API URL for deployed). You can already do this.

### 2c. "How cheap can EC2 actually go?"

Approximate eu-west-3 (Paris) on-demand prices, after free tier expires:

| Instance | vCPU | RAM | On-demand | 1-yr Reserved | 3-yr Reserved |
| -------- | ---- | --- | --------- | ------------- | ------------- |
| `t4g.nano` | 2 burst | 0.5 GB | ~$3.07/mo | ~$1.95/mo | ~$1.30/mo |
| `t4g.micro` | 2 burst | 1.0 GB | ~$6.13/mo | ~$3.85/mo | ~$2.55/mo |

Add:
- **EBS gp3, 8 GB**: ~$0.64/mo
- **Elastic IP** (attached to running instance): **free**
- **Data transfer out**: 100 GB/mo free
- **Route 53 hosted zone** (optional): $0.50/mo

So **t4g.nano on-demand ≈ $3.70/mo all-in** for the backend host. With a 1-year RI: **~$2.60/mo**. Three-year RI: under $2/mo.

500 MB RAM is enough for a single FastAPI process serving low traffic, *if* Postgres lives elsewhere (Neon). It's tight if Postgres also runs on the box — then go `t4g.micro` (1 GB).

---

## 3. Database options (revised)

### 3a. Neon (Postgres, managed, off-AWS) — **new top pick**

- **Cost:** **$0 forever** on free tier. 0.5 GB storage, 190 compute hours/month (scale-to-zero between requests counts as 0). Branching, autosuspend, point-in-time restore included.
- **Pros:** Real Postgres. Free *permanently*, not 12-month free tier. Better dev ergonomics than RDS (branches per PR, instant provisioning). Connection pooling built-in (PgBouncer).
- **Cons:** Not AWS, so no CDK story for the DB. Connection latency: Neon US-East ↔ EC2 eu-west-3 ≈ 90 ms — you'd want a Neon region close to your EC2 (Neon has eu-central-1 = Frankfurt).
- **Verdict:** ✅ **Best fit under your new constraints.** Free forever, real Postgres, zero AWS friction-tax.

### 3b. RDS Postgres `db.t4g.micro` (AWS, Free Tier)

- **Cost:** $0 for 12 months. ~$13/mo after. **Blows the $3/mo budget post-FT.**
- **Pros:** Real RDS, real CDK story, in-AWS.
- **Cons:** Stops being cheap after a year.
- **Verdict:** Pick this only if learning RDS specifically outweighs the cost. Otherwise → Neon.

### 3c. Postgres in Docker on the same EC2 as the backend (AWS)

- **Cost:** $0 marginal — uses the EC2 you're already paying for. But you'd need `t4g.micro` (~$3-6/mo) instead of `t4g.nano` for the extra RAM.
- **Pros:** All on one box. `docker-compose.yml` in prod identical to local. Maximum dev/prod parity. Teaches Postgres-the-server.
- **Cons:** You own backups, upgrades, snapshots. One disk failure = data loss unless you script EBS snapshots (free, easy). No HA.
- **Verdict:** ✅ Strong "all-on-AWS" alternative if you want the learning surface of running Postgres yourself. Slightly more expensive than Neon+nano, comparable to Neon+micro.

### 3d. Aurora Serverless v2 (current)

- **Cost:** ~$5–7/mo idle floor (storage + Secrets Manager + KMS + CloudWatch). Doesn't go to zero.
- **Verdict:** ❌ Delete. Over-engineered, doesn't fit the budget, doesn't teach Postgres-the-server.

---

## 4. Backend hosting options

### 4a. EC2 `t4g.nano` or `t4g.micro` running docker-compose — **recommended**

- **Cost:** $0 for 12 months (Free Tier covers t3.micro / t2.micro; t4g sometimes; verify in console). After: $2-4/mo depending on size and reservation.
- **Pros:** The same `docker-compose.yml` that runs your local dev runs the production backend. Maximum dev/prod parity. You learn EC2, security groups, AMIs, systemd, NGINX/Caddy, ACM/Let's Encrypt, SSH-based deploys. Indistinguishable from how a small startup or a side project at a real company would do it.
- **Cons:** You own patching, restarts, log rotation, certificate renewal (automatic with Caddy/certbot, but yours to fix when it breaks).
- **Verdict:** ✅ Best fit.

### 4b. ECS on EC2 (single instance, no ALB)

- **Cost:** ECS control plane is free. EC2 underneath same as 4a (~$2-4/mo). If you add an Application Load Balancer for HTTPS, **+$16/mo** → kills the budget.
- **Pros:** You learn ECS task definitions, services, ECR, rolling deploys. More "modern AWS shape" than raw docker-compose.
- **Cons:** Without an ALB, your task gets a public IP that changes on every restart — you have to either keep restarting Route 53, or front it with NGINX-on-host (at which point you've reinvented Path 4a with extra YAML).
- **Verdict:** ⚠️ Tempting for learning but the cheap version is uglier than 4a. Pick only if you specifically want ECS on your CV.

### 4c. ECS Fargate

- **Cost:** No free tier. ~$8-15/mo minimum for one always-on task + ALB. Violates budget.
- **Verdict:** ❌ Park for later. Worth doing once for the learning, but not while you care about $3/mo.

### 4d. Lambda (current)

- **Cost:** Essentially free forever.
- **Pros:** Cheap.
- **Cons:** Not what you want — no long-running process feel, the deployment-target divergence makes the project feel "weird" even though local dev is fine.
- **Verdict:** ❌ Reject for the non-cost reasons you described.


---

## 5. Recommended architectures (pick one)

### Path A — **EC2 t4g.nano + Neon** ⭐ recommended

```
┌────────────────────────┐        ┌──────────────────┐
│ EC2 t4g.nano (eu-west) │  HTTPS │  Amplify (FE)    │
│   ├─ Caddy → :443      │◄───────┤  Next.js static  │
│   └─ FastAPI :9000     │        └──────────────────┘
└────────────┬───────────┘                  ▲
             │ TLS Postgres                  │ Cognito SDK
             ▼                               ▼
   ┌──────────────────┐              ┌──────────────┐
   │ Neon (Frankfurt) │              │   Cognito    │
   │  Postgres 16     │              │   (AWS)      │
   └──────────────────┘              └──────────────┘
```

- **Cost:** $0 for 12 months. After: ~$3.70/mo on-demand, ~$2.60/mo with 1-year RI. Neon stays free.
- **You learn:** EC2, security groups, EBS, SSH, systemd/Caddy/NGINX, Let's Encrypt, deploys via `git pull + docker compose up`, basic Linux ops. Plus how to wire a non-AWS data store into an AWS deployment.
- **Local dev:** `docker compose up` — postgres locally, identical Postgres in Neon for prod. No code changes between local and cloud beyond the DSN env var.
- **Trade-off accepted:** Postgres isn't on AWS. Connection hop EC2-Paris → Neon-Frankfurt is ~10 ms — negligible for a personal app.

### Path B — **EC2 t4g.micro hosting backend + Postgres in Docker**

```
┌────────────────────────────────────────┐    ┌──────────────────┐
│ EC2 t4g.micro                          │    │  Amplify (FE)    │
│   ├─ Caddy → :443                      │◄───┤  Next.js static  │
│   ├─ FastAPI :9000   (docker-compose)  │    └──────────────────┘
│   └─ Postgres :5432  (docker-compose)  │            ▲
└────────────────────────────────────────┘            │
        ▲                                             │ Cognito SDK
        │ daily EBS snapshot (free)                   ▼
        │                                       ┌──────────────┐
        ▼                                       │   Cognito    │
   AWS EBS snapshot                             └──────────────┘
```

- **Cost:** $0 for 12 months. After: ~$4.50/mo on-demand, ~$3/mo with 1-year RI.
- **You learn:** Everything in Path A *plus* Postgres-the-server: configuration, backups via `pg_dump` + EBS snapshots, restoring from snapshot, point-in-time recovery (manual), upgrade rollouts.
- **Local dev:** literally identical to prod (same docker-compose.yml runs in both).
- **Trade-off:** You own backups. Easy in practice (cron + `pg_dump` to S3, or EBS daily snapshot via Data Lifecycle Manager — both free for personal-scale).

### Path C — **EC2 + RDS** (drop later if budget tightens)

Same as Path A but with `db.t4g.micro` RDS instead of Neon. Free for 12 months, then ~$15/mo total. Park unless you specifically want RDS on your CV.

---

## 6. Comparison table

| | Path A (EC2 + Neon) | Path B (EC2 + Docker PG) | Path C (EC2 + RDS) | Current (Lambda + Aurora) |
| --- | --- | --- | --- | --- |
| Year-1 cost | $0 | $0 | $0 | ~$7/mo |
| Year-2 cost (on-demand) | ~$3.70 | ~$4.50 | ~$15 | ~$7 |
| Year-2 cost (1-yr RI) | ~$2.60 | ~$3 | ~$13 | ~$7 |
| Local-prod parity | Very high | **Identical** | Very high | Medium (Mangum gap) |
| Server-feel | ✅ | ✅ | ✅ | ❌ |
| AWS learning | EC2, networking, deploys, CI/CD | EC2 + Postgres ops | EC2 + RDS | API GW, Lambda, Aurora |
| Postgres learning | Just queries | **Full stack** | Just queries | Just queries |
| You own backups | No (Neon) | **Yes** | No (RDS) | No (Aurora) |
| All on AWS? | No (Neon external) | Yes | Yes | Yes |
| Best-practice flavor | Modern small-team | Classic "single box" | "Real product" mini | Serverless |

---

## 7. Why I'd pick Path A

Under your constraints ranked by your own stated priorities:

1. **≤ $3/mo after Free Tier** — A clears at ~$2.60/mo with RI. B at ~$3.00. C fails at ~$15.
2. **Server-feel backend** — A, B, C all deliver. Lambda doesn't.
3. **Best-practice over simple** — Neon + EC2 + Caddy + Cognito + Amplify is **how most modern small teams actually ship things**. Not toy. Not over-engineered.
4. **Learning** — A teaches: EC2, SSH-deploys, NGINX/Caddy, ACM/Certbot, Cognito wiring (already done), CDK refactor (delete Aurora, add EC2). B adds Postgres ops on top.
5. **Local parity** — both A and B nail this. A is "same Postgres image" parity, B is "literally the same docker-compose" parity.

Path A wins on cost. Path B wins on parity and Postgres learning. **If post-FT cost difference of <$1/mo matters → A. If you want to learn Postgres internals → B.** Both are correct answers.

---

## 8. Path A migration sketch (what would actually change)

### `infra/` (CDK)

| File | Change |
| ---- | ------ |
| `lib/infrastructure/aurora-stack.ts` | **Delete** |
| `lib/infrastructure/vpc-stack.ts` | **Delete** — EC2 can sit in default VPC, simpler |
| `lib/application/lambda-api-stack.ts` | **Delete** |
| `lib/application/ec2-backend-stack.ts` | **New** — Instance(t4g.nano), security group (22 from your IP, 443 anywhere), Elastic IP, UserData to install Docker + clone repo + pull secrets |
| `bin/infra.ts` | Update stack graph |

UserData script does:
1. `dnf install -y docker git`
2. Pull `.env` (with Neon DSN, Cognito IDs) from SSM Parameter Store or Secrets Manager
3. Clone the repo, `docker compose -f docker-compose.prod.yml up -d`
4. Install Caddy with auto-HTTPS configured for your domain

### Backend code

| File | Change |
| ---- | ------ |
| `backend/src/main.py` | Remove `handler = Mangum(app)` (or leave as dead code). |
| `backend/Dockerfile` | Already container-friendly — no changes needed. |
| `backend/scripts/seed.py` | Works as-is against Neon. |

### Frontend

| File | Change |
| ---- | ------ |
| `frontend/.env.local` and Amplify build env | Update `NEXT_PUBLIC_API_URL` to your EC2 / domain. |

### CI/CD (`.github/workflows/deploy.yml`)

- Replace "Deploy Lambda API Stack" step with:
  1. `cdk deploy Ec2BackendStack` (idempotent — only changes if infra changes)
  2. SSH into the EC2 (via OIDC + temporary credentials or an SSH key in secrets) and run `git pull && docker compose pull && docker compose up -d`
- Amplify build step stays.
- Cognito stack stays.

### Data migration

`pg_dump` Aurora → `pg_restore` into Neon. Or just re-run `seed.py` against Neon — the only real data is your 14 seed recipes; users get JIT-provisioned automatically (we already built that).

---

## 9. Path B-specific extras (if you go with Postgres on EC2)

You'll want:

- **Daily EBS snapshot via Data Lifecycle Manager** (free, scheduled, point-in-time recovery for the whole disk).
- **`pg_dump` to S3** weekly (cron + `awscli` + S3 free tier 5 GB) — protects against logical corruption (snapshots don't).
- **Tag the Postgres data volume separately** from the OS volume so you can rebuild the OS without touching data.

This is the "Postgres ops" curriculum — exactly the learning Path A skips.

---

## 10. Decision checklist before starting

- [ ] Verify in **AWS Cost Explorer → Services (last 30 days)** that your current bill matches the ~$7/mo guess. If something unexpected dominates, address that first.
- [ ] Confirm Free Tier status: was the AWS account opened <12 months ago? If yes, year-1 of EC2 is genuinely $0.
- [ ] Pick a region close to Neon if going Path A: **eu-west-3 (Paris) ↔ Neon eu-central-1 (Frankfurt)** is the right pairing (~10 ms).
- [ ] Decide on custom domain or live with raw EC2 DNS. (`api.<yourdomain>` → $0.50/mo Route 53 hosted zone, free ACM cert.)
- [ ] Caddy vs NGINX + certbot. Caddy = one-liner auto-HTTPS, easier. NGINX = more standard, better for the CV.
- [ ] One environment or staging+prod. **One is fine** for personal — but parameterize the CDK now so adding staging later is `cdk deploy StagingBackendStack`.

---

## 11. Cross-links

- [`platform-alternatives.md`](./platform-alternatives.md) — earlier DIY-AWS vs Vercel/Railway/Fly comparison.
- [`vpc-vs-no-vpc.md`](./vpc-vs-no-vpc.md) — why default VPC is fine for Path A/B.
- [`aws-sql-db-networking.md`](./aws-sql-db-networking.md) — how the current Lambda↔Aurora networking works (useful before deleting it).
- [`../plans/improvement-plan.md`](../plans/improvement-plan.md) — Phase 2 (restaurant reviews) fits any of these paths.
