---
id: T-2062
title: "Reduce (server, batch 3): one 'start the AI turn' step for DM and group turns (scheduled onStart, load the active AI or disconnect and settle offline), one JPEG marker reader for card-media sniff and strip, and one 'reserve a pack slot under the lock' step for sticker upload and the Telegram import — no behaviour change"
status: merged
milestone: M5
branch: task/T-2062-server-clones-three
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2062: Server clones, batch 3

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. The lead's jscpd run (2026-10-18) found three more server blocks copied between two files each. Two of them sit on security-relevant paths (image stripping, AI turn identity), so one copy means one place to get right.

### Facts (read by the lead on 2026-10-18 at `7f39c3adf`)
1. **The turn start.**
   - `apps/server/src/agents/gateway/dm-turn.ts:129-150` (370 lines) and `apps/server/src/agents/gateway/group-turn.ts:112-132` (392 lines) open the same way:
     - call `item.scheduled?.onStart?.()` for each batch item;
     - `loadActiveAi(deps.db, session.aiId)` with defects turned into null;
     - when there is no AI, `disconnectAi(session.aiId)` (defects ignored) and `settle('offline')`.
   - The DM comment adds "The owner JID comes from the database, never from the message". Keep both comments' meaning.
   - `group-turn.ts` is at 392 of the 400-line limit.
   - Other gateway helpers live in `apps/server/src/agents/gateway/` (for example `scheduled-settle.ts` and `turn-defect.ts`).
2. **The JPEG marker read.** `apps/server/src/card-media/sniff.ts:55-71` (168 lines) and `apps/server/src/card-media/strip.ts:120-135` (224 lines) both read one marker:
   - the byte at `offset` must be `0xff`;
   - read the marker at `offset + 1`, advance 2, skip any fill `0xff` bytes;
   - return null on running out of bytes.

   `strip.ts` is the EXIF/metadata stripper, covered by `card-media/strip.test.ts`.
3. **The sticker pack slot.**
   - `apps/server/src/stickers/storage.ts:~195-210` (333 lines) and `apps/server/src/stickers/telegram-store.ts:~64-78` (127 lines) run the same steps in one transaction:
     - `pg_advisory_xact_lock(hashtext(packId))`;
     - count the pack's stickers, and fail `HttpError(400, 'pack_full', …)` at `STICKERS_MAX_PER_PACK`;
     - read the top `position`.
   - Each then does its own INSERT (the Telegram one adds `source_id` and `ON CONFLICT DO NOTHING RETURNING id`). Both then `UPDATE sticker_packs SET updated_at`.

### Steps
1. **The turn start.** Add `apps/server/src/agents/gateway/turn-start.ts` with a `startTurn(deps, session, batch, settle)` Effect. It returns the loaded AI, or `null` after it has disconnected and settled offline. Both turns call it and return on `null`.
2. **The marker reader.** Add `readJpegMarker(bytes, offset): { marker: number; offset: number } | null` to `card-media/sniff.ts`, exported. `strip.ts` imports it. Keep each caller's checks after the marker exactly as they are.
3. **The pack slot.** Add a `reservePackSlot(sql, packId)` Effect in `stickers/storage.ts`, exported. It takes the lock, checks the count and returns the next position. The Telegram store imports it. The INSERTs stay per caller.
4. **Tests.** No new tests. Run the nearest existing ones (Checks).
5. **Size.** Product lines must drop by at least 40. Report the counts. Every file stays at or under 400 lines.

