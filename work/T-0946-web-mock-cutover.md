---
id: T-0946
title: "Mock cutover G (web): mock mode runs the real web store on @zilar/mock-backend (fake HTTP with a fallback to the old mock routes, plus the fake XMPP); the old mock store stops being used"
status: todo
milestone: M5
branch: task/T-0946-web-mock-cutover
model: auto
effort: default
depends_on: [T-0943, T-0944, T-0945]
estimate: 0.5 day
---

# T-0946: Web mock cutover

## Spec (written by Claude, do not edit)

### Why
Task G of `docs/audit/mock-plan.md` (read section 2.6 "Web" and "Julio's answers"). `@zilar/mock-backend` now serves:
- `/me`, `/chats` (with topic rows), `/contacts` and `/search`;
- the AI, approval and tool routes;
- groups, topics, roles, invite links and the directory (T-0937 to T-0944).

`createMockBackend().xmpp` is a fake XMPP core (T-0945). Web mock mode still runs the hand-written mock store instead. The lead read main on 2026-10-10:
- `apps/web/src/store/ChatStoreProvider.tsx:22` picks `isMockMode() ? createChatStore() : createRealChatStore()`; `createChatStore` is the mock store from `apps/web/src/store/mockStore.ts`;
- `apps/web/src/mock/load.ts:8-13` lazy-loads `mockRequest` under a build condition that Vite folds away in production (T-0847);
- `apps/web/src/lib/api.ts:144-146` uses `loadMockRequest()` when `isMockApiEnabled()`;
- `apps/web/src/lib/effect/api-client.ts:20` **imports `mockRequest` statically** and calls it at `:27`. That defeats the build fold (plan risk R6);
- `apps/web/src/store/effects/ports.ts:182` and `:356` already accept a `createXmpp` dependency.

### What to build
1. **`apps/web/src/mock/backend.ts`:**
   - one `createMockBackend()` singleton;
   - a `dispatch(path, init)` that returns `backend.http(path, init)` when it gives a `Response`, and otherwise falls back to the old `mockRequest(path, init)` from `apps/web/src/mock/api.ts`. That is the migration fallback; the old routes are deleted later, in the sweep tasks.

   `mock/load.ts` returns `dispatch` instead of `mockRequest`, under the same inline build condition, and also exports a lazy loader for `backend.xmpp`.
2. **`lib/effect/api-client.ts`:** replace the static `mockRequest` import with the same lazy `loadMockRequest()` path that `lib/api.ts` uses, so mock code stays out of a production build. Check this with `pnpm --filter @zilar/web build`, then grep the production bundle for a string that only the mock seed has (for example `Hello from the mock` or a seed name such as `Viernes`). Report the result.
3. **`ChatStoreProvider.tsx`:** always `createRealChatStore()`. In mock mode, pass `createXmpp` from the mock backend (resolved through the lazy loader). Keep `MockAuthProvider` (`apps/web/src/auth/AuthProvider.tsx:112`) as it is.
4. **Leave `mockStore.ts` alone.** It stays in the tree for the deletion sweep. If `createChatStore` then has no importer except `store.ts:40`, leave that re-export.
5. **Tests:** run the 8 kept web tests. No new tests.
6. **Report:**
   - which routes `dispatch` sent to the old `mockRequest` during a click-through. Log them in dev only, removed before commit, or reason over the routes;
   - anything the real store needed that the backend lacked.

   The lead checks `?mock=1` in the browser.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md` sections 2.6 and 5, the files above, `packages/mock-backend/src/index.ts`, and `apps/web/src/store/realStore.ts`.

### Allowed files
`apps/web/src/mock/backend.ts`, `apps/web/src/mock/load.ts`, `apps/web/src/lib/effect/api-client.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/store/ChatStoreProvider.tsx`, `apps/web/src/store/effects/ports.ts`, `apps/web/package.json`, `pnpm-lock.yaml`, `work/T-0946-web-mock-cutover.md`.

### Checks
```bash
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
- The Checks pass.
- The production bundle has no mock seed strings (shown in the Report).
- Mock mode on web runs the real store; the lead checks it at `?mock=1`.
- The Report lists the routes that fell back.

---

## Report (written by the worker when done)

## Review (written by Claude)
