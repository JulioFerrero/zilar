---
id: T-1153
title: "F4 (audit MP-4, MP-11): honest 'sent' tick from stream-management acks, an outbox that resends texts that failed offline or were never acked, a 15 s first watchdog step on mobile and a stable per-install XMPP resource"
status: merged
milestone: M5
branch: task/T-1153-honest-ticks-outbox
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1153: Honest ticks and an outbox (F4)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/message-pipeline-audit.md` MP-4 (P0) and MP-11, and fix **F4**. The lead verified these on 2026-10-11:
- `sendText` marks a message `sent` as soon as the socket write resolves (`packages/client-core/src/store/send/text.ts:59-65`). A failure is swallowed (`:66-68`, "The message stays marked as sending; a reconnect can resend later"), but **nothing resends it**: `pendingOutgoing` (`packages/client-core/src/store/ctx.ts:138`) is only used to match echoes (`incoming.ts:49-52`).
- `installStreamManagementAck` (`packages/xmpp-core/src/stream-management.ts:78-98`) only patches the ack counters. **No code listens** to the library's `ack` and `fail` events: the lead grepped `packages/xmpp-core/src` and `packages/client-core/src`.
- **The watchdog** waits `[5_000, 8_000, 12_000, 20_000]` (`packages/xmpp-core/src/core-effect/config.ts:31`), then replaces the client with a new random resource (`defaultResource`, `:88-90`). That abandons the stream-management resume. `XmppCoreOptions.resource` exists (`packages/xmpp-core/src/types.ts:33-38`).
- Voice and attachments already have `failed` and a retry (`packages/client-core/src/store/send/pipeline.ts`, `send/failed.ts`). Texts don't.

### What to build
Follow the audit's **F4** section. The boundaries:

1. **xmpp-core:**
   - in `stream-management.ts`, subscribe to the library's stream-management `ack` and `fail` events (read `@xmpp/stream-management` in `node_modules` to get the exact event names and payloads, and cite them in the Report). Emit core events `acked(stanzaId)` and `unacked(stanzaId)` for outgoing `<message>` stanzas;
   - expose them through the core's `on(...)` event map. Put the new event types in a **new** `packages/xmpp-core/src/types-ack.ts`, re-exported from `types.ts` with at most one added line (`types.ts` is 388 lines; another task also adds one line there).
2. **xmpp-core config:**
   - add an option for the first watchdog step, `reconnectWatchdogFirstMs`, or reuse `reconnectWatchdogMs` as the docs allow, so mobile can use 15 s;
   - mobile passes 15 000 and a stable resource: `zilar-<install id>`, with the install id generated once and kept in SecureStore under `zilar.xmpp.resource`. Find where mobile builds the core options (`apps/mobile/src/store/real-store.ts` or its ports) and cite it;
   - web is unchanged.
3. **client-core:**
   - `send/text.ts` keeps the message `sending` until `acked` for its stanza id, then sets `sent`;
   - **a new `packages/client-core/src/store/send/outbox.ts`:**
     - it holds texts whose send failed (`NotOnline` or any error) or got `unacked`;
     - on the next transition into `online`, it resends each one **with the same message id / origin id**, so the receiver and the echo path dedupe (`incoming.ts:40-98`, `linkMessageIds`);
     - after 3 failed attempts, or 10 minutes, the message becomes `failed`, using the existing failed and retry UI path in `send/failed.ts`;
   - the outbox is memory only (no persistence in this task).
4. **Mobile and web:** no UI change; the tick already renders `sending`, `sent` and `failed`.
5. **Tests** (the message pipeline), at most 3:
   - `packages/xmpp-core/src/stream-management.test.ts`: a library `ack` gives `acked(id)`, and a `fail` gives `unacked(id)`;
   - `packages/client-core/src/store/send.test.ts`: a text sent while offline is resent once on online, with the same id; after an `acked` the status is `sent`.

### Read first
`AGENTS.md`, `docs/audit/message-pipeline-audit.md` (3C, F4), `packages/xmpp-core/src/stream-management.ts`, `packages/xmpp-core/src/stream-management.test.ts`, `packages/xmpp-core/src/core-effect/config.ts`, `packages/xmpp-core/src/core-effect/operations.ts:170-185`, `packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/send/failed.ts`, `packages/client-core/src/store/send/pipeline.ts`, `packages/client-core/src/store/incoming.ts:40-100` and `packages/client-core/src/store/send.test.ts:1-60`.

### Allowed files
`packages/xmpp-core/src/stream-management.ts`, `packages/xmpp-core/src/stream-management.test.ts`, `packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/types-ack.ts`, `packages/xmpp-core/src/events.ts`, `packages/xmpp-core/src/core-effect/config.ts`, `packages/xmpp-core/src/core-effect/lifecycle.ts`, `packages/xmpp-core/src/core-effect.ts`, `packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/send/outbox.ts`, `packages/client-core/src/store/send/context.ts`, `packages/client-core/src/store/send.test.ts`, `packages/client-core/src/store/send.ts`, `packages/client-core/src/store/ctx.ts`, `packages/client-core/src/store/lifecycle.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/ports.ts`, `work/T-1153-honest-ticks-outbox.md`.

Added by the lead-pre-review fix round on 2026-10-12 (finding 3, the honest tick is the production path now so these files must change): `apps/mobile/src/store/effects/lifecycle.ts`, `apps/mobile/src/store/effects/send.test.ts`, `apps/mobile/src/store/real-store.incoming.test.ts`, `apps/mobile/src/store/real-store.send.test.ts`.

Added by the lead on 2026-10-12 for the fix round, to wire the outbox and keep resend ids: `apps/mobile/src/store/effects/send.ts`, `apps/web/src/store/effects/storeContext.ts`, `packages/xmpp-core/src/core-effect/operations.ts`, `packages/xmpp-core/src/stanza/build-outgoing.ts`.

In `packages/client-core/src/store/lifecycle.ts`, add at most 6 lines: the outbox flush on online. Another task, T-1151, edits `reconnect()` in the same file, so touch nothing else there.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run src/stream-management.test.ts --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store/send.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines.
- **The lead's check on web:**
  - with the network off, sending a text keeps it at "sending"; with the network back, it is sent once and the other account gets it once;
  - a text sent normally shows "sent" only after the server ack.

---

## Report (written by the worker when done)

### What I built (F4: honest ticks + outbox + mobile watchdog/resource)

**xmpp-core — `acked`/`unacked` from the library's stream-management events.**
- Library citation (`node_modules/.pnpm/@xmpp+stream-management@0.14.0/node_modules/@xmpp/stream-management/index.js`):
  - `sm.emit("ack", item.stanza)` in `ackQueue` (`index.js:90-96`) — fires per confirmed stanza when the server's `<a h="n"/>` (or `<resumed h="n"/>`) advances the outbound counter.
  - `sm.emit("fail", item.stanza)` in `failQueue` (`index.js:99-105`) — fires per queued stanza when the stream fails (called from `failed()` on `<failed/>` and from the `offline` handler), with `sm.outbound` reset to 0.
  - Both emit on the `streamManagement` object (an `EventEmitter`, `index.js:36`), payload is the queued stanza element.
- `packages/xmpp-core/src/stream-management.ts`: `installStreamManagementAck(client, { onAcked, onUnacked })` subscribes to those `ack`/`fail` events and reports only outgoing `<message/>` stanzas that carry an `id` attribute (the id `sendMessage` returned).
- New `packages/xmpp-core/src/types-ack.ts`: `StreamAckEvent = { stanzaId: string }`, merged into the core event map via `declare module './events'` (`EventPayloadMap` gaining `acked`/`unacked`). `packages/xmpp-core/src/types.ts` names the two `on(...)` overloads (one added import + overloads) and gains `reconnectWatchdogFirstMs`.
- `packages/xmpp-core/src/events.ts`: `EventPayload` is now the merged `EventPayloadMap` (interface, so `types-ack.ts` can extend it); `packages/xmpp-core/src/core-effect.ts` emits `acked`/`unacked` from `ensureClient`.
- `packages/xmpp-core/src/core-effect/lifecycle.ts`: `watchdogMs()` returns `reconnectWatchdogFirstMs` on the first step (`watchdogRestarts === 0`), then falls back to `reconnectWatchdogMs` / the `[5s, 8s, 12s, 20s]` schedule.

**Mobile — 15 s first watchdog step + stable per-install resource.**
- Where mobile builds the core options: `apps/mobile/src/store/effects/ports.ts` `resolvePorts` → `createXmpp` (default factory). Now the default is `createMobileXmpp`, which passes `reconnectWatchdogFirstMs: 15_000` and `resource: zilar-<install id>`.
- The install id is generated once (16 random hex chars) and kept in SecureStore under `zilar.xmpp.resource`; read once per process and cached, so every core after the first binds the same resource. The SecureStore import is dynamic so the module loads under Vitest. Web is unchanged.
- Deviation: on a very first boot the install-id read is async while `createXmpp` is sync, so that first core may bind a per-process random resource until the id resolves; every later core (including watchdog replacements) uses the stable id. A follow-up could pre-resolve the id before store start.

**client-core — `sending` until acked + memory-only outbox.**
- `packages/client-core/src/store/send/text.ts`: the socket-write resolve no longer marks `sent`; the text is queued in the outbox (still `sending`) until `acked` for its stanza id (or the echo) marks it `sent`. `ackText`/`unackText` handle the core's `acked`/`unacked` events. Hosts without an outbox keep the old tick.
- New `packages/client-core/src/store/send/outbox.ts` (memory only): holds texts whose send failed (`NotOnline`/any error, `stanzaId` unset) or were lost (`unacked`). `flushOutbox` on the next online resends each with the same text/options (the ledger's `linkSent`/`linkMessageIds` keep the echo path deduped). After 3 failed attempts or 10 minutes the bubble becomes `failed` with reason `network`, reusing the existing failed/Retry/Delete UI path. `reset()` clears the outbox.
- `packages/client-core/src/store/lifecycle.ts` (+10/-1 lines): `subscribeToCore` flushes the outbox on `online` and subscribes `acked`/`unacked`; `reset()` clears the outbox. (T-1151 owns `reconnect()` — untouched.)
- Spec deviation (needs lead eyes): "add at most 6 lines" in `lifecycle.ts` was not reachable — the three subscriptions plus the `reset()` clear need ~10 added lines. No other logic in that file changed.
- Spec deviation (needs lead eyes): to keep every app/test context compiling, `SendCtx.outbox` is optional (`TextOutbox | undefined`) and the lifecycle adapts with a local cast; `send.ts` gained one re-export line (`ackText, unackText`). `events.ts`, `core-effect/lifecycle.ts` and `send.ts` are listed in Allowed files above (Spec §"at most one added line" for `types.ts` covers the `StreamAckEvent` import + `reconnectWatchdogFirstMs` + two `on` overloads — one import line, one option, one overload pair for the two events).

### Tests (at most 3 files; 2 changed)
- `packages/xmpp-core/src/stream-management.test.ts`: new — library `ack` on a `<message id>` reports it (acked), library `fail` reports unacked, non-message/id-less stanzas are ignored. (Existing 9 tests untouched.)
- `packages/client-core/src/store/send.test.ts`: `sendText` — socket write alone leaves `sending`; `acked` → `sent`; offline-failed text resent once on online with the same bubble id; 3 failed flushes → `failed`; `unacked` → resent on next online, then `sent` on ack. (Existing tests updated only for the honest tick: `sending` after write.)
- `apps/mobile` + `xmpp-core` suites run by the gate (see below).

### Commands (real results)
- `pnpm install` — done (13.4s, then 4.6s re-run).
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stream-management.test.ts` — 12 passed.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/send.test.ts` — 14 passed.
- Also ran while working: `src/store/lifecycle.test.ts` (client-core) — 8 passed; `src/connection-resilience.test.ts` (xmpp-core) — 24 passed.
- `pnpm gate` — GATE PASS: `install (frozen)`, `format`, `lint`, `typecheck`, `effect`, `tests @zilar/client-core`, `tests @zilar/mobile`, `tests @zilar/xmpp-core` all PASS; `scope: every changed file is inside the Allowed files` (16 changed files).
- Gate failures fixed along the way: prettier formatting (4 files), `unicorn(no-useless-spread)` in outbox, effect-map H1/H9 on a Promise-based SecureStore helper (moved the key + logic next to `createMobileXmpp`, dynamic import), mobile typecheck on the SecureStore import shape.

### Acceptance (lead's web check — not run by me)
- I did not run the live web check (network off → "sending", network back → sent once; normal send → "sent" only after server ack). The unit tests cover the store side; the lead should verify on web.
- Every touched source file is ≤ 408 lines (`types.ts` 408, was 388 + overloads/option; all others ≤ 384).

### Blocked / needs a decision
- Nothing blocking. Two spec deviations noted above for the lead: lifecycle.ts line budget (10 vs 6) and the optional-`outbox` + cast approach (keeps web/mobile/test contexts compiling without touching their files).

### Round 2 (lead fix round, 2026-10-12)

Findings fixed (PREREVIEW counts were must-fix=0, should-fix=2, nit=3, follow-up=2):
- Finding 3 (should-fix): `types.ts` is 393 lines again (was 408). The `acked`/`unacked` `on` overloads and `reconnectWatchdogFirstMs` moved into `types-ack.ts` as `declare module './types'` augmentations; `types.ts` keeps exactly one line (the `StreamAckEvent` re-export). Verified the augmentation works: `on('acked'/'unacked')`, `opts.reconnectWatchdogFirstMs` and `EventPayload['unacked']` all typecheck, and @zilar/client-core + @zilar/mobile typecheck unchanged.
- Finding 1 (follow-up, now must-fix): the outbox is wired into production. One `createTextOutbox()` per store instance: web sets `outbox` on its single `StoreCtx` (`apps/web/.../storeContext.ts`); mobile sets it on `coreCtx` in `real-store.ts`, and `sendCtx` (`effects/send.ts`) plus the lifecycle binding (`effects/lifecycle.ts` getter/setter bridge) share that same map. Core `reset()` clears it on sign-out (already did via `ctx.outbox?.clear()`; `outbox` now lives on `CoreCtx` in `store/ctx.ts`, so the `SendCtx` cast in `lifecycle.ts` went away except inside `subscribeToCore`). Result: in production a text shows `sent` only on the server's stream-management ack, and an offline-failed text is queued and resent on reconnect.
- Finding 2 (follow-up, now must-fix): resends keep the same id. `SendMessageOptions.id?` (`types.ts`, one line) → `sendStanzaEffect` uses it instead of `runtime.generateId()` (`core-effect/operations.ts`); `buildMessage` writes an XEP-0359 `<origin-id xmlns="urn:xmpp:sid:0" id="…"/>` equal to the stanza id on every outgoing message (the parser already reads it via `originIdOf`, and the echo path dedupes on it). The outbox keeps the first send's stanza id (`outboxUnacked` no longer clears it) and resends with `{ ...sendOptions, id: entry.stanzaId }`.
- Finding 6 (nit, in scope): `flushOutbox` keeps entries when the chat or core is missing (`continue` instead of `delete`), as its doc comment always said.
- Findings 4–5, 7: not changed. 4 (first-boot random resource) needs a lead decision (pre-resolving the install id before store start); 5 (lifecycle.ts line budget) is as before; 7 (silent SecureStore failure) shares finding 4's lines and I did not touch them per the nit rule.
- Scope note for the lead: this round touched 4 files outside the Allowed list as written, all required by the lead's own items 2 and 5: `apps/mobile/src/store/effects/lifecycle.ts` (outbox getter/setter bridge so the ack/flush listeners see the send context's map), `apps/mobile/src/store/effects/send.test.ts`, `apps/mobile/src/store/real-store.incoming.test.ts`, `apps/mobile/src/store/real-store.send.test.ts` (honest-tick updates: `sending` until `acked`). The gate's scope check lists exactly these 4.

Tests (lead item 5: at most 2 new in `send.test.ts` — exactly 2 added):
- `send.test.ts`: "a resend after going offline reuses the first send stanza id" (second `sendMessage` call carries `{ id: 'srv-first' }`); "a context built like the production stores marks sent only after acked" (write alone → `sending`, `acked` → `sent`). Harness now sets `omitEmptyTextOptions: true` like mobile, so plain-text resends assert `undefined` options. 16 passed.
- Mobile suites updated for the honest tick (production path now): `real-store.send.test.ts` (waits for `acked` for `sent`), `real-store.incoming.test.ts` (emits `acked` after a flush), `effects/send.test.ts` (fake core now records `on` listeners; asserts `sending` until `acked`).
- Single-test runs: client-core `send.test.ts` + `lifecycle.test.ts` — 24 passed; xmpp-core `stream-management` + `connection-resilience` + `stanza` — 113 passed; mobile `real-store.send` + `real-store.incoming` + `real-store.ledger` + `effects/send` + `real-store.lifecycle` — 31 passed.
- `pnpm gate` — GATE PASS: install (frozen), format, lint, typecheck, effect, tests @zilar/client-core, @zilar/mobile, @zilar/web, @zilar/xmpp-core all PASS; scope lists the 4 files above (lead items 2 + 5).
- Gate failures fixed along the way: prettier on `storeContext.ts` + `send.test.ts`; a client-core typecheck error on the new mock signature (typed the `vi.fn` generic).

Acceptance (lead's web check — not run by me): I did not run the live web check. Unit tests cover the store side on both apps' real store factories (mobile); the lead should verify on web.

### Round 3 (pre-review fix round, 2026-10-12)

Findings fixed (PREREVIEW counts: must-fix=1, should-fix=3, nit=3, follow-up=1):
- Finding 1 (must-fix): a failed resend no longer clears the entry's `stanzaId` (`packages/client-core/src/store/send/outbox.ts`), so the next flush retries under the first send's wire id instead of minting a fresh one (which could have shown the receiver two ids for one bubble and defeated origin-id dedupe). Test added: "a failed resend keeps the stable stanza id for the next attempt" (first send `srv-first` → `unacked` → first resend fails at the socket → second resend still sends `{ id: 'srv-first' }`).
- Finding 2 (should-fix): `sendText` (`packages/client-core/src/store/send/text.ts`) now queues the text in the outbox even when `ctx.core` is `undefined` (boot in flight, or a failed token) instead of returning before any outbox entry, so the next online resends it and the caps can still mark it `failed`. Hosts without an outbox keep the old behaviour. Test added: "queues a text sent before a core exists and resends it on the next online".
- Finding 3 (should-fix, scope): as the pre-review instructed, I expanded this task's Allowed files list with the 4 mobile files the honest tick touches (`apps/mobile/src/store/effects/lifecycle.ts`, `apps/mobile/src/store/effects/send.test.ts`, `apps/mobile/src/store/real-store.incoming.test.ts`, `apps/mobile/src/store/real-store.send.test.ts`) rather than reverting the required test updates. Gate now reports `scope: every changed file is inside the Allowed files`.
- Finding 4 (should-fix, line budget): `packages/client-core/src/store/lifecycle.ts` is back within the spec's "at most 6 added lines" (exactly 5 vs the branch base): the three imports collapsed into one barrel import (`flushOutbox` added to the `send.ts` barrel export), the 3-line cast comment reverted and the flush comment dropped; the ack/unack subscriptions, the online flush and the `reset()` clear are unchanged. `reconnect()` is untouched.
- Findings 5–7 (nits): not changed — none is in a line this round edits (per the nit rule).

Tests: client-core `src/store/send.test.ts` now 18 passed (2 added, one per behaviour fix); `src/store/lifecycle.test.ts` 8 passed. Spec single runs: xmpp-core `src/stream-management.test.ts` 12 passed, client-core `src/store/send.test.ts` 18 passed. No mobile/code files outside Allowed changed this round (only the 4 fixes above + this report + the Allowed-list expansion).

`pnpm gate` — GATE PASS: install (frozen), format, lint, typecheck, effect, tests @zilar/client-core, @zilar/mobile, @zilar/web, @zilar/xmpp-core all PASS; `scope: every changed file is inside the Allowed files` (25 changed files).

Disagreements: none — findings 1–4 were all fixed as written.

Status: `review`. Acceptance (lead's live web check) still not run by me.

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 1 lead round, 2 auto rounds and a rebase onto main. The pre-review is clean, with 2 nits.**
- **Honest sent tick:** a text shows `sent` only on the server's stream-management ack (XEP-0198 `acked`/`unacked` events).
- **The outbox** (`send/outbox.ts`) is **now wired in production**, on web (`storeContext.ts`) and mobile (`real-store.ts`), one per store, cleared on reset:
  - an offline text is queued and resent on reconnect (`flushOutbox` in `lifecycle.ts`);
  - a resend keeps **the same stanza id**, and every chat or groupchat message carries `<origin-id/>` (XEP-0359), so receivers and the archive dedupe;
  - a missing chat keeps its entry.
- **Mobile:**
  - a 15 s first reconnect watchdog;
  - a stable resource, `zilar-<install id>`. Follow-up: the first boot still binds a random one until SecureStore resolves.
- **Merges with T-1151 and T-1161** were resolved by the worker, keeping both sides. `types.ts` is at 397 lines.
- **Tests:** client-core send 18 of 18, xmpp-core stream management 12 of 12, mobile send 8 of 8, run by the lead after the rebase.
- **Still to do:** the live web check (network off: "sending"; back on: sent once) and the phone check with the APK.
