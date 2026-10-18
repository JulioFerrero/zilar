---
id: T-1982
title: "Auth hardening: signing a device out (Settings › Devices, or sign-out) also ends the user's live XMPP sessions, so a revoked device stops receiving and sending at once"
status: merged
milestone: M5
branch: task/T-1982-revoke-ends-xmpp
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-1982: Revoking a session ends its XMPP stream

## Spec (written by Claude, do not edit)

### Why
This comes from the lead's private security review, 2026-10-18 (T-1968).
- **Today:** deleting a session row stops the device from getting a new XMPP token. The already-open XMPP stream stays connected until the socket drops, so a revoked device keeps receiving and sending.
- **After this task:** revoke and sign-out also end the user's ejabberd sessions. The user's other devices reconnect by themselves with fresh tokens; the revoked one cannot.

### Facts (read by the lead on 2026-10-18)
- **Revoke today.** `apps/server/src/auth/sessions.ts` (143 lines): `revokeSession(deps, ...)` (`:104-139`) runs `DELETE FROM "session" WHERE id = ... AND user_id = ...`, then writes an audit record. It makes no ejabberd call.
  - `SessionsDeps` is at `:21`.
  - `auth/api.ts:191` calls `revokeSession(`.
- **Better Auth hooks.** `apps/server/src/auth/auth.ts:284-293` has only `databaseHooks.session.create.after`, and no delete hook. So Better Auth's own `/sign-out`, `/revoke-session(s)` and `/revoke-other-sessions` never touch ejabberd either.
- **The admin client.** `apps/server/src/xmpp/admin/client.ts` (319 lines) wraps the ejabberd admin HTTP API: `call(command, args)`, then `expectOk` or `expectMutationResult`. See `userResources` (`:91-100`) and `changePassword` (`:102-111`) for the pattern.
  - It has no kick command yet.
  - The ejabberd `api_permissions` allow every HTTP API command except `stop` and `start`, in all three configs (`deploy/ejabberd/ejabberd.yml:162-172`, `infra/ejabberd/ejabberd.yml`, `deploy/baremetal/ejabberd.yml:149-163`).
- **The token check.** The XMPP token is a 5-minute JWT, checked only at login (`apps/server/src/xmpp/token.ts`).

### Steps
1. **The kick command.** Add `kickUser(localpart: string, reason: string): Promise<void>` to the admin client. It calls ejabberd's `kick_user` (`user`, `host: config.domain`) and follows the existing pattern.
   - An offline user (0 sessions kicked) is success.
2. **On revoke.** After the row delete in `revokeSession`, call `kickUser` for that user. This is best effort: log a failure and never fail the revoke.
   - Wire the admin client into `SessionsDeps` from where `auth/api.ts` builds the deps.
3. **On sign-out and Better Auth's own revoke routes.** Add a `databaseHooks.session.delete.after`, if the installed Better Auth version supports it, that does the same kick. If it doesn't support it, say so in the Report and cover `/sign-out` some other way, for example an `after` hook on that path.
   - Kicking the user ends all of that user's XMPP sessions, so the other devices reconnect briefly. That's accepted; say it in a code comment.
4. **Tests (auth is a crucial area).**
   - In `apps/server/src/auth/sessions.test.ts`: a revoke calls `kickUser` with the right localpart, and a kick failure doesn't fail the revoke.
   - The nearest admin-client test: the request body for `kick_user`.
5. **Keep files at or under 400 lines.**

