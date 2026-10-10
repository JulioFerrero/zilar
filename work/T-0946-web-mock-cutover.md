---
id: T-0946
title: "Mock cutover G (web): mock mode runs the real web store on @zilar/mock-backend (fake HTTP with a fallback to the old mock routes, plus the fake XMPP); the old mock store stops being used"
status: merged
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

Status: review. Branch `task/T-0946-web-mock-cutover`. Only the Allowed files
changed (`pnpm gate` confirms this).

### What I built

1. **`apps/web/src/mock/backend.ts` (new).** One `createMockBackend()` singleton
   (`backend`), so its HTTP routes and its fake XMPP core share the same
   in-memory seed. `dispatch(path, init)`:
   - returns `backend.http(path, init)` when it gives a `Response`;
   - otherwise answers `/xmpp/token` with a fixed token (see "Gap" below);
   - otherwise falls back to the old `mockRequest(path, init)` from
     `apps/web/src/mock/api.ts`.

   The token fallback sits **after** `backend.http`, so if the shared backend
   later grows a `/xmpp/token` route, that route wins without touching this file.
2. **`apps/web/src/mock/load.ts`.** `loadMockRequest()` now returns `dispatch`
   (not `mockRequest`) and a new `loadMockXmpp()` returns `backend.xmpp`. Both
   keep the same inline build condition, so Vite folds both dynamic imports away
   in a production build. The old static `mockRequest` import is gone.
3. **`apps/web/src/lib/effect/api-client.ts`.** Dropped
   `import { mockRequest } from '@/mock/api'` (the static import that defeated
   the build fold, plan risk R6). `webFetch` is now `async` and calls
   `await loadMockRequest()` when `isMockApiEnabled()`, the same lazy path
   `lib/api.ts:146` uses.
4. **`apps/web/src/store/ChatStoreProvider.tsx`.** Always uses the real store:
   - non-mock: created synchronously as before;
   - mock mode: created once `loadMockXmpp()` resolves, passing
     `createXmpp` from the mock backend. It renders `null` for the one tick
     until then (the store render is the only thing gated; `AuthProvider` and
     the router mount normally). A `store` prop (tests) still wins.

   `createChatStore` is no longer imported here; `mockStore.ts` is untouched and
   its only remaining importer is the `store.ts:40` re-export, as the spec
   allows. `MockAuthProvider` is unchanged.
5. **`apps/web/package.json` + `pnpm-lock.yaml`.** Added the
   `@zilar/mock-backend` workspace dependency.

### Gap: the real store needed `/xmpp/token`

The real store's boot calls `api.getXmppToken()` (`connectXmpp`,
`client-core/store/lifecycle.ts:341`) and goes `offline` with a retry loop if
that fails. **Neither `@zilar/mock-backend` nor the old `mock/api.ts` serves
`/xmpp/token`** (the old hand-written `mockStore.ts` never needed it). Without
it, `?mock=1` would paint the chat list but never connect the fake XMPP core.

`@zilar/mock-backend` is not in this task's Allowed files, so the web dispatcher
answers it with a fixed token (`jid you@zilar.test`, `service wss://mock...`,
`domain zilar.test`, `mucDomain rooms.zilar.test`). The fake core ignores the
token; only `service`/`domain` are used (media allow-list). The clean fix is a
backend `/xmpp/token` route in a later task; the dispatcher case is written to
yield to it.

### Old routes that still fall back to `mockRequest`

I could not click through in a browser (starting a dev server is a background
run, which `AGENTS.md` forbids), so this is reasoned from the two route sets. I
did **not** add dev logging.

Backend-served prefixes: `me`, `chats` (`/chats` only), `contacts`, `search`,
`ais`, `ai-memory`, `approvals`, `approval-rules`, `audit`, `tools`, `routines`,
`groups`, `topics`, `roles`, `invite-links` (`/groups/:id/invite-links`,
`/join/:token`), `directory`, `public-groups`, `machines`, `connections`.

Fall back to the old `mock/api.ts` (backend returns `undefined`):
`chat-prefs`, `chat-background`, `chat-folders`, `pins`, `backgrounds`,
`stickers`, `sticker-packs`, `sticker-panel`, `sticker-favorites`, `gifs`,
`voice`, `push`, `blocks`, `contact-requests`, `handles`, `users/by-handle`, and
the nested paths the backend's single-segment routes do not own
(`GET /chats/:id/media`, `PUT /me/handle`, `GET /chats/:id/prefs`, group media,
…). These are exactly the plan's wave-2 domains (C/F) plus a few settings ones,
so the migration fallback is doing its job.

`/xmpp/token` is served by the web dispatcher itself (neither backend nor old
mock), as noted above.

### Commands and real results

- `pnpm install` → `Done`, `+ @zilar/mock-backend` linked.
- `pnpm --filter @zilar/web build` → `✓ built in 671ms` (one >500 kB chunk
  warning, pre-existing).
- Bundle grep for mock seed strings (production `apps/web/dist`):
  `Viernes -> 0 file(s)`, `Hello from the mock -> 0 file(s)`,
  `mock-token -> 0 file(s)`, `you@zilar.test -> 0 file(s)`,
  `Dev team -> 0 file(s)`. No `*mock*`/`*backend*` chunk is emitted. So the mock
  backend and the old mock routes stay out of the production build (R6 holds).
- `pnpm gate` (repo root), run twice (the second after the token fallback edit):

  ```text
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (0.9s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.1s)
  PASS  effect  (0.3s)
  PASS  tests @zilar/web  (1.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  The `tests @zilar/web` step is the 8 kept web tests; gate ran them, I did not
  run any single test file by hand (none of the changed files has a nearby unit
  test, and the spec says no new tests).

### Deviations and honesty

- **Deviation (small, forced):** `dispatch` has one extra branch for
  `/xmpp/token` instead of "backend then old fallback" only. Reason above; it is
  ordered so the shared backend wins once it serves the route.
- I did **not** verify `?mock=1` in a browser; that is the lead's check. I
  verified the production fold and the type/test gate. `ChatStoreProvider`
  renders `null` briefly in mock mode while the backend chunk loads — a
  deliberate trade for keeping `@zilar/mock-backend` out of the production
  bundle.
- I did not touch `mockStore.ts`, `mock/api.ts`, `ports.ts` or `lib/api.ts`
  (no change was needed; `loadMockRequest`'s new return type is transparent to
  `lib/api.ts:146`).

### Open questions

- None blocking. If the `/xmpp/token` handling should live in the shared backend
  (or in `lib/api.ts`) instead of the web dispatcher, say so and I will move it.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The cutover:** web mock mode runs the real store on `@zilar/mock-backend`. `mock/backend.ts` dispatches to the backend first and falls back to the old `mockRequest`. The fake XMPP comes in through `createXmpp`, and `api-client.ts` no longer imports the mock statically.
- **Production bundle:** the grep for mock seed strings finds them in 0 files.
- **The lead checked `?mock=1` in Chrome:**
  - the chat list shows the Dev team with 7 topics;
  - General's history loads through the fake XMPP;
  - a sent message gets its ✓, and Dev-1 replies "Sounds good." through the fake XMPP.
- **Follow-ups for the mock tasks:**
  - Dev-1's markdown message shows raw `##` and `**`; the seed probably lacks the markdown flag or format the old mock set;
  - General shows an unread badge for a reply that arrives while it is open, so the fake core should answer `markDisplayed` the way the real server does;
  - a fallback route pays the 150 ms delay twice (the nit).
- **Check:** the gate passed, and the 8 web tests pass.
