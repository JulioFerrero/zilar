---
id: T-0042
title: Web — loading vs empty states (no "No chats yet" flash on reload; a reloaded /c/<jid> loads its history)
status: merged
milestone: M2
branch: task/T-0042-web-loading-states
model: opencode-go/muse-spark-1.3-contributor
depends_on: []
estimate: 1 day
---

# T-0042: Loading is not empty

## Spec (written by Claude, do not edit)

### Goal

Julio reported two bugs on 2026-09-28, both from using the live web app:
1. **Reloading an open chat shows it empty.** He was on his AI's DM (`/c/<ai-jid>`) with messages, pressed reload, and saw an empty chat.
2. **"No chats yet" flashes on every reload** before the real list appears.

He said: "you need to control the empty states better".

The lead's first look found the causes:
1. `openHistory` in `apps/web/src/store/realStore.ts` (around line 790) returns silently when `core` is undefined or the chat isn't in `chats` yet. On a reload of `/c/<jid>`, both are true at mount time. Nothing retries, so the history never loads.
2. `ChatList` renders `EmptyState variant="no-chats"` whenever `chats` is empty, including before the first load has finished.

**Verify both causes before you fix them.** Write a failing test first for each.

The rule to apply everywhere: **"loading" and "empty" are different states.** Show a quiet loading state (skeleton rows or a spinner, in the style of the app) until the data has actually arrived. Show an empty state only once you know it's empty.

### Read first
- `AGENTS.md` (mandatory)
- `apps/web/src/store/realStore.ts`: how chats load (`/api/chats` plus XMPP), `openHistory`, `loadOlder`, `status`, and where `openHistory` is called from
- `apps/web/src/components/ChatList.tsx`, `EmptyState.tsx`, `MessageList.tsx`; `routes/ChatShell.tsx` and `routes/ChatView.tsx` (**read only**, see Allowed files)
- the store's tests and `apps/web/src/test/renderApp.tsx`
- `docs/design/ui-style.md`

### Allowed files
- `apps/web/src/store/**`: the fix lives here, plus tests.
- `apps/web/src/components/ChatList.tsx`, `EmptyState.tsx`, `MessageList.tsx`, and a new `components/Skeleton*.tsx` if you need one, plus their tests
- `apps/web/src/lib/api.ts`: only if the store needs a loading hook there
- `work/T-0042-web-loading-states.md`

**Not allowed:**
- `apps/web/src/routes/ChatView.tsx`, `ChatHeader.tsx`, `NewChatButton.tsx`, `components/ais/**` and `routes/AisPage.tsx`: T-0039 is changing them right now. If the fix truly needs one of these, stop, set `status: blocked` and explain.
- `apps/server/**`, `apps/mobile/**`, `packages/**`, `infra/**`, `docs/**`

### Allowed dependencies
None.

### What to build

**1. Chats have a load state.** The store exposes something like `chatsState: 'loading' | 'ready' | 'error'`:
- `ready` after the first successful `/api/chats` merge;
- `error` with a retry if it fails.

`ChatList` shows:
- skeleton rows while `loading`;
- `EmptyState no-chats` **only** when `ready` and empty;
- an inline error with Retry when `error`.

A chat list that is merely filtered to empty by folder or search keeps whatever it shows today.

**2. Opening a chat before the data is there still loads its history.**
- When `openHistory(chatId)` is called before `core` is connected or before the chat is known, remember it as the pending open chat, and run it as soon as both are ready.
- Only the latest pending chat counts. Loading must not happen twice, and a chat opened again later doesn't reload unless it did before.
- Cover the reconnect path too. After a reconnect, the open chat's history should still be correct; follow whatever the store does today for live catch-up.

**3. Messages have a load state per chat.**
- `MessageList` shows a quiet loading state while the first page of a chat's history is in flight.
- It shows its empty or "say hello" state only when the history is loaded and has no messages.
- If history loading fails, show an inline error with Retry instead of an empty chat.

**4. No regressions**
- Live messages that arrive while history is loading are kept and merged, as today (`live` merge in `openHistory`).
- Previews in the list still work.
- The `?mock=1` mock store is unaffected, or updated to expose the same states as `ready`.

### Tests (Vitest and Testing Library, no network)
- **Store:**
  - `chatsState` goes `loading` → `ready`, and `loading` → `error` → retry → `ready`;
  - `openHistory` called before `core` or the chats are ready runs once they are ready;
  - only the latest pending chat loads;
  - no double load.
- **`ChatList`:**
  - skeleton while loading, and **no** "No chats yet" text before ready (the flash test);
  - the empty state appears when ready and empty;
  - the error shows Retry.
