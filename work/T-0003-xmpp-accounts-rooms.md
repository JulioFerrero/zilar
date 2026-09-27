---
id: T-0003
title: Spike S1 — ejabberd accounts, token login and group chats from our server
status: merged
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

- **`apps/server/src/xmpp/config.ts`** — `xmppEnvSchema` (zod) and `loadXmppConfig(env)`. Defaults for `EJABBERD_API_URL`, `XMPP_DOMAIN`, `XMPP_MUC_DOMAIN`; requires `EJABBERD_ADMIN_JID`, `EJABBERD_ADMIN_PASSWORD` and a ≥32-character `GALENA_XMPP_JWT_SECRET`. One error lists every bad variable, and only variable names + zod messages are used, never a value.
- **`apps/server/src/xmpp/admin-client.ts`** — `createEjabberdAdminClient(config, fetchImpl = fetch)` over `/api` with admin Basic auth. Methods `registerUser`, `userExists`, `createRoom`, `setAffiliation`, `getAffiliations`, `destroyRoom`. Every response is parsed as JSON and validated with zod; non-2xx responses and `{status:"error"}` bodies become a typed `EjabberdApiError` (command + status, no secrets). `localpart`/`roomId` are validated as lowercase `[a-z0-9._-]{1,64}` before any request. `registerUser` and `createRoom` are idempotent (`{created:false}` when the account/room exists); `registerUser` generates a 32-byte random password that is never stored by us or returned.
- **`apps/server/src/xmpp/token.ts`** — `issueXmppToken(config, bareJid, ttlSeconds = 300)` signs an HS256 JWT with `jose` (claims `jid`, `iat`, `exp`), returns `{token, expiresAt}`, rejects JIDs not on `XMPP_DOMAIN`, and rejects TTLs above `MAX_TOKEN_TTL_SECONDS` (600).
- **Unit tests** (`config.test.ts` 6, `admin-client.test.ts` 10, `token.test.ts` 6) with fake `fetch` and no network: URL, auth header and body per command; idempotency; error mapping; `../x`/uppercase/empty input rejection; token verification with the same and a different secret; `exp ≤ ttl`; wrong-domain rejection. The config test asserts the short secret itself never appears in the error.
- **ejabberd config** — added `auth_method: [sql, jwt]` and `jwt_key: /opt/ejabberd/conf/jwt.jwk`; changed the `muc_create` access rule from `allow: local` to `allow: admin` (T-0002 follow-up 4); added `mod_muc_admin: {}`, which the room-management API commands need and which T-0002's config was missing.
- **`infra/ejabberd/jwt-entrypoint.sh`** (new) — at container start it derives an HS256 `oct` JWK from `GALENA_XMPP_JWT_SECRET` (busybox `base64` → base64url) and writes `/opt/ejabberd/conf/jwt.jwk`, then `exec`s the image's normal `tini -- ejabberdctl "$@"`. Compose wires it as the entrypoint (and repeats `command: ['foreground']`, because overriding the entrypoint drops the image CMD).
- **`packages/devtools/src/xmpp-e2e.ts`** (new) and root `pnpm xmpp:e2e` — the end-to-end script, importing the server module **by relative path** (`../../../apps/server/src/xmpp/*`), not a workspace dependency (the server package has no library `exports`). It runs the ten checks from the spec and prints PASS/FAIL per step.
- **`packages/devtools/src/xmpp-client.d.ts`** (new) — `@xmpp/client@0.14` ships no TypeScript declarations, so a minimal ambient module declaration covers the surface the script uses (no `any`, no `@ts-ignore`).
- **`infra/.env.example`** got `GALENA_XMPP_JWT_SECRET=CHANGE_ME` and `EJABBERD_ADMIN_JID=admin@galena.localhost`; **`.gitignore`** got a defensive `infra/ejabberd/*.jwk`; **`README.md`** got a short note in `### Infrastructure`; root/devtools/`apps/server` `package.json` and `pnpm-lock.yaml` got the allowed dependencies.

### Files changed

- New: `apps/server/src/xmpp/config.ts`, `config.test.ts`, `admin-client.ts`, `admin-client.test.ts`, `token.ts`, `token.test.ts`
- New: `packages/devtools/src/xmpp-e2e.ts`, `packages/devtools/src/xmpp-client.d.ts`
- New: `infra/ejabberd/jwt-entrypoint.sh`
- Modified: `infra/ejabberd/ejabberd.yml`, `infra/docker-compose.dev.yml`, `infra/.env.example`, `.gitignore`
- Modified: `apps/server/package.json` (added `zod`, `jose`), `packages/devtools/package.json` (added `@xmpp/client`, `xmpp:e2e` script), `package.json` (added `xmpp:e2e`), `pnpm-lock.yaml`, `README.md`
- Modified: `work/T-0003-xmpp-accounts-rooms.md` (status + this Report)
- Not committed: `infra/.env` (generated locally, git-ignored) and the in-container `/opt/ejabberd/conf/jwt.jwk`.

