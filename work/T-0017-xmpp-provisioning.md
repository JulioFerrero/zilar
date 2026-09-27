---
id: T-0017
title: Server — XMPP account provisioning on sign-up, chat token endpoint, profile name
status: merged
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

- **Config (`src/xmpp/config.ts`, `src/config.ts`, `config.test.ts`).** Added `XMPP_WS_PUBLIC_URL` (a `ws://`/`wss://` URL, default `ws://127.0.0.1:5280/ws`) to `xmppEnvSchema` and to `XmppConfig.wsPublicUrl`. `loadServerConfig` now calls `loadXmppConfig(env)` and exposes the result as `config.xmpp`, so the server config carries the XMPP settings; an XMPP env error is re-thrown as a `ConfigError` (its message names variables only, never values).
- **Schema (`src/db/schema.ts`, migration `drizzle/0002_superb_katie_power.sql`).** Added `xmpp_accounts(user_id pk → user.id on delete cascade, localpart unique, jid unique, provisioned boolean default false, created_at, updated_at)`. The migration was generated with `drizzle-kit generate`, not hand-written.
- **`src/xmpp/provisioning.ts` (new).**
  - `localpartFor(userId)`: lowercases the Better Auth id and uses it directly when it is `[a-z0-9._-]{1,64}`; otherwise it returns `u` + the first 20 lowercase base32 characters of `sha256(userId)`. Deterministic and collision-resistant.
  - `jidFor(localpart, domain)`, `findXmppAccount(db, userId)`.
  - `ensureXmppAccount(db, adminClient, userId, domain, { requesterId? })` → `{ jid, provisioned }`. It upserts the row first (`ON CONFLICT (user_id) DO UPDATE`, so it is safe under concurrency), then calls the idempotent `adminClient.registerUser(localpart)`. With a `requesterId` it returns `provisioned: false` instead of throwing (lazy-retry path); without one it throws (sign-up path, where the caller logs and continues).
- **`src/xmpp/routes.ts` (new).** `POST /api/xmpp/token` (auth required, cookie or bearer):
  - rate-limits to 30 requests per 10 minutes per user id (in-memory, per process),
  - calls `ensureXmppAccount` (the lazy retry), and returns 503 if ejabberd still cannot provision,
  - signs a 300 s token with `issueXmppToken` and returns `{ jid, token, expiresAt, service, domain, mucDomain }`, where `service = XMPP_WS_PUBLIC_URL`.
  - It never logs the token; the only log line here is a warning with `userId`.
- **Auth wiring (`src/auth/auth.ts`, `src/app.ts`, `src/index.ts`).** `createAuth` now takes `adminClient` and an optional `logger`; `databaseHooks.user.create.after` calls `ensureXmppAccount`, and a failure is caught and logged as a warning (no secrets), so sign-up still succeeds. `createApp` receives `adminClient` and mounts `createXmppRoutes({ ..., xmppConfig: config.xmpp, logger })`. `index.ts` creates the ejabberd admin client from `config.xmpp` and injects it into both `createAuth` and `createApp`.
- **Profile (`src/auth/routes.ts`).** `PATCH /api/me` with `{ name }`: zod validates a trimmed 1–64 char string with no control characters (checked by code point, not a control-char regex); the update goes through `auth.api.updateUser` (not raw SQL). `GET /api/me` now also returns `jid` (the stored JID, or `null` if the user has no `xmpp_accounts` row).
- **Tests (Vitest + PGlite + fake admin client).** Added `FakeAdminClient` (togglable `failRegister`) and XMPP test env to `test-support.ts`. New: `provisioning.test.ts` (localpart rules, idempotency/concurrency, down-then-retry, hostile ids) and `routes.test.ts` (token shape + JWT verification, bearer auth, 401, lazy retry after a failed sign-up, 503 when it keeps failing, 30/10-min rate limit per user, and no token/secret in logs). Extended `auth.test.ts` with the sign-up provisioning assertion, the ejabberd-down sign-up, and a `PATCH /api/me` group (trim, empty, >64, exactly 64, control chars, missing/non-string, 401) plus `jid` on `GET /api/me`. Every existing `loadServerConfig`/`createApp`/`createAuth` call site was updated for the new required XMPP env and the `adminClient` dependency.

### Files changed

- New: `apps/server/src/xmpp/provisioning.ts`, `provisioning.test.ts`, `routes.ts`, `routes.test.ts`
- New (generated): `apps/server/drizzle/0002_superb_katie_power.sql`, `drizzle/meta/0002_snapshot.json`
- Modified: `apps/server/src/xmpp/config.ts`, `xmpp/config.test.ts`, `xmpp/admin-client.test.ts`, `xmpp/token.test.ts`, `auth/auth.ts`, `auth/routes.ts`, `auth/auth.test.ts`, `auth/cli-config.ts`, `auth/mailer.test.ts`, `app.ts`, `app.test.ts`, `config.ts`, `config.test.ts`, `db/schema.ts`, `index.ts`, `logger.test.ts`, `test-support.ts`, `apps/server/.env.example`
- Modified: `work/T-0017-xmpp-provisioning.md` (status + this Report)
- No dependency changes; `pnpm-lock.yaml` untouched.

