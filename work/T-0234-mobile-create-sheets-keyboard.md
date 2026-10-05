---
id: T-0234
title: "Mobile: New group / New channel sheets move above the keyboard; the mock store can create groups and channels and has contacts"
status: planned
milestone: M5
branch: task/T-0234-mobile-create-sheets-keyboard
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0228, T-0233]
estimate: 0.3 day
---

# T-0234: Create sheets and the keyboard, mock create

## Spec (written by Claude, do not edit)

### Why
Emulator QA run 3 of T-0228 (mock build, 2026-10-05; screenshots seen by the lead):
1. With the keyboard open, the Handle field is half hidden and the Create button fully hidden behind it.
2. The first tap outside the focused field only closes the keyboard (seen three times).
3. In mock mode, creating fails with "Could not create the channel. Try again." because the mock store throws on purpose. The group flow could not be tested at all: the mock store has no contacts.

### Verified facts (do not re-derive)
- `apps/mobile/src/components/chat/new-chat-button.tsx`, the action `Modal` (lines 195-245): a full-screen `Pressable` (`accessibilityLabel="Close dialog"`, `className="flex-1 items-center justify-center bg-black/40 p-4"`, line 201-205) wraps `NewChannelSheet`, `NewGroupSheet`, `NewMessageSheet`, `InviteSheet` and `JoinLinkForm`. No `KeyboardAvoidingView` and no `ScrollView` with `keyboardShouldPersistTaps` around them. (T-0233 edits only the FAB offset in this file; check the lines after it merges.)
- Mock store `apps/mobile/src/store/chat-store.ts`:
  - `createChannel` (lines 686-693) and `createGroup` (lines 694-701) throw `'... is not available in the mock store'`;
  - the initial state has `contacts: []` (line 164).
- `Contact { userId, name, jid, avatarUrl? }` (`apps/mobile/src/lib/chat-api.ts` lines 13-18). Mock data lives in `apps/mobile/src/mock/` (e.g. `chats.ts`).
- The pattern used in T-0230 for a sheet in a Modal: `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` plus `keyboardShouldPersistTaps="handled"` on the scroll view (`apps/mobile/src/components/ais/tool-detail-sheet.tsx`).

### What to build
1. In the action `Modal`: wrap the content in `KeyboardAvoidingView` (behavior as above, `className="flex-1"`). Inside it, replace the centered `Pressable` layout with a `ScrollView` (`keyboardShouldPersistTaps="handled"`, `contentContainerStyle` centering the sheet with the same padding, `flexGrow: 1`). Keep a full-size backdrop `Pressable` behind the sheet so a tap outside still closes the dialog (same label `Close dialog`). The visual look stays the same when the keyboard is closed.
2. Mock store:
   - `createChannel` and `createGroup` add a new chat to `chats` (title, `kind: 'group'`, `chatKind: 'channel'` for channels, `visibility`/`handle` when public, `unread: 0`, a new id like `mock-group-<n>`) and return its id, like the real store does.
   - `createGroup` rejects with the same error the real store gives when a public handle is `taken` in the mock directory, if the mock directory exposes that; otherwise no handle check.
3. Mock contacts: add three mock contacts (e.g. Ana, Marco, Lena) in a new `apps/mobile/src/mock/contacts.ts`, loaded into `contacts` in the mock store's initial state.
4. Tests:
   - `apps/mobile/src/store/chat-store.test.ts` (or the existing mock store test file): create channel and create group add a chat and return its id; contacts are not empty.
   - A render test for the Modal content if practical (`apps/mobile/src/components/chat/new-chat-button.test.tsx`, only if that file exists; otherwise skip and say so).

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/store/chat-store.ts` (lines 150-200 and 680-710), `apps/mobile/src/store/real-store.ts` (`createChannel`, `createGroup`), `apps/mobile/src/mock/chats.ts`, `apps/mobile/src/components/ais/tool-detail-sheet.tsx` (its `KeyboardAvoidingView`).

### Allowed files
`apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/chat/new-chat-button.test.tsx`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/store/chat-store.test.ts`, `apps/mobile/src/mock/contacts.ts` (new), `work/T-0234-mobile-create-sheets-keyboard.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot chat-store new-chat-button
pnpm gate
```

### Acceptance
- The sheets stay usable with the keyboard open (field and Create visible, the first tap acts); in mock mode a group or channel can be created and appears in the list; the group flow has contacts to pick.
- No server or web change; no change to the real store; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. The lead checks it on the emulator.

### Out of scope
The chat-list count drop after opening a mock chat (QA noted it; separate).

---

## Report (written by the worker when done)

## Review (written by Claude)
