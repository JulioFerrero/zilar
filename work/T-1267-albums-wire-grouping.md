---
id: T-1267
title: "Albums task 1: the <album xmlns='urn:zilar:album:0' id index count/> marker in xmpp-core (build + defensive parse) and chat-core grouping of consecutive same-album messages into one render item, plus the 'N photos' preview; tested; no UI yet"
status: merged
milestone: M5
branch: task/T-1267-albums-wire-grouping
model: auto
effort: default
depends_on: [T-1266]
estimate: 0.4 day
---

# T-1267: Album marker and grouping

## Spec (written by Claude, do not edit)

### Why
This is task 1 of `docs/audit/albums-plan.md` §9 (`:362-380`). The design is in §1.2, §1.4 and §2 (`:43-154`); read them. The lead starts on the plan's recommended defaults (cap 10, Option A). The UI comes in the later tasks.

### What to build
1. **xmpp-core:**
   - `ALBUM_NAMESPACE = 'urn:zilar:album:0'` in `packages/xmpp-core/src/namespaces.ts`;
   - a new `packages/xmpp-core/src/stanza/album.ts` with the marker builder, its parser and the constants (`ALBUM_MAX = 10`, an id length cap of 64);
   - `SendMessageOptions` (`packages/xmpp-core/src/types.ts:212-222`) gains `album?: { id: string; index: number; count: number }`;
   - `buildMessage` (`packages/xmpp-core/src/stanza/build-outgoing.ts:84-136`, 380 lines) appends the marker via `album.ts`, one line plus the import, so the file stays at most 400;
   - `decodeMessageStanza` (`packages/xmpp-core/src/stanza/decode.ts`) reads it into `ChatMessage.album?: MessageAlbum` (`types.ts:46-101`);
   - **the invariants of §1.4:** a non-empty id of at most 64 characters, `2 ≤ count ≤ 10` and `0 ≤ index < count`. Anything else drops the marker, and the message stays a single photo.
2. **chat-core:**
   - `UiMessage` carries `album`, mapped wherever `ChatMessage` becomes `UiMessage` (find and cite);
   - add a render item `{ kind: 'album'; messages: UiMessage[]; count: number; … }` to `packages/chat-core/src/types.ts:209-222`, with the same first/last-in-group fields as `MessageItem`;
   - `groupMessages` (`packages/chat-core/src/messages.ts:35-75`) merges consecutive messages with the same `album.id`, the same sender, the same day and inside `GROUP_WINDOW_MS` into one album item, sorted by `index`. Missing siblings are fine: render what's loaded;
   - `previewBody` (`messages.ts:94-117`) shows "{count} photos", with the same icon prefix the photo preview uses today, when the last message has an album.
3. **Don't touch the apps yet.** The web and mobile lists must keep compiling: where they switch on render item kinds (web `apps/web/src/components/MessageList.tsx:338-383`, mobile `apps/mobile/src/components/chat/message-list.tsx:165-188`), check whether the new kind breaks an exhaustive switch or type. If it does, make the album item temporarily render its first message's normal bubble with the **smallest** possible change in those files, and say so in the Report. `MessageList.tsx` is exactly 400 lines, so the change must not grow it: extract code if needed.
4. **Tests** (the message pipeline), up to 5:
   - `packages/xmpp-core/src/stanza.test.ts`: the build/parse round trip, and an out-of-bounds marker is dropped;
   - `packages/chat-core/src/messages.test.ts`: three same-album messages make one item in index order; a different sender or a gap ends the album; one sibling missing still groups the rest.

### Read first
`AGENTS.md`, `docs/audit/albums-plan.md` (§1, §2, §9), `packages/xmpp-core/src/namespaces.ts`, `packages/xmpp-core/src/stanza/build-outgoing.ts`, `packages/xmpp-core/src/stanza/decode.ts`, `packages/xmpp-core/src/stanza/parse-fields.ts`, `packages/xmpp-core/src/types.ts`, `packages/chat-core/src/messages.ts` and `packages/chat-core/src/types.ts`.

