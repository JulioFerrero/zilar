---
id: T-0210
title: Lead tooling: `lead watch` shows each task's speed (tokens per second, seconds per step, context size, a small speed sparkline)
status: planned
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
- `lead watch` was added by T-0209 in `packages/devtools/src/lead/watch.ts` (`runWatch`, `renderWatch`, `WatchView`, `liveStep`) with tests in `packages/devtools/src/lead/watch.test.ts`. Read both on main before you start: the lead has not seen the merged code yet when writing this, so follow their structure rather than this spec's guesses about it.

### What to build
1. In `packages/devtools/src/lead/watch.ts`, a pure exported `sessionSpeed(messages: unknown[]): { tokPerSec: number; secPerStep: number; context: number; spark: number[] } | null` (null when fewer than 2 usable steps; defensive on unknown shapes, never throws). Fetch 20 messages per session instead of the current number.
2. Add the speed to each task entry of `WatchView` and render the line above in `renderWatch` (colours as described; no escape codes when `color` is false; never longer than the width).
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

## Review (written by Claude)
