---
id: T-0694
title: "B1.1: split effect/http.ts — move the Hono-free helpers (CurrentUser, Session, sessionLayer, requestIdOf, socketAddressOf, httpErrorResponse, failureResponse, withErrorEnvelope, REQUEST_ID_HEADER, the route types) into effect/http-core.ts; the 36 api.ts modules import from it; effect/http.ts keeps only the Hono bridge"
status: todo
milestone: M5
branch: task/T-0694-split-effect-http-core
model: auto
effort: low
depends_on: [T-0689]
estimate: 0.3 day
---

# T-0694: split effect/http.ts (B1.1)

## Spec (written by Claude, do not edit)

### Why
Julio wants Effect HTTP to replace Hono. `docs/audit/effect-edge-flip-plan.md` §4 (T-0689) starts with B1.1: separate the Effect helpers every module uses from the Hono bridge, so later tasks can replace the bridge without touching the modules. **No behaviour change.**

### Verified facts (do not re-derive)
- **`apps/server/src/effect/http.ts`** (214 lines) imports Hono at lines 16-18 (`getConnInfo`, `Hono`, `HonoContext`, `RequestIdVariables`).
  - **Hono-free exports:** `REQUEST_ID_HEADER` (:24), `SessionUser`, `CurrentUser`, `Session`, `sessionLayer` (:49), `requestIdOf` (:80), `socketAddressOf` (:88), `httpErrorResponse` (:96), `failureResponse` (:114), `withErrorEnvelope` (:135), `EffectApiMethod`, `EffectApiRoute`, `EffectApiWebHandler` and `EffectApiMount` (about :145-160).
  - **Hono bridge:** `ServerApp`, `forwardRequest`, `readSocketAddress`, `mountEffectApi` (:190), `mountEffectRoutes` (:206), and `SOCKET_ADDRESS_HEADER` (:25), which the bridge writes and `socketAddressOf` reads.
- **36 module files** import the helpers from `effect/http` (the list is under Allowed files).
- **`apps/server/src/app.ts:38`** and `apps/server/src/blocks/blocks.test.ts:20` import `mountEffectRoutes`, and `apps/server/src/machines/routes.test.ts:10` imports `SOCKET_ADDRESS_HEADER`. These stay on `effect/http` and are **not** changed.
- **`apps/server/src/effect/http.test.ts`** tests both halves.

### What to build
1. **Create `apps/server/src/effect/http-core.ts`:**
   - move every Hono-free export there unchanged (code, comments, names);
   - `SOCKET_ADDRESS_HEADER` moves too, because `socketAddressOf` reads it;
   - the file must import nothing from `hono` or `@hono/*`.
2. **`effect/http.ts`** keeps only the bridge. It imports what it needs from `./http-core` and re-exports `SOCKET_ADDRESS_HEADER` (`export { SOCKET_ADDRESS_HEADER } from './http-core'`), so `machines/routes.test.ts` keeps working. Update the header comment to say what each file holds.
3. **In each of the 36 module files,** change the import path from `effect/http` to `effect/http-core`. Change nothing else.
4. **`effect/http.test.ts`:** split its imports between the two files, and keep every test unchanged.

### Read first
`AGENTS.md`, `apps/server/src/effect/http.ts`, `apps/server/src/effect/http.test.ts` (imports), `docs/audit/effect-edge-flip-plan.md` (§1, §4 B1.1).

### Allowed files
`apps/server/src/effect/http.ts`, `apps/server/src/effect/http-core.ts`, `apps/server/src/effect/http.test.ts`, `apps/server/src/agents/memory/api.ts`, `apps/server/src/ais/api.ts`, `apps/server/src/approvals/api.ts`, `apps/server/src/audit/api.ts`, `apps/server/src/auth/api.ts`, `apps/server/src/avatars/api.ts`, `apps/server/src/backgrounds/api.ts`, `apps/server/src/blocks/api.ts`, `apps/server/src/chat-folders/api.ts`, `apps/server/src/chat-prefs/api.ts`, `apps/server/src/chats/api.ts`, `apps/server/src/connections/api.ts`, `apps/server/src/contact-requests/api.ts`, `apps/server/src/contacts/api.ts`, `apps/server/src/directory/api.ts`, `apps/server/src/drafts/api.ts`, `apps/server/src/files/api.ts`, `apps/server/src/gifs/api.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/handles/api.ts`, `apps/server/src/integrations/api.ts`, `apps/server/src/invite-links/api.ts`, `apps/server/src/machines/api.ts`, `apps/server/src/media/api.ts`, `apps/server/src/pins/api.ts`, `apps/server/src/push/api.ts`, `apps/server/src/roles/api.ts`, `apps/server/src/routines/api.ts`, `apps/server/src/search/api.ts`, `apps/server/src/setup/api.ts`, `apps/server/src/stickers/api.ts`, `apps/server/src/tools/api.ts`, `apps/server/src/topics/api.ts`, `apps/server/src/voice-transcription/api.ts`, `apps/server/src/voice/api.ts`, `apps/server/src/xmpp/api.ts`, `work/T-0694-split-effect-http-core.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/http.test
pnpm gate
```

### Acceptance
- `git grep -n "hono" apps/server/src/effect/http-core.ts` prints nothing.
- No module `api.ts` imports from `effect/http`.
- Every test passes unchanged, apart from the import lines in `effect/http.test.ts`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
