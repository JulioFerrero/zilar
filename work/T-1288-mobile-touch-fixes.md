---
id: T-1288
title: "Mobile batch 1: Message on a contact's profile opens the DM instead of 'Pull to refresh' (MUX-16); touch targets reach 44 dp (MUX-17); pull-to-refresh on the topics list (MUX-28); a check icon on the send key while editing (MUX-30); haptics on chat-row long-press (MUX-22)"
status: merged
milestone: M5
branch: task/T-1288-mobile-touch-fixes
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1288: Mobile batch 1

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md`:
- **MUX-16** (P2, `:77`): on a contact's profile, "Message" can fail with "No chat with them yet. Pull to refresh the chats list." (`apps/mobile/src/app/u/[handle].tsx`).
- **MUX-17** (P2, `:105`): touch targets under 44 dp: the send key, quick reactions and others listed there.
- **MUX-28** (P3, `:93`): no `refreshControl` on the topics list (`apps/mobile/src/components/chat/group-topic-list.tsx`).
- **MUX-30** (P3, `:51`): edit mode keeps the `ArrowUp` icon on the send key (`apps/mobile/src/components/chat/composer-input-row.tsx`).
- **MUX-22** (P3, `:63`): no haptic on chat-row long-press.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **MUX-16:** Message opens the DM directly. If the chat row isn't known yet, create or open it the way the web New message flow does (cite the shared or web helper), and never ask the user to refresh.
2. **MUX-17:** add `hitSlop` (or padding) so each target the audit lists reaches 44 dp, with no visual change.
3. **MUX-28:** a `RefreshControl` on the topics list wired to the group refresh (cite it), the same pattern as the chat list's.
4. **MUX-30:** a `Check` icon on the send key while editing.
5. **MUX-22:** a Light impact on chat-row long-press, the same helper the bubbles use (cite it).
6. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (`:51`, `:63`, `:77`, `:93`, `:105`), and the files above.

### Allowed files
`apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/components/chat/*.tsx`, `apps/mobile/src/components/chat/*.ts`, `apps/mobile/src/store/**/*.ts`, `work/T-1288-mobile-touch-fixes.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:**
  - Message from a contact's profile opens the DM;
  - the topics list refreshes on pull;
  - edit mode shows a check on the send key.

---

## Report (written by the worker when done)

### Recheck on main (each finding)
- **MUX-16** present: `apps/mobile/src/app/u/[handle].tsx:207-222` (old) failed with "No chat with them yet. Pull to refresh the chats list." when the DM row was not in `state.chats`. Not fixed before.
- **MUX-17** present: send key 36 dp with no `hitSlop` (`composer-input-row.tsx:147-157`), quick reactions 36 dp (`message-actions-sheet.tsx:143`), reaction chips `py-0.5` (`reaction-chips.tsx:48`), cancel-reply 36 wide (`composer-input-row.tsx:57-64`), search clear 16 px with no `hitSlop` (`components/ui/search-field.tsx:50-52`).
- **MUX-28** present: no `refreshControl` on the topics `FlatList` (`group-topic-list.tsx:63-99`).
- **MUX-30** present: edit mode kept `ArrowUp` (`composer-input-row.tsx:156`).
- **MUX-22** present: no haptic on chat-row long-press (`chat-list-item.tsx:80`).

### What I changed
- **MUX-16** (`apps/mobile/src/app/u/[handle].tsx`): `openMessage` now pushes `/chat/[id]` at once and calls `reloadChats()` when the DM row is not in `state.chats`; it never asks the user to refresh. This mirrors web `NewMessageDialog.tsx:50-53` (navigate to the DM at once; "the DM already exists on the server for every contact; the chat list only has to catch up") and relies on the chat screen's skeleton while `chatsLoad === 'loading'` (`chat/[id].tsx:34-40`). The `domain === undefined` branch now shows the fixed sentence "Could not open that chat. Try again." (was the refresh instruction).
- **MUX-17**: `hitSlop={8}` on the send key and cancel-reply (`composer-input-row.tsx`); quick reactions `h-9 w-9` → `h-11 w-11` (`message-actions-sheet.tsx`, the audit-prescribed 36 → 44 dp); reaction chips `py-0.5` → `py-1` plus `hitSlop={8}` (`reaction-chips.tsx`). The send key, cancel-reply and reaction chips are unchanged visually; the quick reactions deliberately grow to 44 dp.
- **MUX-28** (`apps/mobile/src/components/chat/group-topic-list.tsx`): added a `RefreshControl` (same shape as `chat-list.tsx:96-102`). Because `GroupTopicList` receives no `onRefresh` prop and `app/group/[id].tsx` is outside the Allowed files, the list reads the store itself: `refreshGroupDetail(groupId)` (the group refresh, cited: `store/effects/group-actions.ts:69-71`) plus `reloadChats()` (`store/effects/history.ts:355-363`). The `groupId` comes from the first topic's `groupId`. The rows are derived from `state.chats`, so `refreshGroupDetail` alone would not repaint them; `reloadChats` is the same call the chat list's pull uses, so the topic rows actually refresh. The spinner clears when `chatsLoad` leaves `loading`, adjusted during render like `(tabs)/index.tsx:68-76`.
- **MUX-30** (`composer-input-row.tsx`): the send key renders a lucide `Check` while `editing`, `ArrowUp` otherwise; the a11y label is unchanged.
- **MUX-22**: new `apps/mobile/src/components/chat/haptics.ts` exports `tap()` — one Light `Haptics.impactAsync`, ignoring a failure, the same call the bubbles used. `ChatListItem`'s `onLongPress` now calls `tap()` first, and `openMessageMenu` (`message-bubble-actions.tsx:47-50`) now calls the same `tap()`, so the bubbles and the chat row share one helper. (The audit proposed `m/lib/haptics.ts`, but `apps/mobile/src/lib` is outside the Allowed files, so the helper lives beside the chat components.)

