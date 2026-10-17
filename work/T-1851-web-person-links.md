---
id: T-1851
title: "Web: clicking a person opens them — a group message's avatar and sender name, and the person rows in the topic panel and the group panel, link to the DM (a contact or your own AI) or to /u/<handle> (Add contact) for someone else; self and unknown senders stay plain"
status: merged
milestone: M5
branch: task/T-1851-web-person-links
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1851: Click a person to open them (web)

## Spec (written by Claude, do not edit)

### Why
**Julio (2026-10-17):** "find accessibility or easy life ideas … like clicking in the circles or profile pictures".
- **The lead tried it live** in "ai test › cards test". Clicking Deepseek's avatar next to its message does nothing, clicking the sender name "Deepseek" does nothing, and clicking a person row in the topic panel does nothing.
- **Telegram opens the person.** Zilar has no separate profile view yet, so this task links to what exists:
  - the DM, for a contact or the viewer's own AI;
  - the Add contact flow at `/u/<handle>`, for anyone else.

### Facts (read by the lead on 2026-10-17)
- **A group message's `senderId`** is the sender's real bare JID when known, else the occupant JID (`packages/xmpp-core/src/types.ts:74-79`, used at `packages/client-core/src/store/ledger-incoming.ts:131`).
  - **AI JIDs** have a localpart starting `ai-`, checked by `isAiJid` (`packages/protocol/src/jid.ts:35`).
  - **A user's JID localpart** is their user id lowercased (`apps/server/src/xmpp/provisioning.ts:29-35`), or a hash when the id is not a safe localpart.
- **The thread avatar** is `<EntityAvatar person={{ id: message.senderId, name: message.senderName }} size={34} />` at `apps/web/src/components/MessageBubble.tsx:209`. That file has 389 lines, so put the new logic in a new file.
- **The sender name** is drawn by `MessageSender` in `apps/web/src/components/message/MessageMeta.tsx:43-53`.
- **The existing "open a person" pattern** is `PersonRow` in `apps/web/src/components/PeopleSearchResult.tsx:76-110`:
  - a contact goes to `/c/<encodeURIComponent(contact.jid)>`;
  - a contact without a chat row first calls `storeApi.getState().refreshChats()`;
  - store contacts come from `useChatSelector((s) => s.contacts)` and have `userId`, `jid` and `handle`.
- **`/u/:handle`** is `AddContactRoute`, which opens the Add contact dialog prefilled (`apps/web/src/routes/AppRoutes.tsx:286`).
- **The store's** `currentUserId` is at `apps/web/src/store/store.ts:35`.
- **Group info:** `useChatSelector((state) => state.groupInfo(chat.id))` gives the members (`GroupMember`: `userId`, `name`, `handle`; `packages/api-contract/src/groups.ts:90-100`). `TopicPeopleLine.tsx:140` uses it for a topic chat.
- **The rows:**
  - topic panel person rows are `MemberItem` in `apps/web/src/components/panels/TopicMembersSection.tsx:87-156`, with the avatar at `:107`;
  - group panel member rows are `apps/web/src/components/group-info/MemberRow.tsx:69-80` (177 lines).

### Steps
1. **New `apps/web/src/components/personLink.ts(x)`:** `usePersonHref(target)`, where `target` is `{ jid?: string; userId?: string; handle?: string | null }`. It returns `{ to: string; onOpen: () => void } | undefined`:
   - **Yourself:** `undefined`. That is a `userId` equal to `currentUserId`, or a JID whose localpart is your user id lowercased.
   - **A contact:** found by `jid` (bare, compared lowercased) or by `userId`. Return `/c/<encoded contact.jid>`; `onOpen` refreshes chats when the row is missing (as `PersonRow` does).
   - **An existing chat:** a chat whose `id` equals the bare JID, which covers the viewer's own AI DMs. Return `/c/<encoded id>`.
   - **A known handle:** return `/u/<handle>`.
   - **Anything else:** `undefined`.

   For a message sender, find the handle in the current chat's `groupInfo` members by matching the JID localpart to `member.userId.toLowerCase()`.
