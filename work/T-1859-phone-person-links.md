---
id: T-1859
title: "Phone: tapping a person opens them — a group message's avatar and sender name, and the person rows in the topic sheet, open the DM (a contact or your own AI) or /u/<handle> for someone else; self and unknown senders stay plain (twin of web T-1851)"
status: merged
milestone: M5
branch: task/T-1859-phone-person-links
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1859: Tap a person to open them (phone)

## Spec (written by Claude, do not edit)

### Why
**Julio (2026-10-17):** "clicking in the circles or profile pictures … apply the same changes to the app".
- **The web gets this in T-1851.** On the phone, a message avatar and the sender name do nothing, and the topic sheet's person rows do nothing either.
- **The members page** is left out here because T-1858 is rewriting it; a follow-up covers it.

### Facts (read by the lead on 2026-10-17)
- **A group message's `senderId`** is the sender's real bare JID when known (`packages/xmpp-core/src/types.ts:74-79`; `packages/client-core/src/store/ledger-incoming.ts:131`).
  - **AI JIDs** have an `ai-` localpart (`isAiJid`, `packages/protocol/src/jid.ts:35`).
  - **A user's localpart** is their user id lowercased (`apps/server/src/xmpp/provisioning.ts:29-35`).
- **The thread avatar:** `apps/mobile/src/components/chat/message-bubble.tsx` (367 lines) draws `<EntityAvatar person={{ id: message.senderId, name: message.senderName }} size={34} className="mr-2" />` (`:296-300`). `currentUserId` is a prop (`:39`), and `outgoing = message.senderId === currentUserId` (`:70`).
- **The sender name:** `apps/mobile/src/components/chat/message-bubble-content.tsx` (364 lines) draws it as a `Text` when `showSenderName` (`:157-163`).
- **The store** has `useChatStore((state) => state.contacts)` (used at `apps/mobile/src/components/chat/empty-chat.tsx:32`); contacts have `userId`, `jid` and `handle`. `state.chats` holds the chat rows, and a DM or an AI chat's `id` is the peer's bare JID.
- **Navigation:**
  - to a DM: `router.push({ pathname: '/chat/[id]', params: { id: jid } })` (`apps/mobile/src/components/chat/new-message-sheet.tsx:74`);
  - to a person's profile: `router.push({ pathname: '/u/[handle]', params: { handle } })` (`apps/mobile/src/components/contacts/people-list-section.tsx:49`).
- **The topic sheet's person rows:** `apps/mobile/src/components/chat/topic-info-sheet.tsx` (362 lines), `people.map` at `:279-296`. Each `person` has `id` (the user id), `name` and `avatarUrl`; `myUserId` is in scope. The group `detail` (`GroupDetail`) has `members` with `handle` (`:60-71`).

### Steps
1. **New `apps/mobile/src/lib/person-link.ts`:** `personTarget(target, ctx)`.
   - `target` is `{ jid?: string; userId?: string; handle?: string | null }`.
   - `ctx` is `{ contacts, chats, currentUserId }`.
   - It returns a route object for `router.push`, or `undefined`. The order is:
     1. **yourself** → `undefined`;
     2. **a contact,** by bare JID (lowercased) or `userId` → its DM;
     3. **a chat whose `id` equals the bare JID,** which covers your own AI → that chat;
     4. **a handle** → `/u/[handle]`;
     5. **anything else** → `undefined`.
2. **New `apps/mobile/src/components/chat/person-pressable.tsx`:** `PersonPressable({ target, name, children })` reads the store and renders `children` alone when there's no route. Otherwise it renders a `Pressable` with:
   - `accessibilityRole="link"`;
   - `accessibilityLabel={`Open ${name}`}`;
   - `hitSlop={6}`;
   - `onPress={() => router.push(route)}`.
3. **Wire it in:**
   - the thread avatar (`message-bubble.tsx:296-300`), with `jid = message.senderId`;
   - the sender name in `message-bubble-content.tsx`, the same way;
   - the topic sheet person rows: the avatar plus the name, with `userId = person.id` and the handle from `detail.members`.

   The bubble's long press must still open the message actions.
4. **No tests** (UI). Every file stays at most 400 lines; each touched file grows by at most 4 lines.

