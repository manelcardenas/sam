# Recipe Manager Frontend

Modern React + Next.js frontend with AWS Cognito authentication.

## Features

- **Authentication**: Email/password and Google Social Login via AWS Cognito
- **Recipe Management**: Create, read, update, and delete recipes
- **Modern UI**: Built with Tailwind CSS and Lucide icons
- **Type-Safe**: Full TypeScript support
- **Responsive**: Mobile-first design

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **UI**: React 19 + Tailwind CSS
- **Authentication**: AWS Amplify + Cognito
- **Type Safety**: TypeScript
- **Icons**: Lucide React

---

## Local Development Setup

### Prerequisites

- Node.js 18+ installed
- AWS Cognito User Pool configured (see `docs/cognito_setup.md`)
- API Gateway deployed (Lambda backend)

### 1. Install Dependencies

The repo is an npm workspace, so dependencies install once from the **repo root**, not from here:

```bash
npm install
```

### 2. Configure Environment Variables

Create `.env.local` file:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your values:

```bash
# AWS Cognito Configuration
NEXT_PUBLIC_AWS_REGION=eu-west-3
NEXT_PUBLIC_USER_POOL_ID=eu-west-3_USER_POOL_ID
NEXT_PUBLIC_USER_POOL_CLIENT_ID=public-user-pool-id
NEXT_PUBLIC_COGNITO_DOMAIN=sam-recipe-manager

# API Gateway URL
NEXT_PUBLIC_API_URL=https://xbm9t398cd.execute-api.eu-west-3.amazonaws.com
```

**Get actual values:**

```bash
# Cognito values
aws cloudformation describe-stacks \
  --stack-name RecipeManagerCognitoStack \
  --region eu-west-3 \
  --query 'Stacks[0].Outputs'

# API Gateway URL
aws cloudformation describe-stacks \
  --stack-name RecipeManagerLambdaApiStack \
  --region eu-west-3 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text
```

### 3. Update Cognito Callback URLs

Add `http://localhost:8080` to Cognito allowed callback URLs:

```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id eu-west-3_HCDXBhOyi \
  --client-id ji735ceuv5enoiuslcg0a9v4l \
  --region eu-west-3 \
  --callback-urls "http://localhost:8080" "https://your-production-domain.com" \
  --logout-urls "http://localhost:8080" "https://your-production-domain.com" \
  --allowed-o-auth-flows code implicit \
  --allowed-o-auth-scopes email openid profile \
  --allowed-o-auth-flows-user-pool-client
```

Or update via CDK (`infra/lib/foundation/cognito-stack.ts`):

```typescript
callbackUrls: [
  'http://localhost:8080',
  'https://your-production-domain.com',
],
logoutUrls: [
  'http://localhost:8080',
  'https://your-production-domain.com',
],
```

Then redeploy:

```bash
cd infra
npx cdk deploy RecipeManagerCognitoStack
```

### 4. Run Development Server

```bash
npm run dev
```

Visit: http://localhost:8080

---

## Testing Authentication

### Test Email/Password Login

1. Create a test user (from backend):

   ```bash
   cd backend/scripts
   ./create_test_user.sh test@example.com TestPassword123!
   ```

2. Visit http://localhost:8080
3. Enter email and password
4. Click "Sign in with Email"
5. You should be redirected to `/dashboard`

### Test Google Login

1. Visit http://localhost:8080
2. Click "Sign in with Google"
3. Authorize with your Google account
4. You'll be redirected back to `/dashboard`

---

## Available Scripts

```bash
# Development server (http://localhost:8080)
npm run dev

# Production build
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

---

## Deployment

Vercel project `sam-web` (production: `https://sam-web-zeta.vercel.app`) builds `main` on every
merge that touches `frontend/`. Config is `frontend/vercel.json`; the whole pipeline, env vars
and the Cognito/CORS origins rule are in [`docs/wiki/ci-cd.md`](../docs/wiki/ci-cd.md).

---

## Authentication Flow

```
1. User visits http://localhost:8080
2. Login page renders (app/page.tsx)
3. User clicks "Sign in with Email" or "Sign in with Google"
4. AWS Amplify handles authentication with Cognito
5. Cognito returns JWT token
6. User redirected to /dashboard
7. Dashboard fetches recipes from API using JWT token
8. API Gateway validates JWT (optional)
9. Lambda validates JWT and returns recipes
```

---

## Troubleshooting

### "Redirect URI mismatch"

Add your domain to Cognito callback URLs:

```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id YOUR_POOL_ID \
  --client-id YOUR_CLIENT_ID \
  --callback-urls "http://localhost:8080" "https://your-domain.com"
```

### "No authentication token available"

1. Check if user is signed in
2. Verify `fetchAuthSession()` returns valid tokens
3. Check browser console for errors

### API calls return 401

1. Verify `NEXT_PUBLIC_API_URL` is correct
2. Check if token is being sent in Authorization header
3. Verify Lambda/API Gateway Cognito configuration

---

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [AWS Amplify Documentation](https://docs.amplify.aws/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [AWS Cognito Documentation](https://docs.aws.amazon.com/cognito/)
