---
id: T-1679
title: "Size split of packages/client-core/src/store/polling.ts (393 lines): move the draft-turn and draft-stream half (DRAFT_* constants, DraftTurns, markTurnFinished … startDraftStream) into a new store/draft-stream.ts and re-export it from polling.ts so no importer changes — a pure move"
status: merged
milestone: M5
branch: task/T-1679-split-client-polling
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1679: Split the draft stream out of client-core polling.ts

## Spec (written by Claude, do not edit)

### Why
`packages/client-core/src/store/polling.ts` is 393 of 400 lines. The pins and chats polling (for example a realtime pins channel, finding UI-15) can't change until it's split. The AI draft-stream half is self-contained.

### Facts (the lead read them on 2026-10-16)
- **`polling.ts` layout:**
  - the polling constants (`TOPIC_REFRESH_INTERVAL_MS :16` … `ROSTER_REFRESH_DEBOUNCE_MS :29`);
  - the draft constants `DRAFT_END_FALLBACK_MS :35`, `DRAFT_IDLE_MS :39`, `DRAFT_STREAM_WATCH_MS :46` and `draftTimerKey :50`;
  - `export interface DraftTurns :53` and `export interface PollingCtx extends HistoryCtx, DraftTurns :58`;
  - the polling functions (`everyInterval :64` … `scheduleChatsRefreshBurst :195`);
  - **the draft half:** `markTurnFinished :204`, `clearFinishedTurns :218`, `clearDraftTimeout :224`, `armDraftRemoval :231`, `handleDraftEnd :252`, `newestAiText :263`, `handleDraftEvent :284`, `syncDraftStream :310`, `draftWatchers :345`, `hasAiChat :350`, `watchChats :354` and `startDraftStream :382` to the end.
- **Importers:**
  - `packages/client-core/src/store/index.ts:34` (`export * from './polling';`), `connect.ts:22` and `lifecycle.ts:24`;
  - `apps/web/src/store/effects/storeContext.ts:27` imports `clearDraftTimeout` and `markTurnFinished` from its own local `./polling`, which is a different file; leave it alone;
  - tests `polling.test.ts:22`, `incoming.test.ts:13` and `unread-merge.test.ts:7`.
- **The folder `packages/client-core/src/store/`** has no `draft-stream.ts`.

### Steps
1. **Create `packages/client-core/src/store/draft-stream.ts`** with the draft constants, `draftTimerKey`, `DraftTurns` and every draft function from `markTurnFinished` to the end of the file, moved **word for word** with their comments.
   - It imports `PollingCtx` as a type from `./polling`, if it needs it.
   - If that would make a value-level import cycle, move `PollingCtx` into the new file too and re-export it from `polling.ts`.
2. **`polling.ts`:** keep the polling part and add `export * from './draft-stream';`, so every existing import (including `index.ts` and the tests) keeps working unchanged.
3. **No behaviour change, no new tests.**

### Allowed files
- `packages/client-core/src/store/draft-stream.ts`
- `packages/client-core/src/store/polling.ts`
- `work/T-1679-split-client-polling.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/polling.test.ts src/store/incoming.test.ts src/store/unread-merge.test.ts src/store/lifecycle.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`polling.ts` is about 210 lines,** and `draft-stream.ts` holds the draft half unchanged.
- **The listed tests pass,** and web and mobile still typecheck.

---

## Report (written by the worker when done)

### What I did

- Created `packages/client-core/src/store/draft-stream.ts` (238 lines) with the draft half: `DRAFT_END_FALLBACK_MS`, `DRAFT_IDLE_MS`, `DRAFT_STREAM_WATCH_MS`, `DRAFT_STREAM_KEY`, `draftTimerKey`, `DraftTurns`, and `markTurnFinished` → `startDraftStream`, moved word for word with their comments (plus the shared `everyInterval` helper — see deviation below).
- Trimmed `packages/client-core/src/store/polling.ts` to 167 lines (the polling constants, `PollingCtx`, `whileFocused`, `clearActiveChatRead`, `refreshGate`, the chats/pins loops and `scheduleChatsRefreshBurst`) and added `export * from './draft-stream';`, so `index.ts`, `connect.ts`, `lifecycle.ts` and the tests import unchanged.
- No behaviour change, no new tests.

Verified word for word with `diff` against `git show HEAD:...polling.ts`:
- the draft half (`markTurnFinished` … end, original lines 203-393) is byte-identical in `draft-stream.ts`;
- the draft constants + `DraftTurns` (original 33-56) are identical;
- `everyInterval` (original 62-70) is identical except `const` → `export const`;
- the polling body (`whileFocused` … `scheduleChatsRefreshBurst`, original 72-201) is identical.

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/polling.test.ts src/store/incoming.test.ts src/store/unread-merge.test.ts src/store/lifecycle.test.ts` → Test Files 4 passed (4), Tests 62 passed (62).
- `pnpm gate` (repo root), summary lines:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.3s)
PASS  lint  (1.2s)
PASS  typecheck  (2.7s)
PASS  effect  (0.7s)
PASS  tests @zilar/client-core  (4.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- **Deviation (one extra move):** the draft half's `startDraftStream` uses the private `everyInterval` helper that lived in the polling half. Importing it back from `./polling` would create a value-level import cycle with `export * from './draft-stream'`, and the spec's suggested remedy (move `PollingCtx`) would not have removed that cycle (it only relocates a type). So I moved `everyInterval` into `draft-stream.ts` word for word (now `export const`) and `polling.ts` imports it. The graph is now strictly `polling → draft-stream` (no runtime cycle; `draft-stream.ts` imports only `type { PollingCtx }`, which is erased). Side effect: `everyInterval` is now re-exported from the package (it was private before); nothing imported it before, so no caller changes.
- `polling.ts` ended at 167 lines, not the “about 210” in Acceptance; the estimate appears to assume a smaller draft half. Both files are well under the 400-line cap and the split is clean.
- I adjusted the file-header comment in `polling.ts` (it no longer describes the draft stream) and gave `draft-stream.ts` its own header. All function/constant comments moved unchanged.
- No importer changed: `index.ts:34` (`export * from './polling'`), `connect.ts:22` and `lifecycle.ts:24` still resolve through the re-export; `apps/web/src/store/effects/storeContext.ts` (its own local `./polling`) was left untouched as instructed.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean; 1 nit, accepted: `everyInterval` is now a package export.
- **The lead's check:**
  - the removed lines equal `draft-stream.ts` apart from the two file headers and `everyInterval`'s new `export`;
  - imports go one way at runtime: `polling` → `draft-stream`, and the reverse edge is type-only.
- **Accepted deviation:** moving `everyInterval` was the right call; the spec's fallback (moving `PollingCtx`) wouldn't have broken the cycle.
- **Result:** `polling.ts` drops from 393 to 167 lines, and `draft-stream.ts` is 238.
