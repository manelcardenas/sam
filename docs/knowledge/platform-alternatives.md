# Platform Alternatives — Personal Project Infrastructure Comparison

> **Context:** This project uses AWS (Lambda + Amplify + Cognito + Aurora + VPC) to learn IaC with CDK.
> The goal is understanding the trade-offs between a DIY AWS setup and modern managed platforms — and
> why the current architecture has costs that the original DynamoDB setup did not.

---

## 1. Why the current setup is not fully free

### The original setup (free)

```
Lambda  →  DynamoDB
Amplify (static)
Cognito
```

- **DynamoDB free tier:** 25 RCU + 25 WCU + 25GB storage — permanently free for personal use
- **Lambda free tier:** 1M requests/month + 400,000 GB-s compute — permanently free
- **Cognito free tier:** 10,000 MAU — permanently free
- **Amplify static hosting:** 15GB storage + 5GB transfer/month — free
- **No VPC needed:** Lambda connects to DynamoDB over a public AWS endpoint

Result: **$0/month, genuinely.**

---

### The current setup (Aurora + VPC)

```
Lambda (no VPC)  →  Aurora Serverless v2 (public subnet)
Amplify (static)
Cognito
VPC (minimal: public subnets only, no NAT Gateway)
Secrets Manager
```

| Resource | Monthly cost | Notes |
|---|---|---|
| VPC | **$0** | Public subnets only, internet gateway is free |
| Aurora Serverless v2 storage | **~$0.01–0.10** | $0.10/GB/month — minimal for a small DB |
| Aurora Serverless v2 compute | **~$0** | $0.06/ACU-hour; scales to 0 ACU when idle — `minCapacity: 0` is already set in this project |
| Aurora backup storage | **~$0.001** | $0.021/GB/month on a near-empty DB |
| Secrets Manager | **$0.40/secret** | No free tier. **Fix: replace with SSM Parameter Store SecureString** |
| Lambda | **$0** | Well within free tier |
| API Gateway | **$0** (year 1) | 1M calls/month free for first 12 months; $3.50/M after |
| Cognito | **$0** | Under 10K MAU |
| Amplify | **$0** | Within free tier |

**Total: ~$0.40/month** (Secrets Manager only), versus the previous **$0/month**.

The VPC is free. Aurora compute is free when idle (NullPool pattern + Lambda means connections are
closed between invocations → Aurora scales to 0 ACU). Aurora storage on a near-empty personal DB
is < $0.01/month. The only meaningful fixed cost is **Secrets Manager at $0.40/secret/month** —
there is no free tier. Replace with SSM Parameter Store SecureString to eliminate this.

---

### Why Aurora needs a VPC at all — and why DynamoDB did not

DynamoDB is a managed service with a public HTTPS endpoint (`dynamodb.eu-west-3.amazonaws.com`).
Lambda calls it like a REST API over HTTPS — no special network plumbing. This is why the original
setup needed no VPC and cost $0.

Aurora is a relational database engine that AWS physically runs inside isolated server infrastructure.
AWS mandates that all Aurora clusters live inside a VPC — this is not a configuration choice, it is
an architecture constraint. You cannot deploy Aurora outside a VPC.

Setting `publiclyAccessible: true` in this project makes the Aurora cluster reachable from the
public internet (it gets a public DNS hostname), so Lambda running *outside* the VPC can connect
over TCP 5432. This eliminates the NAT Gateway (~$35/month) that would otherwise be needed if both
Lambda and Aurora were inside private subnets.

The VPC cost in this project is therefore **$0** — public subnets and an internet gateway are free.

### Why Aurora compute is also ~$0 (with the current setup)

The NullPool pattern in this project (`engine.py`) closes every database connection at the end of
each Lambda invocation. Between Lambda invocations there are no open connections. Aurora Serverless
v2 with `minCapacity: 0` detects this and scales to 0 ACU after a few minutes of inactivity.

At 0 ACU: Aurora charges **$0 for compute**. You only pay storage ($0.10/GB/month).

This is the same approach used in any production-grade Lambda+Aurora setup. The only unavoidable
cost is storage — there is no free tier for Aurora storage the way there is for DynamoDB capacity.

---

## 2. Alternative databases (keeping Lambda + Amplify + Cognito)

If the goal is to keep using AWS for compute and auth but eliminate Aurora's cost, the most
pragmatic path is replacing Aurora with an external serverless PostgreSQL provider.

Lambda outside the VPC can connect to these services exactly the same way it connected to Aurora
(TCP 5432 over the internet), so no VPC is needed at all.

