# AWS Cognito Authentication Setup

Complete guide for implementing AWS Cognito authentication in the Recipe Manager application.

---

## Table of Contents

1. [What is AWS Cognito?](#what-is-aws-cognito)
2. [Architecture Overview](#architecture-overview)
3. [Deployment Steps](#deployment-steps)
4. [Testing Authentication](#testing-authentication)
5. [Optional: API Gateway Authorizer](#optional-api-gateway-authorizer)
6. [Troubleshooting](#troubleshooting)

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

**Deploy via GitHub Actions:**

```bash
git add .
git commit -m "Add Cognito authentication"
git push origin main
```

The workflow will automatically:

1. Deploy `RecipeManagerCognitoStack`
2. Deploy `RecipeManagerLambdaApiStack` (with Cognito env vars)

**Or deploy manually:**

```bash
cd infra
npx cdk deploy RecipeManagerCognitoStack --require-approval never
```

**Outputs you'll see:**

```
RecipeManagerCognitoStack.UserPoolId = eu-west-3_ABC123
RecipeManagerCognitoStack.UserPoolClientId = 1a2b3c4d5e...
RecipeManagerCognitoStack.UserPoolRegion = eu-west-3
RecipeManagerCognitoStack.UserPoolDomain = sam-recipe-manager
```

Save these values - you'll need them for local development.

---

### Step 2: Deploy Lambda API with Cognito Integration

The Lambda stack now automatically receives Cognito configuration from the Cognito stack.

**What gets configured:**

- Environment variables: `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `AWS_REGION`
- Lambda code with `JWTHandler` for token validation
- Protected endpoints require `Authorization: Bearer <token>`

**Deploy via GitHub Actions:**

The workflow deploys both stacks in order:

1. Cognito stack first (foundation)
2. Lambda API stack second (references Cognito outputs)

**Or deploy manually:**

```bash
cd infra
npx cdk deploy RecipeManagerLambdaApiStack --require-approval never
```

---

### Step 3: Configure Local Development

Create/update `.env` in project root:

```bash
# API Configuration
PORT=9000
HOST=0.0.0.0

# DynamoDB (for Docker)
USE_DYNAMODB=true
DYNAMODB_ENDPOINT=http://localhost:8000
TABLE_NAME=recipes

# AWS Configuration
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
AWS_REGION=eu-west-3

# Cognito Configuration (from CDK outputs)
COGNITO_USER_POOL_ID=cognito-user-pool-id    # ← Replace with your value
COGNITO_CLIENT_ID=cognito-client-id  # ← Replace with your value
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

**3. Create recipe (auth required):**

```bash
curl -X POST https://YOUR-API.execute-api.eu-west-3.amazonaws.com/recipes \
  -H "Authorization: Bearer eyJraWQiOi..." \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Pasta Carbonara",
    "description": "Classic Italian pasta dish",
    "ingredients": ["pasta", "eggs", "bacon", "parmesan"]
  }'
```

---

### Test with Postman

**Setup:**

1. Create new request: `GET https://YOUR-API.execute-api.eu-west-3.amazonaws.com/recipes`
2. Go to **Authorization** tab
3. Type: **Bearer Token**
4. Token: Paste the token from `create_test_user.sh` output
5. Send request

**Create a Postman environment:**

```json
{
  "api_url": "https://YOUR-API.execute-api.eu-west-3.amazonaws.com",
  "cognito_token": "eyJraWQiOi..."
}
```

Then use: `{{api_url}}/recipes` with `{{cognito_token}}`

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

## Optional: API Gateway Authorizer

**Current setup:** Lambda validates JWT tokens (works, but Lambda is invoked even for invalid tokens)

**Optional enhancement:** Add Cognito authorizer at API Gateway level

- ✅ Invalid tokens rejected **before** Lambda invocation
- ✅ Lower Lambda invocations = lower cost
- ✅ Faster response for invalid tokens
- ⚠️ More CDK configuration

### When to Add API Gateway Authorizer

**Add it when:**

- You have high traffic (>10,000 requests/day)
- You see many unauthorized requests
- You want to optimize costs
- You want centralized authorization

**Skip it when:**

- Personal/learning projects
- Low traffic (<1,000 requests/day)
- Want simpler architecture

---

### Implementation Steps

**1. Update Lambda API Stack**

File: `infra/lib/application/lambda-api-stack.ts`

```typescript
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";

export class LambdaApiStack extends Stack {
  constructor(
    scope: App,
    id: string,
    props: StackProps,
    cognitoStack: CognitoStack, // Already passed
  ) {
    // ... existing code ...

    // Create Cognito JWT Authorizer
    const authorizer = new HttpJwtAuthorizer(
      "CognitoAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${cognitoStack.userPool.userPoolId}`,
      {
        jwtAudience: [cognitoStack.userPoolClient.userPoolClientId],
        authorizerName: "recipe-manager-cognito-authorizer",
      },
    );

    // Lambda integration (existing)
    const integration = new HttpLambdaIntegration(
      "RecipeIntegration",
      recipeApi,
    );

    // Update routes to use authorizer
    // Protected routes (require authentication)
    httpApi.addRoutes({
      path: "/recipes",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: integration,
      authorizer: authorizer, // ← Add this
    });

    httpApi.addRoutes({
      path: "/recipes/{id}",
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      integration: integration,
      authorizer: authorizer, // ← Add this
    });

    // Public routes (no authentication)
    httpApi.addRoutes({
      path: "/health",
      methods: [HttpMethod.GET],
      integration: integration,
      // No authorizer for health check
    });
  }
}
```

**2. Remove catch-all routes**

Replace:

```typescript
// OLD - too permissive
httpApi.addRoutes({
  path: "/{proxy+}",
  methods: [HttpMethod.ANY],
  integration: integration,
});
```

With explicit routes (shown above).

---

**3. Update Lambda to trust API Gateway**

When using API Gateway authorizer, the JWT is already validated. You can optionally:

**Option A: Keep Lambda validation** (belt-and-suspenders approach)

- API Gateway validates
- Lambda also validates
- ✅ More secure (defense in depth)
- ⚠️ Slight performance overhead

**Option B: Skip Lambda validation** (trust API Gateway)

- Remove `dependencies=[Depends(get_current_user)]` from routes
- ✅ Faster Lambda execution
- ⚠️ No validation if calling Lambda directly (bypassing API Gateway)

**Recommendation:** Keep Lambda validation (Option A) unless you have performance issues.

---

**4. Deploy**

```bash
cd infra
npx cdk deploy RecipeManagerLambdaApiStack --require-approval never
```

---

**5. Test**

```bash
# Invalid token - should return 401 BEFORE Lambda execution
curl https://YOUR-API.execute-api.eu-west-3.amazonaws.com/recipes \
  -H "Authorization: Bearer invalid-token"

# Expected: {"message":"Unauthorized"}
# Status: 401

# Valid token - should work
curl https://YOUR-API.execute-api.eu-west-3.amazonaws.com/recipes \
  -H "Authorization: Bearer eyJraWQiOi..."

# Expected: [] or list of recipes
# Status: 200
```

---

**6. Verify in CloudWatch**

Check Lambda logs - you should **NOT** see logs for requests with invalid tokens (they're rejected at API Gateway).

```bash
aws logs tail /aws/lambda/recipe-manager-api --region eu-west-3 --follow
```

Make a request with invalid token - no logs should appear.

---

### Cost Comparison

**Without API Gateway Authorizer:**

```
Invalid request → API Gateway → Lambda (invoked) → Validates token → Returns 401
Cost: API Gateway request + Lambda invocation + Lambda duration
```

**With API Gateway Authorizer:**

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

### Error: "COGNITO_USER_POOL_ID environment variable is required"

**Cause:** Lambda doesn't have Cognito environment variables.

**Fix:**

1. Check CDK deployment logs - ensure Lambda stack deployed after Cognito stack
2. Verify environment variables in AWS Console:
   ```bash
   aws lambda get-function-configuration \
     --function-name recipe-manager-api \
     --region eu-west-3 \
     --query 'Environment.Variables'
   ```
3. Should see: `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `AWS_REGION`

---

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

### Docker: "Connection refused" to localhost:9000

**Cause:** Missing Cognito env vars in `docker-compose.yml`.

**Fix:**
Check `docker-compose.yml` has:

```yaml
environment:
  - AWS_REGION=eu-west-3
  - COGNITO_USER_POOL_ID=${COGNITO_USER_POOL_ID}
  - COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID}
```

And `.env` file has actual values (not placeholders).

---

### API returns 200 without Authorization header

**Cause:** Old Lambda code still deployed (before Cognito migration).

**Fix:**

1. Check Lambda last modified date:
   ```bash
   aws lambda get-function \
     --function-name recipe-manager-api \
     --region eu-west-3 \
     --query 'Configuration.LastModified'
   ```
2. Should be recent (after your Cognito changes)
3. If old, redeploy:
   ```bash
   cd infra
   npx cdk deploy RecipeManagerLambdaApiStack --require-approval never
   ```

---

## Summary

**What you have now:**

- ✅ Cognito User Pool for user management
- ✅ Lambda validates JWT tokens using RS256 public keys
- ✅ Protected endpoints require valid Authorization header
- ✅ Script to create test users and get tokens
- ✅ Ready for frontend integration

**Optional enhancements:**

- API Gateway Cognito Authorizer (for high-traffic apps)
- Token refresh flow
- Social login (Google, Facebook)
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
