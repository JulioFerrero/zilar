---
id: T-1012
title: "Size split T93: apps/mobile/src/components/chat/voice-recorder.tsx (470 lines) into chat/{voice-recorder-flow,voice-recorder-gesture}; one VoiceRecorderPort import"
status: merged
milestone: M5
branch: task/T-1012-split-mobile-voice-recorder
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1012: Split the mobile voice recorder

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/voice-recorder.tsx` is 470 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #89 (task T93): `components/chat/voice-recorder-flow.ts` and `chat/voice-recorder-gesture.ts`, under `apps/mobile/src/`. `voice-recorder.tsx` keeps the component and every export it has today.

- **In scope:** the in-file part of the Dedup. The two `VoiceRecorderPort` imports fold into one.
- **Out of scope:** the `lib/effect/timers.ts` item, because it crosses files.
- **Same behaviour:** the hold-to-record gesture (press, slide to cancel, lock) keeps its thresholds exactly.

The lead runs a phone smoke of a chat's composer in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #89, and `apps/mobile/src/components/chat/voice-recorder.tsx`.

### Allowed files
`apps/mobile/src/components/chat/voice-recorder.tsx`, `apps/mobile/src/components/chat/voice-recorder-flow.ts`, `apps/mobile/src/components/chat/voice-recorder-gesture.ts`, `work/T-1012-split-mobile-voice-recorder.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/mobile/src/components/chat/voice-recorder.tsx` (470 lines) per
`docs/audit/size-plan.md` §2.2 #89 / `split-rules.md`:

- `components/chat/voice-recorder-flow.ts` — the recorder decision logic
  (`RecorderDecisionDeps`, `flatWaveform`, `waveformFromLevels`,
  `runRecorderBeginEffect`/`runRecorderBegin`, `runRecorderFinishEffect`/`runRecorderFinish`,
  `formatElapsed`) and the two sampling constants (`LEVEL_TICK_MS`,
  `ERROR_VISIBLE_MS`) plus the private `WAVEFORM_BARS`.
- `components/chat/voice-recorder-gesture.ts` — the hold gesture
  (`HoldHandlers`, `FlagRef`, `TickerRef`, `startTicker`, `stopTicker`,
  `createHoldResponder`, private `CANCEL_SLIDE_PX`).
- `voice-recorder.tsx` keeps `VoiceRecorderButton` and re-exports every name it
  exported before; it now imports the moved pieces from the two new files.
  `TIMER_TICK_MS`, `VOICE_MAX_DURATION_MS` and the component stay in the barrel.

Code was moved unchanged. No importer outside the three files was touched
(`composer-input-row.tsx` still imports `VoiceRecorderButton` from the same path).

### Dedup (in scope)

The two `VoiceRecorderPort` imports (old lines 10–14 and 26–30) folded into one:
`voice-recorder-flow.ts` imports the port once as `RecorderPort`; the barrel
imports the type once for the component. No duplicate import remains in either
file.

Out of scope, not done: the `lib/effect/timers.ts` dedup of the ticker
(`startTicker`/`stopTicker`) — it crosses files into `message-search.ts` and the
gif panel, so it is a separate F task.

### wc -l (main old and the new files)

```
470  apps/mobile/src/components/chat/voice-recorder.tsx      (main, old)
285  apps/mobile/src/components/chat/voice-recorder.tsx      (barrel after split)
158  apps/mobile/src/components/chat/voice-recorder-flow.ts
 60  apps/mobile/src/components/chat/voice-recorder-gesture.ts
```

All three are well under 400.

### Export list, before vs after

Old `voice-recorder.tsx` (`grep -E "^export"`, 8 names):
`RecorderDecisionDeps` (type), `waveformFromLevels`, `RecorderBeginResult`
(type), `runRecorderBeginEffect`, `runRecorderBegin`, `runRecorderFinish`,
`runRecorderFinishEffect`, `VoiceRecorderButton`.

Barrel after (`voice-recorder.tsx`): `export { runRecorderBegin,
runRecorderBeginEffect, runRecorderFinish, runRecorderFinishEffect,
waveformFromLevels }` + `export type { RecorderBeginResult,
RecorderDecisionDeps }` + `VoiceRecorderButton`. Same 8 names, same kinds. No
importer changes.

New internal exports (not previously public, so not re-exported by the barrel):
flow — `LEVEL_TICK_MS`, `ERROR_VISIBLE_MS`, `formatElapsed` (used by the
component); gesture — `HoldHandlers`, `FlagRef`, `TickerRef`, `startTicker`,
`stopTicker`, `createHoldResponder` (used by the component).

### Deviations from the plan ranges

- Plan said flow `(33–171)`. The two sampling constants at old lines 46–50 fall
  inside that range and are only used by the moved flow code, so they moved too;
  the barrel imports `LEVEL_TICK_MS`/`ERROR_VISIBLE_MS` back.
- Plan said gesture `(195–248)`. `CANCEL_SLIDE_PX` (old line 193), used only by
  `createHoldResponder`, was included with the gesture to avoid a
  gesture→barrel cycle. `HoldHandlers`/`FlagRef`/`TickerRef` moved with it.
- `formatElapsed` was private before; it is now exported by flow and imported by
  the barrel (not re-exported), since the component still renders it.

### Effect ratchet

No `// effect-plain:` marker was needed or added. `voice-recorder.tsx`,
`voice-recorder-flow.ts` and `voice-recorder-gesture.ts` all import `Effect` as
a value, so the map classifies them `effect`. Gate: `PASS effect`.

### Commands run (real results)

- `pnpm --filter @zilar/mobile typecheck` → clean (`tsc --noEmit`, no output).
- `pnpm gate` (single run, from repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.6s)
  PASS  lint  (0.8s)
  PASS  typecheck  (4.0s)
  PASS  effect  (1.9s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  I ran no other tests: there are no test files near this component
  (`find src -name "*.test.*"` in `apps/mobile` returns 16 files, none under
  `components/chat/`), so gate correctly skips them.

### Security checklist

Not applicable: this is a pure move of UI gesture/flow code. No secrets, routes,
storage, network, deletes/updates, caps or audit entries are touched. No new
dependency.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `voice-recorder.tsx` (470 lines) is now 285 lines, plus `voice-recorder-flow` (158) and `voice-recorder-gesture`. The two `VoiceRecorderPort` imports are one.
- **The lead's phone smoke** (mock build, Ana's chat):
  - a short tap on the mic starts and cancels the recorder, and nothing is sent;
  - a 2.5 s hold records a 0:02 voice note.
- **Seen on main too:** sending the voice note shows "Could not send. Check your connection." with Retry, because the mock has no upload handler (wave 2).
- **Check:** the gate passed.