### Neon — serverless PostgreSQL

| Property | Value |
|---|---|
| Free tier | 0.5 GB storage, compute pauses to 0 when idle |
| Pricing model | Per-compute-second when active (truly serverless) |
| PostgreSQL version | Latest stable (v16+) |
| Connection | Standard TCP 5432 endpoint |
| DX | Branching (like Git for databases), instant provisioning |
| Verdict | **Best drop-in replacement for Aurora in this project** |

Neon's free tier pauses compute automatically after inactivity — identical behaviour to Aurora 0 ACU
but without the VPC requirement and with a more predictable free tier.

Migration from Aurora: change `POSTGRES_HOST/USER/PASSWORD` env vars. No code changes needed.
The VpcStack and AuroraStack CDK stacks can be deleted entirely.

### Supabase — PostgreSQL + batteries included

| Property | Value |
|---|---|
| Free tier | 500 MB storage, 50 MB file storage, pauses after 7 days inactive |
| Extras | Auth, Storage, Realtime, Edge Functions, auto-generated REST API |
| PostgreSQL version | v15 |
| DX | Excellent dashboard, table editor, SQL editor |
| Verdict | Worth considering if you want to replace Cognito too |

Supabase free tier projects pause after 1 week of inactivity (you resume manually from the
dashboard or via API). For a personal project checked regularly this is not an issue.

### CockroachDB Serverless — PostgreSQL-compatible

| Property | Value |
|---|---|
| Free tier | 10 GB storage, 50M request units/month |
| PostgreSQL version | CockroachDB dialect (99% compatible) |
| Notes | Multi-region by default; may be overkill for a personal project |
| Verdict | Good free tier but CockroachDB dialect differences can surprise |

### Turso — SQLite on the edge

| Property | Value |
|---|---|
| Free tier | 9 GB storage, 1B row reads/month, 25M row writes/month |
| Model | libSQL (SQLite fork), edge-native |
| Notes | Not PostgreSQL — requires `libsql` driver, not `psycopg2` |
| Verdict | Excellent for edge workers; not a natural fit for this FastAPI/SQLAlchemy stack |

---

## 3. Full-platform alternatives (replacing most of the AWS stack)

These are "state of the art" managed platforms commonly used for personal and startup projects.
Each provides opinionated defaults that trade learning depth for speed and zero cost.

---

### Option A: Vercel + Supabase (most popular stack, 2024–2025)

```
Frontend + API:  Vercel (Next.js SSR/static + API Routes)
Database + Auth: Supabase (PostgreSQL + Auth + Storage)
```

| Layer | Service | Free tier |
|---|---|---|
| Frontend | Vercel | Unlimited projects, 100 GB bandwidth/month, preview deployments |
| Backend | Vercel Functions (API Routes) | Included in Vercel free tier; 10s max execution |
| Database | Supabase | 500 MB PostgreSQL, pauses after 7 days inactive |
| Auth | Supabase Auth | Included — email/password, magic link, OAuth providers |

**Pros:**
- Vercel is made by the Next.js team — the DX is unmatched for Next.js projects
- Supabase provides a full backend: auto-generated REST API, Realtime subscriptions, Row-Level Security
- Preview deployments on every PR branch
- CI/CD is automatic: push to GitHub → deploys

**Cons:**
- Vercel API Routes have a 10s execution limit on the free plan (not an issue for CRUD)
- Supabase project pauses after 1 week inactive (manual resume required on free plan)
- You learn less IaC/cloud internals — the platforms abstract everything away
- Supabase Auth is less battle-tested than Cognito for enterprise features (MFA, SAML, etc.)

**Learning value vs this project:** Supabase is worth trying as a side experiment. The Row-Level
Security (Postgres policies) and auto-generated PostgREST API are genuinely useful patterns.

---

### Option B: Cloudflare Pages + Workers + D1 or Neon (edge-first stack)

```
Frontend:  Cloudflare Pages
Backend:   Cloudflare Workers (edge functions, V8 isolates)
Database:  Cloudflare D1 (SQLite) or Neon (PostgreSQL)
Auth:      Clerk or Supabase Auth
```

| Layer | Service | Free tier |
|---|---|---|
| Frontend | Cloudflare Pages | Unlimited sites, unlimited bandwidth, 500 builds/month |
| Backend | Cloudflare Workers | 100K requests/day, 10ms CPU per request |
| Database | Cloudflare D1 | 5 GB storage, 5M row reads/day, 100K row writes/day |
| Auth | Clerk | 10K MAU, pre-built React components |

