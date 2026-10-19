---
id: T-2152
title: "Clean-up: product functions that only tests call are deleted with their test cases, and two test-helper files move to the test-support name the code map counts as tests; no behaviour change"
status: merged
milestone: M5
branch: task/T-2152-test-only-code
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2152: Delete product code only tests use; name test helpers as tests

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and code people and AIs can trust. The lead scanned `apps/` and `packages/` at `3509d5601`. Each function below is exported from product code, but no product file calls it; only tests do. The product never runs it, so it and the test cases that exist only for it are dead.

Two files hold test helpers but have names the code map counts as product source. The gate's own size rule already treats `test-harness` as a test file.

### Part A — delete product functions that only tests call

| File (line) | Name | Test file(s) that call it |
| --- | --- | --- |
| `apps/mobile/src/lib/chat-api-schemas.ts` (6) | `parseChatsList` (the whole 8-line file) | `apps/mobile/src/store/real-store.lifecycle.test.ts` |
| `apps/runner/src/connect.ts` (29) | `hubUrlFromServer` | `apps/runner/src/connect.test.ts` |
| `apps/server/src/agents/gateway/routine-send.ts` (63, 76) | `clearRoutineMessage`, `clearRoutineMessageByTarget` | `apps/server/src/routines/message-store.test.ts` |
| `apps/server/src/agents/task-card.ts` (73) | `failTaskCard` | `apps/server/src/agents/task-card.test.ts` |
| `apps/server/src/ai/catalog.ts` (31) | `mapCatalog` | `apps/server/src/ai/catalog.test.ts`, `apps/server/src/connections/catalog-provider.test.ts` |
| `apps/server/src/blocks/roster.ts` (67) | `removeBlockRosterItems` | `apps/server/src/blocks/blocks.test.ts` |
| `apps/server/src/message-blocks/respond.ts` (about 405-440) | `linkAlertCard` and the `AlertLinkTaken` class | `apps/server/src/message-blocks/respond.test.ts` |
| `apps/server/src/questions/service.ts` (245) | `listOpenQuestions` | `apps/server/src/questions/service.test.ts` |
| `packages/chat-core/src/messages.ts` (196) | `previewText` | `packages/chat-core/src/messages.test.ts` |
| `packages/chat-core/src/money.ts` (whole 12-line file) | `formatMoney` | `packages/chat-core/src/money.test.ts` (whole file); also drop `export * from './money';` at `packages/chat-core/src/index.ts:53` |

**`linkAlertCard` is not the alert-card feature.** Routines link their alert card when they are created: `input.alertCard` is inserted at `apps/server/src/tools/routine-adapters.ts:69-76` and `apps/server/src/routines/support.ts:95-106`. `insertRoutineRow` (`apps/server/src/routines/support.ts:311`) turns a duplicate link into `alert_card_taken`. Keep `findAlertRoutine` and everything else in `respond.ts`.

For each row:
1. **Confirm it is unused.** Run `git grep -nw <name>` over the whole repo. If a non-test file other than the declaration names it, skip the row and say where.
2. **Delete the function** and its doc comment, plus any private helper, constant or import only it used.
3. **Delete its test cases.**
   - Delete each `it`/`test` case that calls the deleted function, plus any `describe` left empty.
   - When a test case also checks live code, keep the case and remove only the deleted function's part, if that is a clean cut. Otherwise keep the case and say why in the Report.
   - Delete a test file only when every case in it is gone (`money.test.ts`).

### Part B — move test helpers under a test name

1. `git mv packages/runner-tunnel/src/test-harness.ts packages/runner-tunnel/src/test-support.ts`, then update its importers:
   - `packages/runner-tunnel/src/auth.test.ts`;
   - `packages/runner-tunnel/src/desk-runner.test.ts`;
   - `packages/runner-tunnel/src/demo.ts` (the `pnpm demo` script);
   - `apps/runner/src/connect.test.ts`.
2. `git mv packages/xmpp-core/src/testing.ts packages/xmpp-core/src/test-support.ts`, then change `packages/xmpp-core/package.json`'s export to `"./testing": "./src/test-support.ts"`. Keep the subpath name, so the app tests that import `@zilar/xmpp-core/testing` stay unchanged.
3. Move `testCorePorts` (`packages/client-core/src/store/ports.ts:175`) into the existing `packages/client-core/src/store/test-support.ts`. Update the five client-core tests that import it from `./ports`:
   - `delete-own.test.ts`;
   - `delivered.test.ts`;
   - `lifecycle.test.ts`;
   - `polling.test.ts`;
   - `send.test.ts`.

   Keep any import `test-support.ts` already has.

