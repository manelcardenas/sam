# JWT Authentication - Recipe Manager API

## What is JWT?

**JWT (JSON Web Token)** is a secure way to verify that API requests come from authenticated users.

Think of it like a concert wristband:

- **Login** = Box office gives you a wristband with your name encoded
- **API Request** = Security checks your wristband before letting you in
- **Token Expiration** = Wristband only valid for today

---

## Phase 1: Simple JWT (Current Implementation)

**Goal:** Protect all `/recipes/*` endpoints. Only `/health` remains public.

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Client Request                                            │
│  GET /recipes                                              │
│  Header: Authorization: Bearer eyJhbGciOi...              │
└──────────────────┬─────────────────────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────────────────────┐
│  FastAPI (infra/controllers/recipe_controller.py)          │
│  - Sees: Depends(get_current_user)                        │
│  - Calls get_current_user() BEFORE endpoint logic         │
└──────────────────┬─────────────────────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────────────────────┐
│  JWT Validation (infra/security/dependencies.py)           │
│  1. Extract token from "Authorization: Bearer <token>"    │
│  2. Validate signature using JWT_SECRET from .env         │
│  3. Check expiration                                       │
│  4. Return user info OR raise 401                         │
└──────────────────┬─────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
   ✅ Valid              ❌ Invalid
   Continue              401 Unauthorized
                         (stops here)
```

### Request Flow

**✅ Valid Token:**

```
1. GET /recipes + "Authorization: Bearer <valid-token>"
2. FastAPI runs get_current_user()
3. JWTHandler validates token → OK
4. Endpoint runs: list_recipes(current_user=TokenPayload(...))
5. Response: 200 + recipe data
```

**❌ Missing Token:**

```
1. GET /recipes (no Authorization header)
2. FastAPI runs get_current_user()
3. HTTPBearer: No token found
4. Response: 401 {"detail": "Not authenticated"}
```

**❌ Invalid/Expired Token:**

```
1. GET /recipes + "Authorization: Bearer <bad-token>"
2. FastAPI runs get_current_user()
3. JWTHandler validation fails
4. Response: 401 {"detail": "Token has expired"} or "Invalid token signature"
```

---

## How FastAPI Dependency Injection Works

**Before (no auth):**

```python
def list_recipes(self) -> list[Recipe]:
    # Anyone can call this
    return use_case.execute()
```

**After (with JWT):**

```python
def list_recipes(
    self,
    current_user: TokenPayload = Depends(get_current_user)  # ← Magic here
) -> list[Recipe]:
    # Only runs if JWT is valid
    # current_user.sub = user ID
    # current_user.email = user email
    return use_case.execute()
```

**What happens:**

1. FastAPI sees `Depends(get_current_user)`
2. **Before** calling `list_recipes()`, FastAPI calls `get_current_user()`
3. If `get_current_user()` raises HTTPException(401) → endpoint never runs
4. If `get_current_user()` returns TokenPayload → passes it to endpoint

**This is automatic.** You don't manually call `get_current_user()`.

---

## JWT Token Structure

**Decoded Payload:**

```json
{
  "sub": "user123", // Subject (user ID)
  "email": "test@example.com",
  "exp": 1707427200 // Expiration timestamp
}
```

**How it works:**

- **Header + Payload** = Base64 encoded (readable by anyone)
- **Signature** = Hash of (Header + Payload + SECRET_KEY)
- Signature proves token wasn't tampered with

---

## Environment Configuration

**Add to `.env`:**

```bash
JWT_SECRET=your-super-secret-key-at-least-32-characters-long
```

**Generate secure secret:**

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

**Used by:** `backend/src/infra/security/jwt_handler.py:11`

```python
self.secret_key = os.getenv("JWT_SECRET")
```

---

## Testing Locally

**1. Generate a test token:**

```bash
uv run python backend/scripts/generate_token.py
```

Output:

```
🔑 Test JWT Token (valid for 1 hour):
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

📋 Usage:
curl http://localhost:9000/recipes -H "Authorization: Bearer ..."
```

**2. Test with curl:**

```bash
# Should work (protected endpoint + valid token)
curl http://localhost:9000/recipes \
  -H "Authorization: Bearer <token>"

# Should fail (protected endpoint + no token)
curl http://localhost:9000/recipes

# Should work (public endpoint + no token)
curl http://localhost:9000/health
```

**3. Test with Swagger UI:**

1. Go to http://localhost:9000/docs
2. Click "Authorize" (top right, lock icon)
3. Paste token from step 1
4. Click "Authorize"
5. Now you can test protected endpoints

---

## Phase 2: Migration to Cognito (Future)

**What changes:**

| Aspect                | Phase 1 (Now)              | Phase 2 (Cognito)                    |
| --------------------- | -------------------------- | ------------------------------------ |
| **Token Creation**    | `generate_token.py` script | Cognito creates after user login     |
| **Token Validation**  | Symmetric key (JWT_SECRET) | Asymmetric key (Cognito public keys) |
| **Algorithm**         | HS256                      | RS256                                |
| **User Management**   | None (tokens only)         | Cognito User Pool                    |
| **Endpoints Changed** | None                       | `jwt_handler.py` only                |

**What DOESN'T change:**

- ✅ Controllers still use `Depends(get_current_user)`
- ✅ Use cases stay the same (no auth logic)
- ✅ Domain layer stays pure
- ✅ FastAPI dependency injection pattern

**Migration path:** See `docs/cognito_migration.md` (next steps after Phase 1 works)

---

## Key Files

| File                                     | Purpose                  |
| ---------------------------------------- | ------------------------ |
| `infra/security/jwt_handler.py`          | JWT encode/decode logic  |
| `infra/security/dependencies.py`         | FastAPI auth dependency  |
| `infra/controllers/recipe_controller.py` | Protected endpoints      |
| `backend/scripts/generate_token.py`      | Create test tokens       |
| `.env`                                   | JWT_SECRET configuration |

---

## Quick Reference

**Protected endpoints:** All `/recipes/*`
**Public endpoints:** `/health`, `/docs`, `/redoc`
**Header format:** `Authorization: Bearer <token>`
**Token lifetime:** 1 hour (configurable)
**Secret storage:** `.env` file (never commit!)

**Next:** See `docs/cognito_migration.md` for production authentication with AWS Cognito.
