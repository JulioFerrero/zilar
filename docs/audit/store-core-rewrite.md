# Store core rewrite map

Scope: every production `.ts` file under `packages/client-core/src/store/` (including
`send/`), plus `packages/client-core/src/atom-store.ts` and
`packages/chat-core/src/store/ledger.ts`. No code changes. This document is the map a
rewrite is written from, following `docs/LEAN_CODE.md`.

## How the numbers were taken

`wc -l` over the scope today gives **8,797 lines**: 8,581 under
`packages/client-core/src/store/` (tests and `test-support.ts` excluded), 98 in
`atom-store.ts`, 118 in `chat-core/src/store/ledger.ts`. The task quotes 7,504 as the
2026-10-19 count; the 8,581/8,797 figure is what the tree measures now. Every budget
below is checked against both numbers. Tests are a separate 5,644 lines and are not in
any target.

The 8,581 store lines divide as: 1,809 in the eleven ledger files, 1,554 in `send/` plus
97 in `send.ts` and `send-failure.ts` (1,651 together), 920 comment lines (10.7%), 556
blank lines, and the rest in the modules listed in part 4.

App layers were read only to learn usage: `apps/web/src/store/effects/ctx.ts`,
`apps/web/src/store/effects/storeContext.ts`, and the import graph of
`@zilar/client-core/store` (49 files, 133 distinct imported names).

---

## 1. Behaviour list

Each item is a guarantee the apps rely on. Every claim cites the place it lives today and
the test that pins it. `S/` below means `packages/client-core/src/store/`.

### Identity, dedupe, ordering

1. **One message has one alias root.** A local optimistic id and its server id are linked,
   and every lookup, edit, reaction and status write resolves through the root
   (`S/ledger-ids.ts:30-57`). Pinned by `S/ledger.test.ts:173-259` (echo before the send
   resolves, two identical texts) and `S/ledger.test.ts:321-339` (canonical id resolves a
   server id).
2. **The first author of an id wins.** A reused origin id from another sender never links
   to my message and their correction/retraction is ignored (`S/ledger-ids.ts:59-72`,
   `S/ledger-ids.ts:188-223`). Pinned by `S/ledger.test.ts:455-509`.
3. **A resend appears once.** Two archived rows with one origin id alias together and the
   live/history path drops the second copy before any side effect
   (`S/ledger-ids.ts:183-223`, `S/history.ts:44-55`, `S/incoming.ts:178-183`,
   `S/history.ts:171-190`). Pinned by `S/ledger.test.ts:400-465`,
   `S/incoming.test.ts:53-65`, `S/history.test.ts:250-260`.
4. **The archive id is private.** A MAM/archive id is aliased onto the message but the wire
   target (reply, correction, retraction, reaction) keeps the origin/stanza id the peer
   knows (`S/history.ts:130-146`, `S/ledger-ids.ts:165-174`,
   `S/ledger-ids.ts:238-254`). Pinned by `S/history.test.ts:459-484` and
   `S/history.test.ts:385-458`.
5. **Group reactions name the room stanza id.** An ack that arrives first keeps the echo's
   stanza id once it arrives; an echo that arrives first keeps its id
   (`S/ledger-ids.ts:152-163`). Pinned by `S/ledger.test.ts:341-366`.
6. **A message is identified by root, not by raw id.** `sameMessage` is root equality
   (`S/ledger-ids.ts:137-139`); message order is time first, id as tie-break
   (`S/rows.ts:93-98`). Pinned by `S/ledger.test.ts:214-235` (root equality and order)
   and `S/ledger.test.ts:480-500` (a foreign origin id is not the root).
7. **Pruning forgets ids with the rows.** Dropping old messages also drops their aliases,
   authors, origin ids, base texts and cards (`S/prune.ts:15-46`,
   `S/ledger-ids.ts:256-285`). Pinned by `S/prune.test.ts:74-81`.
8. **Reset clears the whole ledger.** Sign-out clears aliases, server ids, origin ids,
   authors, base texts, cards, cursors, last-read marks, drafts and the outbox
   (`S/ledger.ts:71-80`, `S/lifecycle.ts:145-162`). Pinned by
   `S/lifecycle.test.ts:130-154` and `S/ledger.test.ts:381-399`.
9. **Messages are ordered oldest first.** Live insert, echo, history page and older page
   all end in `sortMessages` order (`S/rows.ts:93-98`, `S/incoming.ts:117-124`,
   `S/incoming.ts:219-222`, `S/history.ts:352-362`, `S/ledger-history-ingest.ts:224-236`).
   Pinned by `S/history-page.test.ts:84-103` (a page arrives oldest first) and
   `S/ledger.test.ts:214-235` (out-of-order acks still sort by time).
10. **An older page keeps the loaded copy.** The page is deduped against loaded messages by
    alias root and only sorted when the concatenation is out of order
    (`S/ledger-history-ingest.ts:228-236`). Pinned by `S/history.test.ts:239-284`.
11. **Chat rows are ordered by recency, not arrival.** A brand-new row with no preview and
    no creation time does not jump to the top for one tick (`S/rows.ts:12-30`,
    `S/chat-rows.ts:83`). Pinned by `S/rows.test.ts:34-81`.
12. **Presence and occupant bursts do not rebuild state needlessly.** When nothing visible
    changed the same array/object is returned (`S/incoming.ts:305-326`,
    `S/incoming.ts:332-355`). Pinned by `S/incoming-presence.test.ts:8-35`.

### History pages and gaps

