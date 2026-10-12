---
id: T-1202
title: "MUX-14 (first step): a too-short press on the mobile mic shows 'Hold to record, release to send' for 1.5 s instead of nothing; a haptic tick when recording starts and when it is cancelled; the slide hint uses a ChevronLeft icon, not the '‹' glyph"
status: merged
milestone: M5
branch: task/T-1202-mobile-voice-hints
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1202: Voice recorder hints and haptics

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-14 (P2, confirmed by code). Hold-to-record works, but:
- **A short press is discarded silently:** a press under `VOICE_MIN_MS` is thrown away (`apps/mobile/src/components/chat/voice-recorder-flow.ts:116-118`, the comment at `:110-112`, and the component doc at `apps/mobile/src/components/chat/voice-recorder.tsx:66-73`). Telegram shows "Hold to record, release to send".
- **No haptics:** there's no haptic on start or cancel. `expo-haptics` is installed (`apps/mobile/package.json:39`) and already used in `apps/mobile/src/components/chat/swipe-to-reply.tsx` and `message-bubble-actions.tsx`. Copy their call style.
- **A text glyph, not an icon:** the hint is `'‹ Slide to cancel'` (`voice-recorder.tsx:256`).
- **Sizes:** `voice-recorder.tsx` is 286 lines and `voice-recorder-flow.ts` 158.

### What to build
1. **The short-press hint.** When the release ends as a too-short press (the `discard` path at `voice-recorder-flow.ts:116-118`, and the post-stop check `finished.durationMs < VOICE_MIN_MS` at `:131`), the button shows a small tooltip-like line above the composer, "Hold to record, release to send", for 1.5 s.
   - Expose that outcome from the flow (for example a distinct return value, or a callback) **without** changing what happens to the recording. Today a too-short press and a cancel both return `undefined`; tell them apart.
   - Time it with an Effect `sleep` on a fiber, the way the codebase does timers (the gate's Effect rule rejects a bare `setTimeout`). Find an example in `apps/mobile/src` and cite it.
2. **Haptics:** a light impact (`Haptics.impactAsync(ImpactFeedbackStyle.Light)`) when the recording actually starts (permission granted and recording), and a warning or medium one when a slide-left cancel happens. Ignore haptics errors.
3. **The icon:** replace `'‹ Slide to cancel'` with a lucide `ChevronLeft` (size 14, the same colour as the text) followed by "Slide to cancel". Keep "Release to cancel" as is.
4. **Update the component doc comment** at `voice-recorder.tsx:66-73` ("discarded silently" is no longer true).
5. **No lock and no slide-up in this step. No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (MUX-14), `apps/mobile/src/components/chat/voice-recorder.tsx`, `apps/mobile/src/components/chat/voice-recorder-flow.ts`, `apps/mobile/src/components/chat/voice-recorder-gesture.ts` and `apps/mobile/src/components/chat/swipe-to-reply.tsx` (the haptics call).

### Allowed files
`apps/mobile/src/components/chat/voice-recorder.tsx`, `apps/mobile/src/components/chat/voice-recorder-flow.ts`, `apps/mobile/src/components/chat/voice-recorder-gesture.ts`, `work/T-1202-mobile-voice-hints.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator:**
  - a quick tap on the mic shows the hint;
  - holding records;
  - the slide hint shows the chevron icon.

---

## Report (written by the worker when done)

### What I did
- `voice-recorder-flow.ts`: `runRecorderFinish`/`runRecorderFinishEffect` now return a `RecorderFinishOutcome` (`sent` / `cancelled` / `too-short` / `refused { copy }`) instead of `string | undefined`, so the component can tell a too-short press apart from a cancel. Recording behaviour is unchanged: too-short takes are still discarded via `recorder.cancel()`, nothing is sent. Added `SHORT_PRESS_HINT_MS = 1500`. Updated the two comments that described the old silent discard.
- `voice-recorder.tsx`: on a `too-short` outcome the button shows "Hold to record, release to send" in a tooltip-like line above the composer for 1.5 s, timed with an `Effect.sleep` forked on a fiber and interrupted by the effect cleanup (the same pattern as the existing error hide, and as `atoms`/`skeleton.tsx` elsewhere in the app; cited timer helper: `apps/mobile/src/lib/effect/timers.ts`). Added a light `Haptics.impactAsync(Light)` when recording actually starts and a medium one on slide-left cancel (call style copied from `swipe-to-reply.tsx` / `message-bubble-actions.tsx`, errors ignored). Replaced the `'‹ Slide to cancel'` glyph with a lucide `ChevronLeft` (size 14, `ICON` colour) + "Slide to cancel" text; "Release to cancel" kept as is. Updated the component doc comment ("discarded silently" no longer true).
- No change to `voice-recorder-gesture.ts` (no gesture change was needed). Spec item 5: no lock, no slide-up, no tests (UI).

### Files changed
- `apps/mobile/src/components/chat/voice-recorder-flow.ts` (158 -> 169 lines)
- `apps/mobile/src/components/chat/voice-recorder.tsx` (286 -> ~332 lines)
- `work/T-1202-mobile-voice-hints.md` (this file)

### Commands and real results
- `pnpm install`: done, 10.9 s.
- `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json`: no output (pass).
- Targeted tests: none exist near these files (no `voice-recorder*.test.*`, no imports of the flow outside the component); the spec requires no tests (UI).
- `pnpm gate` (final, repo root): `PASS install (1.0s)`, `PASS format`, `PASS lint`, `PASS typecheck (2.8s)`, `PASS effect`, `SKIP tests @zilar/mobile (no nearby test files)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. One earlier gate run failed on `format` only (voice-recorder.tsx); fixed with `prettier --write` on that file and re-ran the gate to PASS.
- Acceptance (lead's emulator check, not run by me): I did not run the emulator; the quick-tap hint, hold-to-record, and chevron slide hint need the lead's phone smoke.

### Security checklist
- No secrets, tokens, or URLs logged. No permission/cap/rate-limit surface added (UI hints + haptics only). No deletes/updates, no audit entries, no new routes.

### Blocked / needs a decision
- None. Note: the cancel haptic fires in `finish(cancel=true)` even when the release arrives before the native recorder finished starting (replayed path) — that matches "when a slide-left cancel happens" and I judged it in scope rather than blocking.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **The short-press hint:** a too-short press now has its own outcome from the flow, which shows "Hold to record, release to send" for 1.5 s (an `Effect.sleep` fiber, interrupted on cleanup).
- **Haptics:** a light impact when recording starts, a medium one on a slide-left cancel; errors are ignored.
- **The icon:** a `ChevronLeft` replaces the "‹" glyph. The doc comment is updated.
- **Still to do:** the emulator check with the next APK.
