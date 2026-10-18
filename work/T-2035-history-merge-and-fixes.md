---
id: T-2035
title: "Share W2-e (Julio: fix both): one mergeChatRows in client-core (fresh/kept split, mergeUnread, presence carry-over, order, prefs) used by web and phone; web keeps the last chat prefs when /api/chat-prefs fails (today it wipes pins/mutes/archives for a refresh); the phone prunes inactive chats on open like web (PERF-3 memory cap) — with tests"
status: merged
milestone: M5
branch: task/T-2035-history-merge-and-fixes
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2035: Shared chat-list merge, plus two history fixes (share plan W2-e)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18, answering the share plan's Q5: "Fix both". `docs/audit/share-plan.md` §4 found the chat-list merge copied almost line for line in web and phone history, and two drifts:
1. **Web wipes prefs on failure.** It turns a failed `listChatPrefs` into `[]`, so pins, mutes and archives vanish until the next refresh. The phone keeps the last rows, which is right.
2. **The phone never prunes inactive chats.** Web does, on every `openChat` (the PERF-3 memory cap). With long chats, the phone keeps every loaded message of every chat in memory, and Julio reported phone scroll jank on 10-18.

This is the message pipeline, so tests are required.

### Facts (read by the lead on 2026-10-18 at `c0f134fa7`)
- **Web.** `apps/web/src/store/effects/history.ts` (311 lines):
  - `openChat` calls `pruneInactiveChats(ctx, chatId)` at `:109`;
  - `refreshChatsOrThrow` (`:175`) loads `api.listChatPrefs()` with `Effect.catchCause(() => Effect.succeed([] as ChatPref[]))` (`:183-185`), which is the wipe;
  - the merge block (`:199-232`) builds `known`, `freshRows` (with `applyChatDelivery` per row), `fresh`, and `kept`, where `mergeUnread(row, existing, activeChatId)` carries over `online`, `lastSeenAt` and `onlineCount`. It then calls `ctx.set({ chats: applyChatPrefs(orderChatRows(fresh, kept), prefs, now().getTime()), chatPrefs: prefsByJid(prefs) })` and `k.rememberGroupIds(entries)`.
- **Phone.** `apps/mobile/src/store/effects/history.ts` (314 lines):
  - `loadPrefRows` (`:63-72`) recovers to `s.chatPrefRows` (keeps the last rows);
  - `mergeChatEntries` (`:98-134`) is the same block, using `s.chatPrefRows` and `ports.now()`;
  - `openChat` (`:283-312`) has **no** prune call;
  - `historyCtx = makeHistoryCtx(ctx)` (`:61`) is the `HistoryCtx` that core functions take, already passed to `applyChatDelivery`, `openHistory` and others.
- **Core.**
  - `pruneInactiveChats(ctx: HistoryCtx, activeChatId)` is at `packages/client-core/src/store/prune.ts:20-51`, exported by the store barrel (`store/index.ts:26`).
  - `packages/client-core/src/store/chat-rows.ts` (179 lines) exports `mergeUnread` (`:38`) and `summariesFor` (`:129`), and is exported by the store barrel (`store/index.ts:54`). **Put the shared merge in `chat-rows.ts`, so no barrel edit is needed.**

### Steps
1. **The shared merge.** In `packages/client-core/src/store/chat-rows.ts`, add a pure `mergeChatRows(previous: ChatSummary[], freshRows: ChatSummary[], activeChatId, prefs: ChatPref[], nowMs: number): ChatSummary[]`. It does the fresh/kept split, `mergeUnread`, the carry-over of the three presence fields, then `applyChatPrefs(orderChatRows(fresh, kept), prefs, nowMs)`.
   - Import `orderChatRows` and `applyChatPrefs` from where the apps import them today.
   - `applyChatDelivery` stays in the callers: it has side effects.
   - The file stays at or under 400 lines.
2. **Web.**
   - `refreshChatsOrThrow` uses `mergeChatRows`.
   - On a `listChatPrefs` failure it keeps the last prefs: `Object.values(ctx.get().chatPrefs)`, or whatever reproduces the same `ChatPref[]` that `prefsByJid` was built from. Check the type, and don't use `[]`.
   - `chatPrefs` is left unchanged on failure.
3. **Phone.**
   - `mergeChatEntries` uses `mergeChatRows`.
   - `openChat` calls `pruneInactiveChats(historyCtx, chatId)` right after the active chat is set, where web does it. Make sure the active chat id is already the new one when prune reads state.
4. **Tests.**
   - In `packages/client-core/src/store/rows.test.ts`, or a new `chat-rows.test.ts`:
     - `mergeChatRows` keeps `online`, `lastSeenAt` and `onlineCount` from memory;
     - a new row sorts by recency;
     - prefs pin, mute and archive the merged rows.
   - In `apps/web/src/store/effects/history.test.ts`, if it exists, or the nearest web store test that drives `refreshChats`: a failed `listChatPrefs` after a good one keeps the pinned row pinned.