13. **Page sizes are fixed:** 50 for one page, 1 for a preview, at most 20 pages and 10 s
    for a jump (`S/history.ts:13-21`). Pinned partly by `S/history.test.ts:346-351`
    (preview size); the 20-page and 10 s jump caps have no core test.
14. **History waits for a usable session:** a core exists, status is online, and a group's
    room is joined (`S/history.ts:95-102`). Pinned by `S/history.test.ts:95-106`.
15. **A chat opened before data is ready is remembered and flushed** when the connection or
    its room arrives (`S/history.ts:276-322`, `S/history.ts:402`). Pinned by
    `S/history.test.ts:123-178`.
16. **One page is one store write.** Reactions, edits, mapped messages, read marks and
    `historyComplete` all land in one batched update (`S/history.ts:165-195`,
    `S/ledger-history-ingest.ts:163-222`). Pinned by `S/history-page.test.ts:84-137`.
17. **History never bumps a chat.** An old correction read back from the archive changes
    text only; it does not move the row or raise unread
    (`S/ledger-history-ingest.ts:133-156`). Pinned by `S/ledger.test.ts:810-841`.
18. **A failed page keeps what is on screen and offers retry.** The cursor stays for a later
    attempt and the open, visible chat still marks the newest loaded message seen
    (`S/history.ts:385-400`, `S/history.ts:196-200`). Pinned by
    `S/history.test.ts:179-237`.
19. **Only an open, visible chat marks read.** A page landing after the user left sends no
    displayed marker and keeps unread (`S/history.ts:375-383`, `S/reads.ts:31-60`). Pinned
    by `S/history.test.ts:193-237`.
20. **Jumping to a message pages back until found** (or history is complete), resolves a
    chat preview's archive id, waits for in-flight loads, and fails with
    `message_not_found` after 20 pages or 10 s (`S/history.ts:411-471`). Pinned by
    `S/history.test.ts:355-484`.
21. **Preview pass is bounded** to 4 concurrent MAM queries and skips rows that already have
    a preview and cursor (`S/previews.ts:7-25`). Pinned by
    `S/history.test.ts:325-354`.
22. **The peer's read mark is applied on load** and never downgrades a status
    (`S/reads.ts:62-76`, `S/delivered.ts:96-131`). Pinned by
    `S/read-until.test.ts:61-113`.
23. **Retention:** a non-open chat keeps its newest 300 messages; the open chat, a chat
    with a send in flight, and a chat with a live draft are left alone; a pruned chat is
    marked incomplete so it pages again (`S/prune.ts:8-46`). Pinned by
    `S/prune.test.ts:51-81`.

### Incoming: messages, edits, deletes, reactions

24. **A live message does all of:** drop an already-aliased resend; confirm delivery; clear
    typing; raise unread once per album; finish an AI draft; notify and sync the badge;
    mark displayed when the chat is active and visible (`S/incoming.ts:145-256`). Pinned
    by `S/incoming.test.ts:41-207` and `S/incoming.test.ts:460-478`.
25. **An echo reconciles the optimistic bubble:** link ids, clear a failure, advance status,
    forget retry bytes, replace the local row, re-apply edits and reactions
    (`S/incoming.ts:82-143`). Pinned by `S/incoming.test.ts:138-182`,
    `S/incoming.test.ts:394-459`, `S/ledger.test.ts:172-259`.
26. **Edits and deletes never render as messages.** A XEP-0308 correction or XEP-0424
    retraction is applied to its target only; an empty-body correction is ignored; a card
    correction is remembered even with no body (`S/ledger-history-ingest.ts:32-126`,
    `S/ledger-edits.ts:31-45`). Pinned by `S/ledger.test.ts:510-718`.
27. **A routine correction bumps its chat once, as unread unless mine, and never from
    history** (`S/ledger-routine-bump.ts:32-60`, `S/ledger-edits.ts:31-45`). Pinned by
    `S/ledger.test.ts:719-945`.
28. **Reactions never become a bubble** and a group reaction updates its target's chips in
    place (`S/ledger-reactions.ts:92-129`). Pinned by `S/incoming.test.ts:194-207` and
    `S/incoming.test.ts:433-459`.
29. **A reply quote follows its target.** A loaded target contributes its corrected text,
    a deleted target contributes "Deleted message", and a same-page reply resolves before
    insert (`S/ledger-incoming.ts:95-117`, `S/ledger-edits.ts:193-214`,
    `S/history.test.ts:504-535`, `S/incoming.test.ts:208-240`).
30. **AI-only cards are gated by sender.** A question, approval, blocks, routine or
    progress card from a person is dropped (and a body-less one shows one fixed sentence);
    a sticker is kept and checked at render (`S/ai-cards.ts:8-28`,
    `S/ledger-incoming.ts:179-196`). Pinned by `S/ai-cards.test.ts:37-79` and
    `S/ledger.test.ts:510-718`.
31. **Untrusted media URLs are stripped.** Incoming voice and attachment URLs survive only
    on a trusted host (`S/ledger-incoming.ts:32-48`, `S/ledger-incoming.ts:178-183`).
    No core test.
32. **Typing is per sender.** One line per sender, a 5 s clear, an AI status with a 60 s
    clear, and `aiStatus` moves `working`/`idle` in the same write
    (`S/typing.ts:10-166`, `S/incoming.ts:258-291`). Pinned by
    `S/incoming.test.ts:241-342`.
33. **Displayed markers only come from a peer** (a reflection is ignored)
    (`S/incoming.ts:293-303`). Pinned by `S/incoming.test.ts:343-354`.
