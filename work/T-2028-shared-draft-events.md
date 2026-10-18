---
id: T-2028
title: "Share W1-h: AI draft-stream event decoding and the reconnect delay move to client-core (decodeDraftEvent, draftReconnectDelay); both apps import the event types from client-core; web resets backoff on first bytes like the phone — EventSource (web) and XHR (phone) stay per app — net about −65 lines, with tests"
status: merged
milestone: M5
branch: task/T-2028-shared-draft-events
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2028: Shared draft-stream events (share plan W1-h)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. `docs/audit/share-plan.md` §2.4 and slice **W1-h** found the AI draft-stream event types, validation and backoff written twice, although client-core already exports the types. The net saving is about 65 lines. The stream is in the message pipeline, so tests are required.

### Facts (from `docs/audit/share-plan.md` §2.4, read by the lead on 2026-10-18)
- **The two copies.** `apps/web/src/lib/drafts.ts` (159 lines) and `apps/mobile/src/lib/drafts.ts` (334 lines).
- **The same in both:**
  - **Event types.** Both apps redefine them (web:28-35, mobile:23-42), although client-core exports them (`packages/client-core/src/store/ports.ts:87-102`, through `store/index.ts:21`).
  - **Validation.** The same contract: an effect `Schema` on web (web:14-26,58-73), a hand-written UUID regex on mobile (mobile:74-112).
  - **Backoff constants and jitter**, identical (web:49-50,104-107, mobile:20-21,222-225).
- **Platform-specific, stays in each app:**
  - web: `EventSource` with a cookie (web:38,142-149);
  - mobile: XHR with its own SSE frame parser, a bearer token and `AppState` (mobile:115-150,197-216,251-301). React Native has no `EventSource`, and its `fetch` doesn't stream.
- **Drift.** Web resets the backoff on every frame (web:129,136). Mobile resets it on the first bytes (mobile:283), which is better.
- **Barrel.** The client-core store barrel `packages/client-core/src/store/index.ts` ends at line 64 with `export * from './message-cache';`.

### Steps
1. **The shared module.** Create `packages/client-core/src/store/draft-events.ts`:
   - `decodeDraftEvent(type, data): DraftHubEvent | undefined`, using the effect `Schema` contract with the types from `ports.ts`;
   - `draftReconnectDelay(attempt, random, base = 1000, max = 30000): number`.

   Keep it under about 60 lines.
2. **The barrel.** Add ONE export line to `packages/client-core/src/store/index.ts`, **directly after line 64**, with no comment line.
3. **Web.** `apps/web/src/lib/drafts.ts` imports the types, `decodeDraftEvent` and `draftReconnectDelay`, and deletes its own copies. It resets the backoff when the connection opens (`onopen`), not on every frame. Keep `EventSource`.
4. **Phone.** `apps/mobile/src/lib/drafts.ts` imports the same, and deletes its types, its regex validator and its delay math. Keep the XHR, the SSE parser and `AppState`.
5. **Tests** in a new `packages/client-core/src/store/draft-events.test.ts`:
   - a valid event of each type decodes;
   - a bad UUID, a missing field and bad JSON give `undefined`;
   - the delay stays within `[base, max]` and grows with the attempt.
6. **Fewer lines.** Product lines must end at **at most 440**, against 493 today. Put the before and after counts in the Report. Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/store/draft-events.ts`
- `packages/client-core/src/store/draft-events.test.ts`
- `packages/client-core/src/store/index.ts`
- `apps/web/src/lib/drafts.ts`
- `apps/mobile/src/lib/drafts.ts`
- `work/T-2028-shared-draft-events.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/draft-events.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines are at most 440.

---

## Report (written by the worker when done)

### What I did

- Created `packages/client-core/src/store/draft-events.ts` (58 lines) with the
  shared `decodeDraftEvent(type, data)` (the two effect `Schema` structs on the
  `DraftHubEvent` shapes from `ports.ts`) and `draftReconnectDelay(attempt,
  random, base = 1000, max = 30000)`.
- Added one export line to the client-core store barrel, directly after the
  message-cache line, with no comment.
- `apps/web/src/lib/drafts.ts`: imports `DraftHubEvent`, `decodeDraftEvent` and
  `draftReconnectDelay` from client-core, re-exports `OpenDraftStream`, and
  deletes its schemas, types, constants and parse/backoff code. The backoff now
  resets on `open` (once per connection) instead of on every `draft`/`end`
  frame. `EventSource` and its cookie URL stay.
- `apps/mobile/src/lib/drafts.ts`: imports the same, deletes its event types,
  UUID regex, JSON validator and delay math. The XHR, the SSE frame parser and
  `AppState` handling stay.
- Added `packages/client-core/src/store/draft-events.test.ts` (7 tests): a valid
  `draft` and a valid `end` (both outcomes) decode; a bad UUID, a missing field,
  bad JSON and an event of the other type give `undefined`; the delay stays in
  `[base, max]` for attempts 0..20 and grows with the attempt until the cap.

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/draft-events.test.ts`:
  1 file passed, 7 tests passed.
- `pnpm gate` (exit 0), summary:

```
PASS  install (frozen)  (4.4s)
PASS  format  (1.8s)
PASS  lint  (1.2s)
PASS  typecheck  (3.9s)
PASS  effect  (0.7s)
PASS  build @zilar/server  (0.6s)
PASS  tests @zilar/client-core  (8.0s)
PASS  tests @zilar/mobile  (2.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- Product lines (the two app files): **493 before, 382 after** (web 159 -> 113,
  mobile 334 -> 269). Including the new 58-line shared module the three product
  files total **440**, at the limit; every file is under 400 lines.

### Notes for the lead

- **Jitter range.** The old formula (`half + up to half again`) could return a
  delay below `base` (500 ms at attempt 0), which contradicts the spec's test
  "the delay stays within `[base, max]`". The shared function keeps the
  exponential ceiling and jitter but spreads from `base` to the capped ceiling,
  so the invariant holds. Say the word if you want the old half-jitter back and
  the test relaxed instead.
- Added `// effect-plain: ...` as line 1 of the web file: after the schemas moved
  out it no longer imports `effect`, so the Effect ratchet saw the browser
  `EventSource`/`setTimeout` adapter as new `needs-effect` work. The marker
  records that this transport is deliberately plain (same marker used across the
  repo).
- `draft-events.ts` is 58 lines, just under the spec's "about 60"; the total of
  the three product files is exactly 440, so there is no headroom left.
- No open questions.

## Review (written by Claude)

Approved; the pre-review was clean, with 1 nit.
- **What changed.**
  - `decodeDraftEvent` and `draftReconnectDelay` live in client-core `store/draft-events.ts`.
  - Both apps use the shared event types.
  - Web resets its backoff on `open`, not on every frame.
  - `EventSource` (web) and the XHR SSE reader (phone) stay in each app.
- **Size.** Product lines went from 493 to 440, which is −53.
- **Still to check:** an AI reply streaming on web and phone, in the next live check.
