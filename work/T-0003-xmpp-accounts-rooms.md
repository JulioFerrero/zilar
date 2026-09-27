---
id: T-0003
title: Spike S1 — ejabberd accounts, token login and group chats from our server
status: todo
milestone: M0
branch: task/T-0003-xmpp-accounts-rooms
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0002, T-0013]
estimate: 1–2 days
---

# T-0003: ejabberd accounts, token login, group chats

## Spec (written by Claude, do not edit)

### Goal
Prove, with working code and an end-to-end script, the whole chat backbone our server needs from ejabberd:
1. **Our server creates XMPP accounts** through ejabberd's admin API. Clients never register themselves.
2. **Clients log in with a short-lived token issued by our server,** not a stored password.
3. **Our server creates group chats (MUC rooms) and sets who's a member.**
4. **Two users exchange messages in a room and can read the history back** (MAM).

This is the "S1" spike from plan §23. The code should be production-shaped (typed, tested, zod-validated), because M1 builds directly on it.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`:
  - §6.1 ejabberd (auth integration)
  - §6.2 identity rules
  - §7.1 entities
  - §23 spike S1
- `work/T-0002-dev-infra.md`: the Review section (follow-up 4 applies to this task)
- `infra/ejabberd/ejabberd.yml`, `infra/docker-compose.dev.yml`, `packages/devtools/src/smoke.ts`
- ejabberd docs for version **26.07**:
  - `mod_http_api` commands: `register`, `check_account`, `create_room_with_opts`, `set_room_affiliation`, `get_room_affiliations`, `destroy_room`
  - authentication: **JWT authentication** (`auth_method: jwt`, `jwt_key`, `jwt_jid_field`)
- `@xmpp/client` docs (connect over WebSocket, SASL PLAIN, MUC join presence, MAM query)

### Decisions (follow them)
- **Token login = ejabberd JWT auth.**
  - `auth_method: [sql, jwt]`. SQL stays only for the admin account.
  - Our server signs **HS256** JWTs with a shared secret, with claim `jid` (the user's bare JID) and `exp` (≤ 10 minutes).
  - Clients log in with SASL PLAIN, using the JWT as the password.
  - If ejabberd 26.07 can't do JWT with an HS256 (`oct`) JWK, **stop, set `status: blocked`**, and describe what you found, including which alternatives exist (OAuth tokens via `oauth_issue_token`, or external auth). Don't switch approach on your own.
- **The shared secret** comes from env `GALENA_XMPP_JWT_SECRET` (at least 32 random bytes).
  - ejabberd needs it as a JWK file. Generate it at container start from the env var, e.g. a small entrypoint wrapper or init step writing `/opt/ejabberd/conf/jwt.jwk` inside the container.
  - **Never commit a real key file.** If a generated key file ever lands in the repo tree, git-ignore it.
- **Room creation is restricted to the admin (server) account:** `muc_create: allow: admin` (the T-0002 follow-up). Users only join rooms our server created for them.
- **Room JIDs** are `<id>@rooms.galena.localhost`, where `<id>` matches our `IdSchema` from `@galena/protocol`.

### Allowed files
- `infra/ejabberd/**`, `infra/docker-compose.dev.yml`, `infra/.env.example`
- `apps/server/src/xmpp/**` (new), `apps/server/package.json`
- `packages/devtools/**`, to add the end-to-end script
- `pnpm-lock.yaml`
- `.gitignore`, only for a generated key file if needed
- `README.md`, only a short note in the `### Infrastructure` subsection about the new env var and `pnpm xmpp:e2e`
- Root `package.json`, only to add the `xmpp:e2e` script

**Not allowed:** `apps/mobile/**`, `apps/web/**`, `packages/protocol/**`, `.github/**`. Other workers are editing those.

### Allowed dependencies
- **`apps/server`:** `zod` (v4), `jose` (JWT signing)
- **`packages/devtools`:** `@xmpp/client`, `@xmpp/debug` (optional)

### What to build
1. **`apps/server/src/xmpp/config.ts`.** A zod schema for the env this module needs:
   - `EJABBERD_API_URL` (default `http://127.0.0.1:5280/api`)
   - `EJABBERD_ADMIN_JID`
   - `EJABBERD_ADMIN_PASSWORD`
   - `XMPP_DOMAIN` (default `galena.localhost`)
   - `XMPP_MUC_DOMAIN` (default `rooms.galena.localhost`)
   - `GALENA_XMPP_JWT_SECRET` (≥ 32 chars)

   Export `loadXmppConfig(env)`, which throws one clear error listing every missing or invalid variable. **Never include secret values in error messages.**
2. **`apps/server/src/xmpp/admin-client.ts`.** `createEjabberdAdminClient(config, fetchImpl = fetch)`, a small typed wrapper over `/api` with admin basic auth. Methods:
   - `registerUser(localpart)`: creates the account with a long random password nobody uses, since login is via JWT. Idempotent: if the account exists, return `{ created: false }`.
   - `userExists(localpart)`
   - `createRoom(roomId, { title, membersOnly: true, persistent: true, mam: true })`: idempotent.
   - `setAffiliation(roomId, jid, 'owner' | 'admin' | 'member' | 'none')`
   - `getAffiliations(roomId)`: returns the affiliation list, validated with zod.
   - `destroyRoom(roomId)`

   Rules:
   - Validate every response with zod.
   - Non-2xx responses and ejabberd error bodies become a typed `EjabberdApiError` with the command name and status. **No secrets in messages.**
   - `localpart` and `roomId` are validated (lowercase `[a-z0-9._-]`, 1–64 chars) before any request.
3. **`apps/server/src/xmpp/token.ts`.** `issueXmppToken(config, bareJid, ttlSeconds = 300)`:
   - Returns `{ token, expiresAt }`.
   - HS256 via `jose`, with claims `jid` and `exp`.
   - Reject a JID that isn't on `XMPP_DOMAIN`.
4. **Unit tests** (Vitest, no network):
   - config: valid, missing vars, and a short secret. The error message must not contain the secret.
   - admin client, using a fake `fetch`:
     - the correct URL, auth header and body per command
     - idempotency paths
     - error mapping
     - input validation rejecting `../x`, uppercase, and empty strings
   - token: it verifies with the same secret, `exp` ≤ ttl, a wrong domain is rejected, and verification fails with a different secret.
5. **ejabberd config:**
   - JWT auth as decided above
   - `muc_create: allow: admin`
   - anything JWT needs in compose (env var, entrypoint or init step)

   `pnpm infra:up` and `pnpm infra:smoke` must still pass. **Update the smoke test only if needed and say why.**
6. **End-to-end script `packages/devtools/src/xmpp-e2e.ts`** and root script `pnpm xmpp:e2e`, run against the running dev stack. Using the server module (import it from `apps/server/src/xmpp/*` by relative path or a workspace dependency; say which in the Report), it must:
   1. Register `e2e-alice` and `e2e-bob` (random suffix per run).
   2. Issue a JWT for each.
   3. Connect both with `@xmpp/client` over `ws://127.0.0.1:5280/ws`, using SASL PLAIN with the JWT.
   4. Create room `e2e-<suffix>` and set Alice as owner and Bob as member.
   5. Both join the room.
   6. Alice sends 3 messages, and Bob must receive all 3 live.
   7. Bob disconnects and reconnects with a **new** token, then fetches room history with MAM (XEP-0313, `urn:xmpp:mam:2`, query to the room JID). All 3 messages must come back in order.
   8. **Negative checks:**
      - (a) An expired token (ttl 1 s, then wait 2 s) is rejected.
      - (b) A token signed with the wrong secret is rejected.
      - (c) `carol`, who isn't a member, can't join the members-only room.
      - (d) A normal user can't create a room.
   9. Clean up: destroy the room. Leave the users; that's fine in dev.
   10. Print `PASS`/`FAIL` per step, and exit non-zero on any failure.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass.
- [ ] `pnpm infra:reset` (answer yes), then `pnpm infra:up`, `pnpm infra:smoke` and `pnpm xmpp:e2e` all pass. Paste the full `xmpp:e2e` output in the Report.
- [ ] No real key or secret is committed. `infra/.env.example` documents `GALENA_XMPP_JWT_SECRET` with `CHANGE_ME`.
- [ ] Every negative check fails the way it should, with the actual ejabberd behavior described in the Report.
- [ ] The Report explains how ejabberd reads the JWT key and why that approach was chosen.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm infra:reset      # answer yes
pnpm infra:up
pnpm infra:smoke
pnpm xmpp:e2e
pnpm infra:down
```

### Out of scope
- User sign-up and login screens, Better Auth, database tables (M1).
- Push notifications (T-0005), file uploads, mobile.

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
