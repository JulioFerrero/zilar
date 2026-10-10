---
id: T-0888
title: "Composer.voice.test.tsx is deterministic: no real 500 ms waits, a controlled clock for the 400 ms hold"
status: merged
milestone: M5
branch: task/T-0888-composer-voice-test-deterministic
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0888: Composer.voice.test.tsx is deterministic

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/components/Composer.voice.test.tsx` (308 lines, 11 tests) fails 1 to 7 of its tests per run whenever the machine is loaded, on main as well as on every branch. Five wave 3 and wave 4 workers reported it on 2026-10-09/10, and T-0842 only made the assertions wait. The usual error is "Unable to find a label with the text of: Send voice message".

The test relies on real time:
- **Real waits:** it waits with `await new Promise((resolve) => setTimeout(resolve, 500))` at lines 138, 223, 246 and 273, to cross the 400 ms hold threshold (the comment is at :136).
- **A real tick:** it also uses a real `setTimeout(resolve, 0)` tick at :35.
- **The race:** under load the 500 ms wait and the component's own hold measurement race each other.

### What to build
1. Read `apps/web/src/components/Composer.tsx` and whatever it uses for the voice hold, then report how it measures the hold: `Date.now`, `performance.now`, `setTimeout`, or an Effect `sleep`/`Clock`.
2. Make the test control that clock:
   - **Plain timers or `Date.now`:** use `vi.useFakeTimers({ shouldAdvanceTime: false })`, and replace each real 500 ms wait with `await act(() => vi.advanceTimersByTimeAsync(500))`.
   - **An Effect clock:** use the existing test pattern for Effect time in `apps/web/src` (search for `TestClock` or `advanceTimersByTimeAsync` in other web tests), or inject the hold threshold or clock through the existing props/context if one exists.
   - **No product changes** unless the component has a real timing bug, in which case describe it and fix it minimally.
3. Keep every test's scenario and assertions. Only the waiting mechanism changes.
4. **Prove it:** run the file 20 times in a row (`for i in $(seq 20); do pnpm --filter @zilar/web exec vitest run --reporter=dot src/components/Composer.voice.test.tsx || echo FAIL; done`) and report the pass count, with `uptime` next to it. All 20 must pass.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), `work/T-0842-*.md` (the earlier attempt), the test file and `Composer.tsx`.

### Allowed files
`apps/web/src/components/Composer.voice.test.tsx`, `apps/web/src/components/Composer.tsx`, `apps/web/src/components/composer/**`, `apps/web/src/lib/voice*.ts`, `work/T-0888-composer-voice-test-deterministic.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/components/Composer.voice.test.tsx src/components/Composer.test.tsx
pnpm --filter @zilar/web typecheck
pnpm exec oxlint <your changed files>
```
Run the voice file 20 times as described above.

### Acceptance
- 20 of 20 runs pass, with the load noted.
- oxlint and the typecheck are clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

- Hold is measured in `Composer.tsx` with `Effect.sleep(HOLD_MS)` (HOLD_MS = 400, :53, :676), which runs on the global `setTimeout`. No product change.
- Test now fakes only `setTimeout`/`clearTimeout` (`vi.useFakeTimers({ toFake, shouldAdvanceTime: false })`) from `pressMic`/`holdMic` until release. The four real 500 ms waits became `crossHold()` = `advanceTimersByTimeAsync(500)` inside `act`, then real timers. The `flushStart` tick uses a `setTimeout` captured before faking. Short-press tests no longer race the 400 ms timer under load either.
- In-window `findBy*` became `getBy*` (RTL waitFor hangs on fake timers); real timers are restored before later async finds.
- Runs: 20 of 20 passed, load average 38.63 / 78.99 / 117.89 at the end (up to ~140 earlier). Before the fix a run failed 1 to 7 tests at this load.
- Checks: Composer.voice + Composer tests 44 passed; web typecheck clean; oxlint clean; prettier clean. `pnpm gate` not run (wave mode).

## Review (written by Claude)

**Lead, 2026-10-10: approved.** The hold is `Effect.sleep(400)` on the global `setTimeout`, so the test now fakes only `setTimeout`/`clearTimeout` around each press and advances the clock past the hold. The scenarios are unchanged. The file passed 20 of 20 runs under load. It was the only failure left in the wave 3 combined check, so it lands with wave 3.
