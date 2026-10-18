---
id: T-2024
title: "Share W1-j: one media-retry hook in client-core (1/2/4/8 s backoff fiber, keeps the captured local preview across a URL swap, failed only when there is no preview) and withMediaRetry in chat-core — web and phone become thin adapters — fixes the phone's preview flash — net fewer lines, with tests"
status: merged
milestone: M5
branch: task/T-2024-shared-media-retry
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2024: Shared media retry (share plan W1-j)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. The share plan (`docs/audit/share-plan.md` §2.18 and slice **W1-j**) found the media-retry hook written twice. The net saving is about 130 lines.
- **The phone's copy drifted.** It rebuilds the preview when the URL changes, against its own comment. Sending a photo can then flash "Couldn't load" before the remote image arrives.

### Facts (from `docs/audit/share-plan.md` §2.18, read by the lead on 2026-10-18)
- **The two copies.** `apps/web/src/lib/media-retry.ts` (163 lines) and `apps/mobile/src/lib/media-retry.ts` (155 lines).
- **The same in both:**
  - delays of 1, 2, 4 and 8 s (web:10, mobile:11);
  - `RetryState` (web:20-35, mobile:21-36);
  - the `Effect.sleep` fiber (web:89-108, mobile:86-105);
  - `onError`, retry and restart (web:125-152, mobile:117-144).
- **Drift: the phone differs from web in three places, and web is right each time:**
  - Its `atUrl` rebuilds the preview from the current `localUri` (mobile:48-55). Web keeps the captured preview (web:52).
  - It clears the preview on a local load (mobile:113). Web keeps it (web:120).
  - It returns raw `failed` (mobile:150). Web returns `failed && no preview` (web:158).
- **Why the fiber stays.** `Effect.retry` doesn't fit, because the image element's `onError` drives the retries. Keep the fiber.

### Steps
1. **The shared hook.** Create `packages/client-core/src/use-media-retry.ts`: `useMediaRetry({ url, preview?, retryable })` and `MEDIA_RETRY_DELAYS_MS`, using plain `react` and `effect` only, with **web's** preview rules. Add one export line at the end of `packages/client-core/src/index.ts`.
2. **The URL helper.** Add `withMediaRetry(url, n)` to `packages/chat-core/src/media.ts`; check first that the file exists, and create it if not. If chat-core has a barrel, add one export line at its end.
3. **Thin adapters.** `apps/web/src/lib/media-retry.ts` and `apps/mobile/src/lib/media-retry.ts` become thin adapters with the same exported names.
4. **Tests** in a new `packages/client-core/src/use-media-retry.test.ts`:
   - the preview is kept across a URL swap;
   - `unavailable` or `failed` is reported only when there is no preview;
   - the delays follow 1, 2, 4, 8 s.

   Test the pure state logic. If the hook needs a renderer, extract a pure reducer and test that.
5. **Fewer lines.** Total non-test lines must go down, with the before and after counts in the Report. Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/use-media-retry.ts`
- `packages/client-core/src/use-media-retry.test.ts`
- `packages/client-core/src/index.ts`
- `packages/chat-core/src/media.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/lib/media-retry.ts`
- `apps/mobile/src/lib/media-retry.ts`
- `work/T-2024-shared-media-retry.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/use-media-retry.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines go down.

---

## Report (written by the worker when done)

### What I did
- Added `packages/client-core/src/use-media-retry.ts`: the shared `useMediaRetry({ url, preview?, retryable? })` hook with `MEDIA_RETRY_DELAYS_MS` and `isLocalPreviewUrl`, using web's preview rules (captured preview survives a URL swap and a local load; a remote load drops it; `unavailable` is `failed && no preview`). The state machine is pure (`initialMediaRetryState`, `mediaRetryAtUrl`, `mediaRetryAdvance`, `mediaRetryOnLoad`, `mediaRetryOnError`, `mediaRetryRestart`, `isMediaRetryUnavailable`) and the hook keeps the `Effect.sleep` fiber from the old copies.
- Added one export block at the end of `packages/client-core/src/index.ts`.
- Added `withMediaRetry(url, n)` to `packages/chat-core/src/media.ts`. The chat-core barrel already does `export * from './media'` (line 28), so no extra export line was needed there; adding one would duplicate the star export.
- Replaced `apps/web/src/lib/media-retry.ts` (163 → 16 lines) and `apps/mobile/src/lib/media-retry.ts` (155 → 37 lines) with thin adapters that keep every previously exported name (`MEDIA_RETRY_DELAYS_MS`, `isLocalPreviewUrl`, `withMediaRetry`, `MediaRetry`, `MobileMediaRetry`, `useMediaRetry`). Web passes the proxied `mediaSrc` and `retryable: source !== url`; mobile passes `preview: localUri`, maps `attempt` to `retry`, `unavailable` to `failed`, and the shared `retry` to `restart`. This fixes the phone drift: the preview now survives the URL swap and `failed` is reported only when no preview is left.
- Added `packages/client-core/src/use-media-retry.test.ts` (8 tests) against the pure state functions.

Line counts (non-test product lines): before 318 (web 163 + mobile 155). After 261 (shared hook 193 + web adapter 16 + mobile adapter 37 + 8 added in `chat-core/src/media.ts` + 7 added in `client-core/src/index.ts`), a net reduction of 57 lines. The two hook files alone went 318 → 246. The new test file is 92 lines and not counted; every changed file is under 400 lines.

### Checks run
- `pnpm install` — done, no errors.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/use-media-retry.test.ts` — 1 file passed, 8 tests passed.
- `pnpm gate` (repo root) — final lines:
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  effect`
  - `PASS  tests @zilar/chat-core`
  - `PASS  tests @zilar/client-core`
  - `PASS  tests @zilar/mobile`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead
- The first gate run failed on `format` for `use-media-retry.ts`; I ran Prettier on that one file and the second gate passed.
- No dependency was added: the shared hook imports `withMediaRetry` from `@zilar/chat-core`, which `client-core` already depends on.
- `apps/mobile/src/lib/media-retry.ts` still exports `withMediaRetry`; it now re-exports the chat-core function, so the phone path and the shared hook build retry URLs the same way (`?retry=` when there is no query, `&retry=` otherwise).
- The mobile adapter now reports `failed` only when no preview is left, per the spec. Callers in `media-bubble.tsx` and `album-grid.tsx` were not touched.


## Review (written by Claude)

Approved; the pre-review was clean, with 2 nits.
- **What changed.** One `useMediaRetry` in client-core, plus `withMediaRetry` in chat-core. The web and phone adapters are 16 and 37 lines.
- **Size.** Product lines went from 318 to 254, which is −64.
- **The phone** now follows web's preview rules: it keeps the captured preview across a URL swap, and reports a failure only when there's no preview. That should stop the "Couldn't load" flash when you send a photo.
- **Still to check:** sending a photo on the phone, in the next phone smoke.
