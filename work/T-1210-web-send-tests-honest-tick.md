---
id: T-1210
title: "Two web send-pipeline tests have failed since T-1153 (honest sent tick): update them to the new rule — a text stays 'sending' until the stream-management ack or the echo, and only a settled message can be forwarded"
status: merged
milestone: M5
branch: task/T-1210-web-send-tests-honest-tick
model: auto
effort: default
depends_on: [T-1153]
estimate: 0.1 day
---

# T-1210: Bring two web send tests up to the honest tick

## Spec (written by Claude, do not edit)

### Why
The lead bisected two failures in `apps/web/src/store/realStore.send.test.tsx`: they pass at `e0629bf65~1` and fail from `e0629bf65` (T-1153) on. No task ran this file since then, because the gate runs only nearby tests.
- **`sends text and links the echo without duplicating it`** (`:87-111`) fails with `expected 'sending' to be 'sent'`. It expects `sent` right after `await flush()` (`:93`), before any echo or ack. Since T-1153, a text moves to `sent` only on the stream-management ack (`ackText`, `packages/client-core/src/store/send/text.ts:143`) or on the echo (`packages/client-core/src/store/incoming.ts:48-54`). The send result alone records the outbox entry (`text.ts:95-105`).
- **`forwards a sent message into another chat`** (`:179-194`) fails with `expected undefined to be 'forward me'`. The source is still `sending`, and `forwardMessages` skips a `sending` message (`packages/client-core/src/store/send/forward.ts:120-126`).

The product behaviour is right; **the tests are stale**. Change only the tests.

### What to build
1. **The echo test:** after `await flush()`, expect `'sending'`. Emit the echo, as the test already does, and then expect `'sent'` and exactly one bubble. Keep the duplicate check.
2. **The forward test:** settle the source before forwarding. Emit its echo, or the core's `acked` event for its stanza id: find how `xmpp` fakes emit `acked` in this file or in `packages/client-core/src/store/send.test.ts`, and use the simplest one. Then forward and keep the existing asserts.
3. **Run the whole file:** all 10 tests pass.

### Read first
`AGENTS.md`, `work/T-1153-honest-ticks-outbox.md` (the Review), `apps/web/src/store/realStore.send.test.tsx`, `packages/client-core/src/store/send/text.ts:80-160`, `packages/client-core/src/store/incoming.ts:28-60` and `packages/client-core/src/store/send/forward.ts:110-130`.

### Allowed files
`apps/web/src/store/realStore.send.test.tsx`, `work/T-1210-web-send-tests-honest-tick.md`.

### Checks
```bash
pnpm --filter @zilar/web exec vitest run src/store/realStore.send.test.tsx --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, with 10 of 10 in that file.

---

## Report (written by the worker when done)

### What I did
Updated the two stale tests in `apps/web/src/store/realStore.send.test.tsx` to the
honest-tick rule (T-1153), test-only changes as specced:
1. **Echo test** (`sends text and links the echo without duplicating it`): after
   `await flush()` it now expects `'sending'` (was `'sent'`); after emitting the
   echo it expects `'sent'` and keeps the exactly-one-bubble duplicate check.
2. **Forward test** (`forwards a sent message into another chat`): settles the
   source first with `xmpp.emit('acked', { stanzaId: 'srv-1' })` (the fake core's
   default `sendMessage` returns `{ id: 'srv-1' }`), then forwards with the
   existing asserts. This mirrors the mobile pattern
   (`apps/mobile/src/store/real-store.send.test.ts:158`).

### Files changed
- `apps/web/src/store/realStore.send.test.tsx` (only source change, in Allowed files)
- `work/T-1210-web-send-tests-honest-tick.md` (this report + status)

### Commands (real results)
- `pnpm install` — done (12.6s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.send.test.tsx` — **10 passed, 0 failed**.
- `pnpm gate` — **GATE FAIL** on `typecheck`, caused by a pre-existing break
  outside my Allowed files (details below). Everything else passed:
  `PASS install (frozen)`, `PASS format`, `PASS lint`, `FAIL typecheck`;
  `scope: every changed file is inside the Allowed files`;
  `migration: every added migration continues from the base`.

### Pre-existing gate failure (not mine, cannot fix in scope)
`@zilar/web:typecheck` fails with three errors, all in
`packages/client-core/src/store/send/retry-text.ts` (`:85`, `:109`, `:125`):
`error TS2554: Expected 9 arguments, but got 8` for `outboxFailed` calls.
Evidence it predates my work:
- `git blame` on `outbox.ts:59-69`: the 9th param `replyToText: string | undefined`
  (`:65`) was added by T-1197 (`657d59cfd`), while the three 8-arg callers in
  `retry-text.ts` (`:84-95` and below) are from T-1196 (`8407eb4cb`). Both commits
  are already on main, and `git diff main --stat -- packages/client-core/` is
  empty on my branch — my tree's client-core is byte-identical to main.
- My diff touches only the two Allowed files (`git diff --stat` shows 2 files),
  so no change of mine could have introduced it.
- Per AGENTS.md I report this honestly rather than touching files outside
  Allowed files. Fix suggestion for the lead: pass the missing `replyToText`
  argument at the three `outboxFailed` call sites in `retry-text.ts`
  (or reconcile with T-1196/T-1197 owners).

### Security checklist
No new routes, no secrets, no deletes/updates, no caps, no audit entries —
test-only change; nothing applies.

### Acceptance
- File check passes: 10 of 10 in `realStore.send.test.tsx`.
- `pnpm gate` does NOT pass, solely due to the pre-existing main typecheck break
  above; my scope check is clean.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **Test-only, in `realStore.send.test.tsx`:**
  - the echo test now expects `sending` after the send and `sent` after the echo, with one bubble;
  - the forward test settles its source before forwarding.
- **The follow-up** (the `retry-text.ts` typecheck break on main) was fixed by T-1213, merged just before.
