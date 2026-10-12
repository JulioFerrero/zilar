---
id: T-1224
title: "Mobile HTTP calls time out after 20 s: the two shared transports (raw-request.ts, api-client.ts) add an abort timer when the caller passes no signal, so a request on a dead socket after a network change fails as network_error instead of hanging for ever (a swipe Unpin hung silently on the emulator)"
status: merged
milestone: M5
branch: task/T-1224-mobile-http-timeout
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1224: Mobile HTTP calls time out

## Spec (written by Claude, do not edit)

### Why
On the emulator (APK `745be24c`), right after an airplane-mode gap, a swipe Unpin never settled:
- no change and no error line. The device network worked (ping OK); it applied at once after the app reconnected;
- `saveChatPref` ignores new taps while one is in flight (`apps/mobile/src/components/chat/use-chat-actions.ts:71-73`), so one hung request blocks that chat's pref changes.

Neither shared mobile transport sets a timeout:
- `apps/mobile/src/lib/effect/raw-request.ts:24` calls `fetchImpl(…)` with the caller's `init` and no signal;
- the derived client's adapter, `apps/mobile/src/lib/effect/api-client.ts:20-24`, does the same.

### What to build
1. **A helper:** add `fetchWithTimeout(fetchImpl, url, init, ms)` in a new file, `apps/mobile/src/lib/effect/fetch-timeout.ts`.
   - When `init.signal` is **unset**, it creates an `AbortController`, aborts it after `ms` with `setTimeout`, and clears the timer when the fetch settles. Don't rely on `AbortSignal.timeout` or `AbortSignal.any`; Hermes may lack them.
   - When the caller passes its own signal (uploads and voice transcription do: `attachment-uploader.ts:39`, `voice-transcribe-flow.ts:139`), it passes that signal through unchanged, with no timer.
   - Export `API_TIMEOUT_MS = 20_000`.
2. **Use it** in `raw-request.ts:24` and the adapter in `api-client.ts:20-24`.
   - An abort becomes the existing `network_error` `ApiError` in `raw-request.ts` (its `catch` at `:33-35` already maps any throw).
   - Check what the derived client does with a rejected fetch, and say so in the Report.
3. **Test** (1, in a new file `apps/mobile/src/lib/effect/fetch-timeout.test.ts`, fake timers): a fetch that never settles rejects after 20 s, while a caller signal gets no timer.

### Read first
`AGENTS.md`, `apps/mobile/src/lib/effect/raw-request.ts`, `apps/mobile/src/lib/effect/api-client.ts`, `apps/mobile/src/lib/attachment-uploader.ts:30-50` and `apps/mobile/src/lib/voice-transcribe-flow.ts:130-145`.

### Allowed files
`apps/mobile/src/lib/effect/fetch-timeout.ts`, `apps/mobile/src/lib/effect/fetch-timeout.test.ts`, `apps/mobile/src/lib/effect/raw-request.ts`, `apps/mobile/src/lib/effect/api-client.ts`, `work/T-1224-mobile-http-timeout.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/effect/fetch-timeout.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Uploads and voice transcription keep their own signals, with no 20 s cap.

---

## Report (written by the worker when done)

Did: added `fetchWithTimeout(fetchImpl, url, init, ms)` + `API_TIMEOUT_MS = 20_000` in
`apps/mobile/src/lib/effect/fetch-timeout.ts`, and wired it into both shared mobile
transports: `raw-request.ts` (hand-written requests) and the `fetch` adapter in
`api-client.ts` (derived contract client). When `init.signal` is unset the helper
creates an `AbortController`, aborts it after `ms` via `setTimeout`, and clears the
timer when the fetch settles; when the caller passes its own signal it is forwarded
unchanged with no timer. No `AbortSignal.timeout`/`any` (Hermes may lack them).

Derived-client rejection behavior: the adapter's rejected fetch reaches Effect's
`FetchHttpClient` as an `HttpClientError` with a `TransportError` reason, and
`toApiError` in `packages/api-contract/src/client.ts:95-115` maps `TransportError`
to `ApiError(0, 'network_error', 'Could not reach the server')` — the same fixed
`network_error` the raw-request path produces via its catch. `runApi` then rejects
with that `ApiError` only. Note: Effect's `HttpClient.make` passes its own
interruption signal into the adapter's `fetch`, so the derived client always takes
the pass-through branch; the timeout timer effectively applies to the raw-request
path. That matches the Spec's acceptance (uploads/voice keep their own signals,
no 20 s cap) but means a hung derived-client call relies on Effect interruption,
not the 20 s abort — flagging for the lead in case the adapter should ignore the
Effect signal and always arm the timer.

Uploads/voice: `attachment-uploader.ts:39` and `voice-transcribe-flow.ts:139` pass
their own `AbortController` signals to Expo file APIs, not to these transports, so
they are untouched and uncapped. GIF search (`gifs-api.ts`) and message search
(`search-api.ts`) pass caller signals through `Effect.runPromise(..., { signal })`
into the adapter, so those take the pass-through branch (no 20 s timer) — same as
before for cancellation, and a hung one still relies on the caller.

Deviations: one addition beyond the Spec — the new file carries an
`// effect-plain:` marker on line 1. The `pnpm gate` Effect ratchet failed without
it (`fetch-timeout.ts needs Effect (H3)` for the `setTimeout`); the marker is the
ratchet's sanctioned path for a Promise-level timer helper whose callers are not
Effects.