34. **Occupants and presence update counts/last-seen only** and keep reference identity
    when nothing changed (`S/incoming.ts:305-372`). Pinned by
    `S/incoming.test.ts:355-393`.
35. **AI activity triggers one debounced chat-list refresh per burst**
    (`S/incoming.ts:36-80`). Pinned by `S/activity-refresh.test.ts:57-89`.

### Send pipeline

36. **Every send inserts one optimistic bubble first.** Local ids are `local-N` from a
    per-store sequence, and the echo queue is keyed by chat + body + reply (sticker adds
    the sticker id) (`S/send/context.ts:47-64`, `S/send/text.ts:9-38`). Pinned by
    `S/send.test.ts:159-165`.
37. **A text is only `sent` when the stream acknowledges it.** The outbox holds it by local
    id, resends with the same stanza id on the next online, gives up after 3 attempts or
    10 minutes, drops a settled bubble, and never resends a stanza a resumed stream
    covered (`S/send/outbox.ts:14-16`, `S/send/outbox.ts:46-307`). Pinned by
    `S/send.test.ts:181-656`.
38. **Retry re-sends a failed text under the same id** and keeps it in the outbox until its
    ack or echo (`S/send/retry-text.ts:47-133`). Pinned by
    `S/send.test.ts:507-561`.
39. **A send has a deadline and a run token.** 60 s without settling marks it timed out;
    a retry replaces the run, and an older attempt's late result is ignored
    (`S/send/pipeline.ts:5-84`). Pinned by `S/send.test.ts:835-848`.
40. **Attachment sends** validate the album marker bounds, measure an image, upload with
    progress, keep bytes for Retry, cancel a send whose bubble disappeared mid-upload, and
    map failure to a fixed reason (`S/send/attachment.ts:26-204`). Pinned by
    `S/send.test.ts:755-848`.
41. **Voice sends** convert, upload, send the voice payload, keep bytes for Retry, and fail
    the bubble instead of leaving a clock (`S/send/voice.ts:31-174`). Pinned by
    `S/send.test.ts:849-893` and `apps/mobile/src/store/real-store.send.test.ts:168-200`.
42. **Sticker sends** validate the sticker before the optimistic insert and a Retry never
    re-enqueues the echo signature (`S/send/sticker.ts:56-142`). Pinned by
    `S/send.test.ts:657-754`.
43. **Forwards** build a forward origin (public room only), skip failed/sending/deleted
    sources, regroup an album under one fresh id, and send an optional comment as a normal
    text per target (`S/send/forward.ts:27-221`). Pinned by
    `S/send.test.ts:894-957`.
44. **Failure reasons are user-safe.** Any pipeline error maps to one of a fixed set; raw
    error text, URLs and tokens never reach the UI (`S/send-failure.ts:8-67`). Pinned by
    `apps/web/src/store/effects/sendFailure.test.ts`.
45. **A failed bubble can be deleted without a retraction.** Only a `failed` message may
    go, and its kept bytes go with it (`S/send.ts:17-30`,
    `S/ledger-mutators.ts:113-141`). Pinned by `S/send.test.ts:958-972` and
    `apps/mobile/src/store/effects/send.test.ts`.
46. **Status only moves forward:** sending → sent → delivered → read; a late echo cannot
    downgrade a read message (`S/rows.ts:59-75`). Pinned by `S/ledger.test.ts:367-380`,
    `S/read-until.test.ts:103-113`, `S/delivered.test.ts:76-97`.
47. **The outbox belongs to one user.** It is memory only, flushed on online, and cleared on
    sign-out/reset, so one user's queue never goes out as another user's
    (`S/ctx.ts:117-122`, `S/lifecycle.ts:145-162`). Pinned by `S/send.test.ts:191-506` and
    `S/lifecycle.test.ts:130-154`; the app sign-out tests are
    `apps/web/src/store/effects/switchUser.test.ts` and
    `apps/mobile/src/store/real-store.sign-out.test.ts`.

### Marks, typing, drafts, pins, prefs, rows, caches, lifecycle

48. **Delivery confirmation is debounced per chat and batched to 50 origin ids**
    (`S/delivered.ts:10-12`, `S/delivered.ts:46-80`). Pinned by
    `S/delivered.test.ts:41-75`.
49. **Delivered marks advance my messages up to the mark** (decimal ids compared by length
    first, never `BigInt`) and the summary's mark never moves back
    (`S/delivered.ts:30-39`, `S/delivered.ts:96-171`). Pinned by
    `S/delivered.test.ts:76-127`.
50. **Read marks are saved per user, debounced 500 ms per chat, and only numeric archive
    ids reach the server** (`S/reads.ts:9-60`). Pinned by
    `S/unread-merge.test.ts:104-138`.
51. **Drafts are turn-scoped.** A finished turn ignores a late draft; each draft re-arms a
    60 s idle timer; `end` keeps the draft for a 5 s fallback; the stream opens only while
    an AI chat exists (`S/draft-stream.ts:11-219`, `S/draft-events.ts:9-52`). Pinned by
    `S/polling.test.ts:27-249` and `S/draft-events.test.ts:14-60`.
52. **Pins paint first and roll back on failure**, one fixed error per operation; untrusted
    media loses its URL (`S/pins.ts:9-11`, `S/pins.ts:52-211`). Pinned by
    `S/pins.test.ts:15-50`; the rollback path has no core test and is checked by hand.
53. **A pref paints optimistically and rolls back to the saved rows**, so a concurrent
    background update is kept (`S/prefs.ts:27-88`). No core test; the sign-out flow is in
    `apps/mobile/src/store/real-store.sign-out.test.ts`.