### Commands run and real results

- `pnpm install`: PASS.
- `pnpm --filter @galena/server db:generate`: PASS — "[✓] Your SQL migration file ➜ drizzle/0002_superb_katie_power.sql"; re-run after the code was done: "No schema changes, nothing to migrate".
- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors."
- `pnpm typecheck`: PASS — 6/6 tasks successful.
- `pnpm test`: PASS — 6/6 tasks successful: server 121, protocol 132, mobile 48, agent-drivers 19, devtools 9, web 3.
- `pnpm build`: PASS — 2/2 tasks successful.

### Problems, deviations from the spec, open questions

- **Better Auth's id format (the spec asked me to document it).** Default Better Auth ids are random alphanumeric strings, e.g. `ZHj28vfbcT5vss0u0vWhveDDnx5ptPkk` (32 chars, includes uppercase). So per the spec's rule the localpart is that id **lowercased** and the id itself is used — the `sha256` fallback only triggers for ids that are still invalid after lowercasing (e.g. containing `@` or over 64 chars). I lowercased before testing validity, which is what the spec's "user id, lowercased" wording asks; the consequence is that ids differing only in case would map to the same localpart, which is theoretically possible but practically irrelevant for random 32-char ids. Documented in a comment and covered by a test.
- **`GET /api/me` does not provision.** It reads `xmpp_accounts` and returns `jid: null` when the row is missing (e.g. a user created before this migration). Provisioning happens on sign-up and on `POST /api/xmpp/token`. A lazy `GET` was not asked for and would make a read endpoint have a side effect.
- **`PATCH /api/me` response body** is `{ id, email, name, image }`. The spec only defined the request; I kept the shape close to `GET /api/me` minus `createdAt`/`jid`, since the caller already has those. `createdAt`/`jid` are omitted rather than re-fetched a second time on a write.
- **Token endpoint when provisioning still fails** returns `503 xmpp_unavailable` after the lazy retry (and logs a warning with `userId`). The spec fixes the success shape and the "never stuck" behavior but not this error; a retryable 503 is the natural choice. Not asserted by the spec's test list, so I added one.
- **Rate limiter counts requests before provisioning.** A request that later fails with 503 still consumes one of the 30 slots. This matches "at most 30 per 10 minutes per user" and prevents a failing account from being hammered.
- **`issueXmppToken` rejects a 300 s TTL only above `MAX_TOKEN_TTL_SECONDS` (600),** so `300` is fine; the route passes `TOKEN_TTL_SECONDS = 300` explicitly.
- **No Docker / no live check run.** As the spec requires, tests use PGlite and `FakeAdminClient`; Claude runs the live check against the dev stack.
- **No secrets in logs, verified by a test.** `routes.test.ts` asserts the raw token and `GALENA_XMPP_JWT_SECRET` are absent from the captured log output; `.env.example` uses `CHANGE_ME` placeholders only.

### Blocked / needs a decision

- Nothing blocked.

---

## Review (written by Claude)

**Verdict: approved.** Merged by Claude.

This is excellent. Provisioning is idempotent and safe under concurrency, a sign-up never gets stuck (lazy retry), there's a clean 503 path, rate limiting, and the name update goes through Better Auth's API.

### What I verified myself (on commit 5775c5f)
- `install`, `format:check`, `lint`, `typecheck`, `test` (server **121**) and `build`: all PASS.
- **First real end-to-end run against the dev stack** (Postgres, ejabberd), with the server on :3188:
  1. `invite:create` CLI → it ran the migrations and printed an invite link
  2. requesting a code **with** the invite → 200, and the code arrived in the dev mail log
  3. signing in with the code and the invite → 200 plus a session cookie
  4. `PATCH /api/me` `{name}` → 200. `GET /api/me` shows the name and a `jid`.
  5. `POST /api/xmpp/token` → `{ jid, token, expiresAt, service, domain, mucDomain }`
  6. a second, new email trying the **used** invite → the same 200, but **no code sent** (T-0015 gating works)
  7. **XMPP login to ejabberd with the server-issued token → online as the right JID**

### Findings
1. **(accepted)**
   - Lowercased Better Auth ids as localparts (random 32 characters). The collision risk is negligible, and the unique constraint rejects a collision rather than merging accounts.
   - `GET /api/me` has no side effects.
   - The `PATCH` response shape.
   - The 503 `xmpp_unavailable` response.
   - Counting rate-limited requests before provisioning.
