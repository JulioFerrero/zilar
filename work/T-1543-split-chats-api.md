---
id: T-1543
title: "Split apps/server/src/chats/api.ts (398 lines) before it grows: the 'list' handler body moves to chats/list-handler.ts and the read and delivered mark handlers to chats/mark-handlers.ts; api.ts keeps the API wiring and its exports; no behaviour change"
status: merged
milestone: M5
branch: task/T-1543-split-chats-api
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1543: Split chats/api.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/chats/api.ts` is 398 lines. The 400-line rule (`CLAUDE.md`) leaves no room for the next change to `/api/chats`. **Follow `docs/audit/split-rules.md`.** It is not a `size-plan.md` entry, so this spec names the parts.

### Facts (the lead read them on main, 2026-10-15)
- **Exports:**
  - `CHAT_READ_RATE_LIMIT_MAX` and `CHAT_READ_RATE_LIMIT_WINDOW_MS` (`:41-42`);
  - `ChatUnreadFields` (`:44`);
  - `ChatListEntry` (`:56`);
  - `ChatsApiDependencies` (`:116`);
  - `createChatsApi` (`:139`).
- **Internal:** `chatAccessForMark` (`:97-114`) and `ChatsApi` (`:137`).
- **`createChatsApi`:**
  - the `'list'` handler is `:152-345`;
  - `'markRead'` is `:346-366`;
  - `'markDelivered'` is `:367-386`;
  - `clearHistory` and `deleteForMe` come from `deleteOwn` (`:387-388`).

### Steps
1. **New `apps/server/src/chats/list-handler.ts`:** move the body of the `'list'` handler into an exported function. For example, `listChatsFor(deps, user)` returns the same `Effect` the handler built today. The handler in `api.ts` becomes `handler(logger, (_request, user) => listChatsFor(deps, user))`. Move the helpers only the list uses, along with any imports it alone needs.
2. **New `apps/server/src/chats/mark-handlers.ts`:** move `chatAccessForMark` and the bodies of `markRead` and `markDelivered` into exported functions that take `deps`, the rate limiter(s) and the request. Keep the order of checks exactly: access first, then the write budget.
3. **`api.ts`** keeps every export it has today (re-export a moved type or constant if needed) and the API wiring. It ends well under 400 lines, and so does each new file.
4. **No behaviour change.** No importer outside these three files changes.

### Tests
None new. The nearest kept tests must pass. `apps/server/src/chats/*.test.ts` and any test importing `./api` should still import from `./api`.

### Allowed files
- `apps/server/src/chats/api.ts`
- `apps/server/src/chats/list-handler.ts` (new)
- `apps/server/src/chats/mark-handlers.ts` (new)
- `work/T-1543-split-chats-api.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of the three files;
  - the export list of `api.ts` before and after (identical);
  - the gate summary.
- `/api/chats` still answers 401 signed out.

---

## Report (written by the worker when done)

### What I did
- Split `apps/server/src/chats/api.ts` (398 lines) along the boundaries the spec
  names, with no behaviour change:
  - `chats/list-handler.ts` (new): `ChatUnreadFields`, `ChatListEntry` and
    `listChatsFor(deps, user)`, which returns the same `Effect` the `'list'`
    handler built. `api.ts` now wires `handler(logger, (_request, user) => listChatsFor(deps, user))`.
  - `chats/mark-handlers.ts` (new): the private `chatAccessForMark` plus
    `markReadFor(deps, limiter, request, user)` and
    `markDeliveredFor(deps, limiter, request, user)`. `api.ts` wraps each with
    `handler` and passes the one shared `readLimiter`, so access is still checked
    before the write budget, exactly as before.
  - `api.ts` (now the thin barrel + wiring) keeps every export it had. It
    re-exports `ChatListEntry` and `ChatUnreadFields` from `list-handler.ts`;
    `ChatsApiDependencies`, the rate-limit constants and `createChatsApi` stay put.
- No importer outside these files changed (`apps/server/src/app/routes-messaging.ts`
  still imports `createChatsApi` from `../chats/api`).
- `mark-handlers.ts` carries the `// effect-plain: moved unchanged from
  apps/server/src/chats/api.ts (size split)` marker: its moved bodies use
  `async`/`await` and would otherwise trip the Effect ratchet as a new file.
  `list-handler.ts` needs no marker (it value-imports `effect`).

### Line counts
```
102  apps/server/src/chats/api.ts          (was 398 on main)
266  apps/server/src/chats/list-handler.ts (new)
 95  apps/server/src/chats/mark-handlers.ts (new)
```

### Export list before vs after
Before (`git show main:apps/server/src/chats/api.ts | grep -E "^export"`):
```
export const CHAT_READ_RATE_LIMIT_MAX
export const CHAT_READ_RATE_LIMIT_WINDOW_MS
export interface ChatUnreadFields
export type ChatListEntry
export interface ChatsApiDependencies
export function createChatsApi
```
After (barrel `api.ts`): identical set — the two consts, `interface
ChatsApiDependencies` and `createChatsApi` are declared in `api.ts`;
`ChatUnreadFields`/`ChatListEntry` are `export type { ChatListEntry,
ChatUnreadFields } from './list-handler'`. The new files add
`listChatsFor`, `markReadFor`, `markDeliveredFor` (none existed before). No
export was dropped or renamed.

### Checks run
- `pnpm install` — ok.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats` —
  7 files passed, 25 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/authz-sweep.test.ts` — 5 tests passed; the sweep prints
  `GET /api/chats -> 401` (and the four other `/api/chats` routes -> 401). This
  is the acceptance check.
- `pnpm gate` (from repo root) — GATE PASS:
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (1.1s)
PASS  lint  (1.7s)
PASS  typecheck  (3.3s)
PASS  effect  (0.7s)
PASS  tests @zilar/server  (12.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
The 4 changed files are `api.ts`, `list-handler.ts`, `mark-handlers.ts` and this
task file — all inside the Allowed files.

### Notes for the lead
- `ChatsApiDependencies` stays in `api.ts` because both new modules and the
  wiring use it; `list-handler.ts` and `mark-handlers.ts` take it with a
  type-only import (`import type { ChatsApiDependencies } from './api'`), so
  under `verbatimModuleSyntax` it is erased and there is no runtime cycle. The
  only cycle is `api.ts` value-imports the two modules while they type-import
  `api.ts`; TS type-only cycles are allowed and the gate's typecheck/effect
  steps pass.
- I did not run format/lint/typecheck/whole suites one by one; only the two
  single test files above and the one `pnpm gate` at the end.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - **Sizes:** `api.ts` 102, `list-handler.ts` 266 and `mark-handlers.ts` 95 lines (was 398).
  - **Exports:** `api.ts` still exports `CHAT_READ_RATE_LIMIT_MAX`, `CHAT_READ_RATE_LIMIT_WINDOW_MS`, `ChatsApiDependencies` and `createChatsApi`, and re-exports the types `ChatListEntry` and `ChatUnreadFields`.
  - **Check order:** the mark handlers still check access (`chatAccessForMark`) before charging the write budget, so a probe of an invisible chat costs nothing and gets the same 404.
- **After the deploy,** the lead checks that `/api/chats` answers 401 signed out.
