---
id: T-0949
title: "Mock cutover H1 (mobile): mock mode runs the real mobile store on @zilar/mock-backend (fake HTTP through fetchImpl, fake XMPP, a fake dev-only session), the old mock store stops being used"
status: todo
milestone: M5
branch: task/T-0949-mobile-mock-cutover-store
model: auto
effort: default
depends_on: [T-0946]
estimate: 0.5 day
---

# T-0949: Mobile mock cutover, the store

## Spec (written by Claude, do not edit)

### Why
This is task H, part 1, of `docs/audit/mock-plan.md` (read section 2.6 "Mobile", risks R3, R6 and R7, and "Julio's answers": Q1 is a fake session, Q2 lets ids change). Web is already done: T-0946 runs web mock mode on the real store with `@zilar/mock-backend`. Use `apps/web/src/mock/backend.ts` as the pattern, with the backend first and the old mock as the fallback.

The lead read main on 2026-10-10:
- `apps/mobile/src/store/chat-store-provider.tsx:43-55`, `createMockStore`, `require`s the hand-written mock store from `apps/mobile/src/store/chat-store.ts`, behind `process.env.NODE_ENV === 'test' || __DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK`. Metro folds that condition in a release build.
- `:64-77` builds `createRealChatStore({ ... })` with API factories shaped `(getSessionToken, fetch, API_URL)`.
- `:80-86` starts the store only when `status === 'authenticated'` (`useSession`).
- `RealStoreDeps` (`apps/mobile/src/store/effects/ports.ts:26-65`) takes `api`, `topicsApi`, `inviteLinksApi`, `rolesApi`, `groupsApi`, `chatPrefsApi`, `chatFoldersApi`, `pinsApi`, `mediaApi` and `createXmpp`.
- `apps/mobile/src/lib/effect/api-client.ts:25-31` fails `unauthorized` when the token is `undefined` (plan R3).
- The mock gate is in `apps/mobile/src/mock/gate.ts` (`mockParamAllowed`, `ENV_MOCK`).
- Nothing in `apps/mobile/src/auth/` (`RequireAuth.tsx`, `guard.ts`, `session.ts`) knows about mock mode.

### What to build
1. **`apps/mobile/src/mock/backend.ts`:** one `createMockBackend()` singleton, plus a `mockFetch: typeof fetch` that:
   - strips the origin from the URL it is given (the factories call `${API_URL}/api/...`);
   - calls `backend.http(path, init)`;
   - when that returns `undefined`, answers a 404 JSON error.

   Mobile's old mock objects are not HTTP, so there is no request-level fallback. Screens that still use their hand-written mocks keep them until T-0950.
2. **The provider:** in mock mode (same gate as today), build `createRealChatStore` with every API factory given `(() => Promise.resolve('mock-token'), mockFetch, API_URL)` and with `createXmpp: backend.xmpp`.
   - Start the store in mock mode without waiting for `authenticated`.
   - The `require` of the mock code stays behind the same literal build condition (R6), so a release build carries no mock code.
3. **A fake session (Julio's Q1):** in mock mode in a dev build, the app opens straight into the tabs with nobody logged in, and `useSession` reports an authenticated mock user (`you@zilar.test`) only then. The smallest change is in `apps/mobile/src/auth/session.ts` or `RequireAuth.tsx`, behind the same build condition. A release build is unchanged.
4. **Leave `chat-store.ts` alone.** It stays in the tree for the deletion sweep (task Q). If `createMockStore` becomes unused, delete just that function.
5. **Tests:** run the 15 kept mobile tests. No new tests.
6. **Release build:** prove no mock code ships. Run an `expo export` or Metro release bundle (`pnpm --filter @zilar/mobile exec expo export --platform android --output-dir <scratch>` or the repo's equivalent), then grep it for a seed-only string, for example `Hello from the mock` or `Viernes`. Report the result.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `apps/web/src/mock/backend.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/store/effects/ports.ts`, `apps/mobile/src/lib/effect/api-client.ts`, `apps/mobile/src/auth/session.ts`, `apps/mobile/src/auth/RequireAuth.tsx`, `apps/mobile/src/mock/gate.ts`, and `packages/mock-backend/src/index.ts`.

### Allowed files
`apps/mobile/src/mock/backend.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/auth/session.ts`, `apps/mobile/src/auth/RequireAuth.tsx`, `apps/mobile/src/mock/gate.ts`, `apps/mobile/package.json`, `apps/mobile/metro.config.js`, `pnpm-lock.yaml`, `work/T-0949-mobile-mock-cutover-store.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/mobile exec vitest run --reporter=dot
pnpm gate
```
The lead runs the phone smoke in mock mode.

### Acceptance
- The Checks pass.
- The release bundle has no mock seed strings (shown in the Report).
- Mock mode on the emulator opens straight into the chat list from the shared seed; the lead checks this.
- The Report says how mock mode is switched on in a dev build (the env var or the param).

---

## Report (written by the worker when done)

## Review (written by Claude)