### Commands run and real results

- `pnpm install`: PASS.
- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors … 40 files with 127 rules".
- `pnpm typecheck`: PASS — turbo "4 successful, 4 total".
- `pnpm test`: PASS — turbo "4 successful, 4 total": server 24, devtools 9, protocol 132, web 3.
- `pnpm build`: PASS — turbo "1 successful, 1 total".
- `printf 'yes\n' | pnpm infra:reset`: PASS — all three volumes removed.
- `pnpm infra:up`: PASS — Postgres, ejabberd and LiteLLM all reach "Healthy".
- `pnpm infra:smoke`: PASS — all 5 original checks (`pnpm infra:smoke` output unchanged; **no change to the smoke test was needed**):
  `PASS Postgres …` / `PASS ejabberd reports "started"` / `PASS ejabberd answers /api/status with admin auth` / `PASS ejabberd accepts the XMPP WebSocket <open/> handshake` / `PASS LiteLLM liveness endpoint answers 200`.
- `pnpm xmpp:e2e`: PASS, all 11 steps. Full output (after `infra:reset` + `infra:up`):

```
XMPP end-to-end spike: room e2e-mujxr614odmk@rooms.galena.localhost

PASS  our server registers the e2e users through the admin API
PASS  our server creates the members-only room and sets Alice owner, Bob member
PASS  our server issues a JWT and Alice and Bob log in with it
PASS  Alice and Bob join the room
PASS  Bob receives all three of Alice's messages live
PASS  Bob reconnects with a new token and reads the history back through MAM
      ejabberd answered: login failed for e2e-alice-mujxr614odmk: not-authorized - Invalid username or password
PASS  negative: an expired token is rejected
      ejabberd answered: login failed for e2e-alice-mujxr614odmk: not-authorized - Invalid username or password
PASS  negative: a token signed with the wrong secret is rejected
      the room answered with: registration-required
PASS  negative: Carol, who is not a member, cannot join the members-only room
      the MUC service answered with: forbidden
PASS  negative: a normal user cannot create a room
PASS  clean up: the server destroys the room

All steps passed.
```

- `pnpm infra:down`: PASS — containers and network removed, volumes kept.

### How ejabberd reads the JWT key, and why this approach

`auth_method: [sql, jwt]` makes ejabberd verify client passwords as JWTs. ejabberd never reads the secret from the environment: `jwt_key` must point at a file holding a PEM key, a JWK, or a JWK Set. HS256 needs a symmetric key, so the file is a single `oct` JWK. Our server signs HS256 with the raw UTF-8 bytes of `GALENA_XMPP_JWT_SECRET`; the JWK's `k` is base64url of exactly those bytes, so both sides agree. Verified with a real login: a valid HS256 token is accepted, a token signed with a different secret and a token for another domain are both rejected.

`infra/ejabberd/jwt-entrypoint.sh` is a compose entrypoint wrapper. It reads the secret from the environment (passed by compose), writes `{"kty":"oct","k":"<base64url>","alg":"HS256","use":"sig"}` to `/opt/ejabberd/conf/jwt.jwk` (`umask 077`), then hands over to the image's normal `tini -- ejabberdctl`. That conf directory is inside the container (not a bind mount and not a volume), so the key is regenerated on every start and never lands on the host. The alternative — writing the key from the host — would put a real key in the repo tree; the wrapper avoids that. `.gitignore` also ignores `infra/ejabberd/*.jwk` as a safety net, and `git status` confirms no key file is present.

### Negative checks — the actual ejabberd behaviour

- **Expired token (ttl 1 s, wait 2.5 s):** rejected at SASL with `not-authorized - Invalid username or password`.
- **Wrong secret:** rejected with the same `not-authorized - Invalid username or password`.
- **Carol, not a member, joins the members-only room:** the MUC service answers the join presence with `<error type='auth'><registration-required/>` (XMPP condition `registration-required`, stanza error code 403).
- **A normal user creates a room** (`muc_create: allow: admin`): the MUC service answers the join presence of the new room with `<error type='cancel'><forbidden/>` (condition `forbidden`).

### Problems, deviations from the spec, open questions

