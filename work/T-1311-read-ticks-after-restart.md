---
id: T-1311
title: "Read ticks survive a restart: after the app reloads history, my messages that the other person already read show the read state, not a single tick — find where the read position can come from (MAM markers or a server field) and apply it on history load; tested"
status: merged
milestone: M5
branch: task/T-1311-read-ticks-after-restart
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1311: Read ticks after a restart

## Spec (written by Claude, do not edit)

### Why
Lead's QA, 2026-10-13, on the live release APK as Claude Test:
- In the DM with Julio, five messages Claude Test sent yesterday ("Offline test" … "Offline four") all show **one tick** (`apps/mobile/src/components/chat/ticks.tsx:13-21`: `Check` for sent, `CheckCheck` for delivered or read).
- Julio was online and replied after them ("hello?" at 13:45), so he had read them.

The read state comes only from **live** XEP-0333 `displayed` events (`packages/client-core/src/store/incoming.ts:237-247`, wired in `packages/client-core/src/store/lifecycle.ts:316`). Messages reloaded from history after a restart never get it, so every old message I sent shows one tick until the peer reads something new. Telegram keeps the read state.

`deploy/ejabberd/ejabberd.yml:229-232` has `mod_mam` with `assume_mam_usage: true`. Whether bodiless chat markers are archived is unknown.

### What to build
1. **Find a source for the peer's read position after a restart, and say which one in the Report** (with `file:line` or a test):
   - (a) `displayed` markers coming back in MAM queries: check `packages/xmpp-core/src/stanza/decode.ts` and how history pages are parsed; or
   - (b) the server's own read state, if `/api/chats` or another endpoint already carries the peer's last read message or time (check `packages/api-contract/src/` and `apps/server/src/`).
   - If neither exists, the smallest server addition: the peer's last displayed message id per DM, from the archive, in the `/api/chats` row. **No migration** unless unavoidable; if one is needed, stop and say so in the Report.
2. **On history load,** mark my messages up to that position as `read`, and the rest as `delivered` where a delivery receipt or the 'delivered' state (decided 2026-10-12) is known. Never downgrade a status already higher.
3. **Groups:** keep today's behaviour unless the same source covers them cheaply; say which.
4. **Tests** (the message pipeline), up to 3, in client-core:
   - history load with a known peer read position marks earlier own messages `read`;
   - a later live `displayed` still works;
   - status never goes down.

### Read first
`AGENTS.md`, `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/history.ts`, `packages/xmpp-core/src/stanza/decode.ts`, `packages/xmpp-core/src/core-effect/stanza-router.ts:102`, and `deploy/ejabberd/ejabberd.yml:216-235`.

