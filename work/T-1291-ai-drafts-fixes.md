---
id: T-1291
title: "AI live drafts: a (re)connecting client gets the current draft at once (AI-11); a late draft frame matching the final message is dropped, not shown as a duplicate (AI-13); the drafts stream ends after 10 min so a revoked session stops receiving (AI-19); tested"
status: merged
milestone: M5
branch: task/T-1291-ai-drafts-fixes
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1291: AI live-draft fixes

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md`:
- **AI-11** (P2, `:223`): the drafts hub sends only live events (`apps/server/src/drafts/hub.ts`, 156 lines), and a new subscriber gets nothing until the next frame (`apps/server/src/drafts/api.ts`, 130 lines). A phone back from the background mid-turn shows the old text.
- **AI-13** (P2, `:240`, suspected): if the final XMPP message arrives before the first SSE frame, that frame renders below the final message until `DRAFT_END_FALLBACK_MS` (5 s) in `packages/client-core/src/store/polling.ts` (233 lines).
- **AI-19** (P2, `:247`): the session is checked only when the stream opens, and the stream never ends on its own, so a revoked session keeps getting the owner's drafts.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **AI-11:** the hub keeps the latest frame per (owner, chat) while a turn is open, and clears it on end. A new subscriber is sent those frames at once on connect.
2. **AI-13:** in `polling.ts`, `handleDraftEvent` drops a draft frame whose text equals the chat's newest AI message body, or whose turn already finished (cite how a finished turn is known).
3. **AI-19:** the SSE response ends after 10 minutes; both clients already reconnect (cite where), and the reconnect re-runs the session check.
3b. **PERF-9** (`docs/audit/performance-audit.md:201`): both clients open the drafts stream unconditionally (`packages/client-core/src/store/polling.ts`), one long-lived stream per tab or phone even with no AI. Open it only when the user has at least one AI chat (an AI-kind chat in `state.chats`; cite the field), and open it when the first one appears.
4. **Tests** (auth and the message pipeline), up to 3:
   - a late subscriber gets the latest frame (in a new `apps/server/src/drafts/hub.test.ts`, or the nearest existing test);
   - a duplicate late frame is dropped (`packages/client-core/src/store/*.test.ts`, nearest);
   - the stream closes after the cap (a fake clock), only if simple.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (`:223-260`), `apps/server/src/drafts/hub.ts`, `apps/server/src/drafts/api.ts` and `packages/client-core/src/store/polling.ts`.

### Allowed files
`apps/server/src/drafts/*.ts`, `packages/client-core/src/store/polling.ts`, `packages/client-core/src/store/*.test.ts`, `work/T-1291-ai-drafts-fixes.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/drafts --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines.

---

## Report (written by the worker when done)

### Recheck of each finding on main

All three were still present:
- **AI-11** present: `apps/server/src/drafts/hub.ts:39-43` published only to current listeners, and `apps/server/src/drafts/api.ts:72-99` replayed nothing on subscribe.
- **AI-13** present: `packages/client-core/src/store/polling.ts:200-212` (`handleDraftEvent`) dropped a draft only when `finishedTurns` had the turn; a final message arriving before the first frame never marks the turn (`incoming.ts:139,168-172` only calls `finishDraftTurn` when a draft is already shown), so the late frame still rendered.
- **AI-19** present: the session was checked once at open (`api.ts:36-39`) and the stream had no end (`api.ts:58-63`).

PERF-9 was also still present: both clients opened the stream unconditionally from `startDraftStream` (`polling.ts:214-236`).

### What I did

1. **AI-11** (`apps/server/src/drafts/hub.ts`): the hub now keeps the latest `draft` per (owner, chat) in `latestDrafts` while a turn is open, updates/clears it in `publish` (`draft` stores, `end` forgets the chat, dropping the owner entry when empty), and `subscribe` replays those frames synchronously right after the listener is added, before any live one.
2. **AI-13** (`packages/client-core/src/store/polling.ts`): `handleDraftEvent` drops a frame whose `text` equals the chat's newest AI message body (`newestAiText` picks the newest message whose `senderId === chatJid`). A finished turn is known from `finishedTurns` (still checked): `end` marks it via `markTurnFinished` in `handleDraftEnd`, and the final AI message marks it through the `finishDraftTurn` hook (`incoming.ts:170-172` -> web `storeContext.ts:107-110` / mobile `lifecycle.ts:97-100` -> `markTurnFinished`).
3. **AI-19** (`apps/server/src/drafts/api.ts`): added `DRAFT_STREAM_MAX_MS = 10 * 60_000` and ended the stream with `Stream.interruptWhen(Effect.sleep(...))`, so the SSE response closes after 10 minutes. Both clients reconnect and the reconnect re-runs the session check: web `subscribeToDrafts` (reconnect backoff, `apps/web/src/lib/drafts.ts:100-150`) and mobile (`apps/mobile/src/lib/drafts.ts:218-247`).
3b. **PERF-9** (`packages/client-core/src/store/polling.ts`): split the open logic into `syncDraftStream`, which opens the stream only when `ctx.get().chats.some((chat) => chat.isAI)` (`ChatSummary.isAI`, `packages/chat-core/src/types.ts:149`), closes it when no AI chat is left (`ctx.rt.cancel(DRAFT_STREAM_KEY)`), and does nothing otherwise.

   **Fix round 1:** the stream now follows `state.chats` instead of only the 60 s tick. `startDraftStream` installs `watchChats`, which hooks the write point the core sees (`ctx.set`) so a finished refresh or a locally added chat (e.g. a new AI chat) opens or closes the stream on the write, with the check skipped unless the chats array reference changes. Because an app can write its chats through another view (mobile's history writes through the store `set`, not the polling context's), `startDraftStream` also forks a short `DRAFT_STREAM_WATCH_MS` (1 s) reconciliation loop as a fallback, so the first AI chat opens the stream within a second on both clients. `syncDraftStream` stays idempotent (no reopen while open, cancel when the last AI chat goes). `chatsPolling` is back to its original form (it no longer calls `syncDraftStream`).
4. **Tests**:
   - `apps/server/src/drafts/hub.test.ts` (new, 4 tests): mid-turn subscriber gets the latest frame at once; the replay precedes live events; nothing is replayed after `end`; another owner's frame is never replayed.
   - `packages/client-core/src/store/polling.test.ts` (+3, adjusted helper state): a draft equal to the newest AI message is dropped while a different text still shows (AI-13); no stream opens without an AI chat (PERF-9); after a chats change through `ctx.set` that adds an AI chat the stream opens at once, without a tick, and a further write does not reopen it (PERF-9, fix round 1); and a write that bypasses `ctx.set` (simulated with a direct state write) still opens the stream on the watch interval (PERF-9, fix round 1).
   - The stream-cap test (fake clock) was skipped: it is not simple to exercise the raw SSE handler without a full `HttpApi` test harness, and the spec marked it "only if simple".

### Files changed

- `apps/server/src/drafts/hub.ts`
- `apps/server/src/drafts/api.ts`
- `apps/server/src/drafts/hub.test.ts` (new)
- `packages/client-core/src/store/polling.ts`
- `packages/client-core/src/store/polling.test.ts`
- `work/T-1291-ai-drafts-fixes.md`

All are inside the Allowed files (gate scope: "every changed file is inside the Allowed files"). Longest changed file is `polling.ts` at 281 lines (< 400).

### Commands and results

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/polling.test.ts` -> 1 file, 11 passed (fix round 1).
- `pnpm --filter @zilar/server exec vitest run src/drafts --reporter=dot` -> 1 file, 4 passed.
- `pnpm --filter @zilar/client-core exec vitest run src/store --reporter=dot` -> 11 files, 140 passed (fix round 1).
- `pnpm --filter @zilar/client-core exec tsc --noEmit` -> 0 errors.
- After the rebase onto main (T-1293): `vitest run src/store` -> 12 files, 143 passed; `tsc --noEmit` -> 0 errors; `pnpm gate`:

```
PASS  install (frozen)  (3.7s)
PASS  format  (2.0s)
PASS  lint  (0.9s)
PASS  typecheck  (3.5s)
PASS  effect  (0.5s)
PASS  tests @zilar/client-core  (1.6s)
PASS  tests @zilar/server  (2.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Problems / deviations

- The SSE cap has no unit test (see 4); the implementation relies on `Stream.interruptWhen` ending the response, which the seam test with a fake clock would have covered if simple.
- Fix round 1 reacts to chats changes by wrapping `ctx.set` (the core has no state subscription, and `polling.ts` is the only allowed file) and keeps a 1 s reconciliation loop as a fallback for apps that write their chats through another view (mobile's history writes through the store `set`, not the polling context's). The `ctx.set` hook covers a finished `refreshChats` and local chat adds on web; the watcher covers mobile within a second. The hook skips work unless the chats array reference changes.
- Rebase onto main (T-1293, PERF-11): `packages/client-core/src/store/polling.ts` conflicted on each of the two T-1291 commits with main's coalesced focus refresh (`refreshGate`/`CHAT_REFRESH_COALESCE_MS`) and roster-push debounce (`scheduleChatsRefreshBurst`/`ROSTER_REFRESH_DEBOUNCE_MS`); both sides were kept (main's refresh gating plus the draft-stream logic), and the rebased tree passes `vitest run src/store` (12 files, 143 passed), `tsc --noEmit` (0 errors) and the gate.

## Review (written by Claude)

**Lead, 2026-10-13: approved after fix round 1 (the stream opens on a chats change) and the `polling.ts` conflict with T-1293. Pre-review clean (2 nits, 1 follow-up).**
- **Lead's checks after the rebase:**
  - server drafts vitest: 4 tests pass; client-core store vitest: 147 tests pass;
  - tsc: 0 errors in server, web, mobile and client-core;
  - `polling.ts` is 381 lines, `hub.ts` 191.
- **Follow-up:** the drafts reconnect has no cap after a 401. This behaviour predates the task and backs off, so it's a later item.
