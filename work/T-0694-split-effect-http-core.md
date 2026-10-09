---
id: T-0694
title: "B1.1: split effect/http.ts — move the Hono-free helpers (CurrentUser, Session, sessionLayer, requestIdOf, socketAddressOf, httpErrorResponse, failureResponse, withErrorEnvelope, REQUEST_ID_HEADER, the route types) into effect/http-core.ts; the 36 api.ts modules import from it; effect/http.ts keeps only the Hono bridge"
status: merged
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

**Status:** done, ready for review. Branch `task/T-0694-split-effect-http-core`.

**What I did**
- Created `apps/server/src/effect/http-core.ts` with the Hono-free helpers, moved unchanged (code, comments, names): `REQUEST_ID_HEADER`, `SOCKET_ADDRESS_HEADER`, `SessionUser`, `CurrentUser`, `Session`, `sessionLayer`, `requestIdOf`, `socketAddressOf`, `httpErrorResponse`, `failureResponse`, `withErrorEnvelope`, `EffectApiMethod`, `EffectApiRoute`, `EffectApiWebHandler`, `EffectApiMount`. New file-level comment says it must never import `hono`/`@hono/*` and that the bridge lives in `./http.ts`. It imports only `effect`, `effect/http`, `effect/http-api`, `pino` (type), `../auth/auth` (type) and `../errors`.
- Rewrote `apps/server/src/effect/http.ts` to hold only the bridge: `ServerApp`, `forwardRequest`, `readSocketAddress`, `mountEffectApi`, `mountEffectRoutes`, plus `export { SOCKET_ADDRESS_HEADER } from './http-core'` (so `machines/routes.test.ts` keeps working) and `REQUEST_ID_HEADER` imported for `forwardRequest`. Header comment now says each file holds: bridge here, Hono-free helpers in `./http-core`.
- Changed the import path from `effect/http` to `effect/http-core` in all 36 module `api.ts` files (one line each; `agents/memory/api.ts` uses `../../effect/http-core`). Nothing else changed in those files. The `effect/http` library import (`import { HttpServer, … } from 'effect/http'`) was left untouched.
- `apps/server/src/effect/http.test.ts`: split the imports — `mountEffectRoutes` and `SOCKET_ADDRESS_HEADER` from `./http`, `socketAddressOf` and `withErrorEnvelope` from `./http-core` (one deviation, below).

**Files changed**
- `apps/server/src/effect/http-core.ts` (new)
- `apps/server/src/effect/http.ts`
- `apps/server/src/effect/http.test.ts`
- the 36 `*/api.ts` files listed under Allowed files
- `work/T-0694-split-effect-http-core.md` (status + this report)

**Commands ran (real results)**
- `pnpm install` — done in 12.9s, no dependency changes.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/http.test` — first run: Test Files 1 failed (1); Tests 2 failed | 8 passed (10). The 2 failures are pre-existing (see deviation), so after updating the two stale assertions: Test Files 1 passed (1); Tests 10 passed (10).
- `git grep -n "hono" apps/server/src/effect/http-core.ts` — **this line was wrong in the first round**: the committed header comment still contained the substring `hono`/`@hono/*`, so the command matched line 4. Fix round 1 reworded that comment; the command now prints nothing (exit 1).
- `git grep -n "from '\.\./effect/http'" apps/server/src` — only `blocks/blocks.test.ts:20` and `machines/routes.test.ts:10` remain (both stay on the bridge per the spec). All 36 `api.ts` files now import from `effect/http-core`.
- Pre-existing-failure proof: `git stash push -u` then the same test at branch HEAD gave the same `2 failed | 8 passed`; `git stash pop` restored my work.
- `pnpm gate` (from repo root):
  ```
  gate: 40 changed file(s) against main
  PASS  install (frozen)  (11.0s)
  PASS  format  (62.4s)
  PASS  lint  (1.7s)
  PASS  typecheck  (11.6s)
  PASS  tests @zilar/server  (565.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviation from the spec (please review)**
- The spec says to keep every test in `effect/http.test.ts` unchanged apart from the import lines. Two tests could not pass that way: they asserted the pre-T-0650 legacy zod messages, while the current `handles` module emits its fixed message. Running the test file against the branch base (stash, no changes) already failed those same two tests, so they are stale, not caused by the split. The task had to touch this file (the spec requires it), and the gate selects changed test files, so the failure surfaced here.
- T-0650 (`work/T-0650-handles-drop-zod.md`, lead-approved) changed the claim-body error to the fixed sentence `handle must be a string of 1 to 64 characters, with no other keys` and its spec stated "no test asserts the text"; `handles/handles.test.ts:66` asserts exactly that sentence. In fact `effect/http.test.ts` did assert the old text.
- I updated only those two assertions to the lead-approved sentence, and renamed the two tests from "legacy zod message" to "fixed invalid_request message" so the names are not misleading. No behaviour changed. If you would rather revert this and treat it as a T-0650 follow-up, say so and I will drop the test edit; the gate cannot pass without it (or without a decision to accept a red gate).

**Notes**
- `mountEffectApi` is still exported from `effect/http.ts` and still unused, exactly as before; no behaviour change.
- No secrets, no new dependencies, no changes outside the Allowed files.

**Open questions:** none beyond the deviation above.

**Round (fix round 1) — PREREVIEW findings**
- Finding 1 (should-fix): reworded the `http-core.ts` header comment so it no longer contains the substring `hono`/`@hono/*`; `git grep -n "hono" apps/server/src/effect/http-core.ts` now prints nothing (exit 1), so the literal Acceptance check passes. Comment only, no behaviour change.
- Finding 2 (nit): corrected the first-round Report claim that `git grep -n "hono"` returned "no matches (exit 1)" — it matched line 4 before the reword (see that bullet under Commands ran).
- Tests added or adjusted: none. Finding 1 is a comment reword with no behaviour change, and the finding named no test. Ran `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/effect/http.test`: 1 file passed, 10 tests passed (10).
- `pnpm gate` (from repo root):
  ```
  gate: 40 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (17.2s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.1s)
  PASS  tests @zilar/server  (586.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Disagreements:** none.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean after 1 automatic round (packet head 1c12596e). `effect/http-core.ts` has no Hono import, and all 36 modules import from it. `effect/http.ts` keeps only the bridge and re-exports `SOCKET_ADDRESS_HEADER`, so `blocks.test.ts` and `machines/routes.test.ts` are unchanged.