### Allowed files
`packages/client-core/src/**/*.ts`, `packages/xmpp-core/src/**/*.ts`, `packages/chat-core/src/**/*.ts`, `packages/api-contract/src/**/*.ts`, `apps/server/src/chats/*.ts`, `apps/server/src/xmpp/*.ts`, `work/T-1311-read-ticks-after-restart.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines.
- **The lead's check on the emulator vs live:** after a restart, messages Julio has read show the read ticks.

---

## Report (written by the worker when done)

### What I did

**Source of the peer's read position (spec point 1) — option (b), and no migration.**
The read position already lives on the server: `PUT /api/chats/:jid/read` writes
`chat_reads(user_id, chat_jid, last_read_id)` (`apps/server/src/chats/reads.ts:35-76`,
"T-1207"), and the reader's client sends it from `recordRead`
(`packages/client-core/src/store/reads.ts:39-72`). For a DM the id is the same number on both
sides: ejabberd generates one stanza id per outgoing DM
(`src/mod_mam.erl init_stanza_id`/`mark_stored_msg`, id = `erlang:system_time(microsecond)`),
stamps it `by=<sender>` in the sender's archive and `by=<recipient>` in the recipient's, and the
client's `messageId` picks the `by=<me>` stanza id
(`packages/xmpp-core/src/stanza/resolve-sender.ts:116-132`). So the peer's stored `last_read_id`
compares directly against my own message ids, in the caller's own-message terms — exactly like
`deliveredUntil` (T-1229). I surfaced it as `readUntil` on the `/api/chats` DM entry; no new
table, no migration.

Option **(a) is impossible**: Zilar's `displayed` marker is bodiless
(`packages/xmpp-core/src/stanza/build-outgoing.ts:226-236`), and ejabberd's `mod_mam` only
archives a non-headline message with a non-empty body or subject (or a `<store/>` hint)
(`mod_mam.erl should_archive/2`); so markers never come back in MAM. The history parser also
drops them (`packages/xmpp-core/src/core-effect/stanza-router.ts:27-28` keeps only
`decoded.message`). I confirmed the endpoint path with a test rather than by assertion:
`apps/server/src/chats/read-marks.test.ts` seeds the peer's `chat_reads` row and checks the DM
row carries `readUntil`.

**On history load (point 2).** `applyReadUntil(ctx, chatId, until)`
(`packages/client-core/src/store/reads.ts`) moves my own messages whose archive id is ≤ the mark
to `read` through `advanceStatus`: a later message keeps its status, and `advanceStatus` never
moves a status down (a `delivered`/`read` message at or below the mark stays as high as it was).
`applyChatReadMark(ctx, chatId)` reads the mark from the chat summary. It is applied after a page
lands, in `openHistory` (`packages/client-core/src/store/history.ts:305`) and `loadOlderPage`
(`:172`). The "rest as delivered" part needs nothing new: `applyDeliveredUntil` already applies
`deliveredUntil` from the same rows (`packages/client-core/src/store/delivered.ts:109-139`).

**Groups (point 3).** Unchanged. `readForChats` only looks up `dmPeerUserId`, so a group entry
never gets `readUntil`; the live `displayed` behaviour for groups is untouched. The same
`chat_reads` table holds per-member room marks, so a follow-up could cover groups cheaply
(max over other members), but I kept today's behaviour.

### Files changed (all inside the Allowed files)

- `packages/api-contract/src/chats.ts` — `DmChatEntry.readUntil?` (170 lines).
- `packages/chat-core/src/types.ts` — `ChatSummary.readUntil?` (250 lines).
- `packages/client-core/src/store/chat-rows.ts` — parse `readUntil` into the DM summary; renamed
  the local `deliveredUntilOf` helper to `archiveMarkOf` (now shared by both marks) (347 lines).
- `packages/client-core/src/store/reads.ts` — `applyReadUntil` + `applyChatReadMark` (124 lines).
- `packages/client-core/src/store/history.ts` — apply the mark after a page in `openHistory` and
  `loadOlderPage` (399 lines; I also rewrote `loadOlder`'s guard as a one-liner to stay ≤400).
- `packages/client-core/src/store/read-until.test.ts` (new) — the 3 client-core tests.
- `apps/server/src/chats/reads.ts` — `readForChats` (127 lines).
- `apps/server/src/chats/api.ts` — fetch the peer read marks alongside the delivered marks and set
  `readUntil` on DM entries (399 lines).
- `apps/server/src/chats/read-marks.test.ts` (new) — the endpoint test.
- `work/T-1311-read-ticks-after-restart.md` — this Report.

### Tests (point 4)

`packages/client-core/src/store/read-until.test.ts` (3 tests, the ones the spec lists):
1. history load with a known peer read mark marks my earlier messages `read` and a later one
   untouched;
2. a later live `displayed` still moves a message to `read`;
3. the status never moves down (a `read` message stays `read`, a `delivered` one below the mark
   becomes `read`).

Deviation to flag: I added **one extra test** (`apps/server/src/chats/read-marks.test.ts`) for the
new `/api/chats` field, because the whole feature depends on the server exposing the right mark.
That is 1 server test beyond the "up to 3, in client-core" the spec asked for.

### Commands run (real results)

- `pnpm install` — done (13.5s), only the usual peer-dependency warning.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/read-until.test.ts`
  — 1 file, 3 tests passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/history.test.ts src/store/delivered.test.ts src/store/incoming.test.ts`
  — 3 files, 50 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/read-marks.test.ts`
  — 1 file, 1 test passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/reads.test.ts src/chats/deliveries.test.ts`
  — 2 files, 13 tests passed.
- `pnpm gate` (repo root) — ended with `GATE PASS`. Summary:
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.5s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (0.9s)
  PASS  tests @zilar/client-core  (5.6s)
  PASS  tests @zilar/server  (12.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  The first two gate runs failed on typecheck: (1) my new client test built a `ChatSummary`
  literal without the required `isAI`/`space`/`muted` fields; (2) with `exactOptionalPropertyTypes`
  assigning a `Record` index (possibly `undefined`) straight to `readUntil?: string` was rejected.
  Both fixed (cast the test summary; narrow to a local before assigning).

### Problems / deviations / open questions

- **Known limitation (not in scope but worth knowing):** the mark is applied when a history page
  lands, i.e. when the chat is opened. If a peer reads while I am offline and I reconnect with the
  chat already open (no reopen), the ticks update on the next history load. The acceptance case
  (restart → open the chat → history loads) is covered, and any live `displayed` marker still
  updates immediately. Covering the reconnect-without-reopen path would need the chat-list refresh
  merge to apply `readUntil` too (a `delivered.ts` ↔ `reads.ts` dependency), which I left out to
  keep the change small and cycle-free.
- **AI DMs:** an AI chat entry has no `userId`, so no peer read mark is looked up; its messages
  show `sent` until a live `displayed` (the AI gateway's marker) arrives. Human DMs are the
  acceptance target.
- No migration was needed (the `chat_reads` table already exists).
- Every changed file is ≤400 lines (largest: `apps/server/src/chats/api.ts` and
  `packages/client-core/src/store/history.ts`, both 399).

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (2 nits, 1 follow-up).**
- **Source:** the peer's existing `chat_reads` row (T-1198), returned as `readUntil` on `/api/chats` DM rows. No migration. MAM markers are impossible (bodiless markers aren't archived).
- **The nit about the `::bigint` cast:** checked. Writes have validated `BigInt(messageId)` since the table was created (T-1198 `2ac802f`, T-1205 `5cb61d0`), so the cast can't fail on stored rows. If it ever did, the shared `.catch` keeps the list working without the mark fields.
- **Lead's checks after the rebase:** client-core: 150 tests pass; server `src/chats`: 20 pass; tsc: 0 errors on server, web and mobile. `history.ts` is 399 lines.
- **After the deploy:** call `GET /api/chats` live (it must be 200), and check the read ticks after a restart on the emulator.
