---
id: T-0561
title: "Effect C (HTTP): /me (GET, PATCH) and account invites (create, check, revoke) onto the HttpApi adapter, zod to Effect Schema; GET /invites/:code stays public; Better Auth handler untouched; every /me field kept; tests unchanged"
status: todo
milestone: M5
branch: task/T-0561-effect-http-auth-me-invites
model: auto
effort: low
depends_on: [T-0548]
estimate: 0.5 day
---

# T-0561: /me and invites on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"**, items 8-11. The worked example is `apps/server/src/topics/api.ts`. **`GET /api/me` is called by every client on every start**, so its answer must stay byte-for-byte the same. **Do not touch** the Better Auth handler (`app.all('/api/auth/*', …)` at `apps/server/src/app.ts:308`) or `auth/auth.ts`.

### Verified facts (do not re-derive; read each route)
- **`apps/server/src/auth/routes.ts`** (161 lines):
  - `AuthRoutesDependencies` (line 16) holds `auth`, `db`, `config`, `adminClient` and `logger?`;
  - `AuthRoutesLogger` (25);
  - `displayNameSchema` (30): trimmed, 1..64 characters, with the messages `name must not be empty`, `name must be at most 64 characters` and `name must not contain control characters` (control means a code point at most 0x1f, or 0x7f);
  - `updateMeSchema = z.object({ name })` (39), **non-strict**;
  - `createAuthRoutes` (41).
- **The five routes:**
  - `GET /me` (50). Session required. It answers `{ id, email, name, image: image ?? null, avatarUrl? (omitted when none, never null), handle: … ?? null, createdAt, jid: … ?? null }`, where `createdAt` is a Date serialised by `c.json` as an ISO string;
  - `PATCH /me` (74). Session, then the JSON body (where `.catch(() => null)` means an unparseable body is a validation failure), then 400 `invalid_request` with **the first issue's message** (the tests may assert those three texts), then `auth.api.updateUser({ headers, body: { name } })`, then **the session read again**, then a best-effort `refreshRosterNicknames` (logging only ids and `pending`), then the same shape as GET. Read lines 115-122 for the exact fields;
  - `POST /invites` (124). Session required. It answers `{ code, url: PUBLIC_URL/invite/code, expiresAt }`;
  - `GET /invites/:code` (134). **Public, with no session**: it answers `{ valid }`. Check how `apps/server/src/authz-sweep.test.ts` allowlists it, and keep it public;
  - `DELETE /invites/:code` (139). Session required. It gives 404 "Invite not found", 403 `forbidden` "Only the creator can revoke this invite", or `{ revoked: true }`.
- **`apps/server/src/app.ts:309`** mounts `app.route('/api', createAuthRoutes({ auth, db, config, adminClient, logger }))` right after the Better Auth catch-all at line 308. Keep it at the same position. `createAuthRoutes` has no other importer.
- **Tests (all unchanged):** `apps/server/src/auth/*.test.ts`, `apps/server/src/authz-sweep.test.ts`, `app.test`, and any test that calls `/api/me` or `/api/invites` (find them with grep).

### What to build
1. **Create `apps/server/src/auth/api.ts`** with the five routes on `HttpApi`:
   - the `Session` middleware on the four session routes only;
   - the same order, statuses and texts, including the three name messages;
   - an Effect Schema for the name, with the same trim, length and control-character rules;
   - success schemas that keep every field. `avatarUrl` is optional and omitted, never null; `image`, `handle` and `jid` are nullable; `createdAt` is the ISO string.
   
   Export `AUTH_API_ROUTES`.
2. **`routes.ts`:** delete it if nothing else imports it, moving the dependency and logger types into `api.ts`. Otherwise keep it re-export-only.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position, after the Better Auth catch-all.
4. **Tests:** every listed test passes **unchanged**. If one cannot, stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/topics/api.ts`, `apps/server/src/auth/routes.ts` (all of it), `apps/server/src/authz-sweep.test.ts`, and `apps/server/src/app.ts` (lines 300-315).

### Allowed files
`apps/server/src/auth/api.ts`, `apps/server/src/auth/routes.ts`, `apps/server/src/app.ts`, `work/T-0561-effect-http-auth-me-invites.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot auth authz-sweep app.test
pnpm gate
```

### Acceptance
- `/me` and the invites are served by Effect `HttpApi`, with the same answers, the public invite check kept, and no zod.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
