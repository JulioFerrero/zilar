---
id: T-0042
title: Web — loading vs empty states (no "No chats yet" flash on reload; a reloaded /c/<jid> loads its history)
status: todo
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
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- Mobile, which has the same class of bug. The lead will file a mobile follow-up after this.
- Offline caching of chats or messages (e.g. IndexedDB).

## Report (written by the worker when done)

## Review (written by Claude)
