---
id: T-1400
title: "AI progress cards never notify: one server rule (notify/ai-cards.ts) makes push, unread counts and the chat-list preview skip AI progress rows and their corrections and retractions"
status: merged
milestone: M5
branch: task/T-1400-ai-cards-never-notify
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1400: AI progress cards never notify

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: AI work "needs to happen in the background and dont spam in the chat". The audit `docs/audit/agent-ux-plan.md` (merged) found:
- **Every progress stage of an AI turn notifies,** pushes and bumps the unread badge (§1.2).
- **The cleanup retraction makes it worse:** it turns the chat-list preview into the fallback sentence "…attempted to retract a previous message…".

This task is the audit's **Task A** (§3). Read §1.2, §1.5, §2.3 and Task A.

### Facts (from the audit; the lead re-checked the anchors on main, 2026-10-14)
- **The progress message is stored:**
  - it's sent with a body and an `<agent>` payload of `type: 'progress'` (`apps/server/src/agents/gateway/live.ts:88-96`);
  - later stages are corrections (`:100`);
  - the end is a retraction (`:118-134`).
- **Push:** `resolveCandidate` skips only an empty origin id, a retraction row and a body-less reaction (`apps/server/src/push/candidates.ts:28-43`). The group notifier uses the same resolver (`apps/server/src/push/group-notifier.ts:144`).
- **Unread and preview:** `summarizeUnread` counts every non-own row after the read mark and takes the newest as the preview (`apps/server/src/chats/unread.ts:240-288`); `labelForRow` is at `:60-79`.
- **The `<agent>` payload regex is duplicated** in `apps/server/src/media/extract.ts:8-12` and `apps/server/src/agents/memory/indexer.ts:55-59`.
- **Correction targets** are read in `apps/server/src/search/snippet.ts:81` (`correctionTarget`).

### What to build
1. **New `apps/server/src/notify/ai-cards.ts`:** `isLiveAiUiRow(xml)` returns true for a row whose `<agent>` payload is `type: 'progress'`. Move the shared `<agent>` decoding there, and have `media/extract.ts` and `agents/memory/indexer.ts` import it. Also expose a helper that lets a reader skip a correction or retraction row whose **target** id belongs to a live-UI row, using the targets the reader already has in the batch.
2. **Push:** `resolveCandidate` returns `skip` for a live-UI row, and for a correction or retraction of one (`push/candidates.ts:28-43`). This covers the per-device scan and the group notifier.
3. **Unread and preview:** `summarizeUnread` neither counts live-UI rows nor uses them as the preview, nor their corrections or retractions. It keeps walking back to the newest real message (`chats/unread.ts:240-288`). So a turn that only posted a card leaves the badge and preview alone until the answer arrives.
4. **The memory indexer and the media extractor** skip live-UI rows (`agents/memory/indexer.ts:105-115`, `media/extract.ts:117-157`). Archive search stays as it is.
5. **No client changes and no protocol changes.** The card's look and the tombstone are later tasks.

### Tests (message pipeline: required, keep them few)
- Extend `apps/server/src/push/candidates.test.ts`: a progress row → skip; a correction of a progress row → skip; a normal AI message → ok.
- Extend `apps/server/src/chats/unread.test.ts`: progress row plus correction plus retraction plus a final answer → unread 1, and the preview is the answer; only a progress row → unread 0, preview unchanged.
- New `apps/server/src/notify/ai-cards.test.ts`: the decoder on a progress row, a normal message and a body-less reaction.

### Read first
`AGENTS.md`, `docs/audit/agent-ux-plan.md` (§1.2, §1.5, §2.3, Task A), and the files above.

