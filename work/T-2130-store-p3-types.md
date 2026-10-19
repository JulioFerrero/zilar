---
id: T-2130
title: "Store phase 3, T7: one chat-store action and state type surface in client-core that the web ChatStore and the phone ChatStoreState extend — type-only, no runtime change"
status: merged
milestone: M5
branch: task/T-2130-store-p3-types
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2130: Store phase 3, T7: one chat-store action and state type surface in client-core that the web ChatStore and the phone ChatStoreState extend — type-only, no runtime change

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one copy of logic that web and phone share. This is step T7 of `docs/audit/store-phase3-plan.md` (§2, "T7: one action and state type surface"); read that section first. It cites every `file:line` you need.

### Steps
1. In `packages/client-core/src/store/actions.ts`, add `ChatStoreActions` and `ChatStoreCommonState` with the members both apps declare identically today: chats, contacts, messages, history, send and retry, edit and delete, reactions, typing, drafts, pins, prefs and folders. Compare `apps/web/src/store/store.ts:238-395` with `apps/mobile/src/store/types.ts:221-317` member by member. Move only members whose type is the same on both sides.
2. Make the web `ChatStore` and the phone `ChatStoreState` extend the shared types and keep only their own members. Group and topic APIs stay app-side: their signatures differ (`apps/web/src/store/store.ts:183-236` vs `apps/mobile/src/store/types.ts:38-128`).
3. If a member differs only in optionality or in a doc comment, keep it app-side. Do not change a type to make it fit.
4. **Also plan step T1 (one session check).**
   - Add `createSessionCheck({ getMe, getToken? })` in `packages/client-core/src/store/session-check.ts`.
   - Without `getToken` it is the web rule (`apps/web/src/store/effects/ports.ts:86-103`): `getMe` succeeds → `'valid'`; a 401 `ApiError` → `'gone'`; anything else → `'unknown'`.
   - With `getToken` it is the phone rule (`apps/mobile/src/store/effects/ports.ts:122-154`), which runs first:
     - the token read fails → `'unknown'`;
     - the token is `undefined` → `'gone'`;
     - otherwise, the web rule.
   - Both apps' `checkSession` become one call to it, and keep their exported names and signatures.
   - A check must never reject: it never signs anyone out on a transient error.

### Rules
- No behaviour change. Move code, do not rewrite algorithms.
- Do not edit tests unless an import path changes. They must pass unchanged.
- Report the line counts before and after for each file.

### Allowed files
- `packages/client-core/src/store/actions.ts`
- `apps/web/src/store/store.ts`
- `apps/mobile/src/store/types.ts`
- `packages/client-core/src/store/session-check.ts`
- `packages/client-core/src/store/index.ts`
- `apps/web/src/store/effects/ports.ts`
- `apps/mobile/src/store/effects/ports.ts`
- `work/T-2130-store-p3-types.md`

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/effects/session-check.test.ts
pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts
pnpm gate
```

### Acceptance
- The gate passes, and the listed tests pass without edits.
- Product lines go down by at least the plan's estimate minus 30%.
- **Lead check:** the gate's typecheck is the guard; the web mock and phone smoke open the chat list and a chat.

---

## Report (written by the worker when done)

### What I did

**T7 — one action and state type surface.**
- Added `ChatStoreActions` and `ChatStoreCommonState` to `packages/client-core/src/store/actions.ts`, plus the shared `DraftState`, `TypingState`, `SendTextOptions`, `SendStickerInput` and `ConnectionStatus` types.
- Made web `ChatStore` extend `ChatStoreGroupApi`, `ChatStoreActions` and `ChatStoreCommonState`, and made phone `ChatStoreState` extend `ChatStoreGroups`, `ChatStoreActions` and `ChatStoreCommonState`.
- Kept app-side every member whose type or shape differs: group/topic APIs, web prefs/search/background, platform send/voice/attachment shapes, mobile cancel/retry/prefs/folder APIs, `activeChatId` (`string | null` on phone vs `string | undefined` on web), and the optionality differences (`me`, `editTarget`, `actionError`, `mediaTrustedHosts`, `pinsError`).
- `SendTextOptions`, `SendStickerInput`, `DraftState`, `TypingState` and `ConnectionStatus` are re-exported from the app store modules, so existing component imports still resolve. `SendStickerChoice` stays as a phone alias of the shared `SendStickerInput`.

**T1 — one session check.**
- Added `createSessionCheck({ getMe, getToken? })` in `packages/client-core/src/store/session-check.ts` and exported it from `packages/client-core/src/store/index.ts`.
- Without `getToken` it uses the web rule; with it, a failed token read is `unknown`, a missing token is `gone`, then the web rule. The returned check never rejects.
- Web `checkSession` is now one `createSessionCheck({ getMe })` call; phone `checkSession` keeps its `(getToken = getSessionToken, getMe)` signature and calls `createSessionCheck({ getMe, getToken })()`.

**Line counts (before → after):**

| File | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `packages/client-core/src/store/actions.ts` | 181 | 290 | +109 |
| `apps/web/src/store/store.ts` | 399 | 297 | −102 |
| `apps/mobile/src/store/types.ts` | 317 | 232 | −85 |
| `packages/client-core/src/store/session-check.ts` | 65 | 112 | +47 |
| `packages/client-core/src/store/index.ts` | 35 | 36 | +1 |
| `apps/web/src/store/effects/ports.ts` | 507 | 487 | −20 |
| `apps/mobile/src/store/effects/ports.ts` | 373 | 344 | −29 |
| **Total** | **1877** | **1798** | **−79** |

The plan's combined estimate for T7 + T1 was −63 lines; this is −79.

### Checks run

- `pnpm install --frozen-lockfile` — done (1155 packages reused).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/effects/session-check.test.ts` — 1 file passed, 6 tests passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts` — 1 file passed, 16 tests passed.
- `pnpm gate` — GATE PASS:

```
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  build @zilar/server
PASS  tests @zilar/client-core
PASS  tests @zilar/mobile
PASS  tests @zilar/web
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/web/src/store/effects/ports.ts: 487 lines (main 507); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- T7 is type-only: no runtime code moved, so the gate's typecheck is the guard, and all mobile/web store test suites passed unchanged.
- `messagesByChat`, `reactions`, `edits` and `historyComplete` were duplicated on both state types, so they now live in `ChatStoreCommonState`; this means web `ChatStore` also carries them (the real and mock stores already provide them). `activeChatId` stayed app-side because the two types differ (`null` vs `undefined`).
- No tests were edited. No deviations or open questions.
- Fix round: restored the behaviour comments on the shared members, and `SendTextOptions` / `SendStickerInput` now re-export the canonical `send/context` types so the explicit re-export in `store/index.ts` is no longer needed and no star-export conflict remains.


## Review (written by Claude)

Approved; the second pre-review was clean (1 nit). Net about −79:
- `ChatStoreCommonState` and `ChatStoreActions` in `packages/client-core/src/store/actions.ts` now hold the members both apps declared identically; the web `ChatStore` and the phone `ChatStoreState` extend them. Members that differ in optionality stayed app-side.
- `createSessionCheck` (`store/session-check.ts`) replaces both apps' session checks: the web rule without a token reader, the phone rule with one.

**Lead fix round:** the behaviour comments lost in the move are back on the shared members ("Rejects on failure", "Only a failed own text may relaunch the send", the unread note), and the redundant re-export is gone. The session-check and lifecycle tests pass.

**Phone emulator:** the smoke passed (`/`, `/chat/ana@zilar.test`, `/chat/dev-team@rooms.zilar.test`). The app boots, and both chats render in full.
