# TODO — User Profile Work

Follow-ups arising from the JIT user-provisioning fix (auto-creating a row in
`users` for every authenticated Cognito user). Right now `display_name` is
auto-derived from the email prefix (e.g. `manel@mvst.co` → `manel`, with a
short sub-suffix on collision). That's a stop-gap — we still need:

## 1. Frontend: show recipe author

- [ ] Display `created_by` (the author's `display_name`) on each recipe card / detail view.
- [ ] Decide where the author name is resolved:
  - Option A: backend joins `recipes` → `users` and returns `created_by_name` in the recipe payload.
  - Option B: separate `GET /users/{id}` endpoint, FE caches per session.
  - **Recommended: Option A** — simpler FE, single roundtrip, no N+1.
- [ ] Add the author to the FE `Recipe` type and to `components/RecipeForm.tsx` read-only view.

## 2. Profile-completion requirement

Right now users are auto-provisioned with an email-prefix display name they never chose.
We should force them to pick one.

- [ ] After Cognito sign-in, check whether `display_name` was auto-generated (heuristic: equals `email.split('@')[0]` or matches the `_<sub-prefix>` collision pattern).
- [ ] If yes, redirect to a `/profile/complete` page before letting them use the app.
- [ ] Add `PATCH /users/me` endpoint (auth-protected) that lets the user set their own `display_name`.
  - Validate uniqueness (the column is already `UNIQUE` — return 409 on conflict).
  - Validate length / charset (already constrained at DB level to `String(50)`).
- [ ] FE form: single text input + submit, calls `PATCH /users/me`, then routes to `/dashboard`.

## 3. Backend plumbing this implies

- [ ] `UserRepository` port — add `get_by_id(user_id)` and `update_display_name(user_id, new_name)`.
- [ ] `UserController` with `GET /users/me` and `PATCH /users/me`.
- [ ] Use case layer: `GetCurrentUser`, `UpdateDisplayName`.
- [ ] Track whether the display name was user-chosen (add a `display_name_set_by_user: bool` column) so we don't keep nagging users who deliberately picked their email prefix. Migration required.
