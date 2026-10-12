---
id: T-1272
title: "Albums task 5: an album counts as 1 unread — the server chat-list count (chats/unread.ts) counts one album once, the live client increment (client-core incoming.ts) skips a sibling of an already-counted album, and the server preview reads 'N photos'; tested"
status: merged
milestone: M5
branch: task/T-1272-albums-unread
model: auto
effort: default
depends_on: [T-1271]
estimate: 0.3 day
---

# T-1272: An album is one unread

## Spec (written by Claude, do not edit)

### Why
This is task 5 of `docs/audit/albums-plan.md` §9 (`:426-433`), plus decision 6 in §8: an album counts as 1 unread, and the preview reads "N photos". Today each photo of an album counts once, in two places:
- **Server, the chat-list count** (`apps/server/src/chats/unread.ts:296-331`): the loop counts each non-own row once per `kind + barePeer + nick + originId` key.
- **Client, live:** `packages/client-core/src/store/incoming.ts:173` adds 1 per incoming message (`unread: isRead ? 0 : chat.unread + 1`).
- **The marker:** T-1267's `<album xmlns='urn:zilar:album:0' id index count/>`.
  - On the server, `albumInfoFromXml(xml)` is exported from `apps/server/src/push/candidates.ts:231`;
  - on the client, `UiMessage.album` carries `{ id, index, count }`.

### What to build
1. **Server, `unread.ts`:**
   - when a row carries a valid album marker (`albumInfoFromXml(row.xml)`), use `album:<id>` in place of the origin id in the count key (sender fields kept), so all rows of one album count once;
   - move `albumInfoFromXml` (and its constants and type) out of `push/candidates.ts` into a new `apps/server/src/xmpp/album-xml.ts`, and import it from both places. This avoids `chats/` importing from `push/`;
   - the preview label (`labelForRow`, `unread.ts:59-75`) shows "{count} photos" for an album row, otherwise as today.
2. **Client, `incoming.ts`:**
   - don't add 1 when the incoming message has `album` and the chat's message list already holds another message with the same `album.id` from the same sender (it was counted when the first photo arrived);
   - keep every other case as today.
3. **Tests** (the message pipeline), up to 3:
   - a new `apps/server/src/chats/unread.test.ts`: three same-album rows plus one plain row from the peer give `unread: 2`, and the preview reads "3 photos" when the album is newest. If testing `unreadForChats` needs too much setup, test an extracted pure counting function instead, and say so;
   - `packages/client-core/src/store/incoming.test.ts`: three same-album incoming messages in an inactive chat make `unread` 1.
4. Keep every file at most 400 lines (`unread.ts` is 358).

### Read first
`AGENTS.md`, `docs/audit/albums-plan.md` §2 and §8, `apps/server/src/chats/unread.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/archive-scan.ts`, `packages/client-core/src/store/incoming.ts` and `packages/client-core/src/store/incoming.test.ts`.

### Allowed files
`apps/server/src/chats/unread.ts`, `apps/server/src/chats/unread.test.ts`, `apps/server/src/xmpp/album-xml.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/candidates.test.ts`, `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/incoming.test.ts`, `work/T-1272-albums-unread.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats src/push/candidates.test.ts --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store/incoming.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.

---

## Report (written by the worker when done)

**What I did**

- Server: moved `albumInfoFromXml` (with `ALBUM_MARKER`, `ALBUM_ID_MAX`, `ALBUM_MAX`, `AlbumInfo` and `numericAttribute`) from `push/candidates.ts` into new `xmpp/album-xml.ts`; `push/candidates.ts` and `push/archive-scan.ts` now import it from there, so `chats/` no longer imports `push/`.
- `chats/unread.ts`: `labelForRow` returns `"{count} photos"` for a row with a valid album marker (matching the client's `previewBody`, which puts the album ahead of the text); the count key uses `album:<id>` in place of the origin id when the row carries a valid marker, so all photos of one album count once (sender fields unchanged). Extracted the per-chat counting loop into an exported pure `summarizeUnread(rows, chats, allowed, ownLocalpart, ownJid, domain)`.
- `client-core/store/incoming.ts`: an incoming message whose `album.id` matches a message already in the chat list from the same sender no longer bumps `unread` (the first photo already did); every other case is unchanged (`isRead` still resets to 0).

**Files changed**

- `apps/server/src/xmpp/album-xml.ts` (new)
- `apps/server/src/chats/unread.ts`
- `apps/server/src/chats/unread.test.ts` (new)
- `apps/server/src/push/candidates.ts`
- `apps/server/src/push/archive-scan.ts`
- `packages/client-core/src/store/incoming.ts`
- `packages/client-core/src/store/incoming.test.ts`
- `work/T-1272-albums-unread.md`

**Commands and results**

- `pnpm install`: done (10.8s).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts`: 1 file passed, 24 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats src/push/candidates.test.ts`: 5 files passed, 30 tests passed.
- `pnpm gate` (from the repo root):

  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.3s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/client-core  (1.1s)
  PASS  tests @zilar/server  (18.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

**Deviations / notes**

- The server test exercises the extracted pure `summarizeUnread` rather than `unreadForChats` end to end, as the spec allows: `unreadForChats` needs a seeded database plus an archive pool. `chats/unread.test.ts` covers the same counting key and preview label (album run of three + one plain row -> `unread: 2`, preview `"3 photos"` when the album is newest).
- All modified files stay well under 400 lines.

**Open questions**

- None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 cosmetic nit on the preview emoji).**
- **The change:**
  - `albumInfoFromXml` moved to `apps/server/src/xmpp/album-xml.ts`, imported by push and chats;
  - the server unread key uses `album:<id>` for album rows, and the preview reads "N photos";
  - client-core's live increment skips a sibling of an album already in the chat.
  - Tests: a new `chats/unread.test.ts` and 1 case in `incoming.test.ts`.
- **Lead's checks after the rebase:** server `chats` + `push` 84 passed, client-core 130 passed; tsc on server, web and mobile: 0 errors. `unread.ts` is 381 lines.
