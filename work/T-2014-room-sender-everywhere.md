---
id: T-2014
title: "Message pipeline: every remaining server read takes a room message's sender from the archive's bare_peer, never the stanza from/nick — AI-card detection, media index sender and its edit check, search hit names, media gallery names, topic preview names, AI context and AI memory labels — with tests"
status: merged
milestone: M5
branch: task/T-2014-room-sender-everywhere
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2014: Room sender from `bare_peer` everywhere

## Spec (written by Claude, do not edit)

### Why
The lead checked the live ejabberd archive on 2026-10-18: 376 room rows, structure only, plus `mod_mam.erl`.
- **What room rows hold.** For a room row (`kind = 'groupchat'`), the real sender's bare JID is in the `bare_peer` column. ejabberd sets it, on the user domain, AIs included.
- **What the XML holds.** The stored XML's `from` is `room/nick`, and stored XML never contains a trusted muc#user `<x>`: ejabberd strips it before storing.
- **What the nick is.** It's a free display name: anyone can join with someone else's name.

T-2003 and T-2004 moved search and export edits, pushes and unread to `bare_peer`. These places still trust the nick or `from`:
- **AI-card detection** (`isLiveAiUiRow`) checks only the payload type, so a person can post a `progress` payload and have it hidden from pushes, unread and previews. A client-side check landed in T-2001, but the server still needs one.
- **The media index** stores a room sender as `room/nick`, so the "sender's own media only" edit check from T-1994 compares nicks.
- **Search hits, the media gallery and topic previews** show the nick as the sender's name.
- **The AI's context and memory** label room senders by nick, so someone can pose as "Julio" to an AI.

This is the message pipeline, so tests are required.

### Facts (read by the lead on 2026-10-18 at `889b7d5ec`; paths under `apps/server/src/`)
- **The AI-card check.** `notify/ai-cards.ts` (86 lines) has `isLiveAiUiRow(xml)`, which returns `decodeAgentPayload(xml)?.type === 'progress'` (`:57-59`). Its callers:
  - `agents/memory/indexer.ts:86`
  - `chats/unread-skip.ts:19`, through `skipUnreadRow(xml, liveIds)`, called from `chats/unread.ts`
  - `media/extract.ts:96`
  - `notify/ai-cards.ts:81`
  - `push/api-handlers.ts:215`
  - `push/candidates.ts:44`
  - `topics/preview.ts:90`
- **The media index sender.** `media/indexer.ts` has `senderJidFor(row)`, which returns `stanzaFrom(row.xml) ?? ''` (`:121-123`). It is used as the stored `sender_jid` (`:151`, `:182-183`) and in the edit check that reads `SELECT DISTINCT sender_jid` (`:191`).
- **Gallery names.** `media/items.ts` (76 lines) names a room sender `roomNick(row.senderJid)` (`:45-47`).
- **Search names.** `search/routes.ts:164` calls `senderNameFor(row, ownJid, allowed.peerNames)` without the 4th `roomNames` argument. `search/snippet.ts:45-58` already accepts it and prefers `bare_peer`. The names come from `senderNamesByJid(db, jids)` in `xmpp/archive-sender.ts:16`.
- **Topic previews.** `topics/preview.ts` already selects `bare_peer AS "barePeer"` (`:23`) but returns `nick: row.nick` (`:101`).
- **The AI context.** In `agents/context.ts`, `displayNameOf` returns the trimmed `fromNick` or the bare `fromJid` (`:210-212`), and is used at `:206`. Gateway messages carry `fromJid` and `fromResolved` (true when `fromJid` is a real bare JID) from `packages/xmpp-core/src/types.ts:74-79`.
- **AI memory.** `agents/memory/indexer.ts` `senderFor` returns `row.nick` for a room (`:101-106`).

### Steps
1. **AI-card check.** `isLiveAiUiRow(xml, barePeer)` takes the row's `bare_peer` as a **required** argument.
   - For `<message type="groupchat">` the sender is `bareJid(barePeer)`; otherwise it is the stanza's bare `from`.
   - It returns true only for a `progress` payload whose sender passes `isAiJid` (`@zilar/protocol`).
   - Thread `barePeer` through every caller listed above, including `skipUnreadRow`. Add `bare_peer` to any query that doesn't select it yet.
2. **Media index.** `senderJidFor` uses `bareJid(row.barePeer)` for room rows. The edit check compares those bare JIDs. Rows already stored keep their old value; nothing is migrated. A correction from someone whose `bare_peer` differs is simply not applied.
3. **Names.**
   - Search hits pass `roomNames`, from one `senderNamesByJid` call per page.
   - The gallery's room sender name comes from `senderNamesByJid` on the stored bare JID. Old `room/nick` rows fall back to the nick.
   - Topic previews return the database name for `bare_peer`, with the nick as fallback.
   - The AI context uses the database name for a resolved `fromJid` (`fromResolved === true`), batched per turn. The nick is used only when the sender is unresolved.
   - AI memory names room senders from `bare_peer` the same way.