### Allowed files
`packages/xmpp-core/src/namespaces.ts`, `packages/xmpp-core/src/stanza/album.ts`, `packages/xmpp-core/src/stanza.ts`, `packages/xmpp-core/src/index.ts`, `packages/xmpp-core/src/stanza/build-outgoing.ts`, `packages/xmpp-core/src/stanza/decode.ts`, `packages/xmpp-core/src/stanza/parse-context.ts`, `packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/stanza.test.ts`, `packages/chat-core/src/types.ts`, `packages/chat-core/src/messages.ts`, `packages/chat-core/src/messages.test.ts`, `packages/chat-core/src/index.ts`, `packages/client-core/src/store/**/*.ts`, `apps/web/src/components/MessageList.tsx`, `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/message-list-row.tsx`, `work/T-1267-albums-wire-grouping.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run src/stanza.test.ts --reporter=dot
pnpm --filter @zilar/chat-core exec vitest run src/messages.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every file stays at most 400 lines.
- Both apps still show single photos exactly as today.

---

## Report (written by the worker when done)

### What I built

**xmpp-core (the wire marker)**
- `namespaces.ts`: added `ALBUM_NAMESPACE = 'urn:zilar:album:0'`.
- new `stanza/album.ts`: `ALBUM_MAX = 10`, `ALBUM_ID_MAX = 64`, `albumElement()`
  (the `<album xmlns id index count/>` builder) and `parseAlbum()` (defensive
  parser). The parser drops anything outside §1.4: empty/oversized id,
  non-integer attrs, `count < 2 || count > ALBUM_MAX`, or `index >= count`.
- `types.ts`: new `MessageAlbum { id; index; count }`; `ChatMessage.album?` and
  `SendMessageOptions.album?`.
- `stanza/build-outgoing.ts`: `buildMessage` takes `album?` and appends the
  marker via `albumElement` (one line + the import; file 380 → 384).
- `stanza/decode.ts`: reads the marker with `parseAlbum` into `message.album`.
- `stanza.ts` / `index.ts`: export the new helpers and `MessageAlbum`.

**chat-core (grouping + preview)**
- `types.ts`: `AlbumRef`; `UiMessage.album?`; new `AlbumItem`
  `{ kind: 'album'; message; messages; count; firstInGroup; lastInGroup }`
  added to `RenderItem`.
- `messages.ts`: `groupMessages` merges a consecutive run of same-`album.id`
  messages (same sender/day and inside `GROUP_WINDOW_MS`) into one `album`
  item, members sorted by `album.index`; a lone marker (siblings not loaded) is
  an album of one, and a different sender or a gap ends the run. `previewBody`
  returns `` `🖼 ${count} photos` `` when the last message carries an album.
- `client-core/src/store/ledger-incoming.ts`: `toUiMessage` maps
  `ChatMessage.album` onto the stored `UiMessage` (the single
  `ChatMessage → UiMessage` mapping, shared by both apps via
  `createMessageLedger`; cited `/client-core/src/store/ledger.ts:94`).

**Apps** — both keep compiling, and both show an album as its first photo's
normal single bubble for now (grid is Task 2/3).
- Web `MessageList.tsx`: **no change needed**. `AlbumItem` carries `message`
  (its first photo by index) plus the same first/last fields, so the existing
  `item.kind === 'separator' ? … : <MessageBubble message={item.message}/>`
  ternary still type-checks and renders the first bubble.
- Mobile: widened `ListEntry`'s message variant from `MessageItem` to
  `MessageItem | AlbumItem` (`message-list-row.tsx`, +2 lines). `message-list.tsx`
  needed no change.

### Files changed
`packages/xmpp-core/src/namespaces.ts`, `packages/xmpp-core/src/stanza/album.ts`
(new), `packages/xmpp-core/src/stanza.ts`, `packages/xmpp-core/src/index.ts`,
`packages/xmpp-core/src/stanza/build-outgoing.ts`,
`packages/xmpp-core/src/stanza/decode.ts`, `packages/xmpp-core/src/types.ts`,
`packages/xmpp-core/src/stanza.test.ts`, `packages/chat-core/src/types.ts`,
`packages/chat-core/src/messages.ts`, `packages/chat-core/src/messages.test.ts`,
`packages/client-core/src/store/ledger-incoming.ts`,
`apps/mobile/src/components/chat/message-list-row.tsx`.

### Commands (real results)
- `pnpm --filter @zilar/xmpp-core exec vitest run src/stanza.test.ts --reporter=dot --maxWorkers=2` → **86 passed** (1 file).
- `pnpm --filter @zilar/chat-core exec vitest run src/messages.test.ts --reporter=dot --maxWorkers=2` → **21 passed** (1 file).
- Tests added: xmpp-core round trip + out-of-bounds marker dropped; chat-core
  three same-album → one item in index order (and the `🖼 3 photos` preview),
  different sender/gap ends the album, missing sibling still groups the rest.
- `pnpm gate` → **GATE PASS**:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.0s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/chat-core  (0.7s)
  PASS  tests @zilar/client-core  (3.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  PASS  tests @zilar/xmpp-core  (0.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (One earlier gate run failed on `prettier --check` for `messages.test.ts` only;
  I ran `prettier --write` on that one file and it passed.)

### Deviations / notes
- `AlbumItem.message` is an extra field beyond the spec's `{ kind, messages,
  count, … }`. I added it so the album item can render its first bubble with the
  smallest possible app change (web: none; mobile: one type widen). It is the
  album head by `index`, not by arrival time.
- `packages/xmpp-core/src/types.ts` was already **401 lines** before this task
  and reached 412 with the album fields. Round 2 extracted the message-field
  types, so it is back to **384** (≤400). Every other touched file is ≤400
  (`build-outgoing.ts` 384, `MessageList.tsx` 400).

### Open questions
- **Album sends do not reach the wire yet.** `SendMessageOptions.album` and
  `buildMessage({ album })` exist and are tested, but
  `packages/xmpp-core/src/core-effect/operations.ts:193-202` (the only caller of
  `buildMessage` from `sendMessage`) does not forward `opts.album`, so a caller
  passing `{ album }` today gets a marker-less stanza. That file is not in this
  task's Allowed files, and neither the plan's Task 2 (web send) nor Task 3
  (mobile send) lists it either. I left it untouched to stay in scope; please
  either add it to Task 1/2/3's Allowed files or confirm where the one-line
  `album: opts.album` should land.
- Per the plan (§2, §7.6) and this task's silence, I did **not** collapse an
  album to one unread count in `client-core`; that stays with Task 5.

### Round 2 (fix round)
- **Finding 1 (must-fix, `unreadDividerIndex`)**: album items now contribute one
  message position per member and a string anchor also matches `messages[].id`,
  so a fully unread album still draws the divider and an anchor naming a photo
  inside an album resolves instead of returning `null`. Tests added in
  `messages.test.ts`: "counts album members so a fully unread album still shows
  the divider" (unread=3, one 3-photo album → item 1) and "matches an anchor id
  on a photo inside an album" (anchor `'a2'`, album then message → item 2).
  `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot
  src/messages.test.ts` → **23 passed**.
- **Finding 2 (should-fix, `types.ts` line cap)**: extracted the message-field
  types so every touched file is ≤400. `MessageAlbum` moved to
  `stanza/album.ts`; `MessageCorrection`, `MessageRetraction`,
  `MessageReactions`, `Mention` and `MentionInput` moved to
  `stanza/parse-context.ts` (new "Message field shapes" section). `types.ts`
  re-exports them, so every existing importer is unchanged and there is no
  behaviour change. Line counts: `types.ts` 412 → **384**, `album.ts` 55,
  `parse-context.ts` 138. `pnpm --filter @zilar/xmpp-core test --maxWorkers=2
  --reporter=dot src/stanza.test.ts` → **86 passed**.
- **Finding 3 (nit)**: not touched; the file it names
  (`message-list-row.tsx`) is not on a line this round changes.
- **Gate**: `pnpm gate` → **GATE PASS** (15 changed files): install, format,
  lint, typecheck, effect, tests chat-core/client-core/xmpp-core pass, mobile
  skipped (no nearby tests), scope and migration clean.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round (3 nits, 2 follow-ups).**
- **Round 1 fixed:**
  - the unread divider now counts album members (must-fix);
  - `xmpp-core/types.ts` went from 412 to 384 lines, with the message field types moved to `stanza/parse-context.ts`.
- **The change:**
  - `urn:zilar:album:0`;
  - `stanza/album.ts`, a builder plus a defensive parser enforcing the §1.4 bounds;
  - `SendMessageOptions.album`, `ChatMessage.album` and `UiMessage.album`;
  - chat-core's `{ kind: 'album' }` render item and the grouping rule (same id, same sender, same day, inside the window, index order, missing siblings tolerated);
  - the "N photos" preview;
  - the mobile row change is minimal, and web's `MessageList.tsx` is untouched.
- **Lead's checks:**
  - xmpp-core `stanza` 86 passed, chat-core `messages` 23 passed, client-core all 128 passed;
  - tsc on server, web and mobile: 0 errors.
- **Follow-ups for the next album tasks:**
  - F1: the send path doesn't set `album` yet (task 3 mobile / task 2 web);
  - F2: the outgoing builder doesn't re-check the bounds (nit; the send tasks validate before sending).
