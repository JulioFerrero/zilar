---
id: T-1269
title: "Albums task 4 (server push): an album sends one notification — the push scan marks the album's sibling rows notified, and the payload shows '3 photos' (or the caption) instead of one push per photo"
status: merged
milestone: M5
branch: task/T-1269-albums-push
model: auto
effort: default
depends_on: [T-1267]
estimate: 0.3 day
---

# T-1269: One push per album

## Spec (written by Claude, do not edit)

### Why
This is task 4 of `docs/audit/albums-plan.md` §9 (`:417-424`). The design is §6 (`:294-316`); read it. T-1267 (merged) added the marker `<album xmlns='urn:zilar:album:0' id index count/>` (`packages/xmpp-core/src/stanza/album.ts`).
- **What happens today:** each photo is its own archived row. The push scan (`apps/server/src/push/archive-scan.ts:85-111`) returns one row per publish IQ and marks the older rows it walked past (`:100-104`).
- **The problem:** a 5-photo album can buzz up to 5 times.

### What to build
1. **`candidates.ts`** (211 lines): when the winning row's `xml` carries the album marker, read `id` and `count` defensively. Use the regex approach `candidates.ts:32` uses for retractions, or reuse the T-1267 parser if it works on a string (cite which). Return them on the resolved message.
2. **`archive-scan.ts`** (249 lines): mark every scanned row of the same album id (same sender) as notified/superseded together with the winner, so the later IQs for the siblings send nothing (`:81-110`).
3. **`payload.ts`** (132 lines):
   - `ResolvedPushMessage` (`:24-33`) gains `albumCount?: number`;
   - `previewFor` (`:106-112`) shows "{n} photos" for an album without a caption;
   - with a caption, show the caption as today;
   - when previews are off, keep the generic body.
4. **Tests** (the message pipeline), in `apps/server/src/push/candidates.test.ts`, up to 3:
   - a 3-row album yields one candidate and the 2 siblings are marked;
   - the payload body is "3 photos";
   - a malformed marker behaves like a single photo.

Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/albums-plan.md` §6, `work/T-1267-albums-wire-grouping.md`, `packages/xmpp-core/src/stanza/album.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/payload.ts` and `apps/server/src/push/candidates.test.ts`.

### Allowed files
`apps/server/src/push/candidates.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/payload.ts`, `apps/server/src/push/candidates.test.ts`, `work/T-1269-albums-push.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/candidates.test.ts src/push/delivery.test.ts src/push/api-preview.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **Live (needs Julio's phone and an album sender):** a 3-photo album buzzes once.

---

## Report (written by the worker when done)

### What I built

**`candidates.ts` — resolve the marker from the archived XML**
- New `albumInfoFromXml(xml)` reads the T-1267 marker
  `<album xmlns='urn:zilar:album:0' id index count/>` defensively with regexes,
  the way the retraction check (`:32`) and `textWithoutReplyFallback`
  (`:183-207`) read the archive XML. I did **not** reuse `parseAlbum` from
  `packages/xmpp-core/src/stanza/album.ts`: it takes an `XmppElement`, and the
  package root does not export it (`@zilar/xmpp-core` exports only `.` and
  `./testing`), so a regex is the only in-scope option — the plan's first
  recommendation. The regex enforces the same §1.4 bounds as `parseAlbum`
  (empty/oversized id, non-integer attrs, `count < 2 || count > ALBUM_MAX`,
  `index >= count`); the constants `ALBUM_ID_MAX = 64` / `ALBUM_MAX = 10`
  mirror `album.ts` (can't import a package internal).
- `resolveCandidate` parses the marker once and, when the winning row resolves
  to `ok`, sets `albumId` and `albumCount` on the resolved message.

**`archive-scan.ts` — mark the whole album with the winner**
- In the `ok` branch (`:96-120`), when the winner carries `albumId`, every
  scanned row with the same album id, the same sender (`sameSender`: same
  `owner` + `barePeer` + `nick`) and a non-empty origin id is added to `notify`
  next to the winner, so the later IQs for the siblings send nothing.

**`payload.ts` — the body**
- `ResolvedPushMessage` gains `albumId?` and `albumCount?`.
- `previewFor` now takes the message: a caption wins as today; an album with no
  caption shows `"{n} photos"`; a plain caption-less message and previews-off
  keep today's generic `"New message"`.

### Files changed
`apps/server/src/push/candidates.ts`, `apps/server/src/push/archive-scan.ts`,
`apps/server/src/push/payload.ts`, `apps/server/src/push/candidates.test.ts`,
`work/T-1269-albums-push.md`. All four code files are ≤ 400 lines
(candidates 267, archive-scan 270, payload 143, test 366).

### Tests (3, in `candidates.test.ts`)
- "marks a 3-photo album once: one candidate, both siblings notified" — a stub
  archive returns three same-album DM rows; `newestMessageForUserEffect` yields
  one candidate with `albumCount: 3` and `notify` holds all three origin ids.
- "shows the photo count as the album body" — `buildPushPayload` with
  `albumCount: 3`, no text, previews on → `body === '3 photos'`.
- "treats a malformed album marker as a single photo" — `count="1"` (breaks the
  §1.4 bound) → `resolveCandidate` has no `albumCount` and the body stays
  `'New message'`.

### Commands (real results)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts` → **10 passed** (1 file).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/delivery.test.ts src/push/api-preview.test.ts` → **13 passed** (2 files).
- `pnpm gate` → **GATE PASS**:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.5s)
  PASS  typecheck  (2.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (11.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (One earlier gate run failed on `typecheck` only: my first test stub typed the
  archive rows as `ArchiveCandidate[]`, which is not assignable to the pool's
  `ArchiveRow[]`. Fixed by typing the rows as `ArchiveRow & { text }`.)

### Deviations / notes
- `ResolvedPushMessage` also gained `albumId?: string`. The spec's item 3 names
  only `albumCount`, but the scan needs the id to find the sibling rows (item 1
  says to read `id` and `count` and return them on the message). `albumCount`
  alone is not enough once two albums can be in flight.
- `previewFor`'s signature changed from `(text: string)` to
  `(message: ResolvedPushMessage)`; it is private to `payload.ts`.
- Handling the marker for a groupchat room row uses the row's `owner` (room) and
  `nick` (sender); for a DM it uses `owner` and `barePeer`.

### Open question (residual race, not a blocker)
The fix marks the album rows **present in the scanned page**. If an album's
siblings have not yet landed in MAM when the first IQ is scanned, the scan
returns before the retry loop and cannot see them, so a later sibling IQ could
still notify. The spec scopes the fix to "every scanned row", so I implemented
exactly that and did not add album-id tracking to `recentlyNotified`. If the
live check shows more than one buzz for a slow-landing album, the follow-up is
to also remember the album id (e.g. `album:<id>:<sender>`) in the per-node seen
set and skip rows whose marker matches it.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (2 follow-ups).**
- **The change:** `candidates.ts` reads the album marker from the winning row; `archive-scan.ts` marks the same-album sibling rows in the scanned page as notified; and `payload.ts` carries `albumCount`, with "N photos" for a caption-less album.
- **Lead's checks:** push `candidates`, `delivery`, `api-preview` and `group-notifier` tests: 26 passed; server tsc: 0 errors.
- **Follow-ups (next task):**
  - F1: the group poller (`group-notifier.ts:148-152`) still delivers per row, so an album in a group buzzes N times, each reading "N photos";
  - F2: a sibling whose MAM row lands after the first scan can still notify. Remember the album id briefly to close it.
