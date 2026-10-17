---
id: T-1903
title: "Smooth app task 1: web message cache — the newest 50 messages of the 30 most recent chats in localStorage (zilar:messages, versioned, owner-checked, ≤1.5 MB), painted on a cold load before XMPP connects, written throttled + on pagehide, cleared on sign-out; never tokens, media bytes, unsent or local-* messages"
status: merged
milestone: M5
branch: task/T-1903-web-message-cache
model: auto
effort: default
depends_on: [T-1901]
estimate: 45 min
---

# T-1903: The web opens a chat from its local copy

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §3 "Web" and §5 task 1** (Julio, 2026-10-17: "cards test is slow to load"). A cold web load paints the cached chat list at 0.21 s, but the open chat stays empty until XMPP connects and the history page arrives (about 1.3 s measured). The phone already opens chats from a local copy (T-1313). The web needs the same.

### Facts (read by the lead on 2026-10-17, from the plan's citations)
- **The shape to copy:** `apps/web/src/store/chatListCache.ts` (the key `zilar:chatList`, a version, 200 chats, an owner check, Effect `Schema` decode with passthrough, quota errors swallowed).
- **The phone twin:** `apps/mobile/src/store/offline-cache.ts`:
  - 30 chats × 50 messages;
  - `OFFLINE_CACHE_WRITE_DELAY_MS`;
  - its "never stored" rules: no credentials; no media bytes, only the URLs the rows carry; no `sending`/`failed`/`local-*` messages; no `blob:`/`data:` URLs.
- **`apps/web/src/store/effects/lifecycle.ts`:**
  - `prepareStart` paints the cached list (`:124-141`), with a `pagehide` save;
  - `resetUserState` (`:49-103`) runs on sign-out and `switchUser`.
- **No view changes needed:** `MessageList` renders rows whenever it has any (`apps/web/src/components/MessageList.tsx:156-163`), and the history page merges over existing rows (`packages/client-core/src/store/history.ts:197-216`).

### Steps
1. **New `apps/web/src/store/messageCache.ts`:**
   - `localStorage` key `zilar:messages`, payload `{ version: 1, userId, messages: Record<chatId, UiMessage[]> }`;
   - decode with Effect `Schema`, passthrough for unknown message fields, like `chatListCache`;
   - `readMessageCache(userId)` → the map, or empty on any problem; a different user drops the key;
   - `writeMessageCache(userId, chats, messagesByChat)` keeps the 30 most recent chats in the list's order, with the newest 50 messages each;
   - apply the phone's "never stored" rules;
   - **byte cap:** drop the oldest chats until the JSON is ≤ 1.5 MB;
   - swallow every storage error;
   - `clearMessageCache()`.
2. **Read:** in `prepareStart`, right after the list paint, when the painted user matches, fill the store's messages for those chats from the cache. Use the same store action or setter the history uses to seed rows, and say which in your Report. The history state must still load the page normally.
3. **Write:**
   - throttled at about 2 s after message changes;
   - plus on `pagehide`, next to the list save.
4. **Clear:** call `clearMessageCache()` in `resetUserState`.
5. **Test** (new `apps/web/src/store/messageCache.test.ts`, three cases):
   - round trip for one user, and another user reads empty;
   - `sending`/`local-*` messages and `blob:` URLs are not stored;
   - the byte cap drops the oldest chats.
6. **Size:** every file stays at most 400 lines.

### Allowed files
- `apps/web/src/store/messageCache.ts`
- `apps/web/src/store/messageCache.test.ts`
- `apps/web/src/store/effects/lifecycle.ts`
- `apps/web/src/store/realStore.ts`
- `work/T-1903-web-message-cache.md`