### Rules
- No behaviour change in product code: Part A only deletes; Part B only moves and renames.
- Do not touch anything under `apps/server/src/auth/` or `apps/mobile/src/auth/`.
- No new tests.

### Allowed files
- `apps/mobile/src/lib/chat-api-schemas.ts`
- `apps/mobile/src/store/real-store.lifecycle.test.ts`
- `apps/runner/src/connect.ts`
- `apps/runner/src/connect.test.ts`
- `apps/server/src/agents/gateway/routine-send.ts`
- `apps/server/src/routines/message-store.test.ts`
- `apps/server/src/agents/task-card.ts`
- `apps/server/src/agents/task-card.test.ts`
- `apps/server/src/ai/catalog.ts`
- `apps/server/src/ai/catalog.test.ts`
- `apps/server/src/connections/catalog-provider.test.ts`
- `apps/server/src/blocks/roster.ts`
- `apps/server/src/blocks/blocks.test.ts`
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `apps/server/src/questions/service.ts`
- `apps/server/src/questions/service.test.ts`
- `packages/chat-core/src/messages.ts`
- `packages/chat-core/src/messages.test.ts`
- `packages/chat-core/src/money.ts`
- `packages/chat-core/src/money.test.ts`
- `packages/chat-core/src/index.ts`
- `packages/runner-tunnel/src/test-harness.ts`
- `packages/runner-tunnel/src/test-support.ts`
- `packages/runner-tunnel/src/auth.test.ts`
- `packages/runner-tunnel/src/desk-runner.test.ts`
- `packages/runner-tunnel/src/demo.ts`
- `packages/xmpp-core/src/testing.ts`
- `packages/xmpp-core/src/test-support.ts`
- `packages/xmpp-core/package.json`
- `packages/client-core/src/store/ports.ts`
- `packages/client-core/src/store/test-support.ts`
- `packages/client-core/src/store/delete-own.test.ts`
- `packages/client-core/src/store/delivered.test.ts`
- `packages/client-core/src/store/lifecycle.test.ts`
- `packages/client-core/src/store/polling.test.ts`
- `packages/client-core/src/store/send.test.ts`
- `work/T-2152-test-only-code.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every Part A row is deleted or skipped with the user's file:line, and Part B's three moves are done.
- The Report gives the product-line net from `git diff main --numstat`, with Part A and Part B listed separately.

---

## Report (written by the worker when done)

### What I did

**Part A — deleted product functions only tests called**

Every row was confirmed with `git grep -nw <name>`: no product file outside the declaration calls it. The only other hits are two historical plan docs (`docs/plan/routine-live-message.md`, `docs/audit/handoff-questions-plan.md`), which are not product code and are outside the Allowed files, so the functions were still deleted.

- `apps/mobile/src/lib/chat-api-schemas.ts`: deleted the whole file (`parseChatsList`).
- `apps/runner/src/connect.ts`: deleted `hubUrlFromServer`.
- `apps/server/src/agents/gateway/routine-send.ts`: deleted `clearRoutineMessage` and `clearRoutineMessageByTarget`.
- `apps/server/src/agents/task-card.ts`: deleted `failTaskCard`.
- `apps/server/src/ai/catalog.ts`: deleted `mapCatalog`.
- `apps/server/src/blocks/roster.ts`: deleted the `removeBlockRosterItems` alias.
- `apps/server/src/message-blocks/respond.ts`: deleted `AlertLinkTaken` and `linkAlertCard` only; `findAlertRoutine` and the rest stay. Dropped the now-unused `isUniqueViolation` import.
- `apps/server/src/questions/service.ts`: deleted `listOpenQuestions`.
- `packages/chat-core/src/messages.ts`: deleted `previewText`.
- `packages/chat-core/src/money.ts`: deleted the whole file, its test file, and the `export * from './money';` line in `index.ts`.

Test cases removed or trimmed:
- `real-store.lifecycle.test.ts` (mobile): kept the T-1474 case because it also checks the live chat-list sort; it now decodes with `chatEntriesFromList` from `@zilar/client-core` (the live shared schema `parseChatsList` wrapped).
- `connect.test.ts`: removed `describe('hubUrlFromServer')`.
- `message-store.test.ts`: removed the two clear cases; the record/load case stays.
- `task-card.test.ts`: removed the two `failTaskCard` cases; the `finishTaskCard` cases stay in a renamed describe.
- `catalog.test.ts`: removed the whole `describe('mapCatalog')`.
- `catalog-provider.test.ts`: the base-URL warm-up now goes through live `getAiCatalog({ fetchImpl })` after `resetCatalogCache()` instead of `mapCatalog`.
- `blocks.test.ts`: calls `removePairRosterItems` (the alias target) directly.
- `respond.test.ts`: routines are created already linked via the live `alertCard` input, so `linkAlertCard` is gone; the "refuses a second link" assertion was removed with it.
- `service.test.ts` (questions): kept the create/find case, removed only the `listOpenQuestions` assertion.
- `messages.test.ts`: deleted the cases that only called `previewText`; the prefix/body cases remain, describe renamed to `previewBody and previewPrefix`.
- `money.test.ts`: deleted (every case was `formatMoney`).

**Part B — test helpers under test names**

- `packages/runner-tunnel/src/test-harness.ts` → `test-support.ts`; updated imports in `auth.test.ts`, `desk-runner.test.ts`, `demo.ts` and `apps/runner/src/connect.test.ts`.
- `packages/xmpp-core/src/testing.ts` → `test-support.ts`; `package.json` export points at it, subpath `./testing` unchanged.
- Moved `testCorePorts` (and its private `inertApi`) from `packages/client-core/src/store/ports.ts` into `store/test-support.ts`; updated `delete-own`, `delivered`, `lifecycle`, `polling` and `send` tests. No behaviour change.

### Checks run

Single test runs (all passed):
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/messages.test.ts` — 23 passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/{delete-own,delivered,lifecycle,polling,send}.test.ts` — 5 files, 78 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/message-store.test.ts src/agents/task-card.test.ts src/ai/catalog.test.ts src/connections/catalog-provider.test.ts src/blocks/blocks.test.ts src/message-blocks/respond.test.ts src/questions/service.test.ts` — 7 files, 44 passed.
- `pnpm --filter @zilar/runner test --maxWorkers=2 --reporter=dot src/connect.test.ts` — 11 passed.
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot src/auth.test.ts src/desk-runner.test.ts` — 2 files, 14 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts` — 12 passed.

