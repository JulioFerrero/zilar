---
id: T-2064
title: "Reduce (client-core, message pipeline): applyDeliveredUntil and applyReadUntil share one applyStatusUntil(ctx, chatId, until, status), and the seven copies of 'the reply quote's wire id' in the send pipeline become one wireReply(ctx, replyTo) helper — no behaviour change, existing pipeline tests prove it"
status: merged
milestone: M5
branch: task/T-2064-core-status-and-wire-reply
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2064: One status-mark walk, one wire-reply helper

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. The lead's jscpd run (2026-10-18) found two client-core copies on the message pipeline:
- the delivered and read mark walks are the same 30 lines;
- the reply-quote wire id is built the same way 7 times.

### Facts (read by the lead on 2026-10-18 at `de4bdaa03`)
- **The two walks.**
  - `applyDeliveredUntil(ctx, chatId, until)` is at `packages/client-core/src/store/delivered.ts:109-138` (181 lines).
  - `applyReadUntil(ctx, chatId, until)` is at `packages/client-core/src/store/reads.ts:82-111` (124 lines). `reads.ts` already imports `archiveIdOf` and `compareArchiveIds` from `./delivered` (`:12`).
  - The two bodies are identical except for the target status (`'delivered'` against `'read'`) passed to `advanceStatus`: the archive-id check, my messages at or below the mark, `changed` tracking, then one `ctx.set`.
- **The wire reply.** `replyTo === undefined ? undefined : { ...replyTo, id: ctx.k.wireTargetFor(replyTo.id) ?? replyTo.id }` appears at:
  - `packages/client-core/src/store/send/attachment.ts:69-72` and `:177-180`;
  - `send/sticker.ts:31-34` and `:108-111`;
  - `send/text.ts:27-30`;
  - `send/voice.ts:46-49` and `:149-152`.

  `send/retry-text.ts:21` has a different shape, so leave it. `send/context.ts` (143 lines) holds the shared send helpers.
- **Tests.** The existing ones are `packages/client-core/src/store/delivered.test.ts`, `read-until.test.ts` and `send.test.ts`.

### Steps
1. **The walk.** Add `applyStatusUntil(ctx, chatId, until, status: 'delivered' | 'read')` in `delivered.ts`. `applyDeliveredUntil` and `applyReadUntil` keep their names, exports and doc comments, and each becomes a one-line call.
2. **The wire reply.** Add `wireReply(ctx, replyTo)` to `send/context.ts`, keeping the comment about the origin id in a DM and the room stanza-id in a group. Replace the 7 copies.
3. **Tests.** No new tests. The three test files must pass unchanged.
4. **Size.** Product lines must drop by at least 30. Report the counts.

### Allowed files
- `packages/client-core/src/store/delivered.ts`
- `packages/client-core/src/store/reads.ts`
- `packages/client-core/src/store/send/context.ts`
- `packages/client-core/src/store/send/attachment.ts`
- `packages/client-core/src/store/send/sticker.ts`
- `packages/client-core/src/store/send/text.ts`
- `packages/client-core/src/store/send/voice.ts`
- `work/T-2064-core-status-and-wire-reply.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/delivered.test.ts src/store/read-until.test.ts src/store/send.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass unchanged, and the gate passes.
- Product lines are at least 30 lower.

---

## Report (written by the worker when done)

### What I did

- Added `applyStatusUntil(ctx, chatId, until, status: 'delivered' | 'read')` in
  `store/delivered.ts` holding the shared archive-id walk (non-numeric mark
  ignored, only my messages at or below the mark, one `ctx.set`).
  `applyDeliveredUntil` keeps its name, export and doc comment and is now a
  one-line call; `applyReadUntil` in `store/reads.ts` does the same and drops
  its now-unused `archiveIdOf` / `compareArchiveIds` / `advanceStatus` imports.
- Added `wireReply(ctx, replyTo)` to `store/send/context.ts`, keeping the
  comment about the origin id in a DM and the room stanza-id in a group, and
  exported it beside the other send helpers.
- Replaced the seven copies in `send/attachment.ts` (two), `send/sticker.ts`
  (two), `send/text.ts` (one) and `send/voice.ts` (two). `send/retry-text.ts`
  was left alone as specified. Local variables that held the result are named
  `quote` because the helper is now called `wireReply` (a local of the same
  name would shadow the import in its own initializer).
- No tests added or changed. No dependencies added.

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/delivered.test.ts src/store/read-until.test.ts src/store/send.test.ts`
  → 3 test files passed, 44 tests passed.
- `pnpm gate` (from the repo root), summary lines:

  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.4s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.4s)
  PASS  effect  (1.3s)
  PASS  build @zilar/server  (0.7s)
  PASS  tests @zilar/client-core  (13.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

  The first gate run failed only on `format` (two files); `prettier --write` on
  `send/attachment.ts` and `send/voice.ts` fixed it, and the rerun above passed.
- Size: the seven product files are `66 insertions(+), 109 deletions(-)`, a net
  drop of 43 lines (spec required at least 30).

### Notes for the lead

- `applyStatusUntil` is exported from `delivered.ts` but not added to any
  barrel, matching how the local helpers in `reads.ts` are kept private; the
  gate's file scope did not need one.
- No behaviour change intended: the shared walk calls `advanceStatus` with the
  same per-mark status as before, and `wireReply` is the same expression with
  the same fallback.


## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** `applyStatusUntil` drives both the delivered and read walks, and `wireReply` replaces the 7 copies in the send pipeline.
- **Size.** −43 product lines.
- **Tests.** `delivered.test.ts`, `read-until.test.ts` and `send.test.ts` pass unchanged, which proves no behaviour change on the message pipeline.
