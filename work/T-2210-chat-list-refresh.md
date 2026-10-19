---
id: T-2210
title: "Store phase 3 T4: the chat-list refresh's merge step and new-row adoption move into client-core and both apps use them; phone import aliases and the jump-constant re-exports go; no behaviour change"
status: merged
milestone: M5
branch: task/T-2210-chat-list-refresh
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2210: One chat-list refresh core (store phase 3, T4)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/store-phase3-plan.md` T4. Julio said go on 2026-10-19. After `/api/chats` answers, web and phone run the same steps in their own words:
1. confirm the previews and delivered marks;
2. merge the rows with the prefs;
3. remember the group ids;
4. join every new group room;
5. load each new row's preview.

The open-topic-gone handling differs: web goes to General with a notice and replaces the URL, while the phone goes back to the group screen. That part stays in each app.

### Facts (the lead read these on 2026-10-19)
1. **Web** `apps/web/src/store/effects/history.ts:147-248` `refreshChatsOrThrow`:
   - `:160-174` delivery for each row, `mergeChatRows(...)`, `chatPrefs`, `k.rememberGroupIds(entries)`;
   - `:175-213` topic gone (web only);
   - `:214` `flushPending(ctx)`;
   - `:216-247` join the new group rows (`current.joinRoom(row.id, k.nick(me))` plus `loadGroupMembersInBackground`) and `loadPreview` for each new row.
2. **Phone** `apps/mobile/src/store/effects/history.ts`:
   - `:97-126` `mergeChatEntries`: delivery, `mergeChatRows`, `h.rememberGroupIds`, then topic gone (phone only);
   - `:131-166` `adoptChatEntries`: join the new group rows, start `ensureGroupDetail` once per group id and `ensureGroupMembers` for each row, then `loadPreview` for each new row;
   - `:179-210` `refreshChats` and `reloadChatsList` call them.
3. Both use the core `applyChatDelivery`, `mergeChatRows`, `flushPending` and `loadPreview` from `@zilar/client-core/store`.
4. **Rule breaks to fix** (`docs/ARCHITECTURE.md`: no pass-through re-exports and no rename aliases):
   - `apps/mobile/src/store/effects/history.ts:8,10` import `flushPending as flushCore` and `loadPreview as loadPreviewCore`;
   - `:52` re-exports `MESSAGE_JUMP_MAX_PAGES` and `MESSAGE_JUMP_WAIT_MS`, and `apps/mobile/src/store/real-store.ts:167` re-exports them again.

### Steps
1. In `packages/client-core/src/store/history.ts`, add:
   - `mergeFreshChats(ctx, rows, entries, prefs, now)`: the delivery loop, `mergeChatRows` and `rememberGroupIds`. It returns the chats from before the merge.
   - `adoptNewRows(ctx, core, me, rows, known, onJoined)`: an Effect that joins each new group row's room, ignoring failures, then calls `onJoined(row)`, then loads the preview of each new row.

   Use whatever the core contexts already expose for the ledger (`rememberGroupIds`, `nick`); add a field only if one is missing.
2. **Web `refreshChatsOrThrow`:**
   - calls `mergeFreshChats`, keeping `chatPrefs` in its own `set`;
   - keeps the topic-gone block and `flushPending`;
   - calls `adoptNewRows` with `onJoined = (row) => loadGroupMembersInBackground(ctx, row.id)`;
   - keeps the stale-session check before any `set`, exactly where it is.
3. **Phone:**
   - `mergeChatEntries` calls `mergeFreshChats` and keeps its topic-gone block;
   - `adoptChatEntries` becomes one `adoptNewRows` call. Its `onJoined` starts `ensureGroupDetail` once per group id (keep the `detailStarted` set) and `ensureGroupMembers`;
   - keep the generation check where it is.
4. Fix fact 4:
   - import `flushPending` and `loadPreview` under their own names;
   - delete both re-export lines;
   - point any importer at `@zilar/client-core/store` (`git grep -n "MESSAGE_JUMP_MAX_PAGES\|MESSAGE_JUMP_WAIT_MS" -- apps`).
5. **Keep these orders:** the session or generation check comes before the first `set`; joins happen before previews; previews only for rows not in `known`.
6. **Stop rule:** measure the net over the changed source files, tests excluded. If it is not at least −20, do not commit. Set `status: blocked` and write the numbers in the Report.

### Allowed files
- `packages/client-core/src/store/history.ts`
- `packages/client-core/src/store/ctx.ts`
- `apps/web/src/store/effects/history.ts`
- `apps/mobile/src/store/effects/history.ts`
- `apps/mobile/src/store/real-store.ts`
- `work/T-2210-chat-list-refresh.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/chat-rows.test.ts src/store/delivered.test.ts src/store/history.test.ts --reporter=dot
pnpm --filter @zilar/web exec vitest run src/store/effects/history.test.ts --reporter=dot
pnpm --filter @zilar/mobile exec vitest run src/store/real-store.history.test.ts src/store/real-store.lifecycle.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and the tests above pass unchanged.
- Net at least −20.
- No `as flushCore`, `as loadPreviewCore` or jump-constant re-export left.
- Lead checks:
  - web mock: a new message updates the list row; reload; a group topic opens with its history;
  - phone emulator: the chat list loads, a group opens, and Dev team's members show.

---

## Report (written by the worker when done)

