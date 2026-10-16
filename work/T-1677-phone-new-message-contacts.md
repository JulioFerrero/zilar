---
id: T-1677
title: "Phone New message sheet lists contacts with a filter and opens the DM on tap, like web's NewMessageDialog (parity audit gap 2); with no contacts it keeps today's invite sentence; Invite a friend stays the footer"
status: merged
milestone: M5
branch: task/T-1677-phone-new-message-contacts
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1677: Contacts in the phone New message sheet

## Spec (written by Claude, do not edit)

### Why
On web, New message shows the contacts with a "Search contacts" filter, and a tap opens the DM (`apps/web/src/components/NewMessageDialog.tsx`, WUX-7). On the phone, the sheet only says "Invite a friend… or type their @username in the search bar" (`docs/audit/parity-2026-10-16.md`, gap 2).

### Facts (the lead read them on 2026-10-16)
- **Web** (`apps/web/src/components/NewMessageDialog.tsx`, 146 lines):
  - `matchesFilter(contact, needle)` (`:12-…`) does a case-insensitive prefix match on any word of the name, or on the handle;
  - it filters `s.contacts`, navigates to the contact's `jid`, keeps the invite prompt when there are no contacts, uses the placeholder and `aria-label` "Search contacts", and shows "No contacts found" when the filter matches none.
- **Phone:**
  - `apps/mobile/src/components/chat/new-message-sheet.tsx` (38 lines): `NewMessageSheet({ visible, onInvite, onClose })` is a `BottomSheet` titled "New message", with the footer `Button` "Invite a friend" and one muted sentence;
  - it's used at `apps/mobile/src/components/chat/new-chat-button.tsx:248-252`.
- **The store** has `contacts: Contact[]` (`apps/mobile/src/store/types.ts:70`), `chats` and `reloadChats`.
- **How the phone opens a contact's DM** (`apps/mobile/src/components/profile/use-profile-dm.ts:62-71`): `if (!chats.some((chat) => chat.id === dmChatId)) { reloadChats(); } router.push({ pathname: '/chat/[id]', params: { id: dmChatId } });`. For a contact, the DM id is `contact.jid`.
- **Components to reuse:**
  - `ContactRow({ person, subtitle, online, accessibilityLabel, onPress, … })` (`apps/mobile/src/components/contacts/contact-row.tsx:13-…`);
  - `SearchField` (`apps/mobile/src/components/ui/search-field.tsx`).

### Steps
1. **In `new-message-sheet.tsx`,** read `contacts`, `chats` and `reloadChats` from the store.
   - **With no contacts:** keep today's sentence.
   - **Otherwise:**
     - a `SearchField` (placeholder and `accessibilityLabel` "Search contacts");
     - then a scrollable list of `ContactRow`s filtered by web's `matchesFilter` rule (copy the small function; the subtitle is `@handle` when there is one);
     - "No contacts found" when nothing matches.
   - **A tap** closes the sheet, reloads chats when the DM isn't in `chats`, and pushes `/chat/[id]` with `contact.jid`.
   - **Keep the "Invite a friend" footer**, and reset the filter when the sheet closes.
2. **Change no other file unless the sheet needs a new prop.** If it does, update `new-chat-button.tsx`, which is in Allowed files.
3. **Keep each file within 400 lines. No tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/new-message-sheet.tsx`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `work/T-1677-phone-new-message-contacts.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **New message on the phone lists contacts.** Typing filters them, and a tap opens that DM.
- **With no contacts,** it shows today's sentence; Invite a friend still works.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/components/chat/new-message-sheet.tsx` now mirrors web's
  `NewMessageDialog` (WUX-7):
  - reads `contacts`, `chats` and `reloadChats` from the store;
  - with **no contacts** it keeps today's invite sentence unchanged;
  - otherwise it renders a `SearchField` (placeholder and `accessibilityLabel`
    "Search contacts") and a list of `ContactRow`s (subtitle `@handle` when the
    contact has one), filtered by web's `matchesFilter` rule (the function is
    copied verbatim from `NewMessageDialog.tsx:12-27` — case-insensitive prefix
    match on any name word or on the handle), with "No contacts found" when the
    filter matches none;
  - a tap closes the sheet (`close()`, below), reloads the chat list via
    `reloadChats()` when `contact.jid` is not already in `chats`, and pushes
    `/chat/[id]` with `contact.jid` — the same move as `use-profile-dm.ts:62-71`;
  - the "Invite a friend" footer is unchanged.
- The filter resets on every close path: a local `close()` wrapper (clear query
  + `onClose`) is passed to `BottomSheet`'s `onClose` and used by the contact
  tap, so the close key, a drag, the backdrop, Android back and the tap all
  clear it. (I first used a `useEffect` on `visible`, but the repo's
  `react(set-state-in-effect)` lint rule rejects setState in an effect; the
  `close()` wrapper is the lint-clean equivalent.)
- No new prop was needed, so `new-chat-button.tsx` was **not** changed (it stays
  in Allowed files untouched).
- No tests added (UI code).

### Checks run
- `pnpm install`: done, all reused, no lockfile change (`Done in 16.3s`).
- `pnpm gate` (from repo root), final run:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.5s)
  PASS  lint  (1.0s)
  PASS  typecheck  (5.4s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/mobile  (2.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Single test files run while working: none (the change is UI-only and no test
  imports `new-message-sheet`/`new-chat-button`; the gate's `tests @zilar/mobile`
  passed).

### Notes for the lead
- Acceptance: the sheet lists contacts, the field filters them and a tap opens
  the DM; with no contacts the sentence and the Invite footer are unchanged.
- `new-message-sheet.tsx` is 127 lines, under the 400-line cap.
- I could not run a phone smoke here; the acceptance above is by code review,
  not a live run.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Approved and merged.** This is parity gap 2.

- **Pre-review:** clean, 0 nits.
- **The change:**
  - with contacts, the sheet shows "Search contacts" plus `ContactRow`s filtered by web's `matchesFilter`, and "No contacts found" when nothing matches;
  - a tap closes the sheet, reloads chats if the DM isn't listed, and opens `/chat/<jid>` (the profile's pattern);
  - with no contacts, it keeps the old sentence. Every close clears the filter.
- **Still to check:** the emulator check is in the next phone QA pass.

