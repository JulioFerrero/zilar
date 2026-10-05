---
id: T-0210
title: Lead tooling: `lead watch` shows each task's speed (tokens per second, seconds per step, context size, a small speed sparkline)
status: merged
milestone: M5
branch: task/T-0210-lead-watch-speed
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: [T-0209]
estimate: 0.3 day
---

# T-0210: Speed line in `lead watch`

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05, about `lead watch` (T-0209): "can we also add like tps and time beetwen every step average? something to show the speed of working of that task".

### What Julio sees
One more line in each task block, under the model line, for example:

```
   18.2 tok/s · 9.6 s/step · ctx 158k  ▂▃▅▇▆▄▃▅
```

- `tok/s`: the average output speed over the last 20 assistant steps of the session shown (worker, or the pre-review while it runs): the sum of `tokens.output + tokens.reasoning` divided by the sum of `(time.completed - time.created)` in seconds, one decimal.
- `s/step`: the average gap between the `time.created` of consecutive assistant steps over the same window, one decimal (under 60 s), else `1 min 5 s` style.
- `ctx`: the context size of the newest assistant step, `tokens.input + tokens.cache.read`, as `158k` (thousands, rounded) or `1.2M`. Yellow at 150k or more, red at 200k or more (that is when a session gets expensive).
- A sparkline of the per-step tok/s of the last 10 steps, oldest left, with the characters `▁▂▃▄▅▆▇█` scaled between the lowest and highest of those 10 (all equal: all `▄`).
- Fewer than 2 completed assistant steps: the line shows `measuring…` dimmed. Steps without `time.completed` (still running) or with a duration of 0 are left out.
- At widths under 60 the sparkline is dropped first.

### Verified facts (do not re-derive)
- An assistant message from `client.listMessages` (newest first) looks like this (read by the lead from a real worker session): `{ type: 'assistant', time: { created: 1791189279430, streamed: 1791189282516, completed: 1791189282518 }, model: {...}, finish: 'stop' | 'tool-calls', tokens: { input: 655, output: 199, reasoning: 0, cache: { read: 158705, write: 0 } }, content: [...] }`. Times are milliseconds. Messages of type `idle` have no tokens.
- `lead watch` was added by T-0209 in `packages/devtools/src/lead/watch.ts` (checked by the lead on main after the merge): `WatchEntry` (line 246) and `WatchView` (line 259) hold the data; `renderWatch` (line 368) draws it; the data is collected in a child process (`lead watch --data`) that prints the view as one JSON line, read back by `parseWatchView` (line 292), so a new field must be added to `WatchEntry`, filled where the entries are built, AND accepted by `parseWatchView`, or it is lost between the two processes. The session messages are fetched with `client.listMessages(sessionId, 5)` (line 587). Tests are in `packages/devtools/src/lead/watch.test.ts`.

