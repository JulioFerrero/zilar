---
id: T-0809
title: "WU18: web Composer on Effect (send, attachment upload, voice recording tick, typing timer); sending identical"
status: merged
milestone: M5
branch: task/T-0809-web-composer
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0809: WU18: web Composer on Effect (send, attachment upload, voice recording tick, typing timer); sending identical

## Spec (written by Claude, do not edit)

### Why
This is part of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. It runs in **wave 1** of the batch mode Julio chose on 2026-10-09: the lead checks the whole wave once and sends every failure back. Plan row WU18 (line 388); WU3 (T-0794) is merged. The plan flags "Julio: sending is the core flow": Julio checks sending live.

### Verified facts (do not re-derive)
- **`apps/web/src/components/Composer.tsx`** (1,070 lines, H1 H2 H3 W4), tested in `Composer.test.tsx` and `Composer.voice.test.tsx`. The first hit is `const timer = window.setInterval(...)` at line 383 (plan line 755: a timer at 383, async at 451, try at 453, a `fetch` at 454).
- **The lib modules it calls** (`apps/web/src/lib/attachments.ts`, `voice.ts`) keep their Promise API and export `*Effect` versions since T-0794 (`uploadAttachmentEffect`, `VoiceRecorder.startEffect`, `convertVoiceEffect`, `uploadVoiceEffect`, `computeWaveformEffect`).
- **The raw `fetch` at line 454:** read what it fetches. Wrap it in `Effect.tryPromise` with its `signal`, keeping the same request.
- **Store calls** (send text, sticker and so on) keep the store-error rule in `docs/EFFECT_BRIEF.md`.
- **Recording must start inside the click,** because the microphone permission needs the user's click; only the wait goes into the Effect.

### What to build
Convert `Composer.tsx` with the web pattern. The recording tick becomes `Effect.repeat` with `Schedule.spaced`, and the typing timer becomes a forked `Effect.sleep`, both interrupted where the old code cleared them.

Follow `docs/EFFECT_BRIEF.md` (the wave rules, the building blocks and the traps).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, `apps/web/src/lib/attachments.ts`, `apps/web/src/lib/voice.ts`, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/components/Composer.tsx` and both test files.

### Allowed files
`apps/web/src/components/Composer.tsx`, `work/T-0809-web-composer.md`.

### Checks (wave mode: your own tests and your package typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/components/Composer
pnpm --filter @zilar/web typecheck
```
Run the tests 3 times when the code has timers or concurrency. Run `pnpm exec prettier --write` on your changed files before committing.

### Acceptance
- Each listed source file is `effect` (or carries a valid marker where the task says so) in `pnpm effect:map`.
- Exported names, signatures, texts and behaviour are unchanged, or each difference is listed in the Report.
- Existing tests pass unchanged; new tests pass; the package typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

- **effect:map:** `apps/web/src/components/Composer.tsx` was `needs-effect` (H1 H2 H3 W4); now `effect`. One signal is left: H2 (`fetch(` inside `Effect.tryPromise` in `sendGif`), so it is Tier B, like the other wrapped edges.
- **Tests:** `src/components/Composer` (2 files): 44 passed before, 44 passed after. After: 3 runs pass 3/3. An earlier extra run, with the machine at load average ~34, failed `Composer.voice.test.tsx > clicks to record and sends through the Send button` once (the 400 ms hold timer elapsed between press and release, so release sent instead of locking; the old `setTimeout` has the same race). No new tests. Package typecheck (`pnpm --filter @zilar/web typecheck`): clean. `pnpm gate` not run (wave mode).
- **Sites:**
  - Recording tick (`setInterval` 100 ms): `Effect.repeat(tick, Schedule.spaced(100))` delayed by 100 ms, forked in the `[recording]` effect, interrupted in its cleanup.
  - Hold timer (`setTimeout` 400 ms, `press.holdTimer`): forked `Effect.sleep(HOLD_MS)` that sets `press.hold`; `holdTimer` is now a `Fiber`; every `clearTimeout` became `stopTimer` (fiber interrupt).
  - The "typing timer" named in the spec does not exist in Composer: typing is throttled with `Date.now()` and `lastTypingRef`, left as is.
  - GIF `fetch` + `blob()` (`sendGif`): `Effect.tryPromise` with the abort `signal`, same request (`credentials: 'same-origin'`); `!ok` and empty blob fail with the same `ComposerFailure` and the same text "Could not load that GIF. Try another."; the success step builds the file and calls `store.sendAttachment` as before.
  - `beginRecording`: `VoiceRecorder.start()` is called inside `Effect.tryPromise` run by `Effect.runFork`, which evaluates synchronously, so the call still happens in the click (existing test asserts `start` is called right after pointer-down). The success and failure handlers are the old code moved into `onRecorderStarted` / `onRecorderFailed`.
  - `finishRecording`: `recorder.stop()`, `computeWaveform` and `store.sendVoice` are an `Effect.gen` with the same checks, the same order and the same texts; `onCancelReply` runs last on success only.
  - `setPointerCapture` try/catch: `Effect.runSync(Effect.ignore(Effect.try(...)))`.
- **Behaviour differences:** none intended. Small notes: `beginRecording` and `finishRecording` now return `void` (they are local and their callers used `void`); a throw from `store.sendAttachment` (GIF) or `onCancelReply` (voice) was an unhandled rejection before and is now a fiber defect (still unhandled, nothing shown to the user); continuations resume through the Effect scheduler instead of a bare `await`, so they land a few microtasks later (the tests flush with a macrotask and pass).
- **Unsure / deviations:**
  - The spec says T-0794 is merged and lists `*Effect` lib exports. On this branch (based on main at 545e2314) T-0794 is only on `task/T-0794-web-lib-ports`, so `voice.ts` and `attachments.ts` have no `*Effect` exports. I wrapped the Promise APIs (`VoiceRecorder.start`, `stop`, `computeWaveform`) with `Effect.tryPromise`; this keeps working after T-0794 merges. Switching to the `*Effect` versions later would be a small follow-up.
  - I used one `sed -i` to drop `void ` before the `beginRecording`/`finishRecording` calls (mechanical rename, 7 lines); everything else was done with the edit tool.
  - `docs/EFFECT_BRIEF.md` was read read-only from the main checkout (not in this worktree).

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved. The lead reviewed the Report. The wave 1 combined check (all 12 branches on one tree, by hand) passed the whole-repo typecheck and every package suite: web 1916, server 2279, mobile 2222, xmpp-core 245, runner 63, runner-tunnel 71, devtools 796 after the T-0799 fix, chat-core 174, protocol 174.
- Worker: Sonnet 5.5. Composer is an Effect file; recording starts inside the click; 44 tests pass 3 of 3 runs. Julio checks sending live before the next deploy.
