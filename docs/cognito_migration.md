# Phase 2: AWS Cognito Migration

---

## What is AWS Cognito?

**Cognito** is AWS's managed authentication service. It handles:

- User registration (sign up)
- User login (sign in)
- Password management (reset, change)
- Email verification
- Multi-factor authentication (MFA)
- Social login (Google, Facebook, etc.)
- **JWT token creation** (after successful login)

Think of Cognito as a complete authentication backend that **replaces** your need to manage users and create tokens manually.

---

## Why Migrate to Cognito?

| Feature                | Phase 1 (Simple JWT)         | Phase 2 (Cognito)                   |
| ---------------------- | ---------------------------- | ----------------------------------- |
| **User Management**    | ❌ None                      | ✅ Full user database               |
| **User Registration**  | ❌ Manual                    | ✅ Built-in API                     |
| **Password Security**  | ❌ N/A                       | ✅ Automatic hashing, policies      |
| **Token Creation**     | ❌ Manual script             | ✅ Automatic on login               |
| **Token Security**     | ⚠️ Symmetric (shared secret) | ✅ Asymmetric (public/private keys) |
| **Email Verification** | ❌ None                      | ✅ Built-in                         |
| **Password Reset**     | ❌ None                      | ✅ Built-in                         |
| **Cost**               | Free                         | Free tier: 50,000 MAU               |

**Bottom line:** Cognito is a production-ready auth system. Phase 1 is for learning and testing.

---

## Architecture Comparison

### Phase 1: Simple JWT (Current)

```
┌─────────────┐
│  Frontend   │
│  (Your Web) │
└──────┬──────┘
       │
       │ 1. Calls API with manually-created token
       │    Authorization: Bearer <token-from-script>
       ▼
┌─────────────────┐
│  FastAPI        │
│  - Validates    │
│    with         │
│    JWT_SECRET   │
└─────────────────┘
```

**Problem:** Where do users get tokens? You need to build:

- Login form → validate username/password → create token
- User database (store passwords securely)
- Password reset flow
- Email verification
- Token refresh logic

**This is A LOT of work!**

---

### Phase 2: Cognito

```
┌─────────────┐
│  Frontend   │
│  (Your Web) │
└──────┬──────┘
       │
       │ 1. User submits login form
       │    POST to Cognito API
       ▼
┌─────────────────────────────────┐
│  AWS Cognito User Pool          │
│  - Validates username/password  │
│  - Creates JWT token            │
│  - Returns token to frontend    │
└─────────────────────────────────┘
       │
       │ 2. Frontend stores token
       │ 3. Calls API with token
       │    Authorization: Bearer <cognito-jwt>
       ▼
┌─────────────────────────────────┐
│  FastAPI                        │
│  - Validates token using        │
│    Cognito public keys          │
│  - No user database needed      │
└─────────────────────────────────┘
```

**Benefits:**

- ✅ Cognito handles all user management
- ✅ Your backend only validates tokens (no password storage)
- ✅ Frontend calls Cognito directly for login/signup
- ✅ Production-ready security

---

## Migration Steps (High Level)

### Step 1: Create Cognito User Pool (AWS Console or CDK)

**What:** A "user pool" is Cognito's user database.

**Via CDK (recommended):**

**Outputs to save:**

- `UserPoolId`: e.g., `eu-west-3_ABC123`
- `UserPoolClientId`: e.g., `1a2b3c4d5e6f7g8h9i0j`
- `Region`: `eu-west-3`

**Cost:** Free tier = 50,000 monthly active users

---

### Step 2: Update Backend JWT Validation

**New environment variables:**

```bash
# .env
COGNITO_USER_POOL_ID=cognito-user-pool-id
COGNITO_CLIENT_ID=cognito-client-id
```

**No other backend changes needed!** Controllers, use cases, domain all stay the same.

---

### Step 3: Update Frontend Login Flow

**Before (Phase 1 - Manual):**

```javascript
// No login - just paste token from script
const token = "eyJhbGciOi..."; // From generate_token.py
localStorage.setItem("token", token);
```

**After (Phase 2 - Cognito):**

```javascript
// Use AWS Amplify library (easiest) or direct API calls

// Install Amplify
// npm install aws-amplify

import { Amplify, Auth } from "aws-amplify";

// Configure (use outputs from CDK)
Amplify.configure({
  Auth: {
    region: "eu-west-3",
    userPoolId: "eu-west-3_ABC123",
    userPoolWebClientId: "user-pooñ.web-client-id",
  },
});

// Login
async function login(email, password) {
  try {
    const user = await Auth.signIn(email, password);
    const token = user.signInUserSession.idToken.jwtToken;
    localStorage.setItem("token", token);
    console.log("Logged in!", token);
  } catch (error) {
    console.error("Login failed:", error);
  }
}

// Register
async function register(email, password) {
  try {
    await Auth.signUp({
      username: email,
      password: password,
      attributes: { email },
    });
    console.log("Check your email for verification code");
  } catch (error) {
    console.error("Registration failed:", error);
  }
}

// Verify email (after registration)
async function verifyEmail(email, code) {
  try {
    await Auth.confirmSignUp(email, code);
    console.log("Email verified! You can now login.");
  } catch (error) {
    console.error("Verification failed:", error);
  }
}
```