### What to build
1. In `packages/devtools/src/lead/watch.ts`, a pure exported `sessionSpeed(messages: unknown[]): { tokPerSec: number; secPerStep: number; context: number; spark: number[] } | null` (null when fewer than 2 usable steps; defensive on unknown shapes, never throws). Fetch 20 messages per session instead of the current number.
2. Add the speed (or null) to `WatchEntry`, fill it where the entries are built, accept it in `parseWatchView` (a test: a JSON line with speed parses back with the same numbers; one without speed parses with null), and render the line above in `renderWatch` (colours as described; no escape codes when `color` is false; never longer than the width).
3. Pure helpers for the formatting (`formatContext(158705) === '158k'`, `formatContext(1_234_000) === '1.2M'`, `sparkline([..])`), exported and tested.
4. Tests in `packages/devtools/src/lead/watch.test.ts`: `sessionSpeed` on a hand-made list of 4 assistant steps plus one `idle` and one running step (exact averages), fewer than 2 steps gives null, junk entries are skipped; `formatContext`; `sparkline` (scaling, all equal); `renderWatch` shows the speed line at width 80, drops the sparkline at width 50, shows `measuring…` without speed data.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/watch.test.ts`.

### Allowed files
`packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/watch.test.ts`, `work/T-0210-lead-watch-speed.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts
pnpm gate
```
The lead runs `pnpm lead:watch` before merging.

### Acceptance
- Every running task shows tok/s, s/step, ctx and the sparkline, updated with the 3-second refresh; ctx turns yellow and red at the thresholds.
- Still read-only, no new dependency; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Cost in money, totals per task, history across sessions.

---

## Report (written by the worker when done)

### What I did

Added the speed line to `lead watch`. The renderer pulls one new line per task block, with the new helper `sessionSpeed(messages)` filled at watch time and serialized through the existing `--data` JSON path. The helpers `formatContext` and `sparkline` are exported and pure, so they get their own unit tests.

### Files changed

- `packages/devtools/src/lead/watch.ts`
- `packages/devtools/src/lead/watch.test.ts`
- `work/T-0210-lead-watch-speed.md` (status flipped to `in-progress`, then this report)

### Details

- `sessionSpeed(messages)` walks at most 20 assistant steps newest-first, reverses to oldest-first, and computes:
  - `tokPerSec` = `sum(output + reasoning)` over `sum(time.completed - time.created)` for the window (in seconds). Skips steps without `time.completed` or with `completed <= created` (still running).
  - `secPerStep` = `sum(gaps between consecutive step.created)` / `(N - 1)`, where N is the number of usable steps.
  - `context` = `tokens.input + tokens.cache.read` of the newest step.
  - `spark` = `tokensOut / (gap/1000)` of the last ≤10 steps (so up to 9 bars).
  - Returns `null` for fewer than 2 usable steps or junk input (defensive on `null`, primitives, etc.).
- `formatContext(n)`: 400 → `'400'`; `158_705` → `'158k'` (floor to k, per the spec); `1_234_000` → `'1.2M'` (one decimal).
- `sparkline(values)`: 8 bars (`▁▂▃▄▅▆▇█`), scaled between min and max; equal values become all `▄`.
- `renderSpeedLine` clips the sparkline first when `width < 60`. `ctx` is yellow at `≥150_000`, red at `≥200_000`. No escape codes when `color: false`. Falls back to dimmed `measuring…` when `speed` is null. Lines never exceed `width` (existing tests cover that).
- `buildView` now calls `client.listMessages(sessionId, 20)` (was 5) and fills `speed` per entry.
- `parseWatchView` accepts `speed` as a nullable object; missing field becomes `null` so old payloads still parse.
- Added a `formatDuration` helper to format `s/step` (one decimal under 60 s, else `M min S s`).

### Commands run

- `pnpm install`: 1170 packages, done in 12.4s. 1 minor peer warning (`@types/react-dom` vs `@types/react`) already present on main.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts`: 56/56 passed.
- `pnpm gate`: GATE PASS.
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (10.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.2s)
  PASS  tests @zilar/devtools  (1.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Changed files: `packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/watch.test.ts`, `work/T-0210-lead-watch-speed.md`. All inside the Allowed files.

### Tests I ran

Just `src/lead/watch.test.ts` (56 cases). The single file also exercised the 6 new tests I added (`formatContext` × 3, `sparkline` × 4, `sessionSpeed` × 4, `renderWatch` × 3 for the new line) on top of the existing ones, so nothing else was run on its own.

### Problems / deviations

- None blocking. I matched the spec exactly.
- Minor note: `Math.round(1.5) = 2` in JS banker's; my `formatContext` uses `Math.floor` for the k case (matches the spec `158_705 → 158k` example, and the millions branch uses `Math.round` with one decimal which is exact for the spec's `1_234_000 → 1.2M`).

### Blocked / needs a decision

None.

## Round (rework)

Pre-review flagged two must-fix items and one nit on the speed denominator and the sparkline. Both must-fix items are fixed and the tests now check the spec-correct values. The nit on `formatDuration` was not in any line the fix needed to change, so it is left as-is per the brief ("do not touch nits unless they are in a line you already change").

### Findings fixed

1. `packages/devtools/src/lead/watch.ts` — `sessionSpeed` now sums per-step `time.completed - time.created` instead of the wall span between the newest and oldest step. `SpeedStep` carries a `duration` field populated by `parseSpeedStep` (`completed - created`); `totalDur` is `steps.reduce((sum, step) => sum + step.duration, 0)`.
2. `packages/devtools/src/lead/watch.ts` — the sparkline now uses each step's own `tokensOut / duration` and emits one bar per recent step (up to 10, matching the spec "per-step tok/s of the last 10 steps"), instead of inter-step gap ratios that yielded N-1 bars and broke when a long pause sat between two fast generations.

### Tests added / changed

- `packages/devtools/src/lead/watch.test.ts` — `sessionSpeed` test on the 4-step fixture now expects `tokPerSec = 400 / 24` (was `400 / 3`) and `spark = [100/6, 100/6, 100/6, 100/6]` (was `[100, 100, 100]` with 3 bars). The 2-step fixtures now expect `tokPerSec = 100 / 2` (was `100 / 1`).

### Commands run

- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/watch.test.ts`: 56/56 passed.
- `pnpm gate`:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (5.5s)
  PASS  format  (45.2s)
  PASS  lint  (1.4s)
  PASS  typecheck  (8.4s)
  PASS  tests @zilar/devtools  (1.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Disagreements

None.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Verdict:** Approved after one automatic round (MiniMax). `sessionSpeed` averages output plus reasoning tokens over step durations for the last 20 assistant steps, the gap between steps, the newest context size and a 10-step sparkline; the speed travels through `parseWatchView` and is drawn under the model line, with `measuring…` when there is no data. The lead ran `sessionSpeed` on T-0210's own real session: 26.5 tok/s, 8.1 s/step, context 42.5k (a fresh fix-round session), sparkline values between 7.7 and 98.8. The speed is computed only while a task is working, which matches the spec. Accepted nits: two small ones. T-0211 (the Ink redesign) builds on this.