### Allowed files
- `apps/mobile/src/lib/person-link.ts`
- `apps/mobile/src/components/chat/person-pressable.tsx`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `work/T-1859-phone-person-links.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In a group thread,** tapping another person's avatar or name opens their DM when they are a contact, and your own AI opens its DM. Yourself and unknown senders do nothing.
- **In the topic sheet,** a person row opens the DM or `/u/<handle>`.
- **Long press** still opens the message actions.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `apps/mobile/src/lib/person-link.ts` (63 lines): `personTarget(target, ctx)` resolves in the spec's order — myself first (user id or JID localpart), then a contact by normalized bare JID or user id (its `jid` DM), then an existing chat whose `id` is the bare JID (your own AI), then `handle` to `/u/[handle]`, else `undefined`. It returns the typed route union `/chat/[id] | /u/[handle]`.
- Added `apps/mobile/src/components/chat/person-pressable.tsx` (40 lines): `PersonPressable({ target, name, children })` reads `contacts`, `chats` and `currentUserId` from the chat store as three separate selectors (no unstable object snapshot), renders `children` alone when `personTarget` returns `undefined`, otherwise a `Pressable` with `accessibilityRole="link"`, the label `Open <name>`, `hitSlop={6}` and `onPress={() => router.push(route)}`.
- Wired it in:
  - `message-bubble.tsx` (367 -> 370, +3): the group thread avatar, `target={{ jid: message.senderId }}`.
  - `message-bubble-content.tsx` (364 -> 367, +3): the sender name, the same target.
  - `topic-info-sheet.tsx` (362 -> 366, +4): the person rows. A one-line `handles` map turns `detail.members` into `userId -> handle`; a one-line `rows` array carries that handle into the row; the row's `View` is wrapped in `PersonPressable` with `target={{ userId: id, handle }}`. Contacts open their DM, other members with a handle open `/u/<handle>`, and my own row (`id === myUserId`) stays plain (with its "(you)" marker).
- No other files touched. No tests added, as the Spec says (UI, covered by the phone smoke).

### Checks run
- `pnpm gate` (from the repo root), summary lines (timings vary run to run):
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (0.8s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (1.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
- Single test files: none. The change is UI-only, the Spec says no tests, and no test file was touched; the gate ran the mobile package tests.

### Notes for the lead
- Line growth is message-bubble +3, message-bubble-content +3, topic-info-sheet +4; the two new files are 63 and 40 lines. `topic-info-sheet.tsx` reaches the +4 budget because wrapping each row adds a nesting level, so Prettier splits the name `Text` props; I offset it by collapsing the already-short `EntityAvatar.person` object to one line (the destructured names are short enough to fit).
- `personTarget` treats myself as `userId === currentUserId` or `jidLocal(normalizeJid(jid)) === currentUserId` (the server's localpart is the user id lowercased). Outgoing messages carry `currentUserId` as `senderId`, incoming ones a bare JID, so both forms are covered.
- The sender name is a Pressable nested inside the bubble's own long-press Pressable. `PersonPressable` reads `useOpenMessageMenu()` and forwards it as `onLongPress` (with `LONG_PRESS_MS`), the same way the photo tiles and `ReplyQuote` do (`message-menu-context.tsx`), so a long press started on the name opens the message actions and a short tap opens the person. Outside a bubble (the topic sheet's rows) the hook returns `undefined` and no long-press handler is added.
- The members page and the sticker sender name are untouched, as the Spec asks (the members page is T-1858's; the Spec only names the `:157-163` sender name).

### Round (fix round for PREREVIEW T-1859)
- **Finding 1 (should-fix) fixed:** `apps/mobile/src/components/chat/person-pressable.tsx` (40 -> 49 lines) now reads `useOpenMessageMenu()` and spreads `{ onLongPress: openMenu, delayLongPress: LONG_PRESS_MS }` into its `Pressable` when a menu is in scope, matching `media-bubble.tsx:259-261` and `reply-quote.tsx:61-62`. The sender name's link no longer swallows the bubble's long press; the topic sheet rows are outside any provider, so they keep no long-press handler. No other file needed a change: the provider already wraps `MessageBubbleContent` (`message-bubble.tsx:164`), and the thread avatar sits outside the bubble `Pressable`.
- **Tests added:** none. The Spec says "No tests (UI)" and the finding names no test; the mobile package only runs pure `*.test.ts` files with vitest (there is no component renderer or `react-test-renderer` dependency), so gesture forwarding is covered by the lead's phone smoke, as the Spec intends.
- **Gate:** `pnpm gate` from the repo root ended with `GATE PASS` (install, format, lint, typecheck, effect, tests @zilar/mobile all PASS; scope clean; size within 400 lines).
- **Lead fix round (group as a person):** an unresolved group sender's occupant JID (`room@conference/nick`) no longer resolves to the group. `personTarget` now drops any `target.jid` containing `/` before matching, and the chat fallback only matches chats with `kind !== 'group'`, mirroring web T-1851. Only `apps/mobile/src/lib/person-link.ts` changed; committed as `T-1859: person links ignore occupant JIDs and group chats`. The first gate run failed only on Prettier formatting in that file; after `prettier --write` the re-run ended `GATE PASS` (install, format, lint, typecheck, effect, tests @zilar/mobile all PASS; scope clean; size within 400 lines).

## Review (written by Claude)

Merged on 2026-10-17 at HEAD `7c98fd7b7`.
- **The packet was stale:** its long-press finding is fixed in `8b1f98b05`. My fix round added the occupant-JID and group guards, as web T-1851 has.
- **The emulator check** ran on the mock build (smoke PASS), in "Dev team › Checkout button hidden on Safari":
  - tapping Dev-1's avatar opens the Dev-1 chat;
  - a long hold on the "Dev-1" sender name still opens the message menu (reactions, Reply, Forward…).
- **Next:** the phone @mention-chip twin (T-1877) builds on `PersonPressable`.