2. **New `PersonLink` component** in the same file. When the hook returns a link, it renders a react-router `<Link>` with:
   - `aria-label={`Open ${name}`}` and `title={name}`;
   - a visible focus ring, matching the panel keys' ring classes;
   - `className` passed through.

   Otherwise it renders `children` as they are.
3. **The thread:**
   - wrap the avatar at `MessageBubble.tsx:209` in `PersonLink` (`jid = message.senderId`);
   - wrap the name in `MessageSender` the same way.

   The click must not trigger the bubble's selection click (`stopPropagation`).
4. **The panels:** in `MemberItem` and `MemberRow`, wrap the avatar plus the name span (not the ⋯ menu or the role controls) in `PersonLink` (`userId` and `handle`). A row for yourself stays plain.
5. **No tests** (UI). Every file stays at most 400 lines; `MessageBubble.tsx` grows by 2 lines at most.

### Allowed files
- `apps/web/src/components/personLink.tsx`
- `apps/web/src/components/MessageBubble.tsx`
- `apps/web/src/components/message/MessageMeta.tsx`
- `apps/web/src/components/panels/TopicMembersSection.tsx`
- `apps/web/src/components/group-info/MemberRow.tsx`
- `work/T-1851-web-person-links.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In a group thread,** clicking another person's avatar or name opens their DM when they are a contact, or `/u/<handle>` otherwise. Clicking your own AI opens its DM. Your own and unknown senders do nothing.
- **Topic and group panel person rows** behave the same.
- **The links are keyboard-focusable** and have an "Open <name>" label.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/web/src/components/personLink.tsx`:
  - `usePersonHref(target)` resolves, in order: yourself (userId, or JID localpart equal to the current user id) → plain; a contact by bare JID or userId → `/c/<jid>` plus the `refreshChats()` hand-off when the chat row is missing; an existing chat whose id is the bare JID (the viewer's own AI DM) → `/c/<id>`; a known handle → `/u/<handle>`; otherwise plain.
  - For a sender that only carries a JID, the handle is read from the group member whose `userId.toLowerCase()` matches the JID localpart. The hook searches the group details already loaded in the store, because its fixed `{ jid, userId, handle }` target has no chat id.
  - `PersonLink` renders a react-router `<Link>` with `aria-label="Open <name>"`, `title`, the panels' focus ring (`focus-visible:ring-2 focus-visible:ring-accent/40`), `stopPropagation()` so the bubble selection click does not fire, and the caller's `className`. Without a destination it renders the children unchanged.
- Thread (`MessageBubble.tsx`): wrapped the group avatar in `PersonLink` with the sender JID; the sender name and AI badge in `MessageSender` go through the same link. `MessageBubble.tsx` grew by 3 lines (one import plus the two wrapper lines), from 389 to 392; it stays under the 400-line limit.
- Topic panel (`TopicMembersSection.tsx`): `MemberItem` wraps the avatar and name span (owner/admin badges included) in `PersonLink` with `userId` and the group detail's handle; the ⋯ menu stays outside.
- Group panel (`MemberRow.tsx`): `MemberRow` wraps the avatar and name/role span in `PersonLink`; the ⋯ menu and its role/remove actions stay outside.
- Self rows stay plain through the userId/JID check; unknown senders stay plain when no contact, chat or member handle resolves.

### Checks run

- `pnpm install --frozen-lockfile`: done in 11.9s, no changes.
- `pnpm gate` (final):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (3.5s)
  PASS  format  (1.3s)
  PASS  lint  (2.3s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: this is UI-only and the gate reported no nearby test files for `@zilar/web`.
- Two earlier gate runs failed and were fixed: Prettier formatting in the new file, then `exactOptionalPropertyTypes` on `handle?: string | null` (now `string | null | undefined`).

### Notes for the lead

- The sender handle lookup iterates the loaded `groupInfos` rather than one named chat, because `PersonTarget` has no chat id and the thread avatar is wrapped in `MessageBubble` without new logic there. The open chat's group detail is loaded, so this resolves the same member; it could in theory also resolve a handle from another loaded group with the same JID localpart (same person, same handle).
- `MessageBubble.tsx` is 392 lines: the spec's "grows by 2 lines at most" is met for the JSX, but the file also needs one import line, so the net growth is 3.
- Not live-tested in a browser; only the gate and a read-through of the wiring were done.

### Round 2 (fix round after PREREVIEW.md)

Findings fixed:

1. **Finding 1 (should-fix)** — the chat branch in `usePersonHref` now skips group-kind chats (`row.kind !== 'group'`), so an unresolved sender's occupant JID (`room@conf/nick` → bare `room@conf`) no longer resolves to the open group itself; it stays plain unless a contact, a handle or a non-group chat matches. Commit `75a33ca7b`.
2. **Finding 2 (must-fix)** — the `PersonLink` `<Link>` now carries an inline `style={{ color: 'inherit', textDecoration: 'none' }}`, so the global `.bubble-in a, .bubble-gen a` rule in `index.css` no longer turns every group sender name white and underlined; `senderColor(...)` on the parent div shows through again. Commit `f53e0897e`.

Findings left as they are:

3. **Finding 3 (nit)** — not touched: it is in `memberHandle`, a line this round does not change, and the reviewer states the resolved handle is the same person. Same reason applies to nit 4 (the selector subscriptions) and nit 5 (the 3-line growth in `MessageBubble.tsx`).

Tests: none added. The spec says "No tests (UI)" and AGENTS.md says UI code gets no tests; a `personLink` test file is also outside the Allowed files, so the gate would flag it as out of scope. Neither finding names a test. The gate reports `SKIP tests @zilar/web (no nearby test files)`.

Checks run for this round:

- `pnpm gate` from the repo root:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (6.8s)
  PASS  format  (16.6s)
  PASS  lint  (7.9s)
  PASS  typecheck  (17.1s)
  PASS  effect  (9.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the round changed one UI file and no test exists for it.
- Final verification in a fresh session on HEAD after the report commit, `pnpm gate` again:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.2s)
  PASS  format  (0.9s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.1s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Round 3 (lead fix round)

1. **Sender name colour (must-fix).** Already in place: the `<Link>` has carried the inline `style={{ color: 'inherit', textDecoration: 'none' }}` since commit `f53e0897e` (`personLink.tsx:133`), and the focus ring classes are kept. Verified against the current file; there is no new diff, so I made no second commit for it rather than create an empty one.
2. **Occupant sender stays plain (should-fix).** `usePersonHref` now returns `undefined` up front for any `jid` containing `/` (the occupant form `room@conf/nick`) before any lookup (`personLink.tsx:38`), and the "existing chat" branch already skips `kind === 'group'` rows (`personLink.tsx:71`). Commit `c32c4b10c`.

Tests: none added; this is UI code and the spec says "No tests (UI)".

`pnpm gate` after the fix:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (0.9s)
PASS  typecheck  (2.6s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Disagreements

None.

## Review (written by Claude)

Merged on 2026-10-17 at HEAD `aa8f7d0e3`.
- **The packet was stale** (written at `2012d1599`), so I reviewed the fixed head myself. Its two findings are fixed:
  - the link keeps the sender colour with no underline (`f53e0897e`);
  - occupant JIDs and group rows never link (`75a33ca7b`, `c32c4b10c`).
- **The mock check** ran on the branch in vite at 1440 px:
  - in "Dev team › Checkout button hidden on Safari", "Dev-1" and "QA-1" keep their colours and aren't underlined;
  - clicking Dev-1's avatar opens the Dev-1 DM, which is the viewer's own AI.
- **Nits accepted:** the handle lookup scans the loaded groups, the selectors subscribe broadly, and `MessageBubble` grew by 3 lines.
- **Next:** the @mention chips in messages can use the same `PersonLink`.
