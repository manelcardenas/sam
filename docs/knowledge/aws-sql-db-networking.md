# SQL Databases + AWS Compute — Networking, Costs & Options

> **What this doc covers:** Why Aurora needs a public IP when paired with Lambda, and a full
> breakdown of the 3 networking options for each AWS compute type (Lambda, ECS/EC2, ECS/Fargate)
> combined with each DB type (Aurora Serverless v2, RDS PostgreSQL provisioned).

---

## The core tension

Every SQL database on AWS (Aurora, RDS) lives inside a **VPC** — AWS mandates this.
Compute services have different defaults:

| Compute | Lives in VPC by default? | Can reach VPC-private resources? |
|---|---|---|
| Lambda | **No** — runs in AWS-managed infrastructure outside any VPC | Only if you opt-in (adds cost/complexity) |
| ECS on EC2 | **Yes** — EC2 instances are always in a subnet | Yes, natively |
| ECS on Fargate | **Yes** — Fargate tasks are always in a subnet | Yes, natively |

This asymmetry is why Lambda + SQL is always more complex and more expensive than Lambda + DynamoDB.
DynamoDB has a public HTTPS endpoint and needs no VPC plumbing.
Aurora and RDS do not.

---

## Why Aurora needs a public IP for Lambda (and the 2024 pricing change)

Lambda (default config) runs outside your VPC. It can reach any public internet endpoint but
cannot reach private IP addresses inside your VPC.

Aurora lives inside your VPC. Its endpoint resolves to a **private IP** inside your subnets.
Lambda cannot route to private IPs — there is no path.

To allow Lambda to connect, you have two options:
1. **Give Aurora a public IP** (`publiclyAccessible: true`) so Lambda can reach it over the internet
2. **Put Lambda inside your VPC** so it shares the same private network as Aurora

Option 1 was effectively free before February 2024. In February 2024, **AWS started charging
$0.005/hour (~$3.65/month) for every public IPv4 address** — including public RDS/Aurora endpoints.
This made the "public Aurora + Lambda outside VPC" pattern visibly costly in a way it wasn't before.

```
Before Feb 2024:
  Lambda ──(internet)──▶ Aurora public IP   →  $0 for the IP

After Feb 2024:
  Lambda ──(internet)──▶ Aurora public IP   →  $3.65/month per IP
```

Aurora with 2 Availability Zones gets **2 public IPs** (one per AZ subnet) → up to $7.30/month
just for the IP addresses, before any compute charges.

---

## The 3 options (applied to every compute type)

These 3 networking patterns apply regardless of whether you use Lambda, ECS/EC2, or ECS/Fargate.
The costs and trade-offs differ per compute type but the patterns are the same.

### Option A — Public DB endpoint, compute connects over internet

```
┌─────────────────────────────────────────────────┐
│  VPC                                            │
│  ┌──────────────────────────────────────────┐   │
│  │  Public subnet                           │   │
│  │  ┌─────────────────────────────────────┐ │   │
│  │  │  Aurora / RDS                       │ │   │
│  │  │  publiclyAccessible: true           │ │   │
│  │  │  Public IP: $$                      │ │   │
│  │  └─────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
           ▲
           │  TCP 5432 (internet)
           │
    [Your compute] — Lambda / Fargate task / EC2
         (outside VPC or in a public subnet)
```

**Security model:** password is the only guard (no network boundary). Mitigated by strong
auto-generated passwords (32+ chars, Secrets Manager) and SSL (Aurora default).

**Cost driver:** public IPv4 per AZ ($3.65–7.30/month fixed, regardless of usage).

### Option B — Private DB, compute inside VPC, NAT Gateway for internet access

```
┌─────────────────────────────────────────────────────────────────┐
│  VPC                                                            │
│                                                                 │
│  ┌──────────────────────┐    ┌──────────────────────────────┐  │
│  │  Private subnet      │    │  Isolated subnet             │  │
│  │                      │    │                              │  │
│  │  [Compute]           │───▶│  Aurora / RDS (private IP)   │  │
│  │  Lambda / ECS task   │    │  publiclyAccessible: false   │  │
│  └──────────────────────┘    └──────────────────────────────┘  │
│            │                                                    │
│            ▼                                                    │
│  ┌──────────────────────┐                                       │
│  │  NAT Gateway         │  ← $35/month fixed                   │
│  └──────────────────────┘                                       │
│            │                                                    │
└────────────┼────────────────────────────────────────────────────┘
             ▼
         Internet (for Lambda logs, AWS APIs, etc.)
```

**Security model:** DB is not reachable from the internet at all. Network isolation is the primary
defense. Industry-standard for production.

