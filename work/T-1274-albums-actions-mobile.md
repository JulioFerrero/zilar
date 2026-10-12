---
id: T-1274
title: "Albums actions (mobile): long-press Delete and Forward on an album act on every photo of it — 'Delete album?' confirm loops the delete over the members, Forward sends the whole album (client-core already keeps it one album)"
status: merged
milestone: M5
branch: task/T-1274-albums-actions-mobile
model: auto
effort: default
depends_on: [T-1273]
estimate: 0.2 day
---

# T-1274: Album-wide Delete and Forward on mobile

## Spec (written by Claude, do not edit)

### Why
This is the mobile half of T-1273 (merged; read `work/T-1273-albums-actions-web.md`).
- **What happens today:** the long-press menu on an album bubble acts only on the head photo.
  - Delete: `onConfirmDelete` → `onDelete?.(message)` and `deleteForMe(message.chatId, message.id)` in `apps/mobile/src/components/chat/message-bubble-actions.tsx:158-167`; `onDelete` is `deleteForEveryone(chat.id, message.id)` in `apps/mobile/src/components/chat/chat-thread.tsx:111`;
  - Forward: `screen.setForwarding([message])` in `apps/mobile/src/components/chat/chat-thread.tsx:112`.
- **What exists:**
  - the bubble, and so its actions, render inside `AlbumMembersProvider` (`apps/mobile/src/components/chat/message-list-row.tsx:88-91`); `useAlbumMembers()` is exported from `apps/mobile/src/components/chat/album-members.tsx:26`;
  - since T-1273, client-core's `forwardMessages` stamps a fresh album on same-album copies.

### What to build
1. **Delete:**
   - in `message-bubble-actions.tsx`, when the message has `album` and `useAlbumMembers()` returns 2 or more, both confirm actions loop over every member: `onDelete?.(member)` and `deleteForMe(member.chatId, member.id)`;
   - the confirm title in `apps/mobile/src/components/chat/message-actions-sheet.tsx:215` reads "Delete album?" in that case (a new optional prop);
   - a lone message keeps today's behaviour.
2. **Forward:** in `chat-thread.tsx:112`, when the message has `album`, forward every message in the chat's list with the same `album.id` and `senderId`, sorted by `album.index` (the same rule as web `apps/web/src/routes/ChatView.tsx` `forwardOne`). Otherwise forward `[message]`.
3. **No tests** (UI). Keep every file at most 400 lines; `message-bubble.tsx` (391) stays untouched.

### Read first
`AGENTS.md`, `work/T-1273-albums-actions-web.md`, `apps/web/src/routes/ChatView.tsx`, `apps/mobile/src/components/chat/message-bubble-actions.tsx`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/chat-thread.tsx` and `apps/mobile/src/components/chat/album-members.tsx`.

### Allowed files
`apps/mobile/src/components/chat/message-bubble-actions.tsx`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/chat-thread.tsx`, `apps/mobile/src/components/chat/album-members.tsx`, `work/T-1274-albums-actions-mobile.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:** send a 3-photo album; long-press, Forward it to Ana, and it arrives as one grid; long-press, Delete it, the dialog says "Delete album?", and all 3 photos go.

---

## Report (written by the worker when done)

### What I did

**1. Delete (`message-bubble-actions.tsx`, `message-actions-sheet.tsx`)**
- `BubbleActionsSheet` now reads `useAlbumMembers()`. When the message has `album` and the
  provider hands it 2+ members, it builds `deleteTargets` from those members (else `[message]`).
  Both confirm actions loop over the targets: `onConfirmDelete` calls `onDelete?.(member)` for
  each, `onConfirmDeleteForMe` calls `deleteForMe(member.chatId, member.id)` for each. A lone
  photo, or a bubble drawn without a provider, keeps today's single-message behaviour.
- `MessageActionsSheet` gained an optional `deleteTitle?: string` prop. When set, the confirm
  title of the branch actually shown reads it (else the old defaults). The parent passes
  `deleteTitle="Delete album?"` only for a multi-photo album, so line 215 (the DM own-message
  sheet) reads "Delete album?" as the spec asks.

**2. Forward (`chat-thread.tsx`)**
- The inline `onForward` became a `forward(message)` handler. With no `album` it forwards
  `[message]`; with an `album` it forwards every message in `storeApi.getState().messages(chat.id)`
  that shares `album.id` and `senderId`, sorted by `album.index` — the same rule as web's
  `forwardOne` (`apps/web/src/routes/ChatView.tsx:131-150`). client-core already stamps a fresh
  album on the copies (T-1273), so the target gets one grid.

**Deviation (small, intentional):** the spec pins the new title to `message-actions-sheet.tsx:215`
(the DM own-message confirm). I pass the same `deleteTitle` to all three confirm dialogs the sheet
can show (own DM, peer DM at line 245, group at line 258), because a group album's confirm would
otherwise still say "Delete for everyone?". This mirrors web T-1273's `deleteTitle`, which is used
by all three of its confirms. Non-album behaviour is unchanged in every branch.

### Files changed
- `apps/mobile/src/components/chat/message-actions-sheet.tsx` – optional `deleteTitle` prop used by
  the three confirms.
- `apps/mobile/src/components/chat/message-bubble-actions.tsx` – album-wide Delete.
- `apps/mobile/src/components/chat/chat-thread.tsx` – album-wide Forward.
- `work/T-1274-albums-actions-mobile.md` – this report.
- `album-members.tsx` was in the Allowed list but needed no change: `useAlbumMembers()` already
  returns the grouped members the bubble needs.

### Commands and results
- `pnpm install` – Done (`turbo 2.11.4`, `typescript 7.0.2`; "Done in 9.8s").
- No single test file: the change is UI-only and there are no test files under
  `apps/mobile/src/components/chat/` (`glob` found none), per the spec's "No tests".
- `pnpm gate` (repo root) – summary lines:
  - `gate: 4 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.2s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (3.1s)`
  - `PASS  effect  (0.7s)`
  - `SKIP tests @zilar/mobile (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`

### Notes / open questions
- No new dependency, no `any`/`@ts-ignore`; `message-bubble.tsx` (391) untouched; every touched file
  is well under 400 lines.
- Forward follows the spec's web rule (filter the chat list by `album.id` + `senderId`). Note that
  `album-members.tsx` warns a store-derived lookup can merge a "far sibling the grouping kept
  apart"; the spec explicitly asks for this rule and the `senderId` guard avoids the peer-id
  collision, so I did not deviate.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit).**
- **Lead's check on the emulator (mock build of this branch):**
  - sent a 3-photo album to Marta, long-pressed it and picked Forward, then Ana and Send;
  - the chat list shows Ana with "🖼 3 photos", and Ana's chat shows one grid marked "Forwarded from You";
  - long-press, then Delete, showed "Delete album?" with "Delete for me" and "Delete for everyone". "Delete for everyone" left a single "You deleted this message".
- **Seen once, not caused by this task:** a long-press on a grid tile in Ana's chat opened the viewer instead of the menu, while the same gesture on Marta's album opened the menu. It may be emulator timing; a follow-up checks the tile's long-press handling.
- **Lead's checks after the rebase:** mobile tsc: 0 errors.
