---
id: T-0493
title: "Effect convert: push delivery pipeline (device lookup, MAM-race retry, send, mark) in Effect, handleIncomingPush unchanged"
status: merged
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

### What I did
- Converted the delivery pipeline in `apps/server/src/push/service.ts` to Effect 4 inside, `Promise` at the edge:
  - `resolveAndSend` → `resolveAndSendEffect`, `sendPayload` → `sendPayloadEffect`, `newestMessageForUser` → `newestMessageForUserEffect` (all `Effect.fnUntraced`).
  - Added private typed errors `Undecryptable`, `ArchiveUnavailable`, `SendFailed` (they never leave the module).
  - The archive retry is an explicit loop: exactly 3 reads, `Effect.sleep(Duration.millis(300))` between reads, sticky muted/hidden stop, unchanged.
  - `openDevice` lifted with `Effect.try` → `Undecryptable`; the archive read and `resolveCandidate` lifted with `Effect.tryPromise` → `ArchiveUnavailable` (the old `try/catch` around `newestMessageForUser` turned any throw from those into `archive-unavailable`).
  - `sender.send` and the `gone` cleanup share one `tryPromise`, exactly like the old `try`; a throw runs `markDeviceFailed` and then fails `SendFailed`.
  - `handleIncomingPush` is still `async … Promise<PushOutcome>` and never throws: it runs `Effect.runPromise` and maps the three typed errors with `Effect.catchTags` to the same dropped outcomes and warn logs (ids only). `deviceByNode` / `markDeviceUsed` stay at the edge as before.
  - Removed the now-unused `sleep` helper.
- No export's name, type or signature changed; `service.test.ts` is untouched.

### Deviation worth flagging
Spec bullet "the DB calls (drizzle) wrapped in `Effect.tryPromise`": inside the archive-lookup contract I used `Effect.tryPromise` (→ `ArchiveUnavailable`) because the old code caught any throw from that whole step. For calls whose old behaviour was to reject (`showPreviewsForUser`, `markDeviceFailed`) I used `Effect.promise` via `awaitDb`, matching `docs/EFFECT_GUIDE.md` ("DB failures stay defects … never double-wrap"). Mapping those to a typed error would have changed behaviour. `deviceByNode` / `markDeviceUsed` stay plain awaits at the boundary, as before.

### Line counts
- `apps/server/src/push/service.ts`: 491 → 533 lines.

### Tests
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot push/service` → `Test Files 1 passed (1)`, `Tests 20 passed (20)`.
- I did not add `service.effect.test.ts` (optional in the spec): the existing suite already covers the retry race (`reads === 3`), per-node dedupe, undecryptable, archive-down and send-fail paths.

### Gate
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (6.7s)
PASS  format  (85.4s)
PASS  lint  (1.9s)
PASS  typecheck  (50.4s)
PASS  tests @zilar/server  (39.8s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Files changed
- `apps/server/src/push/service.ts`
- `work/T-0493-effect-push-service.md`

### Open questions
None.

### Round (fix round, 2026-10-07)
- Findings fixed: must-fix 0, should-fix 1 of 1.
- **Finding 1 (sync throw inside the archive scan):** in `resolveAndSendEffect`,
  `newestMessageForUserEffect(...)` is now piped through
  `Effect.catchDefect(() => Effect.fail(new ArchiveUnavailable()))`. A
  synchronous throw in the scan's own bookkeeping (e.g. `rows.length` when the
  cast archive answer is not an array) now becomes the typed `archive-unavailable`
  outcome instead of an Effect defect that rejected the never-throwing
  `handleIncomingPush`. This reproduces the old
  `try { scan = await newestMessageForUser(...) } catch` exactly; the typed
  `ArchiveUnavailable` from the lifted promises still flows through unchanged.
- Test added: `apps/server/src/push/service.effect.test.ts` (new, Allowed). A
  broken `ArchivePool` whose `query` resolves to `null`; asserts
  `handleIncomingPush` resolves to `{ kind: 'dropped', reason: 'archive-unavailable' }`
  and sends nothing. Verified it fails (boundary rejects with the defect) when
  the `catchDefect` pipe is reverted, and passes with it.
- Single test run: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot push/service`
  → 2 files passed, 21 tests passed (20 existing + 1 new).
- `pnpm gate` from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (3.1s)
  PASS  format  (78.0s)
  PASS  lint  (1.5s)
  PASS  typecheck  (44.6s)
  PASS  tests @zilar/server  (66.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- `apps/server/src/push/service.ts`: 533 → 540 lines (+7). New test file: 87 lines.

## Review (written by Claude)

Approved (lead, 2026-10-07). The push delivery pipeline runs on Effect with typed internal errors. The archive lookup keeps 3 reads 300 ms apart and the sticky muted/hidden stop. handleIncomingPush keeps its signature and never throws; outcomes, logs and dedupe marks are identical. The existing tests are untouched. Pre-review clean after one auto round.