1. **`mod_muc_admin` was missing** from T-0002's `infra/ejabberd/ejabberd.yml`. Without it, `create_room_with_opts`, `set_room_affiliation`, `get_room_affiliations` and `destroy_room` answer `404 Endpoint not found` / `400 unknown_command`. The image's default config loads it; I added `mod_muc_admin: {}`. Required for this task.
2. **`EJABBERD_ADMIN_JID` was not in `infra/.env.example`.** The config schema (per the spec) requires it and the e2e reads it from `infra/.env`, so I added it there as `admin@galena.localhost` (matching the dev container's `EJABBERD_MACRO_ADMIN`). An existing T-0002 `infra/.env` needs this one line for `pnpm xmpp:e2e`; `infra:smoke` is unaffected.
3. **Security nuance in `auth_method: [sql, jwt]` (the spec's literal value).** I verified that with this order a non-admin account can still authenticate with its stored SQL password (a probe registered a user with a known password and logged in over SASL with it). That password is 32 random bytes generated inside `registerUser` and never exposed, so it is not practically exploitable, but SQL is not literally "only for the admin account". The ejabberd docs warn about the order and describe a stricter setup: `auth_method: [jwt, sql]` plus `jwt_auth_only_rule: jwt_only` (`deny: admin, allow: all`), which would make every non-admin account JWT-only. **Question:** should I switch to that stricter setup in a follow-up? I kept the spec's literal `[sql, jwt]` rather than change a security decision on my own.
4. **`issueXmppToken` is `async`.** `jose` signs asynchronously, so it returns `Promise<{token, expiresAt}>`. The spec gave the signature without saying whether it is sync; the shape is otherwise as specified.
5. **`roomId`/`localpart` validation is stricter than `IdSchema`.** The spec's admin-client rule is lowercase `[a-z0-9._-]`, 1–64 chars, while `@galena/protocol`'s `IdSchema` also allows uppercase, `~` and up to 128. I followed the explicit rule. If room ids must match `IdSchema` exactly, tell me and I'll widen it.
6. **`@xmpp/client` has no TypeScript types.** I added a small ambient declaration (`xmpp-client.d.ts`) instead of a new `@types` dependency.
7. **`@xmpp/debug` (allowed, optional) is not used.** I left it out to avoid an unused dependency.
8. **`createRoom` returns `{created: boolean}`** (the spec only required idempotency and did not give a return type), mirroring `registerUser`.
9. **The e2e script re-joins the room after Bob reconnects, before the MAM query.** XEP-0313 for MUC answers an occupant; without the re-join the query can be refused. This is part of "reconnect", not a different check.
10. **`jwt-entrypoint.sh` needs no execute bit** because compose runs it as `/bin/sh /galena/jwt-entrypoint.sh`; it is a bind-mount, read-only, and Docker Desktop's exec-bit problem (seen with the Postgres init script in T-0002) does not apply.
11. **`infra/.env` is local and git-ignored.** The dev values used in this run were generated with `openssl rand` and are not shown or committed.

### Blocked / needs a decision

- Nothing blocked. The one decision I would like reviewed is item 3 above (whether SQL password auth for non-admin accounts should be disabled with `jwt_auth_only_rule`).

### Round 2

Answer to review finding 1: **yes, non-admin accounts are now JWT-only.**

**Changes**

- `infra/ejabberd/ejabberd.yml`: switched to `auth_method: [jwt, sql]` (JWT first) and added `jwt_auth_only_rule: jwt_only`, with the access rule `jwt_only: { deny: admin, allow: all }` in `access_rules`. Only the admin account can use its SQL password; every non-admin account is restricted to JWT. I followed the ejabberd docs: **Configure → Authentication → "JWT Authentication"** (the `[jwt, sql]` example with `jwt_auth_only_rule`) and **Top-Level Options → `jwt_auth_only_rule`** (value is an access-rule name; "users that match this rule can only use JWT").
- `apps/server/src/xmpp/admin-client.ts`: added `changePassword(localpart, password)`, a zod-validated wrapper over `/api/change_password` (`{user, host, newpass}`), used by the new negative check. Unit tests added (body per command; empty password rejected before any request).
- `packages/devtools/src/xmpp-e2e.ts`: registers a dedicated `e2e-password-<suffix>` account and adds the negative step **"a non-admin account cannot log in with a known SQL password"**. It sets a known password through `changePassword`, tries SASL PLAIN with it (must be rejected), then logs the same account in with a **valid JWT** (must succeed).

**Checks (all pass, from a clean `infra:reset`)**

- `pnpm format:check`: PASS. `pnpm lint`: 0 warnings, 0 errors. `pnpm typecheck`: 4 successful, 4 total. `pnpm test`: 4 successful, 4 total (server 26, devtools 9, protocol 132, web 3). `pnpm build`: 1 successful, 1 total.
- `printf 'yes\n' | pnpm infra:reset` then `pnpm infra:up`: PASS, all three services healthy.
- `pnpm infra:smoke`: PASS, 5/5 — the admin's SQL password still authenticates `/api`, so `jwt_auth_only_rule` did not lock the admin out.
- `pnpm infra:down`: PASS.

Full `pnpm xmpp:e2e` output (clean stack):

```
XMPP end-to-end spike: room e2e-mujyawzeukfi@rooms.galena.localhost

PASS  our server registers the e2e users through the admin API
PASS  our server creates the members-only room and sets Alice owner, Bob member
PASS  our server issues a JWT and Alice and Bob log in with it
PASS  Alice and Bob join the room
PASS  Bob receives all three of Alice's messages live
PASS  Bob reconnects with a new token and reads the history back through MAM
      ejabberd answered: login failed for e2e-alice-mujyawzeukfi: not-authorized - Invalid username or password
PASS  negative: an expired token is rejected
      ejabberd answered: login failed for e2e-alice-mujyawzeukfi: not-authorized - Invalid username or password
PASS  negative: a token signed with the wrong secret is rejected
      password login answered: login failed for e2e-password-mujyawzeukfi: not-authorized - Invalid username or password
PASS  negative: a non-admin account cannot log in with a known SQL password
      the room answered with: registration-required
PASS  negative: Carol, who is not a member, cannot join the members-only room
      the MUC service answered with: forbidden
PASS  negative: a normal user cannot create a room
PASS  clean up: the server destroys the room

All steps passed.
```

**Observed behaviour after the switch**

- A known SQL password on a non-admin account is rejected at SASL with `not-authorized - Invalid username or password`; the same account with a valid JWT logs in. This closes the gap from Round 1 item 3.
- The four earlier negative checks are unchanged (expired JWT, wrong secret, non-member join `registration-required`, user room creation `forbidden`).
- `pnpm infra:smoke` confirms the admin account is exempt from `jwt_auth_only_rule` and still uses SQL for `/api`.

---

## Review (written by Claude)

**Verdict (round 1): changes requested.** This is an excellent spike: 11/11 end-to-end steps, real negative checks, and a clean JWK-from-env design that keeps the key off the host. The one open security question (item 3) is answered **yes**, which needs a small round 2.

### Findings
1. **(must fix, security) Make every non-admin account JWT-only.**
   - Switch to `auth_method: [jwt, sql]` and add `jwt_auth_only_rule: jwt_only`, with an access rule `jwt_only: { deny: admin, allow: all }`, so only the admin account can use its SQL password. Check the exact syntax and order against the ejabberd 26.07 docs, and cite the doc section in the Report.
   - **New negative e2e step:** give a test user a **known** password through the admin API (`change_password`, or `register` with a known password for a dedicated test account), then try SASL PLAIN with that password. It **must be rejected**. The same user with a valid JWT must still log in.
   - `pnpm infra:smoke` (which uses the admin's password on `/api`) must still pass.
2. **(accepted)** Adding `mod_muc_admin` was required and correct.
3. **(accepted)** `EJABBERD_ADMIN_JID` in `.env.example`: correct. Claude will add it and `GALENA_XMPP_JWT_SECRET` to Julio's local `infra/.env` after merge.
4. **(accepted)** An async `issueXmppToken` is fine, and so is `createRoom` returning `{created}`.
5. **(accepted)** Validating `roomId` and `localpart` more strictly (lowercase) than `IdSchema` is correct for XMPP localparts: it avoids case-folding ambiguity. Room ids the server generates will follow it.
6. **(accepted)**
   - the ambient types for `@xmpp/client`
   - importing the server module by relative path in the devtools script (fine for a dev tool)
   - re-joining the room before the MAM query
7. **(note for later)** `jwt-entrypoint.sh` derives the key from the raw secret bytes, so `GALENA_XMPP_JWT_SECRET` must be at least 32 random chars. The config already enforces that. Good.

**Verdict (round 2): approved.** Merged by Claude.

- From a clean `infra:reset` + `infra:up`, I ran `pnpm infra:smoke` → **5/5 PASS**, then `pnpm xmpp:e2e` → **12/12 PASS**. That includes the new check "a non-admin account cannot log in with a known SQL password", which is rejected with `not-authorized`, while the same account logs in with a valid JWT.
- The admin keeps SQL auth for `/api` (smoke passes). Round 1's finding 1 is resolved, with the doc sections cited.
- Rebased onto `main` (T-0011 and T-0014 had merged): I resolved `apps/server/package.json` and regenerated `pnpm-lock.yaml`, then all code checks pass. Julio's local `infra/.env` got `GALENA_XMPP_JWT_SECRET` and `EJABBERD_ADMIN_JID`.
