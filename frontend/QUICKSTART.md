# Frontend Quick Start Guide

## What We Built

A modern React + Next.js frontend with:

- **Login page** with email/password and Google Social Login
- **Dashboard** with full recipe CRUD operations (Create, Read, Update, Delete)
- **AWS Cognito authentication** via AWS Amplify
- **Responsive UI** with Tailwind CSS
- **Type-safe** with TypeScript

---

## Start Development Server

```bash
cd frontend
npm run dev
```

Visit: **http://localhost:8080**

---

## Test Authentication

### Option 1: Email/Password Login

1. Create a test user:

   ```bash
   cd backend/scripts
   ./create_test_user.sh test@example.com TestPassword123!
   ```

2. Visit http://localhost:8080
3. Enter email: `test@example.com`
4. Enter password: `TestPassword123!`
5. Click "Sign in with Email"

### Option 2: Google Login

1. Visit http://localhost:8080
2. Click "Sign in with Google"
3. Authorize with your Google account

---

## Project Structure

```
frontend/
├── app/
│   ├── page.tsx              # Login page (/)
│   ├── dashboard/
│   │   └── page.tsx          # Recipe dashboard (/dashboard)
│   ├── layout.tsx            # Root layout
│   └── globals.css           # Global styles (Tailwind)
├── lib/
│   ├── amplify.ts            # AWS Amplify/Cognito config
│   └── api-client.ts         # API client for Lambda backend
├── .env.local                # Environment variables (CONFIGURED)
├── next.config.ts            # Next.js configuration
├── tailwind.config.ts        # Tailwind CSS configuration
└── package.json              # Dependencies
```

---

## Features Implemented

### Login Page (`app/page.tsx`)

- Email/password authentication
- Google Social Login button
- Auto-redirect to dashboard if already logged in
- Error handling with friendly messages
- Beautiful gradient background

### Dashboard (`app/dashboard/page.tsx`)

- **List View**: Grid of recipe cards with title, description, ingredients preview
- **Add Recipe**: Form to create new recipes
- **Edit Recipe**: Update existing recipes
- **Delete Recipe**: Remove recipes with confirmation
- **Sign Out**: Logout button in header
- Real-time updates after CRUD operations

### API Client (`lib/api-client.ts`)

- Type-safe Recipe interface
- Automatic JWT token inclusion in requests
- Error handling with detailed messages
- Methods:
  - `listRecipes()` - Get all recipes
  - `getRecipe(id)` - Get single recipe
  - `createRecipe(data)` - Create new recipe
  - `updateRecipe(id, data)` - Update recipe
  - `deleteRecipe(id)` - Delete recipe
  - `healthCheck()` - Check API health

### Amplify Configuration (`lib/amplify.ts`)

- Cognito User Pool connection
- OAuth flow configuration
- Google provider setup
- SSR support

---

## Deployment Options (When Ready)

See detailed instructions in `frontend/README.md`:

### Recommended: AWS Amplify Hosting

- **Cost**: $0-5/month (free tier)
- **Setup**: 5 minutes
- **Features**: CI/CD, SSL, CDN
- **Best for**: Most projects

### Alternative: Vercel

- **Cost**: Free for personal projects
- **Setup**: 2 minutes
- **Features**: Best Next.js performance
- **Best for**: Next.js apps

### Budget: S3 + CloudFront

- **Cost**: $1-2/month
- **Setup**: 15 minutes
- **Features**: Static hosting
- **Best for**: Low cost

See `frontend/README.md` for step-by-step deployment guides.

---

## Tech Stack Details

| Technology   | Version | Purpose         |
| ------------ | ------- | --------------- |
| Next.js      | 15.1.6  | React framework |
| React        | 19.0.0  | UI library      |
| TypeScript   | 5.x     | Type safety     |
| Tailwind CSS | 3.4.1   | Styling         |
| AWS Amplify  | 6.11.5  | Cognito auth    |
| Lucide React | 0.469.0 | Icons           |

---

## How Authentication Works

1. User visits `/` (login page)
2. User clicks "Sign in with Email" or "Sign in with Google"
3. AWS Amplify calls Cognito API
4. Cognito validates credentials and returns JWT token
5. Amplify stores token in browser
6. User redirected to `/dashboard`
7. Dashboard calls API with JWT token in Authorization header
8. API Gateway validates JWT (optional)
9. Lambda validates JWT and returns recipes
10. Dashboard renders recipes

---

## Key Files Explained

### `app/page.tsx` (Login Page)

- Uses AWS Amplify's `signIn()` for email/password
- Uses `signInWithRedirect()` for Google login
- Checks authentication status on mount
- Redirects authenticated users to dashboard

### `app/dashboard/page.tsx` (Recipe Dashboard)

- Protected route (requires authentication)
- Manages three views: list, add, edit
- Calls API client for CRUD operations
- Updates UI in real-time after API calls

### `lib/api-client.ts` (API Client)

- Fetches JWT token via `fetchAuthSession()`
- Includes token in Authorization header
- Type-safe with TypeScript interfaces
- Handles errors gracefully

### `lib/amplify.ts` (Amplify Config)

- Configures Cognito User Pool connection
- Sets up OAuth flow for Google login
- Enables SSR support for Next.js
- Uses environment variables for flexibility

---

## Next Steps

1. **Test locally**: Run `npm run dev` and test authentication flow
2. **Add recipes**: Create a few test recipes to verify CRUD operations
3. **Deploy**: Follow `frontend/README.md` to deploy to AWS Amplify
4. **Customize**: Update colors, add features, improve UI

---

## Troubleshooting

### Cannot sign in

- Check `.env.local` has correct values
- Verify user exists in Cognito (AWS Console)
- Check browser console for errors

### API calls fail (401)

- Verify `NEXT_PUBLIC_API_URL` is correct
- Check API Gateway is deployed
- Verify Lambda has Cognito environment variables

### Google login fails

- Check Cognito callback URLs include localhost:8080
- Verify Google OAuth credentials in SSM Parameter Store
- Check redirect URI in Google Cloud Console

---

## Resources

- [Frontend README](./README.md) - Detailed documentation
- [Cognito Setup Guide](../docs/cognito_setup.md) - Authentication setup
- [Next.js Docs](https://nextjs.org/docs) - Framework documentation
- [AWS Amplify Docs](https://docs.amplify.aws/) - Auth library
