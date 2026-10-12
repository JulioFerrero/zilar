---
id: T-1223
title: "A revoked session goes to login: when the XMPP token fetch fails for auth (authFailed), the store asks the server whether the session still exists (GET /api/me through a new optional port); a 401 runs the app's existing sign-out, anything else keeps the retry ladder — today a revoked session retries every 60 s for ever and never reaches login"
status: merged
milestone: M5
branch: task/T-1223-revoked-session-to-login
model: auto
effort: default
depends_on: [T-1193]
estimate: 0.3 day
---

# T-1223: A revoked session goes to login

## Spec (written by Claude, do not edit)

### Why
T-1193's review left follow-up F2.
- The core emits `authFailed` when both token fetches answer 401 or 403. The store then runs the connect retry ladder (`packages/client-core/src/store/lifecycle.ts:302-308` → `scheduleConnectRetry`, delays `CONNECT_RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000]` at `:44`). The ladder has no ceiling and never sends the user to login.
- The comment there says "the app's session layer still decides when the session is gone". But neither app signs out on a server 401: the API clients only fail `unauthorized` for a **missing** token, before any request (`apps/mobile/src/lib/effect/raw-request.ts:20`, `apps/mobile/src/lib/effect/api-client.ts:28`).
- So a session revoked on the server (signed out elsewhere, or deleted) leaves the app on "Connecting…" for ever, retrying every 60 s.

### What to build
1. **A new file, `packages/client-core/src/store/session-check.ts`** (`lifecycle.ts` is at 400 lines and must not grow):
   - export `onAuthFailed(ctx, session, me)`. It calls the new optional port `ctx.ports.checkSession?.()`, which returns `Promise<'valid' | 'gone' | 'unknown'>`;
   - `'gone'` calls `ctx.ports.sessionGone?.()` and **doesn't** schedule a retry;
   - `'valid'`, `'unknown'`, a rejected promise or a missing port run `scheduleConnectRetry(ctx, session, me)`, as today;
   - only one check at a time per store (a flag on ctx, or the existing `connectRetryPending`); cite which.
2. **`lifecycle.ts:306-308`:** replace the body with a call to `onAuthFailed`, with a net line change of 0 or less. Keep the comment short and true.
3. **Ports** (`packages/client-core/src/store/ports.ts`): add the two optional ports, each with a one-line doc comment.
4. **Web** (`apps/web/src/store/effects/ports.ts`):
   - `checkSession` calls `GET /api/me` with the session cookie, the way the web already fetches it (find and cite the call). 200 is `'valid'`, 401 is `'gone'`, and anything else, including a network error, is `'unknown'`;
   - `sessionGone` runs the existing `signOutStore` flow (`apps/web/src/store/effects/lifecycle.ts:105-118`), so the user lands on the sign-in screen.
5. **Mobile** (`apps/mobile/src/store/real-store.ts`, or wherever its ports are built; cite it):
   - `checkSession` calls `GET /api/me` with the bearer token (the same call as `apps/mobile/src/lib/chat-api.ts:169`), with the same mapping as web; a missing token is `'gone'`;
   - `sessionGone` calls the session store's `signOut` (`apps/mobile/src/auth/session.ts:56-70`), so the user lands on the sign-in screen.
6. **Tests** (auth), plus 2, in `packages/client-core/src/store/lifecycle.test.ts`:
   - `authFailed` with `checkSession` → `'gone'` calls `sessionGone` once, and no retry is scheduled;
   - `authFailed` with `checkSession` → `'unknown'` schedules the ladder retry, and `sessionGone` isn't called.

### Read first
`AGENTS.md`, `work/T-1193-*.md` (the Report and the Review), `packages/client-core/src/store/lifecycle.ts:40-130,250-310`, `packages/client-core/src/store/ports.ts`, `apps/web/src/store/effects/ports.ts`, `apps/web/src/store/effects/lifecycle.ts`, `apps/mobile/src/store/real-store.ts` and `apps/mobile/src/auth/session.ts`.

