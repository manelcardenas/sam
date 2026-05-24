# AWS Cognito Authentication Setup

Complete guide for implementing AWS Cognito authentication in the Recipe Manager application.

---

## Table of Contents

1. [What is AWS Cognito?](#what-is-aws-cognito)
2. [Architecture Overview](#architecture-overview)
3. [Deployment Steps](#deployment-steps)
4. [Testing Authentication](#testing-authentication)
5. [Google Social Login](#google-social-login)
6. [Optional: API Gateway Authorizer](#optional-api-gateway-authorizer)
7. [Troubleshooting](#troubleshooting)

---

## What is AWS Cognito?

**Cognito** is AWS's managed authentication service that handles:

- ✅ User registration (sign up)
- ✅ User login (sign in)
- ✅ Password management (reset, change)
- ✅ Email verification
- ✅ Multi-factor authentication (MFA)
- ✅ Social login (Google, Facebook, etc.)
- ✅ **JWT token creation** (asymmetric RS256 keys)

**Cost:** Free for up to 50,000 monthly active users.

---

## Architecture Overview

```
┌─────────────┐
│  Frontend   │
│  (React)    │
└──────┬──────┘
       │
       │ 1. User login (email + password)
       ▼
┌─────────────────────────────────┐
│  AWS Cognito User Pool          │
│  - Validates credentials        │
│  - Creates JWT token (RS256)    │
│  - Returns IdToken              │
└─────────────┬───────────────────┘
              │
              │ 2. Frontend gets token
              │ 3. Calls API with token
              │    Authorization: Bearer <token>
              ▼
┌─────────────────────────────────┐
│  API Gateway (Optional)         │
│  - Cognito Authorizer validates │
│    token BEFORE Lambda          │
└─────────────┬───────────────────┘
              │ (only if valid)
              ▼
┌─────────────────────────────────┐
│  Lambda (FastAPI)               │
│  - get_current_user dependency  │
│  - JWTHandler validates token   │
│  - Extracts user info (sub, email)
└─────────────────────────────────┘
```

**Two authentication layers available:**

1. **Lambda-based (current):** FastAPI validates token using `JWTHandler`
2. **API Gateway authorizer (optional):** Validates at gateway level, cheaper/faster

---

## Deployment Steps

### Step 1: Deploy Cognito User Pool

The Cognito stack creates:

- User pool for storing users
- App client for authentication
- Cognito domain for hosted UI

---

### Step 2: Deploy Lambda API with Cognito Integration

The Lambda stack now automatically receives Cognito configuration from the Cognito stack.

**What gets configured:**

- Environment variables: `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `AWS_REGION`
- Lambda code with `JWTHandler` for token validation
- Protected endpoints require `Authorization: Bearer <token>`

---

### Step 3: Configure Local Development

Create/update `.env` in project root:

```bash
...
# Cognito Configuration (from CDK outputs)
COGNITO_USER_POOL_ID=cognito-user-pool-id
COGNITO_CLIENT_ID=cognito-client-id
```

**Get actual values:**

```bash
# Option 1: From AWS CloudFormation console
# Services → CloudFormation → RecipeManagerCognitoStack → Outputs

# Option 2: From AWS CLI
aws cloudformation describe-stacks \
  --stack-name RecipeManagerCognitoStack \
  --region eu-west-3 \
  --query 'Stacks[0].Outputs'
```

---

## Testing Authentication

### Create a Test User

Use the provided script:

```bash
cd backend/scripts
./create_test_user.sh myemail@example.com MyPassword123!
```

**What it does:**

1. Creates user in Cognito
2. Auto-confirms user (skips email verification)
3. Authenticates and gets JWT token
4. Prints token and curl command

**Output:**

```
✅ Success! User created and token generated:

📧 Email: myemail@example.com
🔐 Password: MyPassword123!

🔑 ID Token (valid for 1 hour):
eyJraWQiOiJsR1MxRnJzQjhHd2NtM1hiWXVKTFkwUTVUM3hqRjBCWmNET3J5SFg0QzZNPSIsImFsZ...

📋 Test with curl:
curl https://YOUR-API.execute-api.eu-west-3.amazonaws.com/recipes \
  -H "Authorization: Bearer eyJraWQiOi..."
```

---

### Test Endpoints

**1. Health endpoint (no auth required):**

```bash
curl https://YOUR-API.execute-api.eu-west-3.amazonaws.com/health
```

**Expected:** `{"status":"ok","service":"recipes"}`

---

**2. List recipes (auth required):**

```bash
# Without token - should fail
curl https://YOUR-API.execute-api.eu-west-3.amazonaws.com/recipes

# Expected: 500 error (JWTHandler can't initialize without env vars)
# or 401 Unauthorized (if properly configured)

# With valid token - should succeed
curl https://YOUR-API.execute-api.eu-west-3.amazonaws.com/recipes \
  -H "Authorization: Bearer eyJraWQiOi..."

# Expected: [] or list of recipes
```

---

### View Users in AWS Console

**Steps:**

1. Go to AWS Console → https://console.aws.amazon.com
2. Select **eu-west-3** region (Paris)
3. Services → **Cognito**
4. Click **User pools**
5. Click **recipe-manager-users**
6. Click **Users** tab
7. You'll see your created users with:
   - Username (UUID or email)
   - Email
   - Status (CONFIRMED/UNCONFIRMED)
   - Created date

---

## Google Social Login

### Why Add Google Social Login?

**Benefits:**

- ✅ **Better UX**: Users can sign in with their Google account (no password to remember)
- ✅ **Higher conversion**: Social login reduces signup friction
- ✅ **Verified emails**: Google guarantees email verification
- ✅ **Still FREE**: Cognito social login is free within 50K MAU (monthly active users)

**How it works:**

1. User clicks "Sign in with Google" on your frontend
2. Cognito redirects to Google OAuth consent screen
3. User authorizes your app
4. Google redirects back to Cognito with OAuth code
5. Cognito exchanges code for Google user info
6. Cognito creates/updates user in User Pool
7. Cognito returns JWT token to your frontend
8. Frontend uses JWT token to call your API (same as email/password flow)

**Note:** The backend Lambda doesn't change - it still validates JWT tokens the same way. Google login just provides an alternative way for users to obtain those JWT tokens.

---

### Prerequisites

**1. Create Google OAuth 2.0 Client**

Go to: https://console.cloud.google.com/apis/credentials

1. Create new project (or select existing)
2. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
3. Application type: **Web application**
4. Name: `recipe-manager`
5. Authorized redirect URIs:
   ```
   https://sam-recipe-manager.auth.eu-west-3.amazoncognito.com/oauth2/idpresponse
   ```
6. Click "Create"
7. Copy **Client ID** and **Client Secret**

---

**2. Store Credentials in AWS SSM Parameter Store**

**Why SSM?** Keeps secrets out of git and CDK code. The CDK stack references these parameters securely.

**Important:** Use `String` type (not `SecureString`) because CloudFormation doesn't support referencing `SecureString` parameters in templates.

```bash
# Store Google Client ID
aws ssm put-parameter \
  --name /recipe-manager/google-client-id \
  --value "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com" \
  --type String \
  --region eu-west-3

# Store Google Client Secret
aws ssm put-parameter \
  --name /recipe-manager/google-client-secret \
  --value "GOCSPX-your-secret-here" \
  --type String \
  --region eu-west-3
```

**Verify parameters created:**

```bash
aws ssm get-parameter --name /recipe-manager/google-client-id --region eu-west-3 --query 'Parameter.Value'
aws ssm get-parameter --name /recipe-manager/google-client-secret --region eu-west-3 --query 'Parameter.Value'
```

---

**3. Deploy Cognito Stack**

The `CognitoStack` (`infra/lib/foundation/cognito-stack.ts`) now includes:

- Google Identity Provider configuration (reads from SSM)
- OAuth flows enabled (`code`, `implicit`)
- OAuth scopes (`email`, `openid`, `profile`)
- Callback URLs for frontend (localhost + production)
- Cognito Hosted UI domain (`sam-recipe-manager`)

---

### Testing Google Login

**Option 1: Using Cognito Hosted UI**

Get your `CLIENT_ID` from CloudFormation outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name RecipeManagerCognitoStack \
  --region eu-west-3 \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text
```

Visit this URL (replace `YOUR_CLIENT_ID`):

```
https://sam-recipe-manager.auth.eu-west-3.amazoncognito.com/login?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost:3000/auth/callback&scope=email+openid+profile
```

**What you'll see:**

1. Cognito Hosted UI login page
2. "Sign in with Google" button
3. Google OAuth consent screen
4. Redirect to `http://localhost:3000/auth/callback?code=...`

**Note:** You'll need a frontend app running on `localhost:3000` to handle the callback and exchange the code for tokens. For now, you can just verify the Google login flow works (you'll see the authorization code in the URL).

---

**Option 2: Using AWS Amplify in Frontend**

When you build your React/Next.js frontend, use AWS Amplify:

```typescript
import { Amplify } from "aws-amplify";
import { signInWithRedirect } from "aws-amplify/auth";

// Configure Amplify
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: "eu-west-3_YOUR_POOL_ID",
      userPoolClientId: "YOUR_CLIENT_ID",
      loginWith: {
        oauth: {
          domain: "sam-recipe-manager.auth.eu-west-3.amazoncognito.com",
          scopes: ["email", "openid", "profile"],
          redirectSignIn: ["http://localhost:3000/auth/callback"],
          redirectSignOut: ["http://localhost:3000"],
          responseType: "code",
        },
      },
    },
  },
});

// Trigger Google login
function handleGoogleLogin() {
  signInWithRedirect({ provider: "Google" });
}
```

---

### Verify Google User in Cognito

After successful Google login:

1. Go to AWS Console → Cognito → User Pools → `recipe-manager-users`
2. Click "Users" tab
3. You'll see a new user with:
   - **Username**: `google_<google-user-id>`
   - **Email**: Your Google email
   - **Email verified**: `true` (Google verified)
   - **Status**: `CONFIRMED`

---

### Using Google Login Tokens with Your API

**The JWT tokens from Google login work exactly the same as email/password tokens:**

```bash
# After Google login, frontend has IdToken
# Use it to call your API
curl https://YOUR-API.execute-api.eu-west-3.amazonaws.com/recipes \
  -H "Authorization: Bearer <ID_TOKEN_FROM_GOOGLE_LOGIN>"
```

Your Lambda validates the token the same way - it doesn't care if the user logged in with email/password or Google.

---

## API Gateway Authorizer ✅ Already Implemented

The Cognito JWT authorizer at the API Gateway level is **already implemented** in `lambda-api-stack.ts`. Invalid tokens are rejected before reaching Lambda.

The implementation uses `HttpJwtAuthorizer` from `aws-cdk-lib/aws-apigatewayv2-authorizers`, applied to all `/recipes` routes. The `/health` endpoint remains public (no authorizer).

**How it works:**

1. Client sends `Authorization: Bearer <token>` header
2. API Gateway validates the JWT against Cognito's JWKS endpoint
3. If valid → request forwarded to Lambda (which also validates via `get_current_user` dependency)
4. If invalid → 401 Unauthorized returned immediately (Lambda never invoked)

**Defense in depth:** Both API Gateway and Lambda validate the token. This is intentional — even if API Gateway is bypassed (e.g., direct Lambda invocation), the endpoint is still protected.

---

### Cost Comparison

**Without API Gateway Authorizer:**

```
Invalid request → API Gateway → Lambda (invoked) → Validates token → Returns 401
Cost: API Gateway request + Lambda invocation + Lambda duration
```

**With API Gateway Authorizer (current setup):**

```
Invalid request → API Gateway (validates token) → Returns 401
Cost: API Gateway request only
```

**Savings per 1M invalid requests:**

- Lambda invocations: ~$0.20
- Lambda duration (30ms avg): ~$0.01
- **Total savings: ~$0.21 per 1M invalid requests**

For low-traffic apps: Negligible savings.
For high-traffic apps: Can be significant.

---

## Troubleshooting

### Error: "Public key not found in JWKS"

**Cause:** Token is from wrong user pool or region mismatch.

**Fix:**

1. Verify `COGNITO_USER_POOL_ID` matches the pool that issued the token
2. Check token's `iss` claim:
   ```bash
   # Decode token (without verification)
   echo "eyJraWQiOi..." | cut -d. -f2 | base64 -d | jq .iss
   ```
3. Should match: `https://cognito-idp.eu-west-3.amazonaws.com/<POOL_ID>`

---

### Error: "Audience claim does not match"

**Cause:** Token was issued for different client ID.

**Fix:**

1. Verify `COGNITO_CLIENT_ID` environment variable
2. Check token's `aud` claim:
   ```bash
   echo "eyJraWQiOi..." | cut -d. -f2 | base64 -d | jq .aud
   ```
3. Should match your `COGNITO_CLIENT_ID`

---

### Error: "Token has expired"

**Cause:** Cognito tokens expire after 1 hour.

**Fix:**

1. Generate a new token:
   ```bash
   ./backend/scripts/create_test_user.sh myemail@example.com MyPassword123!
   ```
2. Or implement token refresh in frontend (use refresh tokens)

---

## Summary

**What you have now:**

- ✅ Cognito User Pool for user management
- ✅ Lambda validates JWT tokens using RS256 public keys
- ✅ Protected endpoints require valid Authorization header
- ✅ Script to create test users and get tokens
- ✅ Google Social Login (alternative to email/password)
- ✅ API Gateway JWT Authorizer (validates tokens before Lambda invocation)
- ✅ Ready for frontend integration

**Optional enhancements:**

- Token refresh flow
- Multi-factor authentication (MFA)

**Next steps:**

1. Build frontend with login/signup forms
2. Integrate AWS Amplify for easy Cognito calls
3. Implement token refresh logic
4. Add user profile management

---

## Resources

- [AWS Cognito Documentation](https://docs.aws.amazon.com/cognito/)
- [AWS Amplify (Frontend)](https://docs.amplify.aws/)
- [JWT Debugger](https://jwt.io/) - Decode tokens to inspect claims
- [Cognito Pricing](https://aws.amazon.com/cognito/pricing/) - Free tier: 50K MAU
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