### Checks
```bash
pnpm --filter @zilar/web exec vitest run src/store/messageCache.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A cold reload of an open chat** shows its recent messages from the cache in the first frames; the history page then updates them in place.
- **Sign-out clears the cache,** and another user never sees it.
- Unsent messages, tokens and media bytes are never stored.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **New `apps/web/src/store/messageCache.ts`** (`localStorage` key `zilar:messages`, version 1,
  owner-checked):
  - `readMessageCache(storage, userId)` returns the map or `{}` on any problem; on a different
    owner it removes the key.
  - `writeMessageCache(storage, userId, chats, messagesByChat)` keeps the 30 most recent chats in
    list order, the newest 50 messages each, and applies the phone's never-stored rules:
    `sending`/`failed`/`local-*` rows are dropped, and `attachment`/`image`/`voice` are removed
    when their URL is `blob:` or `data:` (https URLs stay).
  - Dates are encoded as ISO strings and rehydrated as `Date`s (invalid dates become epoch, so no
    caller can call `.toISOString()` on a string). Unknown fields pass through via
    `StructWithRest`, like `chatListCache`.
  - The byte cap (1.5 MB, measured with `TextEncoder`) drops the oldest chats first, then the
    oldest rows of the remaining chat; an impossible single message stores an empty map. Every
    storage error is swallowed.
  - `clearMessageCache(storage)` removes the key.
- **Read:** in `prepareStart` (`effects/lifecycle.ts`), right after painting the cached chat list,
  `readMessageCache(storage, cached.userId)` seeds `messagesByChat` through `ctx.set((state) => ({
  messagesByChat: { ...state.messagesByChat, ...cachedMessages } }))` — the same setter and spread
  the core history page uses (`packages/client-core/src/store/history.ts:197-216`). No
  `historyState`/`cursors` are touched, so `openChat` still loads the first page normally and
  merges it over the seeded rows.
- **Write:** `realStore.ts` wraps the store's `set`; when `messagesByChat` changes identity it calls
  `scheduleMessageSave(ctx)`, which keeps one timer per store (WeakMap in `lifecycle.ts`) and
  writes ~2 s after the last change (`MESSAGE_CACHE_WRITE_DELAY_MS = 2_000`). `pagehide` now calls
  `saveMessages(ctx)` next to `saveChatList(ctx)`.
- **Clear:** `resetUserState` cancels the pending timer (so it cannot recreate the key after the
  clear) and calls `clearMessageCache(storage)` next to `clearChatListCache`; it runs on both
  sign-out and `switchUser`.
- **Test:** new `messageCache.test.ts` with three cases: round trip + foreign-user drop + clear;
  unsent/local/blob:/data: rows are not stored while an https attachment survives; the 1.5 MB cap
  drops the oldest chat.

Files changed (all inside Allowed files):
`apps/web/src/store/messageCache.ts` (new), `apps/web/src/store/messageCache.test.ts` (new),
`apps/web/src/store/effects/lifecycle.ts`, `apps/web/src/store/realStore.ts`,
`work/T-1903-web-message-cache.md`.

### Checks run

- `pnpm install --frozen-lockfile` → `Done in 18.4s using pnpm v10.32.1`.
- `pnpm --filter @zilar/web exec vitest run src/store/messageCache.test.ts --reporter=dot` →
  `Test Files 1 passed (1)`, `Tests 3 passed (3)`.
- Also ran it first with the machine-shared flags (`--maxWorkers=2 --reporter=dot`): 3 passed.
- `pnpm gate` (from the repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (4.1s)
  PASS  lint  (2.3s)
  PASS  typecheck  (5.8s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/web  (8.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Signatures:** the spec wrote `readMessageCache(userId)` / `writeMessageCache(userId, chats,
  messagesByChat)` / `clearMessageCache()`. I added `StorageLike | null` as the first parameter,
  exactly like `chatListCache.ts`, so the cache is testable without touching `window.localStorage`.
  Behaviour matches the spec.
- **`sessionGone.ts`:** the 401/"session gone" path (`apps/web/src/lib/api/sessionGone.ts`) clears
  the chat list cache but not the new message cache. It is outside the Allowed files, so I left it.
  The owner check means the next user cannot read it and the next sign-in's `resetUserState` clears
  it, but if you want that path to clear it too it needs a one-line follow-up.
- **Not verified by eye:** I did not run a browser cold-load to watch the first frames; acceptance
  for the painted rows rests on the unit test, the existing `MessageList` "rows whenever present"
  behaviour cited in the spec, and the green gate. The visual check is yours/Julio's.
- The pending write is a debounce: under continuous incoming messages it waits for a 2 s quiet
  gap, and `pagehide` flushes it, like the phone.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `eff135a2f`.
- **The new module:** `messageCache.ts` (209 lines) is owner-checked and versioned, with a 1.5 MB cap. It excludes `sending`/`failed`/`local-*` messages and `blob:`/`data:` URLs, and swallows storage errors.
- **The wiring:** `prepareStart` seeds the messages after the list paint, writes are throttled to 2 s and flushed on `pagehide`, and `resetUserState` clears the cache.
- **The follow-up goes into T-1909:** `sessionGone` should clear `zilar:messages` too. Today it is data at rest until the next sign-in; other users never see it, thanks to the owner check.
- **The nits are accepted:** cap-loop churn, one write after close, and an all-or-nothing encode.
- **Live check after the deploy:** a cold reload of "cards test" should paint the messages before XMPP connects.