54. **Folders sort by position and reset the active folder to `all` once it is gone**
    (`S/folders.ts:15-33`). No core test; no test file references `foldersAfterSet`.
55. **Chat rows merge server and memory:** a newer server preview wins, otherwise memory
    wins; the open chat is always 0 unread; prefs pin/mute/archive; presence stays from
    memory; topics become rows and archived topics disappear
    (`S/chat-rows.ts:27-188`, `S/topic-rows.ts:22-141`, `S/row-helpers.ts:8-81`).
    Pinned by `S/chat-rows.test.ts:41-83` and `S/unread-merge.test.ts:39-103`.
56. **The message cache is display data only:** versioned, 50 rows per chat, never an
    in-flight/`local-` message, local URLs and upload fields stripped, byte-capped, the open
    chat kept, pins decoded leniently, and writes ordered so `clear()` waits for an
    in-flight write (`S/message-cache.ts:9-374`). Pinned by
    `S/message-cache.test.ts:63-223`, `apps/web/src/store/messageCache.test.ts`, and
    `apps/mobile/src/store/offline-cache.test.ts`.
57. **The chat-list cache** keeps unknown fields, caps at 200, drops live presence, and
    rejects another user/version/corrupt JSON (`S/chat-list-cache.ts:7-112`). Pinned by
    `S/chat-list-cache.test.ts:35-92`.
58. **Lifecycle:** `start` is idempotent; `stop` closes every fiber and keeps the ledger;
    `reset` clears it; resume waits for a boot, boots when there is no core, wakes a stale
    core, skips group rejoin on a resumed stream and rejoins on a rebound; `authFailed`
    asks the server and signs out only when the session is gone; connect retries use a
    capped ladder (`S/lifecycle.ts:87-276`, `S/connect.ts:25-179`,
    `S/online.ts:18-51`, `S/session-check.ts:16-112`, `S/lifetime.ts:42-102`). Pinned by
    `S/lifecycle.test.ts:118-544` and `apps/mobile/src/store/effects/session-check.test.ts`.
59. **Polling:** chat list and pins refresh on a 60 s tick (every 5 min while online), on
    focus, and once per roster-push burst; coming back to an unread open chat clears it
    (`S/polling.ts:12-149`). Pinned by `S/polling.test.ts:250-343`.
60. **Delete for me / clear history only change local state after the server accepts**, and
    answer `unavailable`/`failed` without inventing state (`S/delete-own.ts:8-102`). Pinned
    by `S/delete-own.test.ts:49-143`.
61. **Message actions paint first and undo on failure:** react, edit, delete for everyone
    (with `actionError` on failure) and typing (`S/actions.ts:26-189`). Pinned by
    `S/actions.test.ts:32-148`.
62. **The store primitive:** `createAtomStore` keeps one registry atom and a synchronous
    `get`/`set`, and `useStoreSelector` re-renders only when the selected value changes
    (`S/atom-store.ts:20-98`).

---

## 2. Slop by rule

Line costs are the cited ranges, not estimates of the whole file.

### 2.1 One home per piece of logic

| Place | Breaks the rule | Cost |
| --- | --- | --- |
| `S/ctx.ts:100-154` + `S/ctx.ts:188-214` | `CoreCtx` and `CoreLocals` list the same fields twice, and `bridgeLocals` generates accessors for seven of them; every app repeats the list by hand (`apps/web/src/store/effects/storeContext.ts:72-164`, 92 lines) and so does mobile | 81 core lines + ~90 per app |
| `S/history.ts:121-128` | `batchedCtx` rebuilds a `CoreCtx` just to redirect `set` for a page | 8 |
| `S/ctx.ts:9-22` vs `S/actions.ts:191-200` | `CoreTyping`/`CoreDraft`/`CoreActionError` are re-declared as `TypingState`/`DraftState` | 14 duplicated |
| `S/send/context.ts:6-8` vs `apps/web/src/store/effects/ctx.ts:23-25` | `SendRun` is declared twice, and both `SendCtx` and `StoreCtx` declare the same `sequence`, `pendingAttachments`, `pendingVoices`, `sendRuns` | 6 + app copy |
| `S/ctx.ts:156-175` | `createCoreLedger` is a wrapper that adds two closures around `createMessageLedger`; the app also wraps the result in a `Kernel` (`apps/web/src/store/effects/storeContext.ts:47-59`) | 20 + app wrapper |
| `S/send.ts:17-30` vs `apps/web/src/store/effects/storeContext.ts:55-59` | two `removeFailedMessage` wrappers over `S/ledger-mutators.ts:113-141`, each deleting kept bytes | 30 |
| `S/history.ts:95-102` + `S/history.ts:422-429` | two different lookups for "is this message loaded"; the reply path repeats it at `S/ledger-incoming.ts:97-117` | ~30 |
| `S/chat-rows.ts:16` + `S/polling.ts:10` | re-export the neighbour's exports | 3 |

### 2.2 Trust the types and the contract

| Place | Breaks the rule | Cost |
| --- | --- | --- |
| `S/row-helpers.ts:8-81` | `/api/chats` arrives as `unknown` (`S/ports.ts:37`) and is re-validated field by field with `typeof`, although `ChatEntry` is a contract type | 74 |
| `S/chat-rows.ts:164-173` | `entry.topics` is re-read as `unknown` after `chatEntryTopics` already decoded `Topic` rows | 10 |
| `S/ledger-edits.ts:112-128` | a 17-field "is it already deleted" comparison instead of comparing the fields the type says can exist | 17 |
| `S/ledger-edits.ts:150-158` | a six-field equality check before rebuilding a corrected message | 9 |
| `S/message-cache.ts:66-68` + `S/message-cache.ts:113-135` | two hand-rolled `typeof`/array guards around values that the schema can decode once | 20 |

