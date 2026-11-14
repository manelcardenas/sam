# Frontend Deployment: Vercel

The web app (`frontend/`, Next.js static export) is the Vercel project **`sam-web`**:
`https://sam-web-zeta.vercel.app`. It moved off AWS Amplify on 2026-11-14 (ADR 0008); this
page's Amplify version is in git history.

## How it builds

| Setting | Value | Why |
|---|---|---|
| Root Directory | `frontend` | The app lives in the monorepo's `frontend/` workspace. |
| Install | `cd .. && npm ci -w frontend --include-workspace-root` | Vercel runs it inside `frontend/`, and `-w frontend` from there means `frontend/frontend` ("No workspaces found"), hence the `cd ..`. One lockfile at the repo root; a bare `npm ci` would also install `infra/` (~216 MB of aws-cdk). |
| Build | `npm run build` → `next build` | `output: 'export'` writes static HTML/JS that Vercel serves from its CDN. No server runs. |
| Builds | `main` only, and only when `frontend/` or the root `package*.json` changed | The ignore command in `frontend/vercel.json`. |

All of it is in `frontend/vercel.json` except the Root Directory and the env vars, which are
project settings.

## Env vars are baked in at build time

The five `NEXT_PUBLIC_*` values (API URL, Cognito region, pool, client, domain) are compiled
into the bundle by `next build`, so **changing one does nothing until the next deployment**.
They are public by design: anyone can read them in the browser.

## A new web origin needs two other changes

The app signs in with Cognito and calls the API from the browser, so its origin
(`https://sam-web-zeta.vercel.app`) must be in:

1. **Cognito's callback and logout URLs** — `webDomain` in `infra/cdk.json`, then
   `npx cdk deploy RecipeManagerCognitoStack --exclusively`. Cognito's hosted login can take
   ~5 minutes to accept a new URL after the deploy (`error=redirect_mismatch` meanwhile).
2. **The API's `CORS_ALLOW_ORIGINS`** (Vercel project `sam-api`), then redeploy the API.

Email and password sign-in goes straight to Cognito's API and does not use the callback URLs;
Google sign-in does.

## Why static export (not SSR)

Every page is a client component and there is no server-side data fetching, so a server
would add a cold start and cost for nothing.

See [`ci-cd.md`](ci-cd.md) for the whole pipeline.
