---
id: T-1273
title: "Albums actions (web + client-core): Delete and Forward on an album act on every photo of it, and a forwarded album arrives as one album (fresh album id stamped on the copies); forward tested"
status: merged
milestone: M5
branch: task/T-1273-albums-actions-web
model: auto
effort: default
depends_on: [T-1272]
estimate: 0.4 day
---

# T-1273: Album-wide Delete and Forward

## Spec (written by Claude, do not edit)

### Why
`docs/audit/albums-plan.md` §4.2 and §4.3 (`:202-221`), with decisions 4 and 5 in §8.
- **What happens today:** the menu on an album bubble is its head message's menu (`apps/web/src/components/message/MessageMenu.tsx`, 192 lines), so Delete removes only the first photo, and Forward (`apps/web/src/routes/ChatView.tsx:131-133`, `forwardOne`) sends only that photo.
- **What exists:** the album's members are in a React context, `AlbumMembersContext` (`apps/web/src/components/message/AlbumGrid.tsx:15-33`), provided by `apps/web/src/components/MessageListRow.tsx`.
- **The forward problem:** `forwardMessages` (`packages/client-core/src/store/send/forward.ts:118-163`) sends each copy without `album`, so a forwarded album would arrive as single photos.

### What to build
1. **Web Delete:**
   - export a `useAlbumMembers()` hook from `AlbumGrid.tsx`;
   - in `MessageMenu.tsx`, when the message has `album` and the hook returns 2 or more members, the confirm dialogs say "Delete album?" and their actions loop `deleteForMe` / `deleteForEveryone` over every member id. An album is always one sender, so the own/peer rules stay the same;
   - a lone message keeps today's behaviour.
2. **Web Forward:** in `ChatView.tsx` `forwardOne`, when the message has `album`, forward every message in the chat's list with the same `album.id` and the same `senderId`, sorted by `album.index`. Otherwise forward `[message]`, as today.
3. **client-core forward keeps the album:**
   - in `forwardMessages`, per target, group the kept messages that share an `album.id` and a sender. A group of 2 or more gets one fresh album id (the same generator the web send uses: cite it, or `crypto.randomUUID()`), with `index` by position and `count` equal to the group size;
   - set `album` on the optimistic copy and pass it through `runForwardSend` into `sendMessage`;
   - a group of 1 sends without `album`.
4. **Test** (the message pipeline), 1 case in `packages/client-core/src/store/send.test.ts`: forwarding 3 same-album messages sends 3 messages that share one new album id (not the source's), with `count` 3 and indexes 0, 1 and 2.
5. **Out of scope:** reactions on a whole album, and mobile (next task). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/albums-plan.md` §4, `apps/web/src/components/message/AlbumGrid.tsx`, `apps/web/src/components/message/MessageMenu.tsx`, `apps/web/src/routes/ChatView.tsx`, `packages/client-core/src/store/send/forward.ts`, `packages/client-core/src/store/send/attachment.ts` (how T-1268 validates `album`) and `packages/client-core/src/store/send.test.ts`.

### Allowed files
`apps/web/src/components/message/AlbumGrid.tsx`, `apps/web/src/components/message/MessageMenu.tsx`, `apps/web/src/routes/ChatView.tsx`, `packages/client-core/src/store/send/forward.ts`, `packages/client-core/src/store/send/album.ts`, `packages/client-core/src/store/send.test.ts`, `work/T-1273-albums-actions-web.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/send.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's check on the web mock:**
  - send a 3-photo album, then Delete it from the bubble menu; all 3 go;
  - send another album and Forward it to a chat; it arrives there as one grid.

---

## Report (written by the worker when done)

### What I did

**1. Web Delete (`AlbumGrid.tsx`, `MessageMenu.tsx`)**
- Exported a `useAlbumMembers()` hook from `AlbumGrid.tsx`; `AlbumGrid` itself now uses it too.
- `MessageMenu.tsx` reads the members. When the message has `album` and there are 2 or more
  members, the confirm titles become "Delete album?" and both actions loop `deleteForMe` /
  `deleteForEveryone` over every member id. A lone photo, or a bubble drawn without a provider,
  keeps today's single-message behaviour. The own/peer/DM label logic is untouched (an album is
  one sender).

**2. Web Forward (`ChatView.tsx`)**
- `forwardOne` now looks up `storeApi.getState().messages(chat.id)`; when the message has an
  `album`, it forwards every message with the same `album.id` and `senderId`, sorted by
  `album.index`. Otherwise it forwards `[message]` as before.

**3. client-core forward (`send/album.ts`, `send/forward.ts`)**
- New `send/album.ts` exports `forwardedAlbumRefs(messages, id?)`: it groups messages sharing an
  `album.id` and sender; a group of 2+ gets one fresh id (`crypto.randomUUID()`, the generator the
  web composer cites at `apps/web/src/components/composer/useComposerAttachments.ts:295`), with
  `index` by position and `count` = group size; a group of 1 gets no marker.
- `forwardMessages` picks the forwardable copies once (same deleted/failed/sending + origin +
  payload/body checks as before), regroups them **per target** (fresh id per target), stamps the
  marker on the optimistic copy, and passes it through `runForwardSend` into `sendMessage` as
  `album`.

**4. Test (`send.test.ts`)**
- Added one case under `forwardMessages (core)`: 3 same-album sources forward as 3 messages that
  share one new id (not `src-album`), `count` 3, indexes 0/1/2, and the options of the second
  `sendMessage` call carry that album.

**Deviation (small):** I group the copies that actually pass the origin/payload filters rather than
the raw non-deleted list, so `count` always equals what is sent (an album is ≤10 and one invalid
member would otherwise mis-size it). Everything else follows the spec.

### Files changed
- `apps/web/src/components/message/AlbumGrid.tsx` – added `useAlbumMembers()`.
- `apps/web/src/components/message/MessageMenu.tsx` – album-wide Delete.
- `apps/web/src/routes/ChatView.tsx` – `forwardOne` gathers the album's photos.
- `packages/client-core/src/store/send/album.ts` – new `forwardedAlbumRefs` helper.
- `packages/client-core/src/store/send/forward.ts` – per-target regrouping, album on the send.
- `packages/client-core/src/store/send.test.ts` – one new test.
- `work/T-1273-albums-actions-web.md` – this report.

### Commands and results
- `pnpm install` – Done.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/send.test.ts`
  – `Test Files 1 passed (1)`, `Tests 30 passed (30)`.
- `pnpm gate` (repo root) – summary lines:
  - `gate: 7 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (1.3s)`
  - `PASS  lint  (0.8s)`
  - `PASS  typecheck  (3.6s)`
  - `PASS  effect  (0.7s)`
  - `PASS  tests @zilar/client-core  (1.1s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`

### Notes / open questions
- Web has no test files near the change, so `pnpm gate` skipped `@zilar/web` tests (as expected per
  the task; the lead's manual mock check covers the UI).
- No new dependency, no `any`/`@ts-ignore`, every touched file is well under 400 lines.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (2 optional nits).**
- **Lead's check on the web mock:**
  - sent a 3-photo album to Marta, then Forward from the bubble menu to Ana;
  - Ana's chat shows **one** grid marked "Forwarded from You" (a fresh album id stamped on the copies);
  - Delete on that album opened "Delete album?" with "Delete for me" and "Delete for everyone". "Delete for everyone" left a single "You deleted this message" and no photo.
- **Lead's checks after the rebase:** client-core 130 + 1 new = 131 passed; tsc on web and mobile: 0 errors. The largest touched file is `ChatView.tsx`, at 289 lines.