### 2.3 No layers that do nothing

| Place | Breaks the rule | Cost |
| --- | --- | --- |
| `S/index.ts:1-47` | a 47-line barrel over 39 modules with `export *`; 327 declarations are exported, but only 133 names are imported by the apps | 47 |
| `S/ledger.ts:23-32` | the ledger re-exports ten names from two neighbours before `index.ts` exports them again | 10 |
| `S/send.ts:1-30` | a file that only re-exports five send types and holds one 14-line function | 30 |
| `S/previews.ts:7-25` | a one-caller module (`S/connect.ts:176`) whose body is one `Effect.all` | 25 |
| `S/ledger-routine-bump.ts:32-60` | a factory returning one function used once (`S/ledger-edits.ts:25`) | 63 |
| `S/ledger-history-ingest.ts:133-156` | a factory returning one function used once (`S/ledger.ts:68`) | 24 |
| `S/delete-own.ts:8-102` | two functions each called once from the app layers | 102 |

### 2.4 Data over branches

| Place | Breaks the rule | Cost |
| --- | --- | --- |
| `S/send-failure.ts:8-51` | an if-chain mapping codes and statuses to six reasons; a `Record<code, reason>` plus a small status table is half the size | 44 → ~20 |
| `S/pins.ts:56-72` | `pinKindFor` is an if-chain over five fields; a table of field → kind reads better | 17 → ~8 |
| `S/message-cache.ts:241-265` | `fitToBytes` re-serialises the full payload once per removed row; computing sizes once removes the loop-in-a-loop | 25 → ~12 |
| `S/incoming.ts:40-61` | `isAiActivityMessage` is a compound predicate that reads as a table of payload type → state | 22 → ~12 |
| `S/incoming.ts:337-355` | `chatAfterPresence` is a four-case ladder; early returns make the two "same object" cases obvious | 19 → ~10 |

### 2.5 The ledger split: eleven files for one data structure

`ledger-types.ts` (79), `ledger.ts` (134), `ledger-ids.ts` (305), `ledger-edits.ts` (308),
`ledger-incoming.ts` (228), `ledger-history-ingest.ts` (253), `ledger-mutators.ts` (159),
`ledger-reactions.ts` (140), `ledger-identity.ts` (86), `ledger-signatures.ts` (54),
`ledger-routine-bump.ts` (63) = **1,809 lines**.

The split costs structural plumbing:

- `S/ledger.ts:36-70` builds seven modules with seven deps objects. `ids` is created before
  the edit and reaction modules, so its two refresh callbacks are deferred wrappers
  (`S/ledger.ts:54-62`) purely to break a cycle.
- Every module re-declares its own deps interface: `S/ledger-ids.ts:8-14`,
  `S/ledger-edits.ts:12-19`, `S/ledger-incoming.ts:17-24`,
  `S/ledger-history-ingest.ts:20-25`, `S/ledger-history-ingest.ts:128-131`,
  `S/ledger-mutators.ts:9-12`, `S/ledger-reactions.ts:12-17`,
  `S/ledger-identity.ts:6-9`, `S/ledger-routine-bump.ts:25-30`. About 10 lines each.
- Seven `ReturnType<typeof …>` aliases (`S/ledger-ids.ts:305`, `S/ledger-edits.ts:308`,
  `S/ledger-incoming.ts:228`, `S/ledger-reactions.ts:140`, `S/ledger-identity.ts:86`,
  `S/ledger-history-ingest.ts:126`) exist only to let one module name another's return.
- `ledger-edits` imports `ledger-incoming` for `mapMentions` (`S/ledger-edits.ts:8`), and
  `ledger-history-ingest` imports `ledger-edits` back (`S/ledger-history-ingest.ts:6`).

About **110 lines are pure plumbing**, and the split forces every behaviour to be read
across two or three files (dedupe spans ids + incoming + history; the routine bump spans
edits + routine-bump + history-ingest).

### 2.6 The send split

`send/context.ts` (142), `send/pipeline.ts` (84), `send/text.ts` (147),
`send/attachment.ts` (204), `send/voice.ts` (174), `send/forward.ts` (221),
`send/sticker.ts` (142), `send/retry-text.ts` (133), `send/outbox.ts` (307) = 1,554,
plus `send.ts` (30) and `send-failure.ts` (67) = **1,651 lines**.

- The same skeleton is written five times: build the optimistic `UiMessage`, queue the echo
  signature, insert, remember author/base text, then fork the send
  (`S/send/text.ts:21-38`, `S/send/attachment.ts:143-175`,
  `S/send/voice.ts:119-145`, `S/send/sticker.ts:82-112`,
  `S/send/forward.ts:185-213`). About 25 repeated lines each.
- The reply + mentions option object is built three times: `S/send/text.ts:61-82`,
  `S/send/outbox.ts:78-99`, `S/send/retry-text.ts:24-42`.
- Attachment, voice and forward repeat the timeout/run-token/settle sequence
  (`S/send/attachment.ts:67-130`, `S/send/voice.ts:44-106`,
  `S/send/forward.ts:117-141`).
- `S/send.ts:9-15` and `S/index.ts:24-33` re-export the eight modules by hand.