`pnpm gate` (first run failed only on format in 3 files; fixed with Prettier, then reran):
```
PASS  install (frozen)  (1.0s)
PASS  format  (1.4s)
PASS  lint  (1.0s)
PASS  typecheck  (6.2s)
PASS  effect  (0.8s)
PASS  build @zilar/server  (0.3s)
PASS  tests @zilar/chat-core  (1.5s)
PASS  tests @zilar/client-core  (6.7s)
PASS  tests @zilar/mobile  (1.8s)
PASS  tests @zilar/runner  (1.7s)
PASS  tests @zilar/runner-tunnel  (1.3s)
PASS  tests @zilar/server  (8.5s)
PASS  tests @zilar/xmpp-core  (1.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/server/src/message-blocks/respond.ts: 447 lines (main 481); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

Line counts from `git diff main --numstat` (excluding `work/T-2152-test-only-code.md`):

| Part | Product source | Tests | Total |
| --- | --- | --- | --- |
| A (delete) | +1 / −141 → net −140 | +23 / −253 → net −230 | +24 / −394 → net −370 |
| B (moves) | +2 / −38 → net −36 | +48 / −10 → net +38 | +50 / −48 → net +2 |

Product-line net for the task (A + B): **−176 lines** (+3 / −179). Part B's product −36 is the 36 lines moved out of `ports.ts` into `test-support.ts`, which the code map counts as a test file; `package.json` and `demo.ts` are line-neutral.

Deviations / decisions:
- The two plan docs named in Part A are stale design notes, not product source; I deleted the functions anyway.
- `catalog-provider.test.ts` now warms the base-URL map through `getAiCatalog` because `mapCatalog` no longer exists; the test still checks the same route behaviour.
- `respond.test.ts` no longer covers the "second routine on the same alert block" refusal, because that assertion existed only for `linkAlertCard`. The live refusal in `insertRoutineRow` is unchanged.
- Test cases that also checked live code were kept and only their deleted-function part removed (mobile sort case, `previewBody`/`previewPrefix` cases, questions create/find case).

Blocked / needs a decision: none.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). It verified that the deletions are unused, the renames are byte-identical moves, and the trimmed tests keep their live-code checks.

**Part A** deleted 11 product functions that only tests called, and their test cases: −140 product lines and −230 test lines. `linkAlertCard` was a leftover: routines link their alert card at creation, and a duplicate link already answers `alert_card_taken`.

**Part B** moved three test helpers under the test-support name: `runner-tunnel/test-harness.ts`, `xmpp-core/testing.ts` (the `./testing` subpath is unchanged) and `testCorePorts`. That moves 516 lines from source into tests. It is a reclassification, reported apart from the cuts.

**Phone check:** a main smoke after T-2149 passed (chats, Ana, AI edit, routines, approvals, the bug topic), and the AIs-here sheet opens with Dev-1 working and QA-1 waiting.