### What I did
- Added `mergeFreshChats` and `adoptNewRows` to `packages/client-core/src/store/history.ts`.
  `mergeFreshChats` runs the delivery loop, merges the rows with prefs, records the group ids and
  returns the rows from before the merge. `adoptNewRows` joins each new group room best-effort,
  calls the app's `onJoined` hook, then loads the preview of every new row.
- Web `refreshChatsOrThrow` now calls `mergeFreshChats` (prefs still land in their own `set`),
  keeps the topic-gone block and `flushPending` in place, and calls `adoptNewRows` with
  `loadGroupMembersInBackground` as `onJoined`. The stale-session check is still before the first
  `set`.
- Phone `mergeChatEntries` calls `mergeFreshChats` and keeps its topic-gone block;
  `adoptChatEntries` is now one `adoptNewRows` call whose hook keeps `detailStarted`,
  `ensureGroupDetail` and `ensureGroupMembers`. The generation checks are unchanged.
- Removed the rename aliases (`flushPending as flushCore`, `loadPreview as loadPreviewCore`) and
  both jump-constant re-exports (`effects/history.ts` and `real-store.ts`). No other file imported
  those constants (only a comment mentions the page cap), so no importer needed repointing.
- Added an optional `rememberGroupIds` hook to `CoreHooks` in `ctx.ts`: the phone's core context
  had no way to record group ids, and the web context already exposed it through `fx`. The phone
  sets it in `real-store.ts`.
- Also removed the unused pass-through names from the web `history.ts` re-export block
  (`canLoadHistory`, `flushPending`, `loadPreview`); `loadOlder` and `openHistory` still have
  importers. This keeps the house rule against pass-through re-exports.
- `nickFor` (the same helper both apps already used for their `nick`) is used inside
  `adoptNewRows`; no per-app `nick` hook was needed.

### Files changed
- `packages/client-core/src/store/history.ts`
- `packages/client-core/src/store/ctx.ts`
- `apps/web/src/store/effects/history.ts`
- `apps/mobile/src/store/effects/history.ts`
- `apps/mobile/src/store/real-store.ts`
- `work/T-2210-chat-list-refresh.md` (status + this report)

### Net line count (changed source files, tests excluded)
| File | Before | After | Net |
| --- | ---: | ---: | ---: |
| `packages/client-core/src/store/history.ts` | 411 | 448 | +37 |
| `packages/client-core/src/store/ctx.ts` | 228 | 229 | +1 |
| `apps/web/src/store/effects/history.ts` | 248 | 216 | −32 |
| `apps/mobile/src/store/effects/history.ts` | 275 | 247 | −28 |
| `apps/mobile/src/store/real-store.ts` | 452 | 452 | 0 |
| **Total** | **1614** | **1592** | **−22** |

### Commands run
- `pnpm install` — done (1155 packages added, no errors).
- `pnpm --filter @zilar/client-core exec vitest run src/store/chat-rows.test.ts src/store/delivered.test.ts src/store/history.test.ts --maxWorkers=2 --reporter=dot` — 3 files, 36 tests passed.
- `pnpm --filter @zilar/web exec vitest run src/store/effects/history.test.ts --maxWorkers=2 --reporter=dot` — 1 file, 1 test passed.
- `pnpm --filter @zilar/mobile exec vitest run src/store/real-store.history.test.ts src/store/real-store.lifecycle.test.ts --maxWorkers=2 --reporter=dot` — 2 files, 17 tests passed.
- `pnpm exec prettier --write <the five changed source files>` — only formatting.
- `pnpm gate` from the repo root — GATE PASS. Summary lines:
  - `PASS install (frozen) (1.3s)`
  - `PASS format (1.3s)`
  - `PASS lint (0.9s)`
  - `PASS typecheck (6.3s)`
  - `PASS effect (0.8s)`
  - `PASS build @zilar/server (0.4s)`
  - `PASS tests @zilar/client-core (8.8s)`
  - `PASS tests @zilar/mobile (3.9s)`
  - `PASS tests @zilar/web (4.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
  - Warnings only: soft-size warnings for `apps/mobile/src/store/real-store.ts` (452) and
    `packages/client-core/src/store/history.ts` (448); no file over 800, no task IDs in comments.

### Problems / deviations
- None blocking. The phone manual smoke (chat list, group open, Dev team members) and the web mock
  checks are the lead's, as listed under Acceptance; I did not run them.
- The spec suggested using the contexts' `nick`; I used the shared `nickFor` helper directly
  instead, because both apps already used exactly that implementation and it avoids a second
  per-app hook. No behaviour change.

### Blocked / needs a decision
- Nothing.


## Review (written by Claude)

Approved. The pre-review was clean (0 findings). Net −22.

**What changed:**
- client-core gains `mergeFreshChats`: delivery marks, the row merge with prefs, and remembering group ids through `fx.rememberGroupIds`. Web wires that hook in `storeContext.ts:109`, and the phone now wires it in `real-store.ts`.
- client-core also gains `adoptNewRows`: join the new group rooms, then load previews of the new rows.
- Both apps keep their own topic-gone handling and the session or generation check before any `set`.
- Fixed here: the phone's `as flushCore` / `as loadPreviewCore` aliases, the jump-constant re-exports, and three web pass-through re-exports.

**Lead checks:**
- Web mock, branch and main identical: DM send, picture, group send, reload, reopen. The count of 2 for the DM text includes the chat-list preview, on main too.
- Phone emulator: the smoke passes; the chat list loads, Dev team shows "6 members, 5 topics", and General opens with its history and member avatars.