- **`MessageList`:**
  - loading state first, then messages;
  - the empty state appears only after an empty load;
  - an error shows Retry.
- **A reload scenario** through `renderApp`, or the closest existing harness: start at `/c/<jid>` with a store that becomes ready after a delay → history is requested and the messages render.

### Live check (the lead does it)
Give exact steps in the Report:
- reload on `/` → no "No chats yet" flash;
- reload on an AI DM → the messages come back;
- reload on a group → the messages come back;
- stop the server briefly → the list shows the error and Retry, not "No chats yet".

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] Both of Julio's bugs are reproduced by a failing test first, then fixed. Say so in the Report, with the failing output.
- [ ] Empty states appear only once the data is known to be empty.
- [ ] Only the Allowed files changed.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@zilar/web
pnpm build
```

### Out of scope
- Mobile, which has the same class of bug. The lead will file a mobile follow-up after this.
- Offline caching of chats or messages (e.g. IndexedDB).

## Report (written by the worker when done)

### What I did
Fixed both of Julio's bugs by separating "loading" from "empty" in the web store and views.

**Store (`apps/web/src/store/`):**
- `store.ts`: added `chatsState: 'loading' | 'ready' | 'error'` (list level),
  `historyState: Record<string, 'loading' | 'ready' | 'error'>` (per-chat first
  page; absent means `ready`), plus `retryChats()` and `retryHistory(chatId)`.
  The mock store exposes all of them as `ready`/no-ops, seeded via
  `ChatStoreSeed`, so `?mock=1` is unaffected.
- `realStore.ts`:
  - `boot` sets `chatsState: 'ready'` after the first successful `/api/chats`
    merge, and `'error'` (+ `status: 'offline'`) when the first load fails.
    `retryChats()` re-runs boot. Background `refreshChats` failures stay
    silent, as before.
  - `openHistory` no longer returns silently when `core` is undefined or the
    chat is unknown: it records the chat as the pending open, marks its
    `historyState: 'loading'`, and `flushPending()` runs it once the core is
    connected and the chat is known. Only the latest pending chat counts; an
    in-flight load dedupes repeat opens (no double load). Flush points: after
    the first chat merge, after connect, after background refresh merges, and
    on XMPP `status: 'online'` (covers reconnect). Live messages arriving
    mid-load still merge via the existing `live` merge. First-page success →
    `'ready'`, failure → `'error'` (keeps live messages; the view offers
    Retry via `retryHistory`).
  - Captured `core` in a local for the in-flight page load so `stop()`
    mid-load can't throw on `core.markDisplayed`.

**Views:**
- `components/Skeleton.tsx` (new): `ChatListSkeleton` (avatar + two bars per
  row, `role="status"` "Loading chats") and `MessageListSkeleton` (bubble
  shapes on the chat background, "Loading messages"), using app tokens
  (`bg-muted`, `bg-bubble-in/out`) and `animate-pulse`.
- `components/ChatList.tsx`: skeleton while `chatsState === 'loading'`
  (no more "No chats yet" flash), inline "Couldn't load chats" + Retry while
  `'error'`, `EmptyState no-chats` only when ready and empty. Folder/search
  filtering behavior unchanged. Retry calls `storeApi.getState().retryChats()`
  (fresh state, not a render snapshot).
- `components/MessageList.tsx`: skeleton while the first page is in flight
  and there are no messages; "No messages yet" only after a loaded-but-empty
  history; "Couldn't load messages" + Retry on error; live messages arriving
  during load render immediately.

### Failing tests first (both causes verified)
- New `loading states (T-0042)` block in `realStore.test.ts` (7 tests) failed
  before the fix (`historyState` undefined; `chatsState` undefined) and the
  reload test failed with `expected [] to have a length of 1 but got +0`
  (page load never requested) — confirming the lead's diagnosis of
  `openHistory` returning silently.
- New `ChatList` tests (skeleton/no-flash, ready+empty, error+Retry) and new
  `MessageList.test.tsx` (4 tests) failed before the component changes
  (empty state rendered while loading / never rendered at all).
- After the fix all pass; pre-existing store/component tests pass unmodified.

### Files changed (all inside Allowed files)
- `apps/web/src/store/store.ts`, `realStore.ts`
- `apps/web/src/store/realStore.test.ts`, `reload.test.tsx` (new),
  `apps/web/src/components/ChatList.tsx`, `ChatList.test.tsx`,
  `MessageList.tsx`, `MessageList.test.tsx` (new), `Skeleton.tsx` (new)
- `work/T-0042-web-loading-states.md` (this report + status)
- Not touched: `lib/api.ts` (no loading hook needed there),
  `EmptyState.tsx`, `ChatView.tsx`/`ChatShell.tsx` (not allowed).

### Commands (real results)
- `pnpm install`: ok (6.5s).
- `pnpm format:check`: pass (after `prettier --write` on `realStore.test.ts`).
- `pnpm lint` (oxlint): pass.
- `pnpm typecheck`: 9 successful.
- `pnpm exec turbo test --force --filter=@zilar/web`: 22 files, 132 tests,
  all passed.
- `pnpm build`: 2 tasks successful.

### Deviations / decisions
- Kept reload-on-every-open: reopening a loaded chat still refetches its
  first page (today's behavior, keeps read markers fresh); dedupe applies to
  in-flight loads and superseded pendings only.
- `ChatShell` right pane still shows the "Select a chat to start messaging"
  pill until the first chat merge on a `/c/<jid>` reload — fixing that needs
  `ChatShell.tsx`, which is not in Allowed files (T-0039 area). Once chats
  arrive, the view mounts and the pending history loads (covered by
  `reload.test.tsx`). Suggested follow-up: let `ChatShell` render a loading
  state while `chatsState === 'loading'` and the route has a `:chatJid`.

### Live check steps (for the lead)
1. Reload on `/` → skeleton rows, never "No chats here yet".
2. Reload on an AI DM (`/c/<ai-jid>`) → messages come back.
3. Reload on a group → messages come back.
4. Stop the server briefly → list shows "Couldn't load chats" + Retry
   (click Retry after restart → list loads), not "No chats yet".

### Blocked / needs a decision
Nothing. No new dependencies.

### Round 2 (lead pre-review findings, all 4 fixed)
1. **First-paint "No messages yet" flash (must-fix):** `MessageList` used
   `historyState[chat.id] ?? 'ready'`, but `openChat` (which sets `'loading'`)
   runs in `ChatView`'s effect after first paint. Fixed store-side, inside
   Allowed files: new `historyStateFor(chatId)` selector on the store.
   The real store reports unknown (never requested) as `'loading'`; the mock
   store reports `'ready'` unless seeded, so `?mock=1` is unchanged.
   `MessageList` now uses the selector. Test (`reload.test.tsx`): real store
   ready, `MessageList` rendered without opening the chat → loading status
   present, "No messages yet" absent. Failed before, passes now.
2. **Superseded pending marker:** `openChat` now clears the previous pending
   chat's `'loading'` entry (via `clearSupersededMarker`, sparing in-flight
   and settled entries) when a newer pending replaces it. Test: open A then B
   pre-ready → A's entry gone, B `'loading'`, only B page-loads. Failed
   before, passes now.
3. **Error with loaded chats:** `ChatList` keeps the list and shows an inline
   "Couldn't load chats" + Retry bar above it; the full error state appears
   only when there are no chats. Test: seeded chats + `chatsState: 'error'` →
   list, bar, working Retry, no skeleton, no empty state. Failed before,
   passes now.
4. **Reconnect path pinned:** new test gates `connect`, opens a chat
   (pending), waits for chats ready (0 page loads), emits `status: 'online'`
   → history loads exactly once. Failed before (`pending` never flushed),
   passes now.

Round 2 commands (real results): `pnpm format:check` pass (after
`prettier --write` on `reload.test.tsx`); `pnpm lint` pass;
`pnpm typecheck` 9 successful; `pnpm exec turbo test --force
--filter=@zilar/web` 22 files / 136 tests passed (+4 new);
`pnpm build` 2 successful. Scope rechecked: only Allowed files + task file;
`PREREVIEW.md` left untracked and uncommitted.

## Review (written by Claude)

### Round 2: approved

Both of Julio's bugs were reproduced by failing tests first, then fixed:
1. `openHistory` before core or the chats were ready is now queued, keeping only the latest chat, and flushed once both are ready and on reconnect.
2. `ChatList` shows skeleton rows while loading, "No chats yet" only when the list is ready and empty, and an error with Retry.

The round 1 pre-review found the same flash one level down: `MessageList` treated an unknown history state as ready, so it showed "No messages yet" on first paint before `openChat` ran. Round 2 fixed it, plus:
- the superseded pending-chat state;
- the error bar over already-loaded chats;
- a reconnect test.

The round 2 pre-review found two nits, accepted:
- Retry briefly shows the skeleton over an already-loaded list (board follow-up);
- `stop()` leaves per-chat `historyState` across a logout, which recovers on reopen.

Lead re-ran every check after rebasing onto main:
- format:check, lint, typecheck (9/9) and build pass;
- `turbo test --force --filter=@zilar/web`: 147/147;
- scope is clean.

Live check: Julio's reload scenarios, next time he uses the web app.

