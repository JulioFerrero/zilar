---
id: T-0937
title: "Mock backend A: scaffold @zilar/mock-backend with one JID-keyed seed (people, chats, messages), in-memory state, and the /me, /chats and /contacts routes (docs/audit/mock-plan.md task A)"
status: todo
milestone: M5
branch: task/T-0937-mock-backend-scaffold
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0937: Mock backend A, the scaffold

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-plan.md` (T-0935, merged) plans mock mode as each app's real store running against one shared fake backend. Read the whole plan first, plus "Julio's answers" at its end: a fake session, the ids may change, chats first.

This is task A of section 4. It adds code only and deletes nothing. The apps keep their old mock mode until the cutovers G and H.

### What to build
1. **A new package** `packages/mock-backend/` (`@zilar/mock-backend`, private, `"type": "module"`, exports `./src/index.ts`, scripts `typecheck` and `test: vitest run --passWithNoTests`), modelled on `packages/xmpp-core/package.json` and `packages/xmpp-core/tsconfig.json`.
   - It depends only on `@zilar/api-contract`, `@zilar/chat-core`, `@zilar/protocol` and `@zilar/xmpp-core`, with no react and no effect imports in its own code (plan section 2.2, risk R4). Type-only imports are fine.
   - The workspace already includes `packages/*` (`pnpm-workspace.yaml:3`).
2. **The layout** from plan section 2.2, with only what task A needs:
   - `src/index.ts`, the barrel;
   - `src/state.ts`: `createMockData(seed)`, in-memory tables plus mutators;
   - `src/http.ts`: `createMockHttp(data)`. It returns `(path, init?) => Promise<Response | undefined>`, where `undefined` means "not served here yet", so the app dispatcher in G and H can fall back to the old mock routes during the migration. Document that contract in the file;
   - `src/http/chats.ts`, `src/http/me.ts`, `src/http/contacts.ts`;
   - `src/data/people.ts`, `src/data/chats.ts`, `src/data/messages.ts`, `src/data/index.ts`;
   - `createMockBackend(options?)` with `http`, `data`, `reset()` and `setDelay(ms)`, as plan section 2.2 sketches. The `xmpp` member is task F2; leave it out for now.
3. **One seed, keyed by bare JIDs** (plan section 2.5). The people, the DMs, the Dev team room and its topics, the Acme channel and the AIs come from the web seed:
   - `apps/web/src/mock/ids.ts:1-30` (`dev-1@ai.zilar.test`, `dev-team@rooms.zilar.test`);
   - `apps/web/src/mock/chats.ts` (156 lines);
   - a representative part of `apps/web/src/mock/messages.ts` (1,148 lines): enough messages per chat to scroll, and **not** all of them;
   - mobile's copy in `apps/mobile/src/mock/chats.ts` and `messages.ts`, as a cross-check.

   The seed produces **API response shapes**: `GET /chats` returns `{ chats: ChatEntry[] }`, matching `ChatEntry` in `packages/api-contract/src/chats.ts`, so each app's real row mapper (`summariesFor` in `packages/client-core/src/store/chat-rows.ts`) builds its rows. Messages are kept for the fake XMPP (F2) and are not served over HTTP.
4. **The routes:** `GET /me`, `PATCH /me` (the name), `GET /chats` and `GET /contacts`, with the same bodies as web's `mockRequest` for those paths (`apps/web/src/mock/api.ts:2196`, `:2317`, `:3017`), and a default delay of 150 ms (`setDelay`). Answer the paths the way the apps call them; check `apps/web/src/lib/api.ts` (`request`) and `apps/mobile/src/lib/chat-api.ts` for the exact prefix (`/api/...` or not).
5. **Keep every file under 400 lines** (Julio's rule).
6. **No tests** (Julio's minimal-test rule; mock code is not crucial). Instead, prove the routes in the Report: a throwaway script in your scratch folder, not committed, that calls `createMockBackend().http('/api/chats')` (or the right path) and decodes the body with the contract's `ChatEntry` schema. Paste its output.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md` (all of it), `packages/xmpp-core/package.json`, `packages/xmpp-core/tsconfig.json`, `packages/api-contract/src/chats.ts`, `apps/web/src/mock/ids.ts`, `apps/web/src/mock/chats.ts`, and `apps/web/src/mock/api.ts:2179-2330` and `:3017-3053`.

### Allowed files
`packages/mock-backend/**`, `pnpm-lock.yaml`, `work/T-0937-mock-backend-scaffold.md`.

### Checks
```bash
pnpm install
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- No app file changes.
- Every new file is under 400 lines.
- The Report shows the script output: a `GET /chats` body that decodes as `ChatEntry[]`, plus the `/me` and `/contacts` bodies.
- The Report gives the seed's chat, person and message counts.

---

## Report (written by the worker when done)

## Review (written by Claude)
