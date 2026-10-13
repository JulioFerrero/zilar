---
id: T-1323
title: "Web contact info panel like Telegram (parity with mobile T-1308): clicking a DM's header opens a right-side panel — big photo, name, status, @username (copy), bio, Message/Mute/Search actions, shared media, Block in red"
status: merged
milestone: M5
branch: task/T-1323-web-contact-panel
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1323: Web contact info panel

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: the phone changes must also be done on web. Mobile T-1308 rebuilt the contact profile Telegram-style (`apps/mobile/src/app/u/[handle].tsx` and `apps/mobile/src/components/profile/`).

On web, **a DM's header opens nothing:** `apps/web/src/components/ChatHeader.tsx:75` wires `openPanel` only for a topic, an AI or a group, and `apps/web/src/routes/ChatView.tsx:25` types the side panel as `'ai' | 'group' | 'topic'`. In Telegram Web, clicking a person's name opens "User Info" on the right, with:
- a big photo, the name and the status;
- the username, with copy;
- the bio;
- a notifications switch and shared media;
- Block.

### What to build
1. **A `'contact'` panel** in `ChatView.tsx` for a DM that isn't an AI, opened by clicking the header title or avatar (the same affordance as the group panel, `ChatHeader.tsx:183-184`), and closable like the others. Support `?panel=contact` like the existing `initialPanel` (`ChatView.tsx:27`).
2. **`apps/web/src/components/ContactPanel.tsx`** (new; split into `components/contact/` if needed), using the existing web panel styles (look at `GroupPanel.tsx` / `TopicPanel.tsx`):
   - a big centred avatar (about 96 px), the name, and the status line (the same source as the header's subtitle; cite it);
   - an action row of round icon buttons: Message (focuses the composer), Mute (the existing mute action; cite it), Search (the existing in-chat search, `startChatSearch`);
   - an info list: "@handle" with copy (the existing toast if there is one), and the bio if the profile has one (find how web reads a user's profile by handle or JID; cite the API; the server's handle profile route returns `bio`, T-1258);
   - "Shared media", which opens the existing `ChatMediaPanel` (`apps/web/src/components/ChatMediaPanel.tsx`);
   - Block / Unblock at the bottom in the destructive colour, with the existing confirm (cite the block call web uses on the Blocked page).
3. Icons only (lucide), no emoji. Every file stays at most 400 lines (`ChatView.tsx` is 300, `ChatHeader.tsx` 374, so keep header changes tiny). **No tests** (UI).

### Read first
`AGENTS.md`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/ChatMediaPanel.tsx`, `apps/web/src/routes/BlockedPage.tsx`, and `apps/mobile/src/components/profile/` (the content to match).

### Allowed files
`apps/web/src/routes/ChatView.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/ContactPanel.tsx`, `apps/web/src/components/contact/**/*.tsx`, `apps/web/src/components/contact/**/*.ts`, `apps/web/src/lib/contacts.ts`, `work/T-1323-web-contact-panel.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:** clicking Marta's header opens the panel with the photo, name, status, actions, @handle (or the bio when present), Shared media and Block.

---

## Report (written by the worker when done)

### What I did

**A `'contact'` panel for DMs (T-1323).**
- `apps/web/src/routes/ChatView.tsx`: `OpenPanel` gained `'contact'`; `initialPanel` opens it for
  `?panel=contact` when the chat is a DM that is not an AI (`chat.kind === 'dm' && !chat.isAI`).
  The header gets `onOpenContactPanel` for such a DM, and the panel renders next to the others.
- `apps/web/src/components/ChatHeader.tsx`: one new optional prop `onOpenContactPanel`, added to the
  existing `openPanel` chain (`onOpenTopicPanel ?? onOpenAiPanel ?? onOpenGroupPanel ?? onOpenContactPanel`),
  so the title/avatar button opens it exactly like the group panel (T-1249 affordance).
- `apps/web/src/components/ContactPanel.tsx` (new, 330 lines): the Telegram `User info` drawer, built
  on the existing `Sheet`:
  - big centred `Avatar` (96 px) with the name and the status; the status is `chatSubtitle(chat, new Date())`,
    the same source the header subtitle uses (`ChatHeader.tsx:51`, `@zilar/chat-core` `chat-labels.ts:25`);
    the green dot shows when `chat.online`;
  - a round action row: **Message** (closes the panel, then `focusComposer()` on the next macrotask —
    the sheet is a dialog and `focusComposer` refuses while one is open, `useComposerFocus.ts:41`);
    **Mute/Unmute** (the existing `store.setMuted(chat.id, 'forever' | null)`, the same write the header
    menu uses, `ChatActionsMenu.tsx`); **Search** (the existing `startChatSearch`);
  - the info list: `@handle` with a copy button (`copyText`, `@/lib/clipboard`) and the existing
    `useToast()` ("Username copied"); the bio when the profile carries one;
  - **Shared media**: a `ListRow` that opens the existing `ChatMediaPanel`;
  - **Block / Unblock** at the bottom: `blockUser`/`unblockUser` (`@/lib/api`, the same calls the
    Blocked page uses, `BlockedPage.tsx:4`), Block in the destructive colour behind the existing
    `ConfirmDialog`; Unblock as an outline button. Blocked state comes from `useBlockedJids()` plus a
    local override after a write.
- `apps/web/src/lib/contacts.ts` (new): `dmContactFor` matches the DM peer's contact by bare JID
  (the mobile rule, `apps/mobile/src/components/chat/chat-header.tsx:24`), and `dmHandleCandidate`
  returns the contact's `@handle`.

**Search lifted to `ChatView`.** The narrow in-chat search bar (WUX-34) was `ChatHeader` state, so the
contact panel could not start the same search. I moved `searchOpen`/`startChatSearch`/`isWide` into
`ChatView` (parent of both); `ChatView` renders `ChatSearchBar` on narrow instead of the header, and
passes `onSearch={startChatSearch}` to both the header and the panel. `ChatHeader` shrank (374 → 352
lines) and no longer imports `useMediaQuery`/`ChatSearchBar`.

### Files changed
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/components/ContactPanel.tsx` (new)
- `apps/web/src/lib/contacts.ts` (new)
- `work/T-1323-web-contact-panel.md`

### Commands and results
- `pnpm install` — done.
- `pnpm gate` (first run): `FAIL format` on `apps/web/src/components/ContactPanel.tsx` and
  `apps/web/src/lib/contacts.ts` (prettier). Fixed with `pnpm exec prettier --write` on those two files.
- `pnpm gate` (final):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.2s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.9s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Single test files run while working: **none** — UI-only, the spec says no tests, and there are no
  test files next to the changed files (the gate's nearest-tests step also found none).

### Deviations from the spec (and why)
1. **Search moved out of `ChatHeader` into `ChatView`.** Required so the panel's Search can reuse the
   exact `startChatSearch` (the spec cites it); it was `ChatHeader`-local state. Behaviour is unchanged
   (the narrow bar still replaces the header; wide still scopes the list search and dispatches
   `zilar:focus-search`).
2. **The `@handle` fallback (mock).** The contacts list is the primary source and every real user owns a
   handle (T-0163). The dev mock's `GET /contacts` returns no `handle` (`packages/mock-backend/src/domains/contacts/routes.ts:37`
   maps only `userId, name, jid`), so on the mock the panel would show no `@handle`. When the contact
   payload has no handle, `dmHandleCandidate` falls back to the DM's JID localpart and the panel shows
   that handle only if `GET /api/users/by-handle/:handle` resolves it. On the mock, `marta` resolves
   (`@marta`); on the real server the JID localpart is the (random) user id, so the lookup 404s and the
   row stays hidden — the real path always uses the contact's handle. Please flag it if you would rather
   drop the fallback.
3. **Unblock is an outline button, not red.** The spec says "Block / Unblock ... in the destructive
   colour"; red is right for Block, but Unblock is not destructive, so it matches mobile's `ProfileBlock`
   and the web `ContactProfileRow` (outline). Easy to change if you want both red.
4. **Block confirm reuses `ConfirmDialog`** (the shared web confirm), not the inline card confirm of
   `ContactProfileRow`.

### Mock quirks (not acceptance items)
- After blocking Marta in the mock, reopening the panel shows Block again: the mock's blocked list
  reports `jid: 'u-marta@zilar.test'` while the DM chat id is `marta@zilar.test`, so `useBlockedJids`
  (localparts) cannot see it. Immediately after the block the panel does show Unblock (local override).
  The real server's blocked list carries the peer's real JID, so this is mock-only.

### Security checklist
- No new routes or writes beyond the existing `setMuted`, `blockUser`/`unblockUser` and the read-only
  `lookupByHandle`; the block/unblock `where` is the existing server-side scoped one.
- No secrets or tokens logged; no bearer values in the panel.
- Fixed user-facing sentences for the mute/block failures; lucide icons only, no emoji.
- `lookupByHandle` is a read; the panel makes at most one call per open.

### Open questions
- None blocking. Deviation 2 (the mock handle fallback) is the only judgement call worth a veto.

### Round 1 (fix round, 2026-10-13)

- **Finding 1 (should-fix) fixed.** `ContactPanel` is now keyed by the chat id
  (`key={contactChat.id}`) where `ChatView` renders it, so a chat change remounts the
  panel and clears `blockedOverride`, `confirmingBlock` and the `useAction` error/pending
  state together. This is the finding's "effect or `key`" option; a `key` also resets the
  in-flight `useAction` state that a plain `setState` reset cannot reach.
  - Note: `ChatShell` already renders `ChatView` with `key={chat.id}` (`ChatShell.tsx:67`),
    so in the current wiring `ChatView` (and the panel) already remount on a chat change and
    the leak in the finding was not reachable through the normal route. The new key makes the
    reset explicit at the panel itself and keeps `ContactPanel` self-contained if that parent
    key ever goes away.
- **Nits 2–4 left as-is** per the fix-round rule (only fix nits in lines already changed):
  nit 2 (`searchOpen`) and nit 3 (`dmHandleCandidate` guard) are in lines this round does not
  touch; nit 4 (Unblock outline) is the lead's call and is already disclosed as deviation 3.
- **Tests added: none.** The spec says "No tests (UI)" and the finding names no test.
- **Gate (after the fix):**
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.7s)
  PASS  format  (1.9s)
  PASS  lint  (1.7s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (4 nits).**
- **Finding 4, the lead's ruling:** Unblock stays outline, not red, as on mobile `ProfileBlock` and in Telegram, where only Block is destructive.
- **Lead's headless check** (Playwright Chromium, web mock of this branch): "Open Marta info" in the DM header opens "Contact info" with:
  - a big avatar, "Marta" and "last seen recently";
  - round Message / Mute / Search;
  - Username @marta with copy, and Shared media;
  - a red Block at the bottom.
- **Lead's checks:** web tsc: 0 errors; `ChatHeader.tsx` is 352 lines and `ChatView.tsx` 353.