**Cost driver:** NAT Gateway (~$35/month fixed per AZ, regardless of traffic) + data processing
($0.048/GB). No public IP cost for the DB.

### Option C — Private DB, compute inside VPC, RDS Proxy

```
┌─────────────────────────────────────────────────────────────────┐
│  VPC                                                            │
│                                                                 │
│  ┌──────────────────────┐    ┌──────────────┐    ┌──────────┐  │
│  │  [Compute]           │───▶│  RDS Proxy   │───▶│  DB      │  │
│  │  Lambda / ECS task   │    │  (pooling)   │    │ (private)│  │
│  └──────────────────────┘    └──────────────┘    └──────────┘  │
│            │                                                    │
│            ▼ NAT Gateway ($35/month)                           │
└────────────────────────────────────────────────────────────────┘
```

**What RDS Proxy adds:** a connection pool between your compute and the DB. Compute makes many
short-lived connections to the proxy; the proxy maintains a smaller set of long-lived connections
to the DB. Critical for Lambda at scale — 1000 concurrent Lambda invocations would otherwise try
to open 1000 simultaneous DB connections, exhausting the DB's limit.

**Cost driver:** NAT Gateway (~$35/month) + RDS Proxy (~$0.015/vCPU-hour, min 2 vCPUs = ~$22/month).

---

## Compute type 1: Lambda

### Characteristics relevant to DB connectivity

