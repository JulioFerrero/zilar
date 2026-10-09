---
id: T-0812
title: "MU3: mobile lib voice and drafts: drafts, voice, voice-transcribe-flow, whistle-port on Effect"
status: todo
milestone: M5
branch: task/T-0812-mobile-mu3
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0812 (MU3): mobile lib voice and drafts: drafts, voice, voice-transcribe-flow, whistle-port on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU3), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back. Julio checks voice recording and transcription on the phone before the next deploy.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/lib/drafts.ts` (325 lines; first hit at line 87: try/catch @87; JSON.parse @88; fetch/WebSocket @151; timer @167), tested in `drafts.test.ts`;
  - `apps/mobile/src/lib/voice-transcribe-flow.ts` (253 lines; first hit at line 120: async/await/Promise @120; try/catch @130), tested in `voice-transcribe-flow.test.ts`;
  - `apps/mobile/src/lib/voice.ts` (302 lines; first hit at line 105: async/await/Promise @105; try/catch @106), tested in `voice.test.ts`;
  - `apps/mobile/src/lib/whistle-port.ts` (116 lines; first hit at line 48: try/catch @48; async/await/Promise @54), tested in `whistle-port.test.ts`;
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/lib/drafts.ts`, `apps/mobile/src/lib/voice-transcribe-flow.ts`, `apps/mobile/src/lib/voice.ts`, `apps/mobile/src/lib/whistle-port.ts`, `work/T-0812-mobile-mu3.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib/drafts src/lib/voice-transcribe-flow src/lib/voice src/lib/whistle-port
pnpm --filter @zilar/mobile typecheck
```
Run `pnpm exec prettier --write` on your changed files before committing. Do not start the emulator or Metro; the lead runs `pnpm phone:smoke` for the wave.

### Acceptance
- Each listed file is `effect` in `pnpm effect:map`, or `plain` when no async work of its own is left (no added Effect import just for the label).
- The texts and behaviour are the same, or each difference is listed in the Report.
- Existing tests pass unchanged, new tests pass both before and after the conversion, and the mobile typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)
