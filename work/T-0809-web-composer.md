---
id: T-0809
title: "WU18: web Composer on Effect (send, attachment upload, voice recording tick, typing timer); sending identical"
status: todo
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

## Review (written by Claude)
