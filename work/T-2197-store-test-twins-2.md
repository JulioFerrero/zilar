---
id: T-2197
title: "Tests, wave 2: delete web and phone store test cases that repeat a client-core test; product code unchanged"
status: merged
milestone: M5
branch: task/T-2197-store-test-twins-2
model: deepseek/deepseek-flash
effort: default
estimate: 20 min
---

# T-2197: Store test cases tested twice, wave 2

## Spec (written by Claude, do not edit)

### Why
This continues T-2193. Julio's rule (2026-10-10): keep tests for the message pipeline, and cut the rest to the minimum. One copy of each rule stays, in `packages/client-core/src/store/`.

### Facts (the lead read the test names on 2026-10-19)
Delete each item below. Its twin, which stays, is named after the arrow.

1. `apps/web/src/store/realStore.echo-edit.test.tsx`, the whole file (81 lines). Both cases repeat core `incoming.test.ts:420` and `:433`; T-2193 already removed the phone copies.
2. `apps/web/src/store/realStore.incoming.test.tsx:178` sends no correction for an unchanged or empty edit → core `actions.test.ts:73`.
3. `apps/web/src/store/messageCache.test.ts` (keep `:57` as the wiring check):
   - `:83` never stores unsent messages or local preview URLs → core `message-cache.test.ts:118` and `:158`;
   - `:122` round-trips the cached pins… → core `message-cache.test.ts:208`;
   - `:145` drops the oldest chats when the payload is over the byte cap → core `message-cache.test.ts:178`.
4. `apps/mobile/src/store/effects/send.test.ts` (keep `:102`):
   - `:48` calls sendMessage in the same tick… and waits for the ack → core `send.test.ts:481`;
   - `:89` keeps the bubble sending when the send rejects → core `send.test.ts:188`.

### Steps
1. Delete exactly the items above. Delete a `describe` only when it has no case left.
2. Remove the helpers, fixtures and imports in those same files that become unused, including an `afterEach(() => vi.useRealTimers())` with no fake timers left. Change nothing else.
3. Run `pnpm gate`.

### Allowed files
- `apps/web/src/store/realStore.echo-edit.test.tsx` (delete)
- `apps/web/src/store/realStore.incoming.test.tsx`
- `apps/web/src/store/messageCache.test.ts`
- `apps/mobile/src/store/effects/send.test.ts`
- `apps/mobile/src/store/real-store.incoming.test.ts` (only its unused `afterEach` at `:68-71`)
- `work/T-2197-store-test-twins-2.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The diff only deletes test cases and their now-unused helpers.

---

## Report (written by the worker when done)

### What I did
- Deleted `apps/web/src/store/realStore.echo-edit.test.tsx` entirely (both cases).
- Removed the "sends no correction for an unchanged or empty edit" case from `apps/web/src/store/realStore.incoming.test.tsx`; the remaining typing case and its helpers stay.
- Removed the three cases from `apps/web/src/store/messageCache.test.ts` (unsent/preview URLs, pin round-trip, byte-cap eviction), plus the now-unused `Pin` import, `readCachedPins` import and `pin` helper. The wiring case at the top stays.
- Removed the two cases from `apps/mobile/src/store/effects/send.test.ts` (same-tick send/ack, keep sending on reject); the stop/late-ack case and all helpers it uses stay.
- Removed the unused `afterEach(() => vi.useRealTimers())` from both `apps/web/src/store/realStore.incoming.test.tsx` and `apps/mobile/src/store/real-store.incoming.test.ts`, and dropped `afterEach`/`vi` from the imports where they became unused.

### Files changed
- `apps/web/src/store/realStore.echo-edit.test.tsx` (deleted, 81 lines)
- `apps/web/src/store/realStore.incoming.test.tsx` (-19/+1)
- `apps/web/src/store/messageCache.test.ts` (-98)
- `apps/mobile/src/store/effects/send.test.ts` (-54)
- `apps/mobile/src/store/real-store.incoming.test.ts` (-6/+2)
- `work/T-2197-store-test-twins-2.md` (status/report)

### Commands and results
- `pnpm install`: done, 1155 packages, 1.4s.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.incoming.test.tsx src/store/messageCache.test.ts`: 2 files passed, 2 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/effects/send.test.ts src/store/real-store.incoming.test.ts`: 2 files passed, 3 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.incoming.test.tsx`: 1 file passed, 1 test passed (after the afterEach cleanup).
- `pnpm gate` (final run): all steps passed:
  - gate: 6 changed file(s) against main
  - PASS install (frozen) (3.6s)
  - PASS format (1.5s)
  - PASS lint (1.0s)
  - PASS typecheck (3.7s)
  - SKIP effect (no source files changed)
  - SKIP build @zilar/server (no server, package or manifest change)
  - PASS tests @zilar/mobile (4.2s)
  - PASS tests @zilar/web (3.5s)
  - scope: every changed file is inside the Allowed files
  - migration / images / size / comments checks passed
  - GATE PASS

### Problems, deviations, open questions
- None. The line numbers in the Spec are offset from the current checkout (e.g. the incoming case is at `:65`, not `:178`); I matched by test name.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings).

The diff only deletes test cases that repeat a client-core store test, plus their unused helpers: −256 test lines. Product code is unchanged.
- the web echo-edit file;
- 3 web message-cache cases;
- 1 web incoming case;
- 2 phone send-effect cases;
- the phone incoming test's dead `afterEach`.

Each file keeps a wiring case, and the core twins stay.