Files changed:
- `apps/mobile/src/lib/effect/fetch-timeout.ts` (new)
- `apps/mobile/src/lib/effect/fetch-timeout.test.ts` (new)
- `apps/mobile/src/lib/effect/raw-request.ts` (fetch -> fetchWithTimeout)
- `apps/mobile/src/lib/effect/api-client.ts` (adapter -> fetchWithTimeout)

Commands:
- `pnpm install`: ok (10.9s).
- `pnpm --filter @zilar/mobile exec vitest run src/lib/effect/fetch-timeout.test.ts --reporter=dot`: 1 file, 2 tests passed.
- `pnpm gate`: GATE PASS — install/format/lint/typecheck/effect/tests all PASS; scope ok (every changed file inside Allowed files); 5 changed files against main.

Security checklist: no secrets/tokens in logs or errors (abort maps to the fixed
`network_error` sentence); no deletes/updates; no caps/uniqueness; nothing has
effect before permission check (token check still runs before any fetch); no new
routes; audit untouched.

### Round 2 (fix round, PREREVIEW findings 1-3)

Finding 1 (should-fix, derived-client timeout never arms): fixed.
`fetchWithTimeout` now always creates its own `AbortController` and arms the
20 s timer, even when the caller passes a signal. A caller signal is
propagated, not passed through: its `abort` aborts the internal controller
(without `AbortSignal.any`), and an already-aborted signal fails fast. This
covers the motivating Unpin path — Effect's always-present client signal no
longer disables the timer, so a hung derived-client call now fails as
`network_error` after 20 s while caller cancellation (search, GIFs, Effect
interruption) still aborts early. Explicit cancellation still works: a caller
abort rejects the fetch with `AbortError`, which maps to the same fixed
`network_error` via `raw-request`'s catch / `toApiError`'s `TransportError`
branch; search/GIF wrappers keep their pre/post `isAborted()` checks that
convert those to `AbortError`. Uploads and voice transcription never reach
these transports (Expo file APIs with their own controllers), so the Spec's
acceptance (no 20 s cap on them) still holds.

Finding 2 (nit, weak timeout assertion): fixed. The never-settles test now
asserts still-pending at `API_TIMEOUT_MS - 1` and matches the abort message
(`rejects.toThrow('The operation was aborted.')`); the new derived-path test
does the same.

Finding 3 (nit, sync-throw timer leak): fixed. The `fetchImpl` call sits in a
`try/catch` that clears the timer, removes the caller-abort listener, and
rethrows. (First wrote a bare `throw;`, which is a syntax error outside a
`catch {}` without binding in this parser — corrected to
`catch (error) { ...; throw error; }`; tests pass after the fix.)

Tests added/changed (all in `fetch-timeout.test.ts`, fake timers):
- never-settles rejects after 20 s (strengthened per finding 2);
- NEW: with a caller signal (the derived-client/Effect case) the fetch still
  rejects at 20 s;
- NEW: aborting the caller signal fails the fetch before the timeout.

Disagreements: none — all three findings were correct.

Commands (this round):
- `pnpm --filter @zilar/mobile exec vitest run src/lib/effect/fetch-timeout.test.ts --reporter=dot`: 1 file, 3 tests passed (run after each finding fix; one transient failure from the bare-`throw` syntax error, fixed, then passing).
- `pnpm gate` (repo root): GATE PASS — install/format/lint/typecheck/effect/tests all PASS; scope ok (every changed file inside Allowed files); 5 changed files against main.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean after 1 auto round, with 2 nits.**
- **The change:**
  - `fetchWithTimeout` runs every request under an `AbortController` that aborts after `API_TIMEOUT_MS = 20_000`, and a caller signal still aborts it;
  - it's used by `raw-request.ts` and by the derived client's adapter in `api-client.ts`.
- **The deviation was accepted:** the timer applies even with a caller signal, because the derived client always passes one (round 1's should-fix). The lead checked that the long paths are off these transports: drafts SSE uses `XMLHttpRequest` (`drafts.ts:1-12`), and uploads and voice use their own controllers.
- **Lead checks:** the full mobile suite 190 of 190; mobile `tsc` gives 0 errors.