### Allowed files
- `apps/server/src/xmpp/admin/client.ts`
- `apps/server/src/xmpp/admin/types.ts`
- `apps/server/src/auth/sessions.ts`
- `apps/server/src/auth/sessions.test.ts`
- `apps/server/src/auth/api.ts`
- `apps/server/src/auth/auth.ts`
- `apps/server/src/xmpp/admin/client.test.ts`
- `work/T-1982-revoke-ends-xmpp.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/auth/sessions.test.ts src/xmpp/admin --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- After deploy, the lead signs a test device out in Settings › Devices. The ejabberd `user_resources` list for that user goes empty, then other devices reconnect.

---

## Report (written by the worker when done)

### What I did
- **Admin client** (`apps/server/src/xmpp/admin/client.ts`, `types.ts`): added
  `kickUser(localpart, reason)`, which posts `kick_user` with `{ user, host: config.domain }`.
  It accepts the raw result string ejabberd answers (`Kicked sessions: N`) and
  tolerates a number; any other result is an `EjabberdApiError`. An offline user
  (`Kicked sessions: 0`) is success. ejabberd's `kick_user` takes no reason, so
  `reason` only appears in the failure detail.
- **Revoke** (`apps/server/src/auth/sessions.ts`, `auth/api.ts`): after the row
  delete and the audit entry, `revokeSession` calls `kickUser` for the user's
  localpart. It is best effort: a failure is logged with `deps.logger` and never
  fails the revoke. `auth/api.ts` now passes the admin client and logger.
- **Sign-out / Better Auth revoke routes** (`apps/server/src/auth/auth.ts`): the
  installed Better Auth 1.7.6 supports `databaseHooks.session.delete.after`, so
  that hook kicks too. It covers `/sign-out`, `/revoke-session`,
  `/revoke-other-sessions`. The comment records that ejabberd kicks all of the
  user's streams, so the user's other devices reconnect briefly with fresh
  tokens; that blip is accepted.
- **Tests**: three new cases in `apps/server/src/auth/sessions.test.ts` (revoke
  kicks the right localpart, a failed kick still deletes the session, sign-out
  kicks) and a new `apps/server/src/xmpp/admin/client.test.ts` (request body for
  `kick_user`, integer and zero results, rejection of an unexpected result).

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sessions.test.ts src/xmpp/admin`:
  first run 8 passed, 1 failed (the sign-out test got 403 because Better Auth
  wants an `Origin` on a cookie-authenticated POST), then
  `... src/auth/sessions.test.ts`: 6 passed after the test sent `origin`.
- `pnpm gate` from the repo root:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- `kickUser` is optional on `EjabberdAdminClient` (`kickUser?`): `FakeAdminClient`
  in `apps/server/src/test-support.ts`, which is outside this task's Allowed
  files, implements the interface and would not compile with a required method.
  Every real client implements it, callers guard for its absence, and the new
  tests use a `KickAdminClient` subclass. Make it required in a follow-up that
  may edit `test-support.ts`.
- `reason` is not sent to ejabberd: `kick_user` takes only `user` and `host`.
  It is kept in the signature as the spec asks and used in the failure detail.
- Revoke and sign-out both kick all of the user's XMPP streams deliberately;
  other devices reconnect with their still-valid short-lived token.

### Round 2 (fix round after prereview)

Findings fixed:
- **Finding 1 (must-fix)**: `kick_user` now accepts the raw result string that
  ejabberd 26.07 answers (`Kicked sessions: 2`), and still tolerates a number.
  `client.test.ts` gained the real wire-format cases (`"Kicked sessions: 2"` and
  `"Kicked sessions: 0"`); the integer tolerance case stays.
- **Finding 2 (should-fix)**: `databaseHooks.session.delete.after` skips the kick
  when the deleted row is already expired, so Better Auth's expired-session
  cleanup on the get-session path no longer kicks every live device. A new test
  in `sessions.test.ts` expires a session row, makes one request with the stale
  cookie and asserts zero kicks; it failed against the old unconditional hook
  (checked by temporarily removing the guard).

Not changed:
- **Finding 3 (nit)**: bulk revokes still issue one `kick_user` per deleted row.
  It is a nit and outside the lines this round changes.
- **F1 follow-up**: `kickUser?` stays optional until `test-support.ts` may be
  edited.

Tests run:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/xmpp/admin/client.test.ts`: 4 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sessions.test.ts`: 7 passed.

Gate (from the repo root):
```text
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  tests @zilar/server
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Disagreements

None.



## Review (written by Claude)

Approved after one auto round.
- **What it does.** Revoking a session and Better Auth's own sign-out and revoke routes (through `databaseHooks.session.delete.after`) now call `kick_user` for the session's owner. This is best effort: it is logged, and it never fails the revoke.
- **Expired sessions.** Better Auth's own clean-up of expired rows doesn't kick, which the guard and a test confirm.
- **Accepted trade-off.** Kicking ends all of that user's XMPP sessions, so their other devices reconnect with fresh tokens.
- **Live check after the deploy.** Sign a test device out, then see `user_resources` empty. If the logs show kick failures (a response-shape mismatch), widen the result decode.
- **Follow-up.** Make `kickUser` required once `test-support.ts` can change.