About **250 lines of duplication** on top of the 307-line outbox, which stays a real module.

### 2.7 Types repeated across files

- `SendRun` — `S/send/context.ts:6-8` and `apps/web/src/store/effects/ctx.ts:23-25`.
- `CoreTyping`/`CoreDraft`/`CoreActionError` — `S/ctx.ts:9-22`, re-declared as
  `TypingState`/`DraftState` in `S/actions.ts:191-200`; `PinsError` in
  `S/pins.ts:27-30` repeats `CoreActionError`.
- `HistoryPatch`/`HistorySet` — `S/history.ts:32-37`, a second patch type on top of
  `CorePatch`.
- `ChatStoreCommonState`/`ChatStoreActions` — `S/actions.ts:203-288` (86 lines, most of it
  comments) restates the app store; the apps import it back to type themselves.
- `StoreMessage` (`S/ledger-types.ts:14-19`) vs `UiMessage` — history signatures mix both
  (`S/history.ts:140`, `S/history.ts:415`).

### 2.8 Comments, blank lines, size

- 920 comment lines (10.7% of 8,581) and 556 blank lines. Many comments narrate what the
  next lines do (e.g. `S/incoming.ts:1-3`, `S/history.ts:39-43`,
  `S/ledger-ids.ts:28-29`, `S/ledger-incoming.ts:32-36`). `docs/COMMENTS.md` asks for a
  WHY the code cannot say; a rewrite from the behaviour list should need about 300.
- `S/history.ts` (471) is the only production file over the 400-line soft limit; the
  ledger cluster and `send/` are split far below it, for no behavioural reason.

### 2.9 No speculative code

| Place | What is unused or over-general | Cost |
| --- | --- | --- |
| `S/ports.ts:135` | `OutgoingBytes.cancel?` is never called by the core; mobile cancels through its own `ports.uploader.cancel` (`apps/mobile/src/store/effects/send.ts:103-104`), and web documents that it has no cancel (`apps/web/src/store/effects/ports.ts:376`) | 1 + app implementation |
| `S/pins.ts:117-211` | `loadPins` takes a `_ctx` it never reads (`S/pins.ts:118`); `unpinMessage` does too (`S/pins.ts:182`) | 2 |
| `S/group-actions.ts:96-100` + `S/group-actions.ts:159-164` | optional hooks (`onFailure`, `before`, `reloadDetail`, `open`, `requireRow`) where each app uses one fixed variant; ten store interfaces and generic `<D, R>` for two callers | ~40 |
| `S/message-cache.ts:24` | `maxBytes?` is only omitted by one caller; if both pass it, make it required | 1 |
| `S/history.ts:39-55` | `dedupePage` is a generic `<T extends { id }>` used for two types, in one place | 3 |

### 2.10 Use the platform and the libraries we have

No violations in scope: the store has no UI, validation uses Effect `Schema` where it
exists (the hand-rolled guards are counted in 2.2), and `S/atom-store.ts:1-98` builds on
Effect's reactivity and React's `useSyncExternalStore` rather than a private store.

---

## 3. Dead code

Proof is `git grep` over `apps/` and `packages/`, non-test files, run on this branch.
There are no wholly unreferenced functions: the cost is unreachable public surface and
unused branches, not orphan modules.

| Item | Where | Proof | Cost |
| --- | --- | --- | --- |
| `Lifetime.isStoreOpen` | `S/lifetime.ts:26`, returned at `S/lifetime.ts:83` | `git grep isStoreOpen` returns only those two lines | 2 |
| `OutgoingBytes.cancel?` | `S/ports.ts:135` | `git grep -n "cancel" apps/*/src/store/effects/ports.ts` returns only web's "no cancel" comment; the core never calls it | 1 + mobile impl |
| Package exports `isAiOnlyCardType`, `senderAiId` | `S/ai-cards.ts:16`, `S/ai-cards.ts:30`, re-exported at `packages/client-core/src/index.ts:84,87` | `git grep` finds no app import; both are used only inside `ai-cards.ts` (lines 21 and 37) | 4 |
| `OUTBOX_MAX_ATTEMPTS` export | `S/send/outbox.ts:14` | used only in its own file (line 289) | 1 |
| `OUTBOX_MAX_WAIT_MS` export | `S/send/outbox.ts:16` | used only by `S/send.test.ts:18,465` and its own file | 1 |
| `MESSAGE_JUMP_WAIT_MS` export | `S/history.ts:20` | used only at `S/history.ts:114` | 1 |
| `STATUS_CLEAR_MS` export | `S/typing.ts:13` | used only at `S/typing.ts:13-14` and 135 | 1 |
| `PIN_ERROR`, `UNPIN_ERROR`, `PINS_LOAD_ERROR` exports | `S/pins.ts:9-11` | used only inside `S/pins.ts:134,168,198` | 3 |
| `HistoryPatch`, `HistorySet` exports | `S/history.ts:32-37` | used only in the same file's `HistoryCtx` | 6 |
| `RecordedEdit` export | `S/ledger-history-ingest.ts:27-30` | used only as the return type in the same file | 4 |
| `image` branches | `S/ledger-edits.ts:116,133`, `S/message-cache.ts:91-92`, `S/send/retry-text.ts:64` | the store never assigns `UiMessage.image`; only the cache can hydrate legacy rows | ~8 |
| 62 exports used only inside their own file | all scope files | script over `git ls-files`: 327 exported declarations, 62 have no reference outside their definition file | the public surface can shrink from 327 to the 133 names the apps import |

