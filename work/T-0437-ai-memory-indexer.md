---
id: T-0437
title: "AI memory M2a (server): the mirror indexer copies an AI chat's archive into ai_memory_messages, incrementally, with corrections and retractions"
status: merged
milestone: M5
branch: task/T-0437-ai-memory-indexer
model: auto
effort: low
depends_on: [T-0433]
estimate: 0.4 day
---

# T-0437: AI memory — mirror indexer

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/ai-memory-plan.md` §3.2 (M2). Memory is automatic: the log is the conversation itself. This task fills `ai_memory_messages` (T-0433) from the ejabberd archive. **No schema change, no gateway wiring** (the gateway is M3).

### Verified facts (do not re-derive)
- **Tables** (T-0433, in `apps/server/src/db/schema.ts`):
  - `aiMemoryMessages`: `aiId`, `chatKey`, `seq`, `messageId`, `at`, `sender`, `text`, `deleted`, `createdAt`; PK (aiId, chatKey, seq); unique (aiId, chatKey, messageId);
  - `aiMemoryNodes`: aiId, chatKey, lo, hi, summary;
  - `aiMemoryState`: aiId, chatKey, `indexedThroughMicros` (default 0), `floorSeq`.
- **The model to copy** is `apps/server/src/media/indexer.ts`:
  - `buildIndexQuery` (lines 281-301): `username = <room>`, or `username = <owner localpart> AND bare_peer = <peer>`, with `timestamp > cursor ORDER BY timestamp ASC LIMIT n`;
  - `indexChat` (lines 308-417): the cursor is read from state and clamped to a 12-month window, one transaction, corrections then retractions then normal rows, and the state upserted at the end;
  - the constants are `MEDIA_INDEX_MAX_ROWS` 5000 and the 12-month window (lines 14-17).
- **Helpers:**
  - `correctionTarget`, `retractTarget` and `stanzaFrom` are in `apps/server/src/search/routes.ts:519,528,133`;
  - `extractMediaItems(row)` (`media/indexer.ts:178`) returns `{ kind: image|file|gif|voice|link, name?, durationMs?, … }` for a row's payload;
  - `ArchivePool` and `ArchiveRow` are in `apps/server/src/search/service.ts`.
- **Whose archive** (plan §3.2):
  - in a DM, the AI's own archive: `username = <AI localpart>` (`ais.localpart`), `bare_peer = <owner bare JID>`;
  - in a room: `username = <room JID>`.
  - The memory `chatKey` is the gateway's key: `dm:<owner bare JID>` (`apps/server/src/agents/gateway.ts:1720`) or `room:<room JID>` (`gateway.ts:1432`).
- **Tests to copy:** `apps/server/src/media/indexer.test.ts`. It has `ARCHIVE_DDL`, a PGlite fake archive, `createTestContext` (line 265) and payload XML helpers.

### What to build
1. **New `apps/server/src/agents/memory/indexer.ts`:** export `indexMemory(input)` with input `{ archive, db, aiId, chatKey, archiveOwner, scope: { kind: 'dm'; peer } | { kind: 'room'; room }, aiBareJid, ownerName?, now }`, returning `{ read, inserted, done }`.
   - **The cursor** comes from `aiMemoryState`, clamped to 12 months. Read at most 5000 rows ascending, all in one transaction. Take `pg_advisory_xact_lock(hashtext(aiId || '|' || chatKey))` first, so two passes never interleave.
   - **A correction** (`correctionTarget`) updates the target row's `text` (to the new body, cut to 1000 chars) and deletes every `aiMemoryNodes` row with `lo <= target.seq < hi`. The correction row itself is not stored.
   - **A retraction** (`retractTarget`) sets the target's `deleted = true` and `text = ''`, and drops the covering nodes the same way. The retraction row is not stored.
   - **Any other row:**
     - **skip it** when its `originId` is already mirrored (the unique key);
     - **text:** the body, trimmed. If `extractMediaItems(row)` finds media, prefix a placeholder: `[image: <name>]`, `[file: <name>]`, `[gif]` or `[voice m:ss]`. A link-only message keeps its body as the text. A sticker payload becomes `[sticker]`.
     - **skip it** if the result is empty;
     - **cut** the text to 1000 chars;
     - **sender:** "AI" when the bare `from` equals `aiBareJid`; else the room nick (`row.nick`) in a room; else `ownerName ?? 'Owner'` in a DM;
     - **seq** = current max seq + 1, assigned in order, so seqs stay dense;
     - **at** comes from the row timestamp (microseconds).
   - **At the end:** upsert `aiMemoryState.indexedThroughMicros` to the last row read.
   - **Never log** bodies.
2. **New `apps/server/src/agents/memory/indexer.test.ts`**, with the PGlite fake archive like `media/indexer.test.ts`:
   - a DM pass mirrors owner and AI messages in order, with dense seqs 0..n-1 and senders "Owner"/name and "AI";
   - a room pass uses nicks;
   - a second pass inserts 0 (cursor), and forcing the cursor back also inserts 0 (unique key);
   - media rows become placeholders, and an empty-body non-media row is skipped;
   - a correction replaces the text and drops a node covering it (insert a fake node first), while a node not covering it stays;
   - a retraction marks the row deleted and blanks its text;
   - rows older than 12 months are ignored;
   - another chat's rows are never mirrored (scope).

### Read first
`AGENTS.md`, `docs/audit/ai-memory-plan.md` §3.1-§3.2, `apps/server/src/media/indexer.ts`, `apps/server/src/media/indexer.test.ts:1-160` and `:260-300`, `apps/server/src/search/routes.ts:130-140` and `:515-535`, `apps/server/src/db/schema.ts` (the four `aiMemory*` tables).

### Allowed files
`apps/server/src/agents/memory/indexer.ts`, `apps/server/src/agents/memory/indexer.test.ts`, `work/T-0437-ai-memory-indexer.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/indexer
pnpm gate
```

### Acceptance
- `indexMemory` mirrors a DM or a room incrementally, with dense seqs, placeholders, corrections and retractions (dropping covering nodes), scoped and bounded.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**

Added `apps/server/src/agents/memory/indexer.ts` with `indexMemory(input)`, mirroring an AI chat's archive into `ai_memory_messages` with the media indexer's shape:

- DM scope is `username = <AI localpart> AND bare_peer = <owner bare JID>`; a room is `username = <room JID>`. The cursor comes from `aiMemoryState`, clamped to a 12-month window, and at most 5 000 rows are read ascending.
- One transaction takes `pg_advisory_xact_lock(hashtext(aiId || '|' || chatKey))` first and reads the cursor inside it, so two passes of one chat never interleave.
- A correction rewrites the target's `text` (cut to 1 000 chars); a retraction sets `deleted = true` and blanks the text. Both drop every `ai_memory_nodes` row with `lo <= target.seq < hi`. Neither edit row is stored.
- A normal row skips an already-mirrored `originId` via the unique key (`onConflictDoNothing`); `seq = max(seq) + 1` is consumed only by an insert that actually happened, so seqs stay dense.
- Text from `extractMediaItems`: `[image: <name>]`, `[file: <name>]`, `[gif]`, `[voice m:ss]`; a link-only message keeps its body; a sticker payload becomes `[sticker]`; an empty result is skipped; everything is cut to 1 000 chars.
- Sender: "AI" when the bare `from` equals `aiBareJid`, else the room nick, else `ownerName ?? 'Owner'`.
- The state upsert moves `indexedThroughMicros` to the last row read. Nothing is logged.

Added `apps/server/src/agents/memory/indexer.test.ts` (10 tests) with the PGlite fake archive copied from `media/indexer.test.ts`: DM order/dense seqs/senders, DM default sender, room nicks, cursor + forced-back dedup, media placeholders + empty-row skip, 1 000-char cut, correction dropping only the covering node, retraction, 12-month window, and other-chat scope.

**Files changed**

- `apps/server/src/agents/memory/indexer.ts` (new)
- `apps/server/src/agents/memory/indexer.test.ts` (new)
- `work/T-0437-ai-memory-indexer.md` (status + this Report)

**Commands and results**

- `pnpm install` — done, 1170 packages added.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/indexer` — 1 test file passed, 10 tests passed.
- `pnpm gate` — `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.

**Notes / deviations**

- `extractMediaItems` is imported from `media/indexer.ts` as the spec lists it under Helpers. Stickers are the one payload kind it drops, so the indexer decodes the agent payload itself (same namespace and XML unescape as the media indexer) to emit `[sticker]`.
- `buildIndexQuery` is a local copy of the media one, since the spec lists it as the model to copy rather than a helper. The scope type is local (`MemoryScope`).

**Open questions**

- None.

## Review (written by Claude)

Approved (lead, 2026-10-06). indexMemory mirrors a DM (AI archive, owner bare_peer) or a room incrementally: an advisory lock per chat, a cursor clamped to 12 months, at most 5000 rows, dense seqs (duplicates consume no seq), placeholders for media, sender AI, nick or owner name, corrections replacing text and retractions blanking it, both dropping the covering nodes. Nothing is logged. Nit, carried to M3: the header comment wrongly says "a retraction always leaves the summaries".
