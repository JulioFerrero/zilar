---
id: T-2009
title: "Chat perf W2 (phone): older history is requested 3 screens early with a one-page prefetch and one retry, the list window is retuned, and a new message no longer re-renders every mounted row (stable selection, row gets isGroup not chat, one per-chat facts context)"
status: merged
milestone: M5
branch: task/T-2009-chat-list-prefetch
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2009: Prefetch older history, no re-render fan-out (perf W2)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18, on the 0.2.12 Android app: older messages load slowly, and a fling up turns into "a little scroll, 4 or 5 times", then a jump.

The lead's performance audit (T-1997, `docs/audit/chat-scroll-perf.md`, causes C1, C5 and part of C6, section W2) found two causes:
- **Late requests.** The list asks for older messages only half a screen before the end, so a fling hits the end before the page arrives.
- **Re-render fan-out.** Every change to the chat's messages re-renders every mounted row.

The UI has no tests (Julio's rule).

### Facts (read by the lead on 2026-10-18; paths under `apps/mobile/src/components/chat/`)
- **List settings.** `message-list.tsx` (361 lines) renders the `FlatList` with:
  - `initialNumToRender={20}` (`:314`), `windowSize={11}` (`:315`) and `maxToRenderPerBatch={10}` (`:316`);
  - `onEndReachedThreshold={0.5}` (`:346`), whose `onEndReached` calls `loadOlder(chat.id)` when `hasMore` is true (`:347-351`).
- **Scroll state.** `use-message-list-scroll.ts` (304 lines) owns the scroll state (`onScroll`, content size, the jump logic).
- **The selection object.** In `use-chat-screen.ts` (327 lines), `selection` is a **new object on every render**: `{ ids: selectedIds, onToggle: ..., onStart: ... }` (`:140-144`). The screen also subscribes to `state.messagesByChat[chatId]` (`:39`). So every message change re-renders the screen, makes a new `selection`, and then a new `renderItem` in `message-list.tsx`, which re-renders every mounted cell.
- **Row props.** `message-list-row.tsx` (201 lines) receives `selection` (`:36`, `:62`) and the whole `chat`.
- **Bubble store reads.** `message-bubble.tsx` (389 lines, near the limit) has these per-row store subscriptions (`:72-95`):
  - `mediaTrustedHosts`;
  - a `showMarkdown` selector;
  - `me?.jid`;
  - `state.chats.find((entry) => entry.id === message.chatId)`.
- **Prefetch rules.** The audit's §2.4 sets them: trigger at 3 viewports from the end, and when a page lands while the reader is still within 3 viewports of the new end, request the next page at once (the `VirtualizedList` re-arms only on scroll). Retry a failed prefetch once after 1 s.

### Steps
1. **Request earlier.** Set `onEndReachedThreshold={3}`. In `use-message-list-scroll.ts`, add the one-page prefetch with a single retry, using the last offset, the viewport height and the content height it already tracks.
2. **Retune the window.** Set `windowSize={9}`, `maxToRenderPerBatch={5}`, `updateCellsBatchingPeriod={32}` and `initialNumToRender={15}`.
3. **Stable selection.**
   - Memoise `selection` in `use-chat-screen.ts` on `selectedIds`, with stable callbacks.
   - `forwardSelected` reads the messages lazily through `getState()`, not through the `messagesByChat` subscription.
   - Drop that subscription if nothing else needs it; check `loadedMessageIds`' users first.
4. **Narrow row props.** `MessageListRow` gets `isGroup` (boolean) instead of `chat` wherever it only needs that. Keep `chat` only where a row truly needs more.
5. **One facts context per chat.** Add a new `chat-row-facts.tsx` that provides `{ mediaHosts, showMarkdown, meJid, chat }` from `MessageList`, with one set of subscriptions per chat. `message-bubble.tsx` reads that context instead of its four selectors at `:72-95`, which makes `message-bubble.tsx` shorter.
6. **Keep behaviour.** Jump-to-message, the unread divider, staying at the bottom for new messages and the reveal animation must work exactly as before.
7. **Keep files small.** Every file stays at or under 400 lines. No tests (UI).

### Allowed files
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/use-message-list-scroll.ts`
- `apps/mobile/src/components/chat/message-list-row.tsx`
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/chat-row-facts.tsx`
- `work/T-2009-chat-list-prefetch.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The gate passes.**
- **Smoke test.** The lead runs a phone smoke on a long mock chat:
  - scrolling up loads pages with no wall hits;
  - new messages still follow at the bottom;
  - jump-to-message and the unread divider work.
- **Frame comparison.** The lead compares `dumpsys gfxinfo` janky frames against the 0.2.12 baseline.

---

## Report (written by the worker when done)

### What I did

- **Request earlier (C1).** `message-list.tsx`: `onEndReachedThreshold={3}`. `use-message-list-scroll.ts`: the hook now takes `hasMore` and `loadOlder` and owns a one-page prefetch. It uses the refs it already had (last offset, viewport height, content height): once the reader is within 3 viewports of the inverted list's end it requests a page, and when a page lands (`contentHeight` grew) while still within 3 viewports of the new end it requests the next page immediately. A prefetch whose content did not grow within 1 s is retried once; a failed retry re-arms on the next scroll. The retry timer is interrupted on chat change and unmount. The store's `loadingOlder` guard makes an overlapping `onEndReached` / retry a no-op.
- **Window (step 2).** `initialNumToRender={15}`, `windowSize={9}`, `maxToRenderPerBatch={5}`, `updateCellsBatchingPeriod={32}`.
- **Stable selection (C5).** `use-chat-screen.ts`: `selection` is memoised on `selectedIds` with two `useCallback`s. The `messagesByChat[chatId]` subscription (and the `loadedMessageIds` memo) is gone; `forwardSelected` and `jumpTo` read `store.getState().messages(chatId)` through `useChatStoreApi()`. `loadedMessageIds` had no other users.
- **Narrow row props.** `message-list-row.tsx`: `isGroup: boolean` replaces `chat: ChatSummary`; `renderItem` in `message-list.tsx` no longer depends on `chat`.
- **One facts context per chat (C6).** New `chat-row-facts.tsx` (`ChatRowFactsProvider` / `useChatRowFacts`) subscribes once per chat to `mediaTrustedHosts` and `me.jid` and provides `{ mediaHosts, showMarkdown, meJid, chat }`; `message-list.tsx` wraps the list in it. `message-bubble.tsx` dropped its four per-row selectors for the context (it still keeps the per-row `senderAvatar` string selector).
- **Behaviour kept.** Jump-to-message, the unread divider, follow-at-bottom and the reveal animation code paths are untouched; the existing restore/follow branches of `handleContentSizeChange` were kept and the prefetch runs after them.

### Checks run

- `pnpm gate` (first run): `FAIL format` — Prettier on `chat-row-facts.tsx` and `use-chat-screen.ts`. Fixed with `pnpm exec prettier --write` on those two files.
- `pnpm gate` after the fix: passed, and passed again after this Report was added (timings vary per run; one run's lines):
  - `PASS  install (frozen)  (6.5s)`
  - `PASS  format  (1.5s)`
  - `PASS  lint  (3.4s)`
  - `PASS  typecheck  (2.4s)`
  - `PASS  effect  (4.6s)`
  - `PASS  tests @zilar/mobile  (6.4s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- Single test files: none. The change is UI-only (AGENTS.md: UI gets no tests); the mobile suite the gate ran passed.

### Notes for the lead

- **Deviation, small:** the context's `chat` is not the whole `ChatSummary` but the fields a row reads (`kind`, `isAI`, `groupId`, `topic`). A new message gives the summary a new identity (preview/unread), which would otherwise change the context and re-render every mounted row — the C5 measure "only the new row flashes". `showMarkdown` is a function `(message) => boolean` in the context so it stays the shared `shouldRenderMarkdown` rule per chat.
- **Failed prefetch detection:** `loadOlder` swallows a failed page (no error reaches the UI) and returns void, so the hook treats "the content did not grow within 1 s" as the failure signal and retries once. A page slower than 1 s makes the retry a no-op through the store's `loadingOlder` guard; the following 2 s check then just re-arms the prefetch. If the audit wants a real success/failure seam from the store, that is a `history.ts` change outside this task's scope.
- `onEndReached` still calls `loadOlder` alongside the prefetch; the store dedupes them. The hook only remembers prefetches it started, so a failed `onEndReached` page is retried by the next scroll, as before.
- `PAGE_HISTORY_MAX` was not touched (audit says measure first).
- **Not verified here:** no phone smoke (long mock chat, jump/divider, follow) and no `dumpsys gfxinfo` comparison — both need the device and are the lead's acceptance steps. I did not reason about frame numbers.


## Review (written by Claude)

Approved: a clean pre-review with 4 nits (a stale comment, a transient ref, poll churn that was already there, and an idle-timer flag).
- **History loading:** older history is requested 3 screens early, with a one-page prefetch and one retry.
- **List window:** retuned to `windowSize` 9, `maxToRenderPerBatch` 5, batching 32 ms and 15 initial rows.
- **Fewer re-renders:** `selection` is memoised, rows get `isGroup`, and one `ChatRowFacts` context per chat replaces four store selectors per bubble.

The emulator smoke and the gfxinfo comparison run on main after this merge, against a build of `72ff17678` (before W1). Results go in NOW.md.
