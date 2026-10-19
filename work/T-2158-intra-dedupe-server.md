---
id: T-2158
title: "Clean-up (server): repeated blocks inside one file become one helper or one loop; no behaviour change"
status: merged
milestone: M5
branch: task/T-2158-intra-dedupe-server
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2158: One copy of each block repeated inside a file (server)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead scanned each file at `3b06cd0a4` for runs of 6 or more normalised lines (comments, blanks, imports and lone braces ignored) that appear twice or more in the same file. The ranges below are where the copies sit; the groups are separated by `;`.

| File (lines) | Repeated ranges |
| --- | --- |
| `apps/server/src/tools/queries.ts` (373) | 14-20, 101-107, 357-363 ; 156-164, 183-191, 210-218 ; 159-169, 213-223 ; 88-111, 344-367 |
| `apps/server/src/push/store.ts` (405) | 120-125, 137-142 ; 283-289, 340-346 ; 294-333, 354-393 |
| `apps/server/src/sandbox/run-tool.ts` (450) | 343-350, 355-362, 375-382, 386-393 ; 354-369, 385-400 |
| `apps/server/src/routines/outcomes.ts` (241) | 119-125, 138-144 ; 121-129, 140-148, 205-213 ; 158-163, 169-174, 202-207 ; 159-164, 203-208 |
| `apps/server/src/ais/api.ts` (592) | 350-361, 373-384 ; 442-471, 490-517 |
| `apps/server/src/ais/queries.ts` (192) | 15-28, 115-128 |
| `apps/server/src/push/api-handlers.ts` (503) | 205-219, 314-328 |
| `apps/server/src/stickers/telegram/client.ts` (357) | 92-116, 134-158 |
| `apps/server/src/groups/visibility.ts` (234) | 132-139, 152-159 ; 92-103, 184-195 |

### Steps
For each group, read every copy:
1. **Same code:** keep one copy, as a local helper, a shared row-to-view mapper, a loop over a small table, or a shared JSX piece in the same file. Make the other places use it.
2. **Same shape, different data:** pass the difference as a parameter only when the result is shorter. Otherwise skip the group.
3. **A call site, not a copy:** skip the group when the repeat is only a call site or a destructure.
4. **Keep the sum smaller:** a helper must save more lines than it adds. If it doesn't, revert it and say so in the Report.

### Rules
- No behaviour change: the same SQL, the same values and order, the same log texts, the same markup, labels and styles.
- Keep every "why" comment, once.
- No new tests. Run the nearest existing tests with `--reporter=dot`.
- `apps/server/src/push/store.ts` is on the message pipeline. Its `push` tests must pass unchanged.

### Allowed files
- `apps/server/src/tools/queries.ts`
- `apps/server/src/push/store.ts`
- `apps/server/src/sandbox/run-tool.ts`
- `apps/server/src/routines/outcomes.ts`
- `apps/server/src/ais/api.ts`
- `apps/server/src/ais/queries.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/stickers/telegram/client.ts`
- `apps/server/src/groups/visibility.ts`
- `work/T-2158-intra-dedupe-server.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat`.
- The Report lists each group: merged (lines saved) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Merged each scanned group in place; no behaviour change intended.

- `apps/server/src/tools/queries.ts`: one `toPublicTool` mapper now feeds both list loops and `toToolDetail` (14-20 / 101-107 / 357-363 and 88-111 / 344-367); one `loadTool` helper replaces the four identical `getToolRow` wrappers (156-164 / 183-191 / 210-218 and 159-169 / 213-223). File net −33 lines.
- `apps/server/src/push/store.ts`: 294-333 / 354-393 partly merged — the repeated "saved row missing" guard is now `requireSaved` (3 lines saved); the count and insert bodies stay separate because their columns and endpoint/token predicates differ. 120-125 / 137-142 skipped: two different UPDATEs, a parameterised helper would be longer and alter the SQL. 283-289 / 340-346 skipped: the shared block is four lines and the helper cost more lines than it saved (tried, then reverted). File net −2 lines.
- `apps/server/src/sandbox/run-tool.ts`: 343-350 / 355-362 / 375-382 / 386-393 merged into `invalidOutput` (~12 lines saved); 354-369 / 385-400 merged into `settleOutput` (~6 lines saved). File net −18 lines.
- `apps/server/src/routines/outcomes.ts`: 119-125 / 138-144, 121-129 / 140-148 / 205-213 and 158-163 / 169-174 / 202-207 / 159-164 / 203-208 merged into one `updateRoutine` wrapper around the same four UPDATE statements. File net −2 lines.
- `apps/server/src/ais/api.ts`: 350-361 / 373-384 merged into `recordAiChange`, also used by the same-shaped `assignMachine` audit (~10 lines saved); 442-471 / 490-517 merged into `setAiStatus`, with `stopAi` and `resumeAi` reduced to two calls (~26 lines saved). File net −36 lines.
- `apps/server/src/ais/queries.ts`: 15-28 / 115-128 merged into one `publicAiColumns` SQL fragment; `findOwnedAi` appends `ais.localpart`. File net −14 lines.
- `apps/server/src/push/api-handlers.ts`: 205-219 / 314-328 merged into `syncRoomsBestEffort`; the two log texts are unchanged (`after registration` / `after device removal`). File net −11 lines.
- `apps/server/src/stickers/telegram/client.ts`: 92-116 / 134-158 merged into `readCappedBody`, with a callback for the two different overflow errors. File net −13 lines.
- `apps/server/src/groups/visibility.ts`: 132-139 / 152-159 merged into `assertChangeAllowed` (~5 lines saved); 92-103 / 184-195 merged into `retireLiveHandle` (~4 lines saved). File net −9 lines.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools src/groups/visibility.test.ts src/push/store.test.ts src/push/api-subscribe.test.ts src/routines/blocks-post.test.ts src/routines/execute.test.ts src/routines/scheduler.test.ts src/sandbox/run-tool.test.ts src/ais/provisioning.test.ts src/stickers`: 12 files passed, 129 tests passed.
- `pnpm gate` first run failed only on format (3 files); after `prettier --write` on those files the rerun ended with:
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (1.3s)`
  - `PASS  typecheck  (3.5s)`
  - `PASS  effect  (0.8s)`
  - `PASS  build @zilar/server  (0.4s)`
  - `PASS  tests @zilar/server  (43.2s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

Net product lines from `git diff main --numstat` (excluding the task file): 249 insertions, 387 deletions, **−138 lines**.

### Notes for the lead

- `setAiStatus` binds the two status values as SQL parameters instead of inline literals; the predicates, order and semantics are otherwise identical, and the stop/resume tests pass. Same for the shared audit helper.
- Soft size warnings remain for files already over 400 lines on `main`; each of them is smaller than on `main`, and none is over 800 lines.


## Review (written by Claude)

Approved; the pre-review was clean. Net −138 across nine server files:
- `tools/queries`: one tool row-to-view mapper instead of three copies.
- `ai/api`: one stop/resume helper.
- Also: `ais/queries`, `groups/visibility`, `push/api-handlers`, `routines/outcomes`, `sandbox/run-tool`, `stickers/telegram/client`.
- `push/store`: only the "saved row missing" guard was shared. The count and insert bodies stay, because they differ.

**Comments:** the stop/resume "why" survives, reworded for the merged helper: a foreign id answers 404, the target status is idempotent, `disabled` answers 409, and a racing call wins. No other "why" was lost.

**Checks:** the gate ran the server tests, the push tests included. The lead runs the route probe after the push.