4. **Tests** (in the nearest test files):
   - a person's `progress` payload in a room is **not** treated as a live AI card, and an AI's is;
   - a media correction from a different `bare_peer` with the same nick doesn't touch the target's media;
   - a search hit and a topic preview show the database name for `bare_peer`, not a spoofed nick;
   - the AI context labels a resolved sender with their database name.
5. **Keep every file at or under 400 lines.**

### Allowed files
- `apps/server/src/notify/ai-cards.ts`
- `apps/server/src/notify/ai-cards.test.ts`
- `apps/server/src/agents/memory/indexer.ts`
- `apps/server/src/agents/memory/indexer.test.ts`
- `apps/server/src/chats/unread-skip.ts`
- `apps/server/src/chats/unread.ts`
- `apps/server/src/media/extract.ts`
- `apps/server/src/media/indexer.ts`
- `apps/server/src/media/indexer.test.ts`
- `apps/server/src/media/items.ts`
- `apps/server/src/media/api.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/candidates.ts`
- `apps/server/src/push/candidates.test.ts`
- `apps/server/src/push/api-preview.test.ts`
- `apps/server/src/search/routes.ts`
- `apps/server/src/search/routes.test.ts`
- `apps/server/src/topics/preview.ts`
- `apps/server/src/topics/preview.test.ts`
- `apps/server/src/topics/api.ts`
- `apps/server/src/agents/context.ts`
- `apps/server/src/agents/context.test.ts`
- `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/chats/unread.test.ts`
- `work/T-2014-room-sender-everywhere.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/notify src/media src/topics src/agents/context.test.ts src/agents/memory --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Every file stays at or under 400 lines.

---

## Report (written by the worker when done)

### What I did

All of T-2014, including the lead's addendum and the follow-up permissions.

1. **AI-card check** (`notify/ai-cards.ts`): `isLiveAiUiRow(xml, barePeer)` takes the row's `bare_peer` as a required argument. A `<message type="groupchat">` row's sender is `bareJid(barePeer)`; any other row's sender is the stanza's bare `from`. It returns true only for a `progress` payload whose sender passes `isAiJid`. `liveAiUiIds(rows)` takes rows carrying `barePeer`. Threaded through `agents/memory/indexer.ts`, `chats/unread-skip.ts` (`skipUnreadRow(xml, barePeer, liveIds)`, `UnreadSkipRow` gained `barePeer`), `chats/unread.ts`, `media/extract.ts`, `push/api-handlers.ts`, `push/candidates.ts` and `topics/preview.ts`. `push/archive-scan.ts` and `push/group-notifier.ts` already use rows with `barePeer`, so they needed no edit.
2. **Media index sender** (`media/indexer.ts`): `senderJidFor` returns `bareJid(row.barePeer)` for a `groupchat` row and the stanza's bare `from` otherwise, so `sender_jid` and the "sender's own media only" edit check compare real bare JIDs. `buildTargetAuthorQuery` selects `bare_peer` and `kind` too. Stored rows are not migrated; an old `room/nick` value never equals a correction's bare JID.
3. **Names, wired end to end**:
   - Search (`search/routes.ts`): the render step loads one `senderNamesByJid` map per page for the page's room `bare_peer`s and passes it to `senderNameFor`.
   - Gallery (`media/items.ts` + `media/api.ts`): `senderNameFor` takes a `roomNames` map; `media/api.ts` makes one `senderNamesByJid(deps.db, roomSenderJids(page))` call per page. An old `room/nick` row falls back to its nick.
   - Topic preview (`topics/preview.ts` + `topics/api.ts`): `readTopicPreview` takes a `RoomNameLookup` and calls it once with the page's `bare_peer`s; `topics/api.ts` passes `senderNamesByJid(deps.db, jids)`. The nickname is the fallback.
   - AI context (`agents/context.ts`, `agents/gateway/group-turn-body.ts`, `agents/gateway/group-turn.ts`): `GroupContextInput.senderNames` labels every resolved history sender from the database (bare JID when unnamed, never the nick); the group turn body makes one batched lookup per turn; `group-turn.ts` resolves the trigger's `senderName` the same way.
   - AI memory (`agents/memory/indexer.ts`): one batched `senderNamesByJid` per pass over the room batch's `bare_peer`s; `senderFor` stores that name with the nick only as a fallback.
4. **Preview cards only from AIs** (addendum): `topics/preview.ts` decodes and attaches a payload only when `isAiJid(bareJid(row.barePeer))`; a person's `blocks`/`progress` payload is dropped and the body shown.
5. **Tests**:
   - `notify/ai-cards.test.ts`: a person's room `progress` payload is not live UI, an AI's is; DM cards use the stanza sender.
   - `media/indexer.test.ts`: occupant `from` and `bare_peer` are separate; a correction from another `bare_peer` with the same nick leaves the victim's media untouched.
   - `topics/preview.test.ts`: the preview names the sender from the database, not a spoofed nick; a person's `blocks` payload has no `payload`, an AI's does.
   - `agents/context.test.ts` (new): resolved senders are labelled with the database name, unresolved ones keep the nick.
   - `search/routes.test.ts` (new): a room hit shows the database name for `bare_peer`, not a spoofed nick.
   - `chats/unread.test.ts` and `push/candidates.test.ts`: progress-card fixtures moved to real `ai-…` JIDs, same intent.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/notify/ai-cards.test.ts src/media/indexer.test.ts src/topics/preview.test.ts src/agents/context.test.ts src/chats/unread.test.ts src/push/candidates.test.ts src/search/routes.test.ts` — **59 passed, 7 files passed**.