### Allowed files
`apps/server/src/notify/ai-cards.ts`, `apps/server/src/notify/ai-cards.test.ts`, `apps/server/src/push/candidates.ts`, `apps/server/src/push/candidates.test.ts`, `apps/server/src/push/group-notifier.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api-preview.test.ts`, `apps/server/src/chats/unread.ts` (381 lines today: put new logic in `apps/server/src/chats/unread-skip.ts` if it would pass 400), `apps/server/src/chats/unread-skip.ts`, `apps/server/src/chats/unread.test.ts`, `apps/server/src/agents/memory/indexer.ts`, `apps/server/src/media/extract.ts`, `work/T-1400-ai-cards-never-notify.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/notify/ai-cards.test.ts src/push/candidates.test.ts src/chats/unread.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; files stay at most 400 lines.
- The tests above pass.
- **Live after the deploy:** an AI turn with a web search leaves the chat's unread badge and preview alone until the answer, and sends one push (for the answer).

---

## Report (written by the worker when done)

Status: review. Branch `task/T-1400-ai-cards-never-notify`.

### What I did

**New `apps/server/src/notify/ai-cards.ts`** (73 lines): the one live-AI-UI rule.
- `decodeAgentPayload(xml)` — the shared `<agent>` decoder, moved out of
  `media/extract.ts` and `agents/memory/indexer.ts` (their duplicated regex +
  entity unescape are gone).
- `isLiveAiUiRow(xml)` — true for an `<agent>` payload of `type: 'progress'`.
- `cardEditTarget(xml)` — the target id of a correction (`search/snippet.ts:81`)
  or retraction (`:90`), else null.
- `isLiveAiUiEdit(xml, liveIds)` — true when a correction/retraction edits a
  live-UI row whose origin id the reader read in the same batch.
- `liveAiUiIds(rows)` — the batch's live-UI origin ids.

**Push** (`push/candidates.ts`): `resolveCandidate` returns `skip` for a card and
for a card edit, next to the existing skips. A new optional `liveIds` argument
(default empty set) carries the batch. `push/archive-scan.ts` computes
`liveAiUiIds(rows)` per read and passes it; `push/group-notifier.ts` computes it
per page and threads it through `notifyRow`/`notifyMemberForRow`. This covers the
per-device scan and the polled group notifier, as the spec asks.

**Unread and preview** (`chats/unread.ts`, new `chats/unread-skip.ts`):
`summarizeUnread` skips cards and card edits for both the count and the preview,
so it keeps walking to the newest real row. A turn that only posted a card leaves
an empty entry (badge and preview unchanged). `unread.ts` was 381 lines, so the
two new decisions live in `chats/unread-skip.ts` (`skipUnreadRow`,
`newestUnskippedRow`) and `unread.ts` ends at 399 lines.

**Memory indexer and media extractor**: `memoryText` returns `''` for a card
(skipped, like the existing empty-text path) and `extractMediaItems` returns `[]`
for one. Archive search is untouched.

No client or protocol changes.

### Deviations from the spec (and why)

1. **`buildNewestQuery` now reads up to 25 rows per chat instead of 1.** The
   fallback read below the read mark is what supplies the preview for a chat whose
   only post-mark rows are cards; with `LIMIT 1` it returned the card and the
   stage text still became the preview. `newestUnskippedRow` walks the 25 and
   picks the newest real row (the previous message), which is exactly "leaves the
   preview alone until the answer arrives". The constant is `NEWEST_SCAN_ROWS`.
2. **`resolveCandidate` gained an optional 5th parameter.** `push/api-handlers.ts`
   (the push-preview route) also calls `resolveCandidate` and is **not** in the
   Allowed files; the optional parameter keeps it compiling and still skips the
   card itself there. Only correction/retraction-of-card skips need the batch, and
   that route passes none.

### Problems

- First `pnpm gate` failed `format` on `apps/server/src/push/candidates.test.ts`
  (the added tests). I ran `pnpm exec prettier --write` on that one file and reran;
  the second gate passed. No other file needed formatting.
- My first draft of the candidates progress-row test used `"ai":"ana"`, which
  `ProgressSchema` (a JID field) rejects, so the row did not decode as a card and
  the test failed. Fixed the fixture to a full JID; not a code bug.

### Tests run (real results)

- `pnpm --filter @zilar/server exec vitest run src/notify/ai-cards.test.ts src/push/candidates.test.ts src/chats/unread.test.ts --reporter=dot --maxWorkers=2`
  → `Test Files 3 passed (3)`, `Tests 27 passed (27)`.
  New: `notify/ai-cards.test.ts` (progress row, XML-escaped payload, normal
  message, body-less reaction, card-edit targeting); `push/candidates.test.ts`
  (+3: card → skip, correction of a card → skip, normal AI message → ok);
  `chats/unread.test.ts` (+3: card + edit + retraction + answer → unread 1 and the
  answer previews; a lone card → no entry/unread 0; the fallback walk-back picks
  the newest real row).
- `pnpm --filter @zilar/server exec vitest run src/push/group-notifier.test.ts src/push/component.test.ts src/push/api-preview.test.ts --reporter=dot --maxWorkers=2`
  → `Test Files 3 passed (3)`, `Tests 13 passed (13)` (regression check for the
  pushed scan, group notifier and preview route).

### `pnpm gate` (from the repo root)

```
gate: 12 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.3s)
PASS  lint  (0.9s)
PASS  typecheck  (3.3s)
PASS  effect  (0.8s)
PASS  tests @zilar/server  (34.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Files changed (all inside Allowed files)

`apps/server/src/notify/ai-cards.ts` (new), `apps/server/src/notify/ai-cards.test.ts`
(new), `apps/server/src/chats/unread-skip.ts` (new), `apps/server/src/chats/unread.ts`,
`apps/server/src/chats/unread.test.ts`, `apps/server/src/push/candidates.ts`,
`apps/server/src/push/candidates.test.ts`, `apps/server/src/push/group-notifier.ts`,
`apps/server/src/push/archive-scan.ts`, `apps/server/src/agents/memory/indexer.ts`,
`apps/server/src/media/extract.ts`, `work/T-1400-ai-cards-never-notify.md`.

### Open questions / not verified here

- The live acceptance ("an AI turn with a web search leaves the badge and preview
  alone and sends one push for the answer") needs a deploy plus the web `?mock=1`
  Dev-AI thread or the emulator mock build; I could not run it in this worktree.
  The unit tests cover the server rule end to end at the resolver and summariser
  level.

### Fix round 1

Pre-review items, one commit each.

**Item 1 — explicit fallback row order.**
- `apps/server/src/chats/unread.ts`: the fallback preview query now ends
  `ORDER BY scope.chat_jid, newest.timestamp DESC`, so the rows arrive per chat,
  newest first, independent of Postgres' own order.
- `apps/server/src/chats/unread-skip.ts`: `newestUnskippedRow` no longer assumes
  the input order — it sorts by archive timestamp (descending) first. `UnreadSkipRow`
  gained `timestamp`; a `toMicros` helper normalises the string/number/bigint the
  archive returns.
- `apps/server/src/chats/unread.test.ts`: the walk-back test now feeds rows out of
  order with distinct timestamps and asserts the newest real row wins.
- `unread.ts` is exactly 400 lines (the cap). Command:
  `pnpm --filter @zilar/server exec vitest run src/chats/unread.test.ts src/notify/ai-cards.test.ts --reporter=dot --maxWorkers=2`
  → `Test Files 2 passed (2)`, `Tests 11 passed (11)`.

**Item 2 — the preview route skips cards and card edits.**
- `apps/server/src/push/api-handlers.ts`: after reading the row by `messageId`,
  when `cardEditTarget(row.xml)` names a target the route reads that target row
  (same scope) and, if it is live AI UI, passes its id to `resolveCandidate`, which
  then skips the edit. The card itself is already skipped by `resolveCandidate`.
- `apps/server/src/push/api-preview.test.ts` (the existing route test): a new case
  seeds a card, a correction, a retraction and a real answer; the first three answer
  404 and the answer previews. Command:
  `pnpm --filter @zilar/server exec vitest run src/push/api-preview.test.ts --reporter=dot --maxWorkers=2`
  → `Test Files 1 passed (1)`, `Tests 7 passed (7)`.
- `api-handlers.ts` is 399 lines (under the cap).
- Both files were added to the task's Allowed files as the review asked.

Spec test command after both items:
`pnpm --filter @zilar/server exec vitest run src/notify/ai-cards.test.ts src/push/candidates.test.ts src/chats/unread.test.ts --reporter=dot`
→ `Test Files 3 passed (3)`, `Tests 27 passed (27)`.

`pnpm gate` after both items:

```
gate: 14 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.4s)
PASS  lint  (0.7s)
PASS  typecheck  (2.8s)
PASS  effect  (0.6s)
PASS  tests @zilar/server  (27.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)
Lead, 2026-10-14: approved after fix round 1 (outer order on the fallback preview; the push preview route skips cards and card edits). Re-review CLEAN, nit 2 (liveIds built per page, not per chat; harmless because message ids are unique UUIDs. The retract leg of the preview test also passes via the older retraction rule). Server-only. Live check once AI replies are on (after T-1399 and the gateway flip): an AI turn with a web search leaves the badge and preview alone until the answer.