The 62 own-file exports are mostly factory modules that exist only because of the
eleven-file ledger split and the eight-file send split; merging the files removes the
exports rather than their logic. `LedgerContact` (`S/ledger-types.ts:21-24`) is *not* dead:
`LedgerState` uses it at line 31, but its re-export from `S/ledger.ts:24` is unnecessary.

---

## 4. Lean target structure

Design rule: one module per behaviour family, one context factory, one public entry. The
target keeps the two already-lean primitives unchanged: `atom-store.ts` (98) and
`chat-core/src/store/ledger.ts` (118, the forward/mention helpers).

`today` is `wc -l` on the files the new module absorbs. Counts for `state.ts` are carved
out of `ctx.ts` and `actions.ts`, so they are not added to the total twice.

| New file | Owns | Today | Budget | Guarded by |
| --- | --- | --- | --- | --- |
| `store/ports.ts` | `CorePorts`, `SendPorts`, the hooks and flags; no `cancel` | 158 | 88 | compile + app port tests |
| `store/state.ts` | `CoreState`, patch, `StoreMessage`, the row/status/order helpers (`rows.ts`) | 107 | 78 | `rows.test.ts` |
| `store/context.ts` | the one context factory: state, locals, ledger, lifetime, ports; no `bridgeLocals` | 229 | 108 | app `realStore` tests |
| `store/ledger.ts` | alias roots, ids, dedupe, author/origin claims, `toUiMessage`, cards, edits, retractions, reactions, mutators, batching, routine bump | 1,809 | 600 | `ledger.test.ts`, `history-page.test.ts`, `prune.test.ts`, `incoming.test.ts:394-459` |
| `store/history.ts` | page sizes, open/flush, older pages, jump, preview pass, prune, one-write batching | 471 + 25 + 46 | 300 | `history.test.ts`, `history-page.test.ts`, `prune.test.ts` |
| `store/incoming.ts` | live messages, echo reconcile, typing, displayed, occupants, presence, AI activity | 372 | 248 | `incoming.test.ts`, `incoming-presence.test.ts`, `activity-refresh.test.ts` |
| `store/send.ts` | optimistic insert, text, outbox, retry, deadline, attachment, voice, sticker, forward, failure map | 1,554 + 30 + 67 | 680 | `send.test.ts`, web `sendFailure.test.ts`, web/mobile `realStore.send` |
| `store/actions.ts` | react, edit, retract, typing, delete-for-me, clear history | 288 + 102 | 182 | `actions.test.ts`, `delete-own.test.ts` |
| `store/marks.ts` | delivered queue and marks, read marks, last-read persistence | 76 + 171 | 148 | `delivered.test.ts`, `read-until.test.ts`, `unread-merge.test.ts` |
| `store/typing.ts` | per-sender typing and AI status | 166 | 92 | `incoming.test.ts:241-342` |
| `store/drafts.ts` | turn bookkeeping, idle/end timers, stream open/close, wire decode | 219 + 52 | 168 | `polling.test.ts:27-249`, `draft-events.test.ts` |
| `store/polling.ts` | chats/pins loops, focus, gates, roster burst | 149 | 108 | `polling.test.ts:250-343` |
| `store/lifecycle.ts` | start/stop/reset/reconnect/boot, connect, auth check, retry ladder, wake, lifetime scopes | 276 + 179 + 51 + 112 + 102 | 380 | `lifecycle.test.ts`, mobile `session-check.test.ts`, both `realStore.lifecycle` |
| `store/cache.ts` | message cache codec + writer, chat-list cache codec | 374 + 112 | 290 | `message-cache.test.ts`, `chat-list-cache.test.ts`, web/mobile cache tests |
| `store/chat-rows.ts` | `/api/chats` → rows, topic rows, preview merge, unread/prefs merge | 188 + 81 + 141 | 220 | `chat-rows.test.ts`, `unread-merge.test.ts`, `rows.test.ts` |
| `store/prefs.ts` | pref patch, optimistic row, folders | 88 + 33 | 60 | mobile sign-out test; manual smoke |
| `store/pins.ts` | pin snapshot, optimistic pin/unpin, media trust | 211 | 120 | `pins.test.ts`; manual smoke |
| `store/groups.ts` | group detail load, topic row repaint, create/change/leave/join, invite | 107 + 299 | 200 | mobile `group-actions.test.ts`; manual smoke |
| `store/ai-cards.ts` | AI-only card gate, sender AI id, approval match | 42 | 35 | `ai-cards.test.ts` |
| `store/sender-avatar.ts` | sender picture lookup | 47 | 40 | none (pure, no state) |
| `store/index.ts` | the only public entry, explicit named exports | 47 | 18 | typecheck of 49 importing files |

**Store total: 4,163 budget against 8,581 today** (51.5% fewer). Plus the two untouched
primitives (`atom-store.ts` 98 + `chat-core/src/store/ledger.ts` 118) the whole scope is
**4,379 against 8,797 today** (50.2% fewer), and against the task's 7,504 baseline it is
**41.7% fewer**. Every budget is a limit, not a target: if a module cannot hold its
part-1 items it stops and says which, per `docs/LEAN_CODE.md`.

### Files deleted

The 54 production modules under `packages/client-core/src/store/` as they exist today
(`index.ts` is rewritten in place), including the eleven ledger files and the nine
`send/` files, plus `send.ts`, `send-failure.ts`, `delete-own.ts`, `previews.ts`,
`row-helpers.ts`, `topic-rows.ts`, `rows.ts`, `reads.ts`, `delivered.ts`,
`draft-stream.ts`, `draft-events.ts`. Their behaviour moves to the 21 files above. No
compatibility shim and no second path: the apps move to the new exports in the same
commit.