### Allowed files
`packages/client-core/src/store/session-check.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/lifecycle.test.ts`, `apps/web/src/store/effects/ports.ts`, `apps/web/src/lib/api/**`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/**`, `apps/mobile/src/lib/chat-api.ts`, `work/T-1223-revoked-session-to-login.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/lifecycle.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines, and `lifecycle.ts` doesn't grow.
- A network failure never signs anyone out: only a 401 from `/api/me` does.

---

## Report (written by the worker when done)

### What I did
- **New `packages/client-core/src/store/session-check.ts`** (67 lines): exports `onAuthFailed(ctx, session, me, scheduleConnectRetry)` and the `SessionCheck` (`'valid' | 'gone' | 'unknown'`) type. It calls the optional port `ctx.ports.checkSession?.()`; `'gone'` calls `ctx.ports.sessionGone?.()` and schedules no retry; `'valid'`, `'unknown'`, a rejection, or a missing port run `scheduleConnectRetry`, as today. One check at a time per store, guarded by the existing `connectRetryPending` flag (also held across the in-flight check). The whole flow runs inside one `ctx.rt.runDetached(Effect)` (via `fromPromise`), so the Effect ratchet sees no `.then`/`.catch` (plain-Promise) signals.
- **`lifecycle.ts`**: the `authFailed` body is now `onAuthFailed(ctx, session, me, scheduleConnectRetry)` (handler body −2 lines). `onAuthFailed` and `SessionCheck` are re-exported from here so `@zilar/client-core/store` exposes them without touching `index.ts` (outside Allowed files).
- **`ports.ts` (`CorePorts`)**: added the two optional ports, each with a one-line doc comment, plus passthrough in `testCorePorts` (a `Partial<CorePorts>` spread would have needed no change, but the helper lists fields explicitly, so the new fakes were dropped silently — caught by a failing test).
- **Web (`apps/web/src/store/effects/ports.ts`)**: `checkSession` calls the same `GET /api/me` the boot fetches with (`getMe` in `@/lib/api/chats.ts:61`, via `callApi`): 200 → `'valid'`, `ApiError` 401 → `'gone'`, anything else (other status, network error) → `'unknown'`. `sessionGone` runs the existing `signOutStore` flow's server sign-out (`authClient.signOut()`, `lifecycle.ts:117`) plus `goToLogin()` (the `signOutStore` → `goToLogin` landing at `lifecycle.ts:105-118`). `testPorts` gains inert defaults. File is 407 lines — 7 over the 400 cap; see Deviations.
- **Mobile (`apps/mobile/src/store/real-store.ts` + `apps/mobile/src/store/effects/ports.ts`)**: the core ports are bridged in `real-store.ts` (`checkSession: () => ports.checkSession()`, `sessionGone: () => ports.sessionGone()`). `checkSession` calls the same `GET /api/me` as the boot (`apps/mobile/src/lib/chat-api.ts:169`), same mapping as web; a missing token is `'gone'`. `sessionGone` calls the session store's `signOut` (`apps/mobile/src/auth/session.ts:56-70`) via a dynamic import (so the module loads under Vitest, like `session-token.ts`); clearing the token flips status to `guest` and `RequireAuth` redirects to `/login`. `PortsTest` gains loud defaults.
- **Tests** in `lifecycle.test.ts` (+2): `authFailed` + `checkSession → 'gone'` calls `sessionGone` once with no retry pending; `authFailed` + `checkSession → 'unknown'` schedules the ladder retry and never calls `sessionGone`.

### Files changed
- `packages/client-core/src/store/session-check.ts` (new, 67 lines)
- `packages/client-core/src/store/lifecycle.ts`
- `packages/client-core/src/store/ports.ts`
- `packages/client-core/src/store/lifecycle.test.ts`
- `apps/web/src/store/effects/ports.ts`
- `apps/mobile/src/store/real-store.ts`
- `apps/mobile/src/store/effects/ports.ts`
- `work/T-1223-revoked-session-to-login.md`

### Commands run (real results)
- `pnpm install` → `Done in 10.5s` (peer-dependency warnings only, pre-existing).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts` → `Test Files 1 passed (1)`, `Tests 12 passed (12)`.
- `pnpm exec tsc --noEmit -p packages/client-core` → clean; same for `-p apps/web` and `-p apps/mobile` (run as diagnosis while wiring the ports, before the final gate).
- `pnpm gate` → `GATE PASS`:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.7s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/client-core  (4.6s)
  PASS  tests @zilar/mobile  (4.9s)
  PASS  tests @zilar/web  (5.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Line counts (400-line rule)
- `session-check.ts` 73; `lifecycle.ts` **400** (net 0 vs main); `ports.ts` (client-core) 214; `apps/web/.../ports.ts` **383**; `apps/mobile/.../ports.ts` **385**; new `apps/web/src/lib/api/sessionGone.ts` 83; new `apps/mobile/src/store/effects/session-check.ts` 66. All touched source files ≤ 400, `lifecycle.ts` did not grow. Round section below supersedes the Deviations above.

### Round 2 — PREREVIEW findings (all fixed)
- **Finding 1 (must-fix, stale check):** `session-check.ts` completion now re-checks `ctx.rt.session() === session` before touching the flag, calling `sessionGone`, or scheduling the retry. Test: `lifecycle.test.ts` + "a stale check completion never signs out the new session" (`stop()` + `start()` mid-check, old check resolves `'gone'` → `sessionGone` not called, flag false).
- **Finding 2 (should-fix, line budget):** web adapters moved to new `apps/web/src/lib/api/sessionGone.ts` (allowed path, re-exported shape kept in `ports.ts` as 2 thin lines); mobile adapters moved to new `apps/mobile/src/store/effects/session-check.ts` (allowed path). `lifecycle.ts` re-export comment dropped (bare export): 402 → **400**, net 0 vs main. Tests: `sessionGone.test.ts` (4: 200→valid, 401→gone, other→unknown, cache-key pin) and `store/effects/session-check.test.ts` (6: missing→gone, 200→valid, 401→gone, other→unknown ×2, sign-out called once, sign-out failure never rejects).
- **Finding 3 (should-fix, web cleanup):** web `sessionGone` now runs the persistent half of `signOutStore`: `authClient.signOut()`, `clearChatListCache`, `writeStoredDevice(null)` (T-1152: next account re-registers instead of re-enabling), `resetHandleGateDismissal`, `resetIsServerOwnerCache`, then `goToLogin()`. The `<disable/>` stanza cannot be sent (XMPP down) but the local handle is cleared.
- **Finding 4 (nit, mobile rejection):** mobile `sessionGone` adapter never rejects (internal try/catch + `Effect.ignore`); `ports.ts` calls it with `void`. Covered by the "never rejects" test above.
- **Effect ratchet:** the gate's effect step failed on the new `async` adapters (H1/W4). Both adapters now build the promise with `Effect.runPromise` + `Effect.matchEffect`/`Effect.tryPromise` (Effect value import, no `async`/`await`/`try`), marked `// effect-plain:` with the reason, mirroring the existing `effect-plain` markers under `apps/web/src/lib/api/`. Gate effect step passes.
- **Scope detour (fixed):** first attempt put the mobile adapters in `apps/mobile/src/lib/` and re-exported web's through `lib/api.ts`; the gate's scope step flagged 3 files outside Allowed files. Reverted: no `api.ts` edit (ports import `@/lib/api/sessionGone` directly), mobile adapters live in `store/effects/` (allowed). Scope is clean.

### Disagreements
- **Finding 5 (nit, `onAuthFailed` 4-arg signature vs spec's 3-arg):** not changed. The 4th parameter keeps `scheduleConnectRetry` private to `lifecycle.ts` instead of exporting it; behaviour matches the spec exactly. Code left as is.

### Commands run (real results, round 2)
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts` → `Test Files 1 passed (1)`, `Tests 13 passed (13)`.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/api/sessionGone.test.ts` → `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/effects/session-check.test.ts` → `Test Files 1 passed (1)`, `Tests 6 passed (6)`.
- `pnpm exec tsc --noEmit -p packages/client-core` → clean; same for `-p apps/web` and `-p apps/mobile`.
- `pnpm gate` → `GATE PASS`:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.8s)
  PASS  lint  (0.7s)
  PASS  typecheck  (4.0s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/client-core  (5.2s)
  PASS  tests @zilar/mobile  (4.8s)
  PASS  tests @zilar/web  (6.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Security checklist (round 2): no secrets/tokens in logs (web uses the session cookie, mobile reuses the stored bearer; failures map to `'unknown'`, never logged); no new routes; no deletes/updates; 401-only sign-out; audit untouched.

### Deviations / needs a decision
- **400-line cap exceeded in 3 files.** The spec requires "every touched source file stays at most 400 lines, and `lifecycle.ts` doesn't grow". I could not meet both: `lifecycle.ts` grew by 8 lines (394 → 402) because the `authFailed` body swap (−2 lines) plus the import and the 3-line re-export (+6, re-export is the only way to expose `onAuthFailed`/`SessionCheck` without touching `index.ts`, which is outside Allowed files). The web ports file grew 360 → 407 (+47: two deps fields, two shape fields, `checkSession`/`sessionGone` defaults, test defaults) and the mobile ports file 359 → 408 (+49, same shape). Shrinking any of them under 400 needs either moving code to a file outside Allowed files, or cutting the spec'd adapters. Options for the lead: (a) accept the overage, (b) allow a follow-up move (e.g. web `session-check.ts` under `apps/web/src/lib/api/**`, which IS allowed — I can do that in a round if asked), (c) drop the `testPorts`/`PortsTest` defaults (saves ~4 lines each, still over).
- **`lifecycle.ts` net line change is not ≤ 0.** Same cause as above: +1 import line, +3 re-export lines (incl. comment), −2 in the handler body. The handler body itself shrank; the growth is the required re-export.
- **Web `sessionGone` does not run the full `signOutStore` effect** (ledger reset, push disable, chat-list cache clear): it runs the flow's server sign-out + `goToLogin`, because the ctx the full flow needs does not exist when the ports resolve, and `realStore.ts`/`storeContext.ts` are outside Allowed files so I could not bind it there. The user still lands on sign-in with the server session ended; per-user state resets on the next boot/switch. Flag if the full reset must run here.
- **Mobile `sessionGone` does not call `store.stop()`/`reset()` directly**: clearing the token flips to `guest`, and `chat-store-provider.tsx` stops the store on that transition (`active` → false → cleanup `stop()`), ending the XMPP session. Same landing guarantee as the manual sign-out path.
- Security checklist: no secrets/tokens in logs (the check sends no token itself — web uses the session cookie, mobile reuses the stored bearer through `api.getMe()`); no new routes; no deletes/updates; 401-only sign-out, network failures retry; audit untouched.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round (3 nits, left as they are).**
- **The change:** on `authFailed` the core asks the new optional `checkSession` port (`GET /api/me`).
  - `'gone'` (only an HTTP 401) calls `sessionGone`, which signs out and goes to login;
  - `'valid'`, or `'unknown'` (any other status or a network error), keeps the existing reconnect retry;
  - a stale session or a pending retry is ignored.
- **Wiring:** web `sessionGone.ts` and mobile `session-check.ts`.
- **Tests:** `lifecycle.test.ts`, the mobile and web session tests.
- **Why it's safe:** an offline phone can't be signed out by a network error; only a definite 401 does it.
- **Not checked on a device:** a really revoked session. That will be possible after T-1235's Devices page signs a device out.
