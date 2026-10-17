---
id: T-1913
title: "Smooth app W1 (web): the pinned banner paints with the first frame — the web message cache (zilar:messages) also keeps the cached chats' pins, prepareStart seeds pinsByChat from it, so the thread no longer drops ~48 px when the pins answer"
status: merged
milestone: M5
branch: task/T-1913-web-pins-cache
model: auto
effort: default
depends_on: [T-1909]
estimate: 35 min
---

# T-1913: The web pinned banner is there from the first frame

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §4 W1.** Pins load when a chat opens (`apps/web/src/routes/ChatView.tsx:232-236`), and the banner above the thread pops in when they answer (`apps/web/src/components/PinnedBanner.tsx:56`), pushing the whole thread down. Since T-1903 the web caches recent messages locally, so the pins can ride in the same cache.

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/store/messageCache.ts`** (209 lines):
  - the payload is `{ version: CACHE_VERSION, userId, messages }` (schema `:41-43`, `serialize` `:109-110`);
  - `readMessageCache(storage, userId)` (`:122`) returns `Record<chatId, UiMessage[]>`;
  - `writeMessageCache(storage, userId, chats, messagesByChat)` (`:157`) keeps the 30 most recent chats, under a byte cap;
  - `clearMessageCache` is at `:203`.
- **`apps/web/src/store/effects/lifecycle.ts`** (245 lines):
  - `saveMessages` (`:145-150`) and the scheduled write call `writeMessageCache(ctx.ports.storage, state.currentUserId, state.chats, state.messagesByChat)`;
  - `prepareStart` seeds `messagesByChat` from `readMessageCache(storage, cached.userId)` (`:179-185`).
- **Web pins state:** `pinsByChat: Record<chatId, Pin[]>` (`apps/web/src/store/realStore.ts:61`), published by `apps/web/src/store/effects/pins.ts:22-23`.
- **`Pin`** is the api-contract schema (`packages/api-contract/src/pins.ts:73-83`): id, chat, messageId, senderName, text, kind, pinnedBy and pinnedAt, all display strings.

### Steps
1. **`messageCache.ts`:**
   - the payload gains an optional `pins: Record<chatId, Pin[]>`, with the version unchanged. Decode it leniently (a missing or bad `pins` reads as `{}`), and use the contract `Pin` schema per entry, dropping entries that fail;
   - `writeMessageCache` takes an optional 5th parameter `pinsByChat`, and stores the non-empty pin lists of the same kept chats. Pins count toward the byte cap: drop a chat's pins together with its messages;
   - add `readCachedPins(storage, userId): Record<string, Pin[]>` with the same owner check (another user's file reads `{}`).
2. **`lifecycle.ts`:**
   - `saveMessages` and the scheduled write pass `state.pinsByChat`;
   - `prepareStart` seeds `pinsByChat` from `readCachedPins` right after the messages, only for chats with no pins in the store yet.

   The normal pin load still runs on open and replaces them.
3. **Test:** in `apps/web/src/store/messageCache.test.ts`, add one case: pins round-trip for the owner, and another user reads `{}`.
4. **Size:** files stay at most 400 lines.

### Allowed files
- `apps/web/src/store/messageCache.ts`
- `apps/web/src/store/messageCache.test.ts`
- `apps/web/src/store/effects/lifecycle.ts`
- `work/T-1913-web-pins-cache.md`

### Checks
```bash
pnpm --filter @zilar/web exec vitest run src/store/messageCache.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A cold reload of a chat with pins** shows the pinned banner in the first frame, and the thread does not drop when the pins answer.
- **Sign-out** still clears everything (same key).
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/store/messageCache.ts`: the payload now carries an optional `pins` map alongside the version-1 messages. `readCachedPins(storage, userId)` reads it (same owner check as the messages: another user's file reads `{}` and is removed). Pins are decoded per entry with the contract `Pin` schema and entries that fail are dropped; a missing or bad `pins` value reads as `{}`. `writeMessageCache` takes an optional 5th `pinsByChat` and stores the non-empty lists of the kept chats. The byte-cap trimming now works on a `{ id, messages, pins }` list, so dropping a chat drops its pins too, and if the payload is still over the cap after trimming messages the pins go before the last rows.
- `apps/web/src/store/effects/lifecycle.ts`: `saveMessages` (and therefore the scheduled write and `pagehide`) passes `state.pinsByChat`. `prepareStart` seeds `pinsByChat` from `readCachedPins` right after the cached messages, only for chats that have no pins in the store yet. The normal pin load on open still replaces them.
- `apps/web/src/store/messageCache.test.ts`: one new case — pins round-trip for the owner and another account reads `{}` (and the foreign key is dropped).
- Files stay within 400 lines: messageCache.ts 302, messageCache.test.ts 165, lifecycle.ts 265.

### Checks run
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/messageCache.test.ts` → 1 file passed, 4 tests passed.
- `pnpm gate` → `GATE PASS`, 4 changed files, all inside the Allowed files:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/web`
  - `scope: every changed file is inside the Allowed files`, `size: every changed source file is within 400 lines`
- The first gate run failed on `format` (`messageCache.ts`); fixed with `pnpm exec prettier --write` on the three changed source files. The second run failed on `typecheck` (`Pin.Type` used as a namespace); fixed by importing `type Pin as PinRow`. The final run above is the passing one.

### Notes for the lead
- No deviation from the spec. One addition inside step 1's cap rule: after trimming the newest chat's rows, if the payload is still over the cap I drop the kept chats' pins (oldest chat first) before falling back to an empty cache, so a large pin list cannot evict the last message.
- The cache write is still triggered by message changes (and `pagehide`), not by a pin change alone. Cached pins are therefore refreshed on the next message write or when the page hides; the live pin load on open is the source of truth. That matches the existing write schedule, so I did not add a trigger.
- I did not verify the first-frame acceptance on a running app (no browser smoke in this task); the gate and the unit test cover the cache behaviour.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `7f841d59b`.
- **The change:**
  - the same `zilar:messages` payload gains a lenient optional `pins`, with the same owner check and the version unchanged;
  - `prepareStart` seeds `pinsByChat` only for chats with no pins yet, and the pin load on open replaces them;
  - `messageCache.ts` is now 306 lines.
- **The nits are accepted:**
  - a pin or unpin only reaches the cache on the next message write or on `pagehide`; stale pins correct themselves on open;
  - the payload is parsed twice at start;
  - the tests don't cover the lenient-decode edges.
- **Live check after the deploy:** a cold reload of a chat with pins shows the banner at once.