5. **Fewer lines.** Product lines go down, against 311 + 314 + 179. Report the counts. Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/store/chat-rows.ts`
- `packages/client-core/src/store/chat-rows.test.ts`
- `packages/client-core/src/store/rows.test.ts`
- `apps/web/src/store/effects/history.ts`
- `apps/web/src/store/effects/history.test.ts`
- `apps/web/src/store/store.test.ts`
- `apps/mobile/src/store/effects/history.ts`
- `work/T-2035-history-merge-and-fixes.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- **Lead check, web mock:** blocking `/api/chat-prefs` keeps the pins.
- **Lead check, phone emulator mock:** opening 3 long chats doesn't crash, and the first chat pages back in.

---

## Report (written by the worker when done)

### What I did

- Added the pure `mergeChatRows(previous, freshRows, activeChatId, prefs, nowMs)` to
  `packages/client-core/src/store/chat-rows.ts`. It does the fresh/kept split,
  `mergeUnread` per kept row, carries over `online`, `lastSeenAt` and
  `onlineCount`, then applies `orderChatRows` and `applyChatPrefs`. It is exported
  by the existing store barrel through `export * from './chat-rows'` (no barrel edit).
- Web `apps/web/src/store/effects/history.ts`: `refreshChatsOrThrow` now calls
  `mergeChatRows`. `listChatPrefs` is wrapped in `Effect.option`; on failure the
  merge uses `Object.values(ctx.get().chatPrefs)` (the same `ChatPref[]` that
  `prefsByJid` was built from) and `chatPrefs` is not written at all. On success
  it still writes `prefsByJid(prefs)`.
- Mobile `apps/mobile/src/store/effects/history.ts`: `mergeChatEntries` now calls
  `mergeChatRows` with `s.chatPrefRows`. `openChat` calls
  `pruneInactiveChats(historyCtx, chatId)` immediately after the state update
  that sets the new `activeChatId`, so the store already names the new chat
  (prune also gets the id explicitly, like web).
- Tests:
  - New `packages/client-core/src/store/chat-rows.test.ts` (3 cases): presence
    carry-over of `online`/`lastSeenAt`/`onlineCount`; a new row sorted by
    recency; prefs pinning, muting and archiving the merged rows.
  - New `apps/web/src/store/effects/history.test.ts`: drives the real web store
    (`createRealChatStore` + `fakeApi`), lets boot load a pinned pref, then makes
    `listChatPrefs` reject and refreshes; the row stays pinned and `chatPrefs`
    keeps the same `pinnedAt`.
- Line counts (product files): `chat-rows.ts` 179 → 219, web history 311 → 286,
  phone history 314 → 295 = **800 vs 804 (-4)**. Every file is under 400 lines.
- Allowed files used: the five source/test files above plus this task file.
  `apps/web/src/store/store.test.ts` does not exist, and the new
  `effects/history.test.ts` (an allowed path) covered the web case, so no other
  test file was added.

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/chat-rows.test.ts src/store/rows.test.ts`
  → 2 files passed, 6 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/effects/history.test.ts`
  → 1 file passed, 1 test passed.
- `pnpm gate` (run twice; first run failed only on prettier formatting, which I
  fixed with `prettier --write` on the touched files, then reran). Final run:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.9s)
  PASS  effect  (0.4s)
  PASS  build @zilar/server  (0.6s)
  PASS  tests @zilar/client-core  (6.4s)
  PASS  tests @zilar/mobile  (1.9s)
  PASS  tests @zilar/web  (3.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- I did not run the two manual acceptance checks (blocking `/api/chat-prefs` in a
  browser, or the phone emulator with 3 long chats); those still need Julio/the
  lead.
- The phone prune relies on `historyCtx.set`, which maps mobile state names to the
  core's; `pruneInactiveChats` only touches `messagesByChat` and
  `historyComplete`, both passing through unchanged.
- Web's boot path (`applyBoot`) still applies whatever prefs boot fetched; this
  task only changed the refresh path as specified.


## Review (written by Claude)

Approved; the pre-review was clean, with 2 nits.
- **What changed.**
  - `mergeChatRows` in client-core `chat-rows.ts` is used by web and phone history.
  - On web, a failed `listChatPrefs` (`Effect.option`) keeps the last prefs and leaves `chatPrefs` unchanged. There's a new web test for it.
  - The phone calls `pruneInactiveChats(historyCtx, chatId)` in `openChat`, right after `activeChatId` is set.
- **Lead emulator check** (mock release build of this branch, Viernes with 1,092 messages):
  - 8 flings back reached about 04:33;
  - opening Ana and returning shows Viernes at its newest (15:18), so it was pruned;
  - 8 more flings page back to about 04:48;
  - no crashes and no JS errors.
