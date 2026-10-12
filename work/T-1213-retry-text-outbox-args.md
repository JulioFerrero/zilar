---
id: T-1213
title: "URGENT: main does not typecheck — retry-text.ts (T-1196) calls outboxFailed with the old 8-argument shape after T-1197 changed it to (ctx, …, replyToText, …); fix the three calls and add a test that a retried text is tracked by the outbox"
status: merged
milestone: M5
branch: task/T-1213-retry-text-outbox-args
model: auto
effort: default
depends_on: [T-1196, T-1197]
estimate: 0.1 day
---

# T-1213: Fix the retryText outbox calls

## Spec (written by Claude, do not edit)

### Why
T-1196 and T-1197 each passed their own gate, but together they break main. `pnpm --filter @zilar/client-core exec tsc --noEmit -p tsconfig.json` on main gives:
```
src/store/send/retry-text.ts(85,7): error TS2554: Expected 9 arguments, but got 8.
src/store/send/retry-text.ts(109,13): error TS2554: Expected 9 arguments, but got 8.
src/store/send/retry-text.ts(125,13): error TS2554: Expected 9 arguments, but got 8.
```
- **The signature moved:** T-1197 changed `outboxFailed` to `(ctx: SendCtx, chatId, localId, text, replyToId, replyToText, mentions, stanzaId, now)` (`packages/client-core/src/store/send/outbox.ts:59-69`).
- **The callers kept the old shape:** `retry-text.ts:85,109,125` still pass `ctx.outbox` first and no `replyToText`, so every argument after `replyToId` shifts by one.
- **At runtime:** a retried text gets no outbox entry and can stay `sending`.
- **The correct shape:** the three calls in `packages/client-core/src/store/send/text.ts:53,103,122` (`ctx, chatId, localId, trimmed, wireReply?.id, wireReply?.text, mentions, sent.id, now`).

### What to build
1. **Fix the three calls** in `packages/client-core/src/store/send/retry-text.ts` to the new shape:
   - pass `ctx`;
   - pass the reply's quote text as `replyToText`, the way `retryTextOptions` already reads `replyTo.text`;
   - keep `mentions`, `stanzaId` and `now` in their places.
2. **Test** (the message pipeline), 1, in `packages/client-core/src/store/send.test.ts`, next to the T-1196 `retryText` test: after `retryText`, the outbox holds an entry for that message, and the core's `acked` event for its stanza id turns the bubble `sent`.
3. **Confirm the typecheck:** `pnpm --filter @zilar/client-core exec tsc --noEmit -p tsconfig.json` prints nothing. Paste the result into the Report.

### Read first
`AGENTS.md`, `packages/client-core/src/store/send/outbox.ts:55-110`, `packages/client-core/src/store/send/retry-text.ts` and `packages/client-core/src/store/send/text.ts:40-130`.

### Allowed files
`packages/client-core/src/store/send/retry-text.ts`, `packages/client-core/src/store/send.test.ts`, `work/T-1213-retry-text-outbox-args.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/send.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and the client-core typecheck is clean.

---

## Report (written by the worker when done)

- Fixed the three `outboxFailed` calls in `packages/client-core/src/store/send/retry-text.ts` (lines 85, 109, 125) to the new 9-argument shape: pass `ctx` instead of `ctx.outbox`, and insert `options?.replyTo?.text` as `replyToText` (matching `retryTextOptions`, which already carries `replyTo.text` through). `mentions`, `stanzaId` (`undefined` / `sent.id` / `undefined`) and `now` are in their correct places, mirroring `text.ts:53,103,122`.
- Added test `retryText tracks the retried text in the outbox until its ack` in `packages/client-core/src/store/send.test.ts` next to the T-1196 retry test: fails a text via outbox caps, retries with the network back, asserts the outbox holds the entry with `stanzaId 'srv-retry'`, then `ackText(ctx, 'srv-retry')` flips the bubble to `sent`.
- Commands and real results:
  - `pnpm install`: done, 11.7s.
  - `pnpm --filter @zilar/client-core exec tsc --noEmit -p tsconfig.json`: clean, no output, exit 0.
  - `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/send.test.ts`: 1 file passed, 23 tests passed.
  - `pnpm gate`: GATE PASS — PASS install (frozen), format, lint, typecheck, effect, tests @zilar/client-core; scope: every changed file is inside the Allowed files; 3 changed file(s) against main.
- Security checklist: no secrets/tokens touched; no deletes/updates; no caps/uniqueness changed; no permission checks involved; no routes added; no audit entries. No deviations from the spec.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit.**
- **The fix:** the three `outboxFailed` calls in `retry-text.ts` now use T-1197's shape: `ctx` first, `replyToText` passed, and the later arguments back in place.
- **The test:** a retried text is tracked by the outbox, and its `acked` event marks it `sent`.
- **Lead's checks on the branch:** the client-core `tsc` gives 0 errors, and client-core send passes 23 of 23.
- **This is the first merge with the gate back on.**