### Allowed files
- `apps/server/src/agents/gateway/turn-start.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/card-media/sniff.ts`
- `apps/server/src/card-media/strip.ts`
- `apps/server/src/stickers/storage.ts`
- `apps/server/src/stickers/telegram-store.ts`
- `work/T-2062-server-clones-three.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts src/card-media/strip.test.ts src/card-media/service.test.ts src/stickers/api-upload.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines are at least 40 lower.

---

## Report (written by the worker when done)

### What I did

- **Turn start.** Added `apps/server/src/agents/gateway/turn-start.ts` with
  `startTurn(deps, session, batch, settle)`. It runs each item's
  `scheduled.onStart`, loads the active AI with defects as `null`, and on
  `null` disconnects (defects ignored) and settles `offline`. Both
  `dm-turn.ts` and `group-turn.ts` call it and return on `null`; the
  scheduled-timeout comment and the owner-JID / gateway-AI-id comment moved
  into the helper.
- **JPEG marker.** Added exported `readJpegMarker(bytes, offset)` in
  `card-media/sniff.ts`; the sniffer uses it and `strip.ts` imports it. Each
  caller keeps its own checks after the marker (`strip.ts` still records
  `start` before the read and still rejects `marker === 0x00`).
- **Pack slot.** Added exported `reservePackSlot(sql, packId)` in
  `stickers/storage.ts`: advisory lock, count with `pack_full`, top position,
  returns the next position. `uploadSticker` uses it and `telegram-store.ts`
  imports it; each caller keeps its own INSERT and `updated_at` update
  (`telegram-store` keeps `source_id` + `ON CONFLICT DO NOTHING RETURNING`).
- No new tests, per the spec.

Files changed: the seven files in Allowed files (six product files plus the new
`turn-start.ts`).

Line counts (`wc -l`, product files):

| file | before | after |
| --- | --- | --- |
| `agents/gateway/dm-turn.ts` | 370 | 355 |
| `agents/gateway/group-turn.ts` | 392 | 378 |
| `agents/gateway/turn-start.ts` (new) | 0 | 35 |
| `card-media/sniff.ts` | 168 | 176 |
| `card-media/strip.ts` | 224 | 213 |
| `stickers/storage.ts` | 333 | 337 |
| `stickers/telegram-store.ts` | 127 | 112 |
| **total** | **1614** | **1606** |

### Checks run

- `pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts src/card-media/strip.test.ts src/card-media/service.test.ts src/stickers/api-upload.test.ts --reporter=dot`
  — **35 passed, 2 failed** (`gateway-group.test.ts`, "smart wake rules
  (T-1633)"): both fail in `openRoom` at `waitFor(() => core.joined.length === 1)`
  (5 s timeout), i.e. the room join never completes. I stashed all product
  changes and reran the same file on the base tree: the same two tests failed
  identically, so this is pre-existing/environmental (shared machine), not
  caused by this change.
- `pnpm gate` — **GATE PASS**:
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The gate's own nearest-test run passed (including the gateway folder); the
  standalone six-file run above is the only red result.

### Notes for the lead

- **Size target.** The net `wc -l` across the seven touched files is
  **1614 → 1606, i.e. −8**, not −40. The six original files alone drop 43
  (100 deleted, 57 inserted) because the two copies of each block are now one;
  the new shared `turn-start.ts` adds 35 lines. The three helper bodies plus
  call sites cost 92 lines against the 100 duplicated lines removed, so a net
  −40 is not reachable with these three extractions unless the helpers were
  made unreadably terse. I kept the code readable and left this note instead of
  forcing the number.
- **Behaviour.** No logic changed: same order (onStart, load AI, disconnect,
  settle), same defect handling, same post-marker checks, same lock/check/insert
  order inside the transaction.
- The "smart wake rules" failures in the direct six-file run reproduce on base;
  the gate's nearest-test run passes. Worth a rerun on a quieter machine.

### Round (fix round, 2026-10-18)

Findings in `PREREVIEW.md`: 0 must-fix, 1 should-fix (the size target).
**Not fixed: it needs a decision I cannot make, so the task is blocked.**

- **Finding 1 — size target.** I agree with the finding, and I measured the
  claim instead of repeating it. I wrote the tightest versions of the three
  helpers I would still call readable (inline `deps` type instead of the
  `TurnStartDeps` interface, an 11-line `readJpegMarker` without the
  fill-byte braces, single-line caller returns, one-line SQL in
  `reservePackSlot`), ran `prettier --write` on them and counted:
  **1595 total, i.e. −19** against 1614 — still 21 lines short of −40.
  I then reverted those scratch edits, so the branch's product code is
  byte-for-byte what the prereview verified.
- **Tests added:** none. No behaviour changed in this round and the finding
  names no test. The existing tests were not rerun separately because no
  product file changed; `pnpm gate` ran the nearest suites.
- **Gate on the unchanged tree** (only this task file differs):
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  PASS  build @zilar/server
  PASS  tests @zilar/server
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Blocked / needs a decision

The acceptance criterion "Product lines are at least 40 lower" cannot be met
inside the Allowed files without deleting unrelated comments or real code.
The two copies of each extracted block are ~100 lines including their
comments; the three readable helpers plus their call sites cost 92, so the net
is −8 (1614 → 1606). My best-effort rewrite reaches −19, not −40. Nothing is
behaviourally at stake; this is a number in the Spec.

The lead needs to pick one:

1. **Waive the number** and accept −8 (or the −43 measured over the six
   existing product files, if the new `turn-start.ts` is not counted — that
   exclusion is the lead's call, not mine).
2. **Reshape the task** around a larger or different set of duplicated blocks
   with a reachable target.

I did not force the number with unreadable code and did not edit the Spec, so
the task stays blocked until one of those is chosen.

### Disagreements

None. Finding 1 is correct as written.


## Review (written by Claude)

Approved, with the size target waived by the lead.
- **What changed.** One copy each of:
  - `startTurn` (`gateway/turn-start.ts`, for DM and group turns);
  - `readJpegMarker` (card-media sniff and strip);
  - `reservePackSlot` (sticker upload and Telegram import).
- **Size.** −8 product lines, not the −40 the lead estimated. The worker blocked rather than write unreadable code to hit the number, which was the right call. The value is a single copy of the identity check in the AI turn start and of the JPEG parser the EXIF stripper relies on.
- **Pre-review.** Order and behaviour were verified unchanged, and the gate passed (the turn, card-media and sticker tests).