### Files changed
`work/T-1288-mobile-touch-fixes.md`, `apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/components/chat/composer-input-row.tsx`, `apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/components/chat/reaction-chips.tsx`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/message-bubble-actions.tsx`, `apps/mobile/src/components/chat/group-topic-list.tsx`, `apps/mobile/src/components/chat/haptics.ts` (new). All files are well under 400 lines (largest: `message-actions-sheet.tsx`, 277).

### Commands run (real results)
- `pnpm install`: done in 1m 21.5s, resolved 1271 packages; only the pre-existing unmet-peer warning (`apps/mobile` @types/react-dom 19.3.0 wants @types/react ^19.3.0, found 19.2.18).
- `pnpm gate`:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.7s)
  PASS  effect  (1.2s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test files were run: the change is UI-only and there are no test files near these components (gate confirms "no nearby test files").

### Deviations / notes
- **MUX-17 search clear not changed**: `apps/mobile/src/components/ui/search-field.tsx` is not in the Allowed files. Its clear button (16 px icon, no `hitSlop`) still needs the fix; the other four targets listed in the audit are done.
- **MUX-28 wiring**: as noted above I call both `refreshGroupDetail` (the "group refresh" named by the spec) and `reloadChats`, because the topic rows live in `state.chats`; `refreshGroupDetail` alone does not repaint them. Flagging this so the lead can confirm the intended wiring.
- No tests added (UI, per the spec).

### Round (fix round 1)
- **Finding 1 (should-fix) — fixed.** `openMessage` in `apps/mobile/src/app/u/[handle].tsx` no longer guesses the DM id blindly. It now calls the new pure helper `resolveDmChatId(userId, contacts, domain)` (`apps/mobile/src/components/chat/dm-chat-id.ts`), which:
  1. returns the peer's real JID when the profile's `userId` is in the loaded contacts list (`state.contacts`, each row carries the server's real `jid`), so a hashed localpart opens the right chat;
  2. falls back to `contactChatId(userId, domain)` only when `userId.toLowerCase()` is a safe XMPP localpart (`^[a-z0-9._-]{1,64}$`, the server's `SAFE_LOCALPART` in `apps/server/src/xmpp/provisioning.ts:16`);
  3. returns `undefined` for an id the server would hash, so the screen shows the fixed sentence "Could not open that chat. Try again." instead of navigating to a chat that does not exist (the "Chat not found" strand).
- **Tests added:** `apps/mobile/src/components/chat/dm-chat-id.test.ts` (4 tests) — real JID wins over the guess; safe id falls back to the server-built id; unsafe id and over-64-char id return `undefined`.
- **Single test run:** `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/chat/dm-chat-id.test.ts` → 1 file, 4 tests passed.
- **Gate:** `pnpm gate` → `GATE PASS` (install, format, lint, typecheck, effect PASS; `tests @zilar/mobile` PASS; scope clean; migration clean), 11 changed files.
- **Nits 2 and 3 left as-is** (not in a line this round changes, per the round instructions): `group-list-item.tsx:98` bare `onLongPress`, and `group-topic-list.tsx:51` `groupId` derived from the first topic.
- **Nit 4 addressed in this Report:** the MUX-17 entry above no longer claims "No visual change"; the quick reactions grew on purpose.


## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (the hashed-id DM guess was fixed with `resolveDmChatId` from the contacts list). 1 nit, 2 follow-ups.**
- **Lead's check on the emulator mock:**
  - the smoke passes;
  - long-press on "Yes, thanks!", then Edit: the send key shows a check icon;
  - Marta's profile in the mock is a non-contact ("Send request"), so I checked MUX-16 in the diff: it resolves the DM id from the contacts list, reloads the chats, and no longer says "Pull to refresh".
- **Follow-ups, for a later mobile batch:**
  - the search-field clear button is still 16 px (`apps/mobile/src/components/ui/search-field.tsx:50-52`);
  - the topics refresh takes `groupId` from the first topic, so it is undefined with zero topics.
- **Lead's checks after the rebase:** mobile tsc: 0 errors. Every file is at most 400 lines.