**Pros:**
- The most generous free tiers of any platform
- Workers run at the edge (Cloudflare's 300+ PoPs) — <50ms latency globally
- D1 is SQLite, which works fine for personal projects
- Zero cold starts (V8 isolates, not containers)

**Cons:**
- Workers runtime is a subset of Node.js — Python (FastAPI) is **not supported**
- D1 is SQLite, not PostgreSQL — schema differences; no `psycopg2` or SQLAlchemy support
- Cloudflare ecosystem is very different from AWS — learning curve for a different cloud
- Clerk is free but has a paid tier after 10K MAU

**Learning value:** Cloudflare Workers teaches edge computing and a very different execution model
from Lambda containers. Worth exploring if interested in the edge computing space.

---

### Option C: Firebase (Google BaaS)

```
Frontend:  Firebase Hosting or Vercel
Backend:   Cloud Functions for Firebase
Database:  Firestore (NoSQL) or Firebase Realtime Database
Auth:      Firebase Authentication
```

| Layer | Free tier (Spark plan) |
|---|---|
| Hosting | 10 GB storage, 360 MB/day transfer |
| Cloud Functions | 125K invocations/month, 40K GB-s |
| Firestore | 1 GB storage, 50K reads/day, 20K writes/day |
| Auth | Unlimited users, all sign-in methods |

**Pros:**
- Firebase Auth is battle-tested with excellent SDKs
- Firestore has a very generous free tier and offline-first client SDKs
- Tight Google ecosystem integration

**Cons:**
- Firestore is a NoSQL document store — no SQL, no JOINs, no Alembic migrations
- Cloud Functions cold starts can be slow (Python runtime)
- Firebase is proprietary — vendor lock-in is real
- The `firebase.json` / rules / indexes config is not IaC in the traditional sense

**Learning value:** Firebase is relevant for mobile-first apps. For a web app with a relational
data model (recipes, users, restaurants), Firestore's document model adds complexity.

---

### Option D: Railway — simple deployment platform

```
Frontend:  Railway (static) or Vercel
Backend:   Railway web service (any language/framework)
Database:  Railway PostgreSQL plugin
Auth:      Keep Cognito or add Clerk
```

| Property | Value |
|---|---|
| Free tier | $5 credit/month (not truly free, but negligible for personal use) |
| DX | `railway up` deploys from git; includes PostgreSQL, Redis, MySQL plugins |
| Database | Managed PostgreSQL — persistent, no pause/resume |
| Backend | Full containerized server — no execution time limits |

**Pros:**
- Supports persistent servers (no cold starts, no 10s limits)
- PostgreSQL never pauses — suitable if you want always-on DB
- Simple pricing model: pay per use, $5/month credit covers small personal projects

**Cons:**
- Not truly free — costs $1–5/month for sustained use
- Less learning value (no IaC, no CDK, no cloud-native patterns)
- Smaller ecosystem than AWS/Vercel

---

## 4. Comparison table

### Frontend

| Platform | Free bandwidth | CI/CD | SSR | Static | CDN | Best for |
|---|---|---|---|---|---|---|
| **AWS Amplify** | 5 GB/month | ✓ GitHub | ✗ (static only) | ✓ | ✓ | Learning AWS |
| **Vercel** | 100 GB/month | ✓ GitHub | ✓ | ✓ | ✓ | Next.js projects |
| **Cloudflare Pages** | Unlimited | ✓ GitHub | ✓ Workers | ✓ | ✓ | Edge / low latency |
| **Netlify** | 100 GB/month | ✓ GitHub | ✓ Functions | ✓ | ✓ | Jamstack sites |
| **GitHub Pages** | Unlimited | ✓ Actions | ✗ | ✓ | ✓ | Simple static sites |

### Backend

| Platform | Language | Free requests | Execution limit | Cold start | Best for |
|---|---|---|---|---|---|
| **AWS Lambda** | Any | 1M/month | 15 min | ~100ms–2s | Learning AWS, event-driven |
| **Vercel Functions** | Node/Python/Go/Ruby | 100GB bandwidth | 10s (free) | ~100ms | Next.js API routes |
| **Cloudflare Workers** | JS/TS (WASM) | 100K req/day | 10ms CPU | ~0ms (isolates) | Edge, low latency |
| **Supabase Edge Functions** | Deno (JS/TS) | 500K/month | 2s | ~50ms | Supabase-native logic |
| **Railway** | Any (Docker) | $5 credit/month | Unlimited | None (persistent) | Full-stack monolith |
| **Render** | Any (Docker) | Free (spins down) | Unlimited | ~30s (spin-up) | Simple web services |

### Database

| Platform | Engine | Free storage | Pauses when idle | Free tier limit | Best for |
|---|---|---|---|---|---|
| **DynamoDB** | NoSQL (key-value) | 25 GB | Never | 25 RCU/WCU | Original setup, scales to 0 |
| **Aurora Serverless v2** | PostgreSQL | — | 0 ACU (min) | No free tier | Learning RDS/Aurora |
| **Neon** | PostgreSQL | 0.5 GB | Yes (auto) | 1 project | PostgreSQL, serverless |
| **Supabase** | PostgreSQL | 500 MB | After 7 days | 1 active project | Full BaaS |
| **CockroachDB** | PostgreSQL-compat | 10 GB | No | 50M req units | Multi-region |
| **Turso** | SQLite (libSQL) | 9 GB | Yes (auto) | 500 databases | Edge SQLite |
| **MongoDB Atlas** | MongoDB | 512 MB | No | 1 M0 cluster | Document store |
| **Firestore** | NoSQL (document) | 1 GB | No | 50K reads/day | Real-time, offline-first |
| **PlanetScale** | MySQL | — | — | **No free tier** ❌ | — |

### Auth

| Platform | Free MAU | Social providers | MFA | JWT | Best for |
|---|---|---|---|---|---|
| **Cognito** | 10K | ✓ | ✓ | ✓ | Learning AWS IAM/JWT |
| **Supabase Auth** | Unlimited | ✓ | ✓ | ✓ | Supabase stack |
| **Clerk** | 10K | ✓ | ✓ | ✓ | Best DX, React components |
| **Auth0** | 7,500 | ✓ | ✓ | ✓ | Enterprise features |
| **Firebase Auth** | Unlimited | ✓ | ✓ | ✓ | Google ecosystem |
| **Better Auth** | Self-hosted | ✓ | ✓ | ✓ | Open source, no vendor lock |

---

## 5. Recommended paths

### Path 1: Stay on AWS, eliminate Aurora cost → replace with Neon

**Change:** Delete `vpc-stack.ts` and `aurora-stack.ts`, add Neon PostgreSQL.

```
Before: Lambda → Aurora (VPC, $0.50–5/month)
After:  Lambda → Neon (no VPC, $0/month)
```

- Keep everything learned (CDK, Lambda, Cognito, Amplify)
- Drop the VPC entirely
- Replace `POSTGRES_HOST/USER/PASSWORD` env vars with Neon connection string
- Same psycopg2/SQLAlchemy code, same Alembic migrations
- **Learning gained:** how to evaluate managed DB services vs AWS-native services

### Path 2: Full rewrite with Vercel + Supabase

**Change:** Move frontend + backend to Vercel, replace Cognito + Aurora with Supabase.

```
Before: Amplify + Lambda + Cognito + Aurora
After:  Vercel (Next.js API routes) + Supabase (DB + Auth)
```

- Simplest modern stack for a Next.js project
- Zero IaC, zero DevOps — not the goal of this project, but useful to know
- **Learning gained:** the developer experience of a "zero config" modern stack

### Path 3: Keep current AWS setup as-is

**Why this is valid:** Aurora Serverless v2 with `minCapacity: 0` genuinely scales to near zero.
The cost for a personal project with light traffic is $0.50–2/month — acceptable for the learning
value. The VPC cost is $0.

The main thing to watch: make sure the `minCapacity: 0` setting is active (available since AWS
released "Aurora Serverless v2 zero ACU" support), and check if Secrets Manager ($0.40/secret)
can be replaced with SSM Parameter Store SecureString ($0.05/parameter/10K API calls) to save
a few cents.

---

## 6. Summary

The original DynamoDB setup was free because DynamoDB has a permanent free tier and needs no VPC.
The Aurora migration introduced costs (~$0.50–5/month) because:
1. Aurora Serverless v2 charges for storage even when idle
2. Aurora Serverless v2 charges per ACU-hour when active
3. Secrets Manager adds $0.40/secret/month

The VPC itself costs nothing in this project (no NAT Gateway, no VPN, only public subnets).

For a personal learning project in 2025, the "state of the art" zero-cost stack is:
- **Vercel** (frontend + serverless functions) + **Supabase** (PostgreSQL + auth)
- Or **Cloudflare Pages + Workers + D1** if interested in edge computing

The AWS stack built here trades cost-optimality for **cloud engineering knowledge** — CDK, IAM,
VPC networking, Aurora Serverless, Cognito OAuth flows. That knowledge transfers to real production
environments where these services are industry-standard choices.