- Runs **outside any VPC by default** — this is the source of all complexity
- Each invocation is independent — no shared state between calls
- Connection pattern: **open → query → close** (NullPool is required; a connection pool is useless
  because Lambda containers don't share memory)
- Concurrency: each Lambda invocation gets its own container — 1000 concurrent requests = 1000
  containers, each wanting a DB connection
- Cold start: Lambda outside VPC = fast (~100ms); Lambda inside VPC = slower (~300–600ms for ENI
  attachment on first invocation)

### Option A — Aurora/RDS public + Lambda outside VPC

```
Lambda (no VPC config)
    │
    │  TCP 5432 over internet
    ▼
Aurora / RDS  (publiclyAccessible: true, public subnet)
```

| | |
|---|---|
| Fixed monthly cost | ~$3.65–7.30 (public IPv4, 1–2 AZs) |
| Variable cost | ACU-hours or instance hours |
| Security | Medium — password-only, endpoint publicly discoverable |
| Cold start impact | None — Lambda stays outside VPC |
| Connection behaviour | 1 connection per invocation, closed immediately (NullPool) |
| When to use | Personal projects, dev/staging, low-security data |
| When NOT to use | Regulated data (HIPAA/PCI), production with real users |

**Current project setup.** Cost: ~$7–13/month (IP + compute).

---

### Option B — Aurora/RDS private + Lambda inside VPC + NAT Gateway

```
Lambda (VPC config: private subnet)
    │
    │  Via private IP
    ▼
Aurora / RDS (isolated subnet, publiclyAccessible: false)

Lambda → internet:  Lambda private subnet → NAT Gateway → Internet Gateway
```

| | |
|---|---|
| Fixed monthly cost | ~$35 (NAT Gateway) |
| Variable cost | ACU-hours or instance hours + NAT data ($0.048/GB) |
| Security | High — DB unreachable from internet |
| Cold start impact | +200–500ms on first invocation (ENI creation in VPC) |
| Connection behaviour | Same NullPool pattern — closing connection returns it to nothing |
| When to use | Production, compliance requirements, multi-team environments |
| When NOT to use | Personal projects or solo dev — NAT cost is disproportionate |

**Total fixed cost: ~$35/month** — worse than Option A for low-traffic personal use.

---

### Option C — Aurora/RDS private + Lambda inside VPC + RDS Proxy

```
Lambda (VPC config: private subnet)
    │
    ▼
RDS Proxy (private endpoint, same VPC)
    │
    ▼
Aurora / RDS (isolated subnet)

Lambda → internet: Lambda private subnet → NAT Gateway → Internet Gateway
```

| | |
|---|---|
| Fixed monthly cost | ~$35 (NAT) + ~$22 (RDS Proxy) = ~$57/month |
| Variable cost | ACU-hours or instance hours |
| Security | High — same as Option B, plus IAM auth via proxy |
| Cold start impact | Same as Option B |
| Connection behaviour | Lambda connects to proxy (fast); proxy pools to DB (efficient) |
| Concurrency ceiling | Proxy eliminates the "1000 Lambda = 1000 DB connections" problem |
| When to use | High-concurrency Lambda (>100 simultaneous invocations hitting DB) |
| When NOT to use | Low-traffic or personal projects — $57/month fixed is expensive |

**Total fixed cost: ~$57/month.** Only justified at significant scale.

---

### Lambda — Aurora Serverless v2 vs RDS PostgreSQL

| | Aurora Serverless v2 | RDS PostgreSQL (provisioned) |
|---|---|---|
| Billing model | Per ACU-hour when active; $0 compute when fully idle | Per hour, always-on (24/7 billing) |
| Minimum cost (no traffic) | Storage only (~$0.01/month) | db.t4g.micro: ~$13/month always |
| Free tier | None | 750 hrs/month for 12 months (new accounts) |
| Cold start after idle | 30–60s first query after long idle | None — always warm |
| Connection limit | ~1000 (at 2 ACU) | ~87 (db.t4g.micro) — hits ceiling quickly with Lambda |
| Max storage | 128 TB | 64 TB |
| RDS Proxy compatible | Yes | Yes |
| Best for Lambda | Sporadic/dev traffic — pay only when used | Steady traffic — predictable cost matters more than cold start |

> **Summary for Lambda:** Aurora Serverless v2 is cheaper for personal projects with sporadic
> usage. RDS provisioned is cheaper for consistent traffic because the per-invocation ACU cost
> adds up. Use RDS Proxy with either if you have high concurrency.

---

## Compute type 2: ECS on EC2

### Characteristics relevant to DB connectivity

- EC2 instances **always live inside a VPC** — no outside-VPC concept
- Long-running processes — can maintain a **persistent connection pool** (unlike Lambda)
- SQLAlchemy pool, pgBouncer, or application-level pooling all make sense here
- EC2 instances have stable IPs → DB security groups can whitelist by SG, not by IP

### Option A — EC2 in public subnet + DB public

```
┌──────────────────────────────────────────────────────┐
│  VPC                                                 │
│  ┌────────────────────────────────────────────────┐  │
│  │  Public subnet                                 │  │
│  │  ┌─────────────────┐    ┌─────────────────┐   │  │
│  │  │  EC2 instance   │───▶│  Aurora / RDS   │   │  │
│  │  │  (public IP)    │    │  (public IP)    │   │  │
│  │  └─────────────────┘    └─────────────────┘   │  │
│  └────────────────────────────────────────────────┘  │
│            │                                         │
│            ▼  Internet Gateway (direct internet)     │
└──────────────────────────────────────────────────────┘
```

| | |
|---|---|
| Fixed monthly cost | EC2 instance + 2× public IPv4 ($7.30) |
| Security | Low — both compute and DB are publicly exposed |
| Connection behaviour | Persistent pool maintained in ECS task (efficient) |
| When to use | Never in production — dev/test only if at all |

---

### Option B — EC2 in private subnet + DB in isolated subnet + NAT Gateway

```
┌──────────────────────────────────────────────────────────────┐
│  VPC                                                         │
│  ┌─────────────────────┐    ┌─────────────────────────────┐  │
│  │  Public subnet      │    │  Private subnet             │  │
│  │  ┌───────────────┐  │    │  ┌─────────────────────┐   │  │
│  │  │  NAT Gateway  │  │    │  │  EC2 / ECS task     │   │  │
│  │  │  ($35/month)  │  │    │  └─────────────────────┘   │  │
│  │  └───────────────┘  │    └─────────────────────────────┘  │
│  └─────────────────────┘                  │                  │
│                                           ▼                  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Isolated subnet (no internet in or out)             │    │
│  │  ┌─────────────────────────────────────────────┐     │    │
│  │  │  Aurora / RDS  (private IP only)            │     │    │
│  │  └─────────────────────────────────────────────┘     │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

| | |
|---|---|
| Fixed monthly cost | EC2 instance + NAT Gateway (~$35) |
| Security | High — DB completely unreachable from internet |
| Connection behaviour | Persistent pool from ECS task to DB (optimal) |
| When to use | Standard production workload — this is the industry default |

**Most common setup for ECS/EC2 in production.** The NAT Gateway cost is justified because ECS
has persistent workloads — unlike Lambda, you're already paying for the EC2 24/7, so $35 extra
for proper security is proportionally small.

---

### Option C — EC2 in private subnet + DB + RDS Proxy

```
EC2 / ECS tasks (private subnet)
    │
    ▼
RDS Proxy (private endpoint)
    │
    ▼
Aurora / RDS (isolated subnet)
```

| | |
|---|---|
| Fixed monthly cost | EC2 + NAT (~$35) + RDS Proxy (~$22) |
| Security | High + IAM auth enforced at proxy level |
| Connection behaviour | Multiple ECS tasks share proxy pool → DB sees few connections |
| When to use | Many ECS tasks / high concurrency exhausting DB connection limit |
| When NOT to use | Single ECS service with moderate load — proxy adds latency (~1ms) |

**For ECS/EC2, RDS Proxy is less often needed** because EC2 tasks are long-running and can
maintain their own connection pools efficiently. It becomes relevant when you have many replicas
of an ECS service all holding connections simultaneously.

---

### ECS/EC2 — Aurora Serverless v2 vs RDS PostgreSQL

| | Aurora Serverless v2 | RDS PostgreSQL (provisioned) |
|---|---|---|
| Billing model | Per ACU-hour | Per hour always-on |
| Cost at steady traffic | Higher than provisioned (ACU-hours add up) | Predictable flat rate |
| Cost at idle | ~$0 compute | Full instance cost (you're paying anyway) |
| Scaling | Automatic (no ops) | Manual (change instance type, downtime) |
| Connection limits | ~1000 at 2 ACU | Instance-dependent (db.t4g.large: ~858) |
| Best for ECS | Apps with highly variable traffic (peaks and troughs) | Apps with steady load — RDS provisioned is cheaper per-hour at sustained use |

> **Summary for ECS/EC2:** RDS provisioned is usually the better fit. ECS tasks run 24/7 and
> generate steady DB load — Aurora Serverless v2's per-ACU pricing ends up more expensive than
> a correctly-sized RDS instance at sustained use. Use Aurora Serverless v2 for ECS only if
> your traffic is highly spiky (e.g., batch jobs that run once a day).

---

## Compute type 3: ECS on Fargate

### Characteristics relevant to DB connectivity

- Fargate tasks live inside a VPC (like EC2), but AWS manages the underlying hardware
- Unlike EC2, you **don't have a persistent host** — tasks start/stop as you scale
- Like Lambda in some ways (task start = similar to a cold start) but tasks are longer-lived
- A running Fargate task CAN maintain a persistent DB connection pool for its lifetime
- The Fargate task itself can optionally get a public IP (`assignPublicIp: true`) in a public subnet

### Option A — Fargate in public subnet (assignPublicIp: true) + DB public

```
┌──────────────────────────────────────────────────────┐
│  VPC                                                 │
│  ┌────────────────────────────────────────────────┐  │
│  │  Public subnet                                 │  │
│  │  ┌─────────────────┐    ┌─────────────────┐   │  │
│  │  │  Fargate task   │───▶│  Aurora / RDS   │   │  │
│  │  │  (public IP     │    │  (public IP)    │   │  │
│  │  │  per task!) $$  │    └─────────────────┘   │  │
│  │  └─────────────────┘                          │  │
│  └────────────────────────────────────────────────┘  │
│            │  Internet Gateway (direct access)        │
└──────────────────────────────────────────────────────┘
```

| | |
|---|---|
| Fixed monthly cost | N × $3.65 (one public IP per running Fargate task) + DB public IP |
| Security | Low — both compute and DB publicly reachable |
| Works without NAT | Yes — public IP provides direct internet access |
| Scales badly | 10 Fargate tasks = 10 public IPs = $36.50/month just for IPs |
| When to use | Single-task dev setup only |

> **The "Fargate public IP" trick** is similar to the Lambda + Aurora public pattern — it
> avoids NAT Gateway cost. But unlike Lambda (short-lived, 1 IP for thousands of invocations),
> Fargate tasks each get their own IP for their entire running lifetime. At any real scale,
> per-task IP cost exceeds the NAT Gateway cost it was meant to avoid.

---

### Option B — Fargate in private subnet + DB private + NAT Gateway

```
┌──────────────────────────────────────────────────────────────┐
│  VPC                                                         │
│  ┌──────────────────────┐    ┌──────────────────────────┐   │
│  │  Public subnet       │    │  Private subnet          │   │
│  │  ┌────────────────┐  │    │  ┌────────────────────┐  │   │
│  │  │  NAT Gateway   │  │    │  │  Fargate tasks     │  │   │
│  │  │  ($35/month)   │◀─┼────┼──│  (no public IP)    │  │   │
│  │  └────────────────┘  │    │  └────────────────────┘  │   │
│  └──────────────────────┘    └──────────────────────────┘   │
│                                          │                   │
│  ┌───────────────────────────────────────┼─────────────┐    │
│  │  Isolated subnet                      ▼             │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │  Aurora / RDS  (private)                    │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

| | |
|---|---|
| Fixed monthly cost | Fargate compute + NAT Gateway (~$35) |
| Security | High — DB unreachable from internet |
| Connection behaviour | Persistent pool per Fargate task for its lifetime |
| When to use | Standard production Fargate setup — this is the default |
| Note | One NAT Gateway covers all tasks — unlike per-task public IP, doesn't scale with task count |

**This is the standard production Fargate setup.** The NAT Gateway is a fixed cost shared across
all tasks — 1 task or 100 tasks, same $35/month. Much better value than Option A at scale.

---

### Option C — Fargate private + DB private + RDS Proxy

```
Fargate tasks (private subnet, many replicas)
    │
    ▼
RDS Proxy  (manages pooling for all tasks combined)
    │
    ▼
Aurora / RDS (isolated subnet)
```

| | |
|---|---|
| Fixed monthly cost | Fargate + NAT (~$35) + RDS Proxy (~$22) |
| Security | High + IAM auth at proxy |
| Connection behaviour | All Fargate replicas share a single proxy pool — DB sees constant load |
| When to use | Fargate service with auto-scaling (10–100+ tasks) all hitting the same DB |
| When NOT to use | Small service with 1–3 tasks — proxy overhead isn't worth it |

---

### ECS/Fargate — Aurora Serverless v2 vs RDS PostgreSQL

| | Aurora Serverless v2 | RDS PostgreSQL (provisioned) |
|---|---|---|
| Billing model | Per ACU-hour | Per hour always-on |
| Scales with Fargate auto-scaling | Yes — DB scales up as more tasks add load | No — you pre-provision for peak |
| Cost at steady traffic | Comparable or higher than provisioned | Cheaper at sustained load |
| Operational overhead | Zero — fully managed, auto-scales | Some — right-size the instance |
| Best for Fargate | Services with variable load, aligned with Fargate's own auto-scaling | Services with predictable load |

> **Summary for ECS/Fargate:** Fargate and Aurora Serverless v2 pair well architecturally —
> both auto-scale, both have no persistent infrastructure to manage. For personal projects or
> variable-load apps, this is a natural fit. For steady traffic, a provisioned RDS instance
> is cheaper.

---

## Full comparison matrix

### Fixed costs per option

| Compute | Option A (public) | Option B (private + NAT) | Option C (private + NAT + Proxy) |
|---|---|---|---|
| Lambda | $3.65–7.30 (IPs) | ~$35 (NAT) | ~$57 (NAT + Proxy) |
| ECS/EC2 | $7.30 (2 IPs) | ~$35 (NAT) | ~$57 (NAT + Proxy) |
| ECS/Fargate | $3.65 × N tasks (per-task IP!) | ~$35 (NAT, shared) | ~$57 (NAT + Proxy) |

### DB costs (on top of fixed costs above)

| DB type | Cost at zero traffic | Cost at light use | Free tier |
|---|---|---|---|
| Aurora Serverless v2 | ~$0.01/month (storage only) | ~$1–5/month (sporadic ACU) | None |
| RDS PostgreSQL db.t4g.micro | ~$13/month (always-on) | ~$13/month | 750 hrs/month for 12 months |
| RDS PostgreSQL db.t3.small | ~$30/month (always-on) | ~$30/month | None |

### Security posture

| Option | DB reachable from internet? | Auth mechanism |
|---|---|---|
| A (public) | Yes | Password (+ SSL) |
| B (private + NAT) | No | VPC network isolation |
| C (private + Proxy) | No | VPC isolation + IAM authentication |

### When to use each option

| Scenario | Recommended |
|---|---|
| Personal project, learning, no sensitive data | **Option A** — cheapest, simplest |
| Startup MVP, moderate traffic, single service | **Option B** — standard, NAT cost amortised |
| High-concurrency Lambda (>100 simultaneous) | **Option C** — proxy prevents connection exhaustion |
| Regulated data (HIPAA, PCI, financial) | **Option B or C** — private subnet is required |
| Many Fargate replicas auto-scaling | **Option C** — proxy prevents DB connection storm |
| Cost is paramount (personal/side project) | **Option A or replace DB with Neon/Supabase** |

---

## Quick reference: this project's current setup

```
Compute:   Lambda (outside VPC)
DB:        Aurora Serverless v2  →  Option A (public)
Cost:      ~$3.65 public IP + ~$3 ACU + $0.40 Secrets Manager = ~$7/month
```

To reach true $0: replace Aurora (Option A) with **Neon** (free tier) or **Supabase** (free tier).
Both accept the same psycopg2/SQLAlchemy connection string. The VpcStack and AuroraStack CDK stacks
can be deleted entirely. Lambda stays exactly as-is.