**API calls stay the same:**

```javascript
// Call your FastAPI backend (no changes)
const response = await fetch("https://your-api.com/recipes", {
  headers: {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  },
});
```

---

### Step 4: (Optional) Add API Gateway Authorizer

**Two options for token validation:**

**Option A: Lambda validates token (current approach)**

- ✅ Works with Phase 1 and Phase 2
- ✅ No CDK changes needed
- ⚠️ Slightly slower (Lambda does validation)

**Option B: API Gateway validates token**

- ✅ Faster (API Gateway rejects before Lambda)
- ✅ Lower Lambda invocations = lower cost
- ⚠️ Requires CDK changes

**To add API Gateway authorizer (CDK):**

```typescript
// infra/lib/application/lambda-api-stack.ts
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";

const httpApi = new apigatewayv2.HttpApi(this, "RecipeApi", {
  // ... existing config ...
});

// Add Cognito authorizer
const authorizer = new authorizers.HttpJwtAuthorizer(
  "CognitoAuthorizer",
  `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
  {
    jwtAudience: [clientId],
  },
);

// Apply to routes
httpApi.addRoutes({
  path: "/recipes",
  methods: [apigatewayv2.HttpMethod.GET],
  integration: lambdaIntegration,
  authorizer: authorizer, // ← Validates token before Lambda
});
```

**Both options work.** Option A (Lambda validation) is simpler for personal projects.

---

## Migration Checklist

**Phase 1 → Phase 2 migration:**

- [ ] **Deploy Cognito User Pool** (CDK stack)
- [ ] **Note outputs:** UserPoolId, ClientId, Region
- [ ] **Update `.env`:** Add Cognito variables
- [ ] **Update `jwt_handler.py`:** Switch to JWKS validation
- [ ] **Install new dependencies:** `python-jose`, `requests`
- [ ] **Test backend:** Generate token from Cognito console, test API
- [ ] **Update frontend:** Add Amplify, implement login/register
- [ ] **Test end-to-end:** Register user → Login → Call API
- [ ] **(Optional) Add API Gateway authorizer**
- [ ] **Remove Phase 1 code:** Delete `generate_token.py`, remove `JWT_SECRET`

---

## Cost Estimation

| Resource                   | Free Tier      | Cost After Free Tier       |
| -------------------------- | -------------- | -------------------------- |
| **Cognito User Pool**      | 50,000 MAU     | $0.0055/MAU                |
| **Example: 100 users**     | FREE           | FREE                       |
| **Example: 100,000 users** | First 50k FREE | 50k × $0.0055 = $275/month |

**For personal projects with <100 users:** Completely free forever.

**MAU = Monthly Active Users** (users who log in at least once per month)

---

## Testing Cognito Locally

**Option 1: Use real Cognito (easiest)**

- Deploy Cognito stack to AWS
- Frontend calls real Cognito
- Backend validates real Cognito tokens
- Works immediately, no mocking needed

**Option 2: Mock Cognito for offline dev**

- Use `cognito-local` (Docker)
- More complex setup
- Not recommended unless you need 100% offline dev

**Recommendation:** Use real Cognito even for local dev. It's free and simpler.

---

## Common Issues & Solutions

**Issue:** "Token signature verification failed"
**Solution:** Check `COGNITO_USER_POOL_ID` and `AWS_REGION` match your actual pool

**Issue:** "Audience claim does not match"
**Solution:** Set `audience=os.getenv("COGNITO_CLIENT_ID")` in jwt.decode()

**Issue:** "Public key not found (kid)"
**Solution:** Token might be from wrong user pool. Check UserPoolId.

**Issue:** "User is not confirmed"
**Solution:** User must verify email before login. Check email for verification code.

---

## Security Best Practices

**Token Storage (Frontend):**

- ✅ Use `localStorage` or `sessionStorage` for simple apps
- ⚠️ Avoid `localStorage` for high-security apps (vulnerable to XSS)
- ✅ Best practice: Use `HttpOnly` cookies (requires backend endpoint for login)

**Token Refresh:**

- Cognito tokens expire after 1 hour
- Use refresh tokens (valid for 30 days) to get new access tokens
- Amplify handles this automatically

**HTTPS Only:**

- ⚠️ **NEVER** send tokens over HTTP
- ✅ Always use HTTPS in production (API Gateway provides this)

---

## Summary

**What you'll have after Phase 2:**

```
User Experience:
1. User visits your website
2. Clicks "Register" → Cognito creates account → Email verification
3. Clicks "Login" → Cognito validates password → Returns JWT
4. Frontend stores JWT
5. All API calls include JWT
6. Backend validates JWT using Cognito public keys
7. User can reset password, change email, etc. (all via Cognito)
```

**Code changes:**

- ✅ Backend: Only `jwt_handler.py` changes (40 lines)
- ✅ Frontend: Add Amplify library + login forms
- ✅ CDK: Add Cognito stack
- ✅ Controllers, use cases, domain: **No changes**

**Timeline:**

- Backend changes: 1 hour
- Frontend changes: 2-4 hours (depends on UI)
- Testing: 1 hour
- **Total: ~4-6 hours**

**Next step:** Complete and test Phase 1, then revisit this document when ready for production auth.
