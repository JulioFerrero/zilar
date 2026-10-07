---
id: T-0493
title: "Effect convert: push delivery pipeline (device lookup, MAM-race retry, send, mark) in Effect, handleIncomingPush unchanged"
status: todo
milestone: M5
branch: task/T-0493-effect-push-service
model: auto
effort: low
depends_on: [T-0173]
estimate: 0.4 day
---

# T-0493: the push delivery pipeline in Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "all the codebase to be effect 4.0", "nothing of new features". `docs/ROADMAP_EFFECT.md` names push as a candidate area. This task converts the delivery pipeline under `docs/EFFECT_GUIDE.md`:
- Effect inside, the Promise export at the edge;
- **behaviour stays the same, and existing tests pass unchanged**.

zod and drizzle stay as they are here; the T-0490 plan decides those layers later.

### Verified facts (do not re-derive)
- **The file:** `apps/server/src/push/service.ts` (491 lines).
- **Exports:** `PushLogger`, `PushServiceDeps` (with the `recentlyNotified` per-node dedupe map), `PushOutcome` (`sent`, `dropped` with reasons, `unknown-device`), and `handleIncomingPush(deps, notification): Promise<PushOutcome>` (line 86).
- **The contract** (comment at lines 81-85): it **never throws**. Every failure becomes an outcome and is logged with ids only, never message text or endpoint URLs.
- **The flow:**
  1. `handleIncomingPush` (lines 86-99): `deviceByNode` → `resolveAndSend` → `markDeviceUsed` on `sent`.
  2. `resolveAndSend` (from line 101): `openDevice` (a throw gives `undecryptable`), then `newestMessageForUser` (a throw gives `archive-unavailable`), then the mute/hidden/duplicate/no-message outcomes, then `sendPayload`.
     - A failed send gives `send-failed` and is **not** marked notified.
     - A successful send is marked with `markNotified` (lines 171-175).
  3. `sendPayload` (from line 178): `deps.sender.send`. If the result is `gone`, it removes the device. A throw runs `markDeviceFailed` and logs ids only.
  4. **The MAM-race retry:** `newestMessageForUser` loops `ARCHIVE_LOOKUP_ATTEMPTS = 3` times with `sleep(ARCHIVE_LOOKUP_RETRY_MS = 300)` between reads (lines 246-282; the constants are at lines 66-68; `sleep` is at line 489). A muted or hidden verdict is "sticky" and stops the retries.
- **Importer:** `apps/server/src/push/component.ts`. **Tests:** `apps/server/src/push/service.test.ts`. The other `push/*.test.ts` files cover the other modules.
- **The references:** `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/web-tools/guarded-fetch.ts` (T-0484, merged) and `apps/server/src/sandbox/run-tool.ts` (T-0489, merged) as worked v4 examples. Use `Effect.sleep`, or a `Schedule` with a fixed spacing and a recurrence limit, for the retry.

### What to build
1. **The flow becomes Effect functions** (`Effect.fnUntraced`):
   - typed internal errors for undecryptable, archive unavailable and send failed;
   - the archive retry as an explicit loop with `Effect.sleep`, **or** `Effect.repeat` / `retry` with a `Schedule`. Either way it keeps exactly 3 reads, a 300 ms spacing and the sticky stop;
   - the DB calls (drizzle) wrapped in `Effect.tryPromise`.
   
   **`handleIncomingPush` stays an `async` Promise function that never throws.** It runs the program with `Effect.runPromise` and maps each typed error to today's outcome and log.
2. **Byte-identical behaviour:** the outcomes, the log lines (fields and messages), the `recentlyNotified` updates, and `markDeviceUsed` / `markDeviceFailed` / `removeDeviceByNode`, all in the same order.
3. **Exports:** every export keeps its name, type and signature.
4. **Tests:** the existing tests pass **unchanged**. You may add `apps/server/src/push/service.effect.test.ts`.
5. **Report:** give the line counts before and after.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/web-tools/guarded-fetch.ts`, `apps/server/src/push/service.ts`, `apps/server/src/push/service.test.ts`.

### Allowed files
`apps/server/src/push/service.ts`, `apps/server/src/push/service.effect.test.ts`, `work/T-0493-effect-push-service.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot push/service
pnpm gate
```

### Acceptance
- The push delivery pipeline runs on Effect inside.
- `handleIncomingPush` keeps its signature and never throws.
- Outcomes and logs are identical.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