- `pnpm --filter @zilar/server exec vitest run src/notify src/media src/topics src/chats src/push src/search src/agents --reporter=dot` — **391 passed, 2 failed** (`gateway-group.test.ts`, the two two-AI smart-wake tests: they time out in `openRoom` waiting for the second AI's core to join, before any turn runs). I re-ran the block with my two changed gateway files stashed (`git stash push -- group-turn.ts group-turn-body.ts`) and the same two tests fail, so this is pre-existing and unrelated to T-2014.
- `pnpm gate` — `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `size: every changed source file is within 400 lines`, ends **GATE PASS**.
- Source line counts stay ≤ 400: largest are `topics/api.ts` 387, `media/indexer.ts` 340, `agents/context.ts` 313, both gateway turn files 400.
- `PREREVIEW.md` does not exist.

### Notes for the lead

- The two failing two-AI smart-wake tests are the only red mark, and they fail identically without the T-2014 gateway wiring; they are not caused by this task. `push/api-preview.test.ts` passed unchanged, so I left it alone.
- One design choice: `readTopicPreview` takes a `RoomNameLookup` (the 4th argument) rather than a map, because the page's senders are only known after its rows are read; `topics/api.ts` passes `senderNamesByJid`.
- The trigger's name lookup is one single-JID query in `group-turn.ts`, and the history names are one batch in `group-turn-body.ts`; both fall back safely (empty map → resolved senders show their bare JID, never the nick) if the lookup fails.

### Fix round

- **Finding 1 (should-fix, `search/routes.ts`)** — fixed. The page's batched room-name lookup now catches a rejection and yields an empty map, so a transient DB failure degrades to the nick/`Unknown` fallback instead of turning a working search into a 500. Added a test in `search/routes.test.ts` that makes the lookup reject and checks the hit is still returned with the nick as its name.
- **Finding 2 (should-fix, `media/api.ts`)** — fixed. The gallery's `senderNamesByJid` call is wrapped in `Effect.catchDefect(() => Effect.succeed(new Map()))`, the same degradation the handler already applies to `indexChat`. No test was added: the gallery handler has no test file, and `apps/server/src/media/api.test.ts` is not in the task's Allowed files (creating it would leave scope). The new search test exercises the same `senderNameFor` empty-map fallback.
- **Nit 3 (`agents/gateway/group-turn.ts:275`)** — left unchanged, per the instruction not to touch nits.
- **Disagreements** — none.

Commands this round:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/search/routes.test.ts` — **2 passed, 1 file passed**.
- `pnpm gate` — `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`, `images: every workspace package an app image needs is copied into its Dockerfile`, `size: every changed source file is within 400 lines`, ends **GATE PASS**.


## Review (written by Claude)

Approved after the lead's unblock round (the extra call sites and fixtures) and 1 auto round. The pre-review was clean, with 60 of 60 tests passing.
- **AI-card detection.** `isLiveAiUiRow(xml, barePeer)` takes the sender of a room row from the archived `bare_peer`, and the stanza's `from` for a DM. It counts a row only when that sender is an AI.
- **The media index** stores `bare_peer` for room rows.
- **Names** come from the database by `bare_peer`: search hits, the media gallery, topic previews, AI context (the trigger label included) and AI memory.
- **Topic join previews** carry a card `payload` only from an AI `bare_peer`.
- **Old rows.** Rows indexed before this change keep their old `room/nick` sender in the media index. Display only.
- **Live check after deploy:**
  - an AI progress card in a topic still updates and notifies;
  - search shows real names in group hits.
