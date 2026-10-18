---
id: T-2003
title: "Message pipeline privacy: a message deleted for everyone (or corrected) stays deleted (or corrected) in every server read — search on any page, the account export and the push preview — and only the original sender's retraction or correction counts there and in the topic preview — with tests"
status: merged
milestone: M5
branch: task/T-2003-retractions-server-reads
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2003: Retractions hold in every server read

## Spec (written by Claude, do not edit)

### Why
The lead's private security review of 2026-10-18 (T-1987) found that ejabberd keeps a message's original archive row next to its retraction row. So a "delete for everyone" message, and the old text of an edited one, can still be read in three places:
- **Search:** past the first page, or when the edits window cap pushed the retraction out.
- **Account export:** the export has no retraction or correction pass at all.
- **Push preview:** the preview returns the deleted text.

Search and the topic preview also honour a retraction or correction from **any** sender.

This is the message pipeline, so tests are required.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/`)
- **Search.**
  - `search/archive-query.ts` (155 lines) builds the edits query: corrections and retractions `WHERE ${scope} AND timestamp > cutoff${before} ... ORDER BY timestamp DESC LIMIT ${cap}` (`:84-98`). The `before` cursor is applied to edits too (`:84`).
  - `search/routes.ts` (303 lines) applies those edits (`:146-162`) with no same-sender check.
- **Export.**
  - `auth/export-stream.ts` (150 lines): `exportMessage(row, ownBareJid, chatKind)` maps a row to `body: content.body` (`:62-76`).
  - `auth/export.ts:218-253` streams the rows. Neither has a retraction or correction pass.
- **Push preview.**
  - `push/api-handlers.ts` (278 lines) calls `readCandidateByOriginId(archive, allowed, request.query.messageId)` (`:168`), and the same for an edit target (`:183`).
  - `readCandidateByOriginId` is in `push/archive-scan.ts` (286 lines). It returns the original row whether or not it was retracted.
- **Topic preview.** `topics/preview.ts` (134 lines) applies corrections and retractions at `:72-84`, with no sender check.
- **Shared helpers.**
  - `search/snippet.ts` (95 lines) has `correctionTarget` and `retractTarget` (`:75-…`) and `stanzaFrom`.
  - `notify/ai-cards.ts` has `cardEditTarget(xml)`.
- **The same sender.**
  - In a DM: the same bare JID.
  - In a room: the same real JID. ejabberd writes the sender's real JID into archived room messages for non-anonymous rooms, as `<x xmlns='http://jabber.org/protocol/muc#user'><item jid='…'/></x>`. If the row has none, compare the `from` resource (nick).
- **T-1988** (running in parallel) adds linear markup helpers in `apps/server/src/markup/scan.ts`. If it is on main when you start, use them for any new XML reading; if not, use `indexOf`-based reads, never a backtracking regex over the whole stanza.

### Steps
1. **Shared helper.** Add one helper in a new file `apps/server/src/search/edit-overlay.ts`: `loadEditsForTargets(archive, scope, targetOriginIds)`. It reads every correction and retraction row whose target is in the given set:
   - no time cursor and no row cap, but at most the targets' count times 20 rows;
   - newest first;
   - it keeps only those whose sender equals the target row's sender.

   It returns, per target, `{ retracted: boolean, latestText?: string }`.
2. **Use it everywhere.** Use the helper in search (for the page's hits), in the export (per batch of rows) and in the push preview, plus its edit-target path.
   - A retracted message is left out of search hits and the push preview; the preview answers 404.
   - In the export, a retracted message is exported with `body: ''` and `kind: 'deleted'`.
   - A corrected message shows its latest text.
3. **Topic preview.** It applies only the original sender's correction or retraction.
4. **Tests:**
   - search page 2, after a retraction outside the window, doesn't return the text;
   - an export of a chat with a retracted message has no original text;
   - the push preview of a retracted message answers 404;
   - a retraction from another sender is ignored in search.
5. **Size.** Every file stays at or under 400 lines.

### Allowed files
- `apps/server/src/search/edit-overlay.ts`
- `apps/server/src/search/edit-overlay.test.ts`
- `apps/server/src/search/archive-query.ts`
- `apps/server/src/search/routes.ts`
- `apps/server/src/auth/export-stream.ts`
- `apps/server/src/auth/export.ts`
- `apps/server/src/auth/export.test.ts`
- `apps/server/src/push/archive-scan.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/api-preview.test.ts`
- `apps/server/src/topics/preview.ts`
- `apps/server/src/topics/preview.test.ts`
- `work/T-2003-retractions-server-reads.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/search src/auth/export.test.ts src/push/api-preview.test.ts src/topics/preview.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/server/src/search/edit-overlay.ts` with `loadEditsForTargets(archive, scope, targetOriginIds)`. It reads the target rows and every correction/retraction row in the scope with **no page cursor and no search-window cap**, newest first, bounded only by `target count × 20`. It keeps an edit only when its sender equals the target's sender: bare JID in a DM, MUC `item jid` (real JID) in a room, falling back to the nick/`from` resource. The MUC item is read with `indexOf`, no new regex over the stanza. It returns `{ retracted, latestText? }` per target.
- **Search** (`search/routes.ts`, `search/archive-query.ts`): the exact and fuzzy passes now build the overlay for every hit (and each edit row's target), drop retracted hits, drop a hit superseded by a newer same-sender correction, and only show a correction row when it is the newest accepted correction. A forged retraction/correction is ignored. Removed the old cursor-bound `buildArchiveEditsQuery` (now dead). The exact query also selects `txt` so a correction row can be matched to the overlay's latest text.
- **Export** (`auth/export-stream.ts`, `auth/export.ts`): each page loads the overlay for its chat before writing. A retracted row is exported as `body: ''`, `kind: 'deleted'`; a corrected row exports the latest text; correction/retraction rows are not exported as separate messages. `ExportStreamInput` now carries the archive pool.
- **Push preview** (`push/api-handlers.ts`): retracted target → 404; a same-sender correction replaces the preview text. The edit-target read now answers 404 for a retracted target and for an edit with no accepted same-sender entry (an orphan/forged edit).
- **Topic preview** (`topics/preview.ts`): the hand-rolled merge is replaced by the shared helper, so only the original sender's correction/retraction applies and forged edits are ignored.
- **Tests**: new `search/edit-overlay.test.ts` (unit helper tests + two route tests through `runSearchEffect`: a page-2 hit retracted after the cursor, and a forged retraction ignored). `auth/export.test.ts` (retracted → deleted, no original text; corrected → latest text). `push/api-preview.test.ts` (retracted → 404, corrected → latest text). `topics/preview.test.ts` (another sender's correction and retraction ignored, using the MUC real JID).
- Files changed are exactly the Allowed files; every changed file is 399 lines or fewer.

### Checks run

- `pnpm install --frozen-lockfile` — done, 1155 packages.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/search/edit-overlay.test.ts` — 7 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/export.test.ts` — 6 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/api-preview.test.ts` — 9 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/preview.test.ts` — 3 passed.
- `pnpm gate` (first run failed on Prettier formatting and on the new plain-`async` file needing the `effect-plain` marker; both fixed, then reran):

```
gate: 12 changed file(s) against main
PASS  install (frozen)  (3.6s)
PASS  format  (2.6s)
PASS  lint  (1.6s)
PASS  typecheck  (5.7s)
PASS  effect  (0.8s)
PASS  tests @zilar/server  (77.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- `edit-overlay.ts` is marked `// effect-plain:` because it is a Promise helper over the read-only `ArchivePool`, like `search/service.ts`; the Effect call sites adapt it.
- I removed `buildArchiveEditsQuery`/`ArchiveEditRow` from `search/archive-query.ts` and the `routes.ts` re-exports; nothing else imported them.
- In search and the topic preview, the original row of a corrected message is hidden and the newest accepted correction row is the visible message (keeping the target's id in the topic preview). If the newest correction no longer matches the query, the message is not a search hit — this preserves the previous behaviour.
- Push preview now also 404s an edit row whose target has no accepted same-sender edit, so a forged correction cannot be previewed as a message.
- No deviations from the spec that I am aware of; no open questions.

### Round

Fix round for `PREREVIEW.md` (must-fix=1, should-fix=0, nit=1).

- **Finding 1 (must-fix) — fixed.** In `search/routes.ts` the fuzzy second pass now builds its edit overlay after the fuzzy candidates are fetched, over the union of the exact rows and the fuzzy candidates, and both passes render against that one overlay. A retracted (or corrected) message that only the fuzzy pass matches can no longer be returned. Added `search retractions > hides a retracted hit that only the fuzzy pass matches` in `search/edit-overlay.test.ts`; I verified it fails on the pre-fix `routes.ts` (it returned the deleted `m1` as a fuzzy hit) and passes with the fix.
- **Finding 2 (nit) — not changed**, per the fix-round rule to leave nits alone unless they are on a line already changed. `topics/preview.ts` is untouched this round.
- Single test run: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/search/edit-overlay.test.ts` — 8 passed.
- `pnpm gate`: `GATE PASS`; install, format, lint, typecheck, effect and `@zilar/server` tests all PASS; scope, migration, images and size checks PASS; 12 changed files, all inside the Allowed files.

### Lead fix round

- **Room sender identity.** `rowSenderKey` now compares `bare_peer` for `kind === 'groupchat'`, lowercased bare (`room:${bareJid(row.barePeer).toLowerCase()}`). Removed `mucRealJid`, the `MUC_USER_NAMESPACE` constant and the nick/`from`-resource fallback; the `Pick<>` now takes `kind | barePeer | xml`. The edit-overlay's target and edit queries already select `bare_peer`, as do the search queries, the export query and the push scan; I also added `bare_peer` to the topic preview's `MESSAGE_COLUMNS`.
- **Tests.** Added three room cases to `search/edit-overlay.test.ts`: a retraction with the target's nick but a different `barePeer` is dropped; a retraction from the same `barePeer` applies; a forged `muc#user` item jid on an edit from another `barePeer` is dropped. Existing room fixtures in `topics/preview.test.ts` and `push/api-preview.test.ts` now set `barePeer` to the sender, and the preview forgery fixture no longer relies on a stored MUC item.
- **Nits.** Updated the `topics/preview.ts` header comment to the shared-helper design. `attributeValue` now accepts whitespace around `=`; it stays in use for the DM `from` parse (`messageFrom`), so deleting `mucRealJid` did not leave dead code.
- Tests: `pnpm --filter @zilar/server exec vitest run src/search src/auth/export.test.ts src/push/api-preview.test.ts src/topics/preview.test.ts --maxWorkers=2 --reporter=dot` — 4 files, 29 passed.
- `pnpm gate`: `GATE PASS`; install, format, lint, typecheck, effect and `@zilar/server` tests PASS; scope, migration, images and size PASS; 12 changed files, all inside the Allowed files.
- Deleted the ignored `PREREVIEW.md` at the lead's request. Status stays `review`.

## Review (written by Claude)

Approved after a lead fix round and one auto round; the pre-review now finds 2 test nits.
- **The overlay.** The new `search/edit-overlay.ts` loads every correction and retraction of the page's targets in the caller's own scope. It has no time cursor, so a later retraction still hides an earlier hit.
- **Where it applies.** Search (exact and fuzzy), the account export, the push preview and the topic preview all use it.
- **Who may edit.** Only the original sender's edits count.
  - In a room, the sender is `bare_peer`, ejabberd's real sender. The stored `<x>` and the nick were dropped after the lead found the stored room XML holds no trusted `<x>` and that nicks are display names.
  - In a DM, the sender is the stanza's bare `from`.
