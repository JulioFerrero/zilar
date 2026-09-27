---
id: T-0017
title: Server — XMPP account provisioning on sign-up, chat token endpoint, profile name
status: todo
milestone: M1
branch: task/T-0017-xmpp-provisioning
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0003, T-0015]
estimate: 1 day
---

# T-0017: XMPP provisioning + chat token

## Spec (written by Claude, do not edit)

### Goal
Connect login (T-0015) to chat (T-0003):
- When a user signs up, our server **creates their XMPP account**.
- A logged-in app can ask **`POST /api/xmpp/token`** for a short-lived chat token, plus what it needs to connect.
- Users can **set their display name** (the sign-up flow asks for a name after the code).

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`: §6.1 (auth integration), §6.2 (identity), §7.2 (the sign-up flow)
- `work/T-0003-xmpp-accounts-rooms.md` and `work/T-0015-auth-invites.md`: both Reports and Reviews
- `apps/server/src/xmpp/*` (`admin-client`, `token`, `config`) and `apps/server/src/auth/*` (`auth.ts` hooks, `routes.ts`)
- `apps/server/src/app.ts`, `index.ts`, `config.ts`, `test-support.ts`

### Allowed files
- `apps/server/src/**`
- `apps/server/drizzle/**`, if a migration is needed
- `apps/server/package.json`, `apps/server/.env.example`
- `pnpm-lock.yaml`, only if dependencies change (none should be needed)

**Do not run Docker.** Another worker uses the dev stack. Use PGlite and fake `fetch` / a fake admin client in tests. Claude runs the live check.

### Decisions (follow them)
- **XMPP localpart = the Better Auth user id, lowercased.**
  - If the user id contains characters outside `[a-z0-9._-]`, derive a stable localpart instead: `u` followed by the first 20 lowercase base32 characters of `sha256(userId)`.
  - Document which one happens with Better Auth's id format.
  - The JID is `<localpart>@<XMPP_DOMAIN>`. Store it on our side (see step 2), and never derive it from user-controlled data such as email or name.
- **Provisioning happens in Better Auth's `databaseHooks.user.create.after`.**
  - It calls `adminClient.registerUser(localpart)`, which is idempotent.
  - If ejabberd is down, **the sign-up still succeeds**. Mark the account `xmpp_provisioned = false`, log a warning (no secrets), and the token endpoint retries provisioning lazily. The user must never be stuck.
- **Token endpoint `POST /api/xmpp/token`** (auth required, cookie or bearer). It returns:

  ```
  { jid, token, expiresAt, service, domain, mucDomain }
  ```

  - `service` is the public WebSocket URL, from a new config `XMPP_WS_PUBLIC_URL` (default `ws://127.0.0.1:5280/ws`).
  - The TTL is **300 s**.
  - Rate limit: at most 30 per 10 minutes per user. Use a simple in-memory limiter keyed by user id; document that it's per process.
  - It ensures the account is provisioned first (the lazy retry).
  - It **never logs the token.**
- **Profile:** `PATCH /api/me` with `{ name }`:
  - `name` is trimmed, 1–64 chars, with no control characters
  - it updates Better Auth's user name through Better Auth's API or adapter, not raw SQL on its tables
  - `GET /api/me` also returns `jid`

### What to build
1. **Config:** add `XMPP_WS_PUBLIC_URL` to the server config, and **compose** the existing `loadXmppConfig` (from `src/xmpp/config.ts`) into server startup, so `index.ts` loads both. The server now needs the XMPP env vars at startup. Update `.env.example` (placeholders only).
2. **Schema:** a table `xmpp_accounts(user_id pk → user.id, localpart unique, jid unique, provisioned boolean, created_at, updated_at)`. Generate the migration with drizzle-kit.
3. **`src/xmpp/provisioning.ts`:**
   - `localpartFor(userId)`
   - `ensureXmppAccount(db, adminClient, userId)` → `{ jid, provisioned }`. It's idempotent and safe under concurrency (a unique constraint plus an upsert).
4. **Wiring:**
   - the `user.create.after` hook
   - the routes `POST /api/xmpp/token`, `PATCH /api/me`, and `jid` on `GET /api/me`
   - `createApp` receives the admin client and XMPP config through its dependencies (injectable for tests)
5. **Tests** (Vitest, PGlite, fake admin client):
   - sign-up through the OTP flow (reuse T-0015's helpers) creates `xmpp_accounts` with `provisioned = true`, and the admin client's `registerUser` was called once with the right localpart
   - when the admin client throws during sign-up, sign-up still succeeds with `provisioned = false`. Then `POST /api/xmpp/token` retries, succeeds and returns a token
   - the token response has the right shape. The JWT verifies with the secret and has `jid` equal to the user's JID and `exp` within about 300 s
   - `POST /api/xmpp/token` without auth → 401. With bearer auth it works
   - the rate limit: the 31st request within the window → 429
   - `localpartFor`: deterministic, valid characters, and different users get different localparts
   - `PATCH /api/me`: valid, trimmed; rejects empty strings, over 64 chars, and control characters; unauthenticated → 401. `GET /api/me` includes `jid`
   - no token and no secret appear in the captured logs

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass for the whole repo.
- [ ] Every test above exists and passes.
- [ ] The migration was generated by drizzle-kit.
- [ ] Only allowed files touched. No Docker. No secrets in logs.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Contacts, rosters, groups and the chats list (next task).
- Web and mobile screens.
- Push notifications.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-