### Public surface

The apps import 133 distinct names from `@zilar/client-core/store`. The rewrite keeps
exactly those (renaming only where a type moves), and drops the 327-declaration `export *`
barrel. The app context factories delete their hand-written field lists
(`apps/web/src/store/effects/storeContext.ts:72-164` and the mobile equivalent) and call
the core factory. This is where a large part of the app-layer saving in T-2234 comes from,
but it is required here: without it `context.ts` cannot be 108 lines.

---

## 5. Order and risks

Each step is mergeable alone with the current tests green. The public names in each area
stay the same until the step that changes its callers, so no step needs a flag.

| Step | Work | Today → budget | Lines removed | Tests to run before merge |
| --- | --- | --- | --- | --- |
| 1 | Collapse the eleven ledger files into `ledger.ts`; keep `MessageLedger`'s shape | 1,809 → 600 | 1,209 | `pnpm --filter @zilar/client-core test ledger history-page prune` |
| 2 | Collapse `send/` + `send.ts` + `send-failure.ts` into `send.ts`; share the optimistic-insert and option builders | 1,651 → 680 | 971 | `pnpm --filter @zilar/client-core test send`, web `sendFailure`, both `realStore.send` |
| 3 | Fold `history` + `previews` + `prune`, `incoming`, `typing`, and `marks` (`reads`/`delivered`) | 1,327 → 788 | 539 | core `history incoming delivered read-until`, both `realStore.history/incoming` |
| 4 | Replace `ctx.ts` + app wiring with `context.ts`, add `state.ts` from `rows.ts`, fold `lifecycle`/`connect`/`online`/`session-check`/`lifetime`, and fold `delete-own` into `actions` | 1,446 → 748 | 698 | core `lifecycle actions delete-own rows`, both `realStore.lifecycle`, mobile `session-check`, web `switchUser` |
| 5 | Fold rows/topic rows, both caches, drafts, polling, and trim `ports.ts` | 1,474 → 874 | 600 | `rows chat-rows unread-merge message-cache chat-list-cache polling draft-events`, both `realStore.ledger` |
| 6 | Fold prefs/folders, pins, groups, `ai-cards`, `sender-avatar`; shrink `index.ts` | 874 → 473 | 401 | `pins message-cache`, mobile `group-actions`; manual smoke for prefs/folders |

Every step is about 1.5k touched lines: Step 1 (1,809) and Step 2 (1,651) are the two
largest, and steps 1-5 each remove more lines than they add. Each step starts from the
behaviour list in part 1, not from the old file layout.

### Guarantees that are easy to lose

| Guarantee | How a rewrite loses it | How the lead checks it |
| --- | --- | --- |
| Origin-id dedupe and the first-author rule (B1-B3) | merging ids and "same message" into one map drops the sender claim; a resend then shows twice or a peer can retarget my message | `S/ledger.test.ts:400-509`; then web mock: send the same text twice with the network cut between, confirm one bubble |
| The outbox across reconnects, not process restarts (B37, B47) | making it a `Set` keyed by stanza id loses the local id, so the ack cannot settle the bubble; persisting it would send one user's text as another's | `S/send.test.ts:191-506`; web mock: devtools offline → send → online; phone emulator: airplane mode; then sign out and back in as another user and confirm the queue is empty (`S/lifecycle.test.ts:130-154`) |
| Sign-out reset (B8, B47) | splitting session state from the ledger, or memoising a map outside `reset`, leaves the previous user's ids, last-read marks or outbox | `S/lifecycle.test.ts:130-154`, `apps/mobile/src/store/real-store.sign-out.test.ts`, `apps/web/src/store/effects/switchUser.test.ts`; two accounts on one device |
| Status ladder never downgrades (B46) | applying `delivered` after `read` from a stale page | `S/ledger.test.ts:367-380`, `S/delivered.test.ts:76-127`, `S/read-until.test.ts:103-113` |
| One write per history page (B16) | calling `set` per stanza while merging files makes long pages re-render dozens of times | `S/history-page.test.ts:84-137` |
| Echo vs. a late edit/reaction (B25) | replacing the row from the echo after re-applying edits loses the edit | `S/incoming.test.ts:394-459` |
| Group reaction target (B5) | using the local/origin id in a group after the ack races the echo | `S/ledger.test.ts:341-366`; phone emulator: react in a group immediately after sending |
| Read marks only when visible (B19) | applying a page's read mark after the user left clears an unread badge | `S/history.test.ts:193-237` |
| Cache safety (B56-B57) | writing a `local-`/`sending` row or a `file://` URL makes a clock or a broken image survive a restart | `S/message-cache.test.ts:118-177`; kill and reopen the phone app |
| Per-user last-read map (B50) | one storage key for all users leaks one user's read state into another's list | `S/lifecycle.test.ts:118-129`; sign in as a second user and check the unread dividers |

For a read-only live look, use presence/occupancy and typing in a real group (B12, B32,
B34) and a cold start that paints from the cache (B56-B57). Do not use a live check for
sign-out, delete or outbox behaviour; those need the tests and a throwaway account.

### Open question for the lead

The 300-line budget for `history.ts` assumes `openAtMessage`'s wait loop and the prune pass
move into it unchanged. If the lead wants the jump loop rewritten as a bounded recursive
page walk instead of the 20-iteration `for`, the budget still holds, but the test at
`S/history.test.ts:355-484` must be kept as the exact contract.
