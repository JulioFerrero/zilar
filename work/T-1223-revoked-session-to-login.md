---
id: T-1223
title: "A revoked session goes to login: when the XMPP token fetch fails for auth (authFailed), the store asks the server whether the session still exists (GET /api/me through a new optional port); a 401 runs the app's existing sign-out, anything else keeps the retry ladder — today a revoked session retries every 60 s for ever and never reaches login"
status: todo
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

## Review (written by Claude)
