---
id: T-0201
title: Runner: connect.test.ts waits for the runner to be live instead of a fixed 200 ms sleep (CI flake)
status: merged
milestone: M5
branch: task/T-0201-runner-connect-test-flake
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0201: Runner connect test flakes on CI

## Spec (written by Claude, do not edit)

### Why
GitHub CI, 2026-10-05: `pnpm test` failed in `@zilar/runner`:
`src/connect.test.ts > runRunner > connects an approved key, then stops cleanly on signal`, `AssertionError: expected false to be true` at `src/connect.test.ts:39`. The test sleeps a fixed 200 ms and then expects the runner to be live; on a slow CI machine the handshake takes longer. It is a test timing bug, not a runner bug (the same file's other tests and the real e2e test passed in that run).

### Verified facts (do not re-derive)
- `apps/runner/src/connect.test.ts` line 38 and line 83 both do `await new Promise((resolve) => setTimeout(resolve, 200));` followed by `expect(server.isRunnerLive(identity.machineId)).toBe(true);` (lines 39 and 84).
- `packages/runner-tunnel/src/test-harness.ts` line 24 exports `waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>`, which polls every 10 ms and throws `timed out waiting for <label>` after the deadline.
- `connect.test.ts` line 9 already imports `startFakeGateway` from `'../../../packages/runner-tunnel/src/test-harness.ts'`.

### What to build
1. In `apps/runner/src/connect.test.ts`, add `waitFor` to the existing import on line 9.
2. Replace the sleep on line 38 with `await waitFor(() => server.isRunnerLive(identity.machineId), 5_000, 'runner live');` and keep the `expect(...).toBe(true)` on the next line.
3. Do the same for the sleep on line 83.
4. Change nothing else.

### Read first
`AGENTS.md`, `apps/runner/src/connect.test.ts`, `packages/runner-tunnel/src/test-harness.ts` (lines 24-39).

### Allowed files
`apps/runner/src/connect.test.ts`, `work/T-0201-runner-connect-test-flake.md`.

### Checks
```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/runner test --maxWorkers=2 src/connect.test.ts
pnpm gate
```
Run the connect test three times in a row and report all three results.

### Acceptance
- No fixed sleep remains before an `isRunnerLive` assertion in `connect.test.ts`.
- The connect tests pass three runs in a row; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Any change to runner or tunnel source code, other test files, timeouts in `package.json`.

---

## Report (written by the worker when done)

Did exactly what the spec asked, nothing else:
- `apps/runner/src/connect.test.ts` line 9: added `waitFor` to the existing `test-harness.ts` import.
- Line 38 and line 83: replaced the fixed `await new Promise((resolve) => setTimeout(resolve, 200))` with `await waitFor(() => server.isRunnerLive(identity.machineId), 5_000, 'runner live');`. The `expect(...).toBe(true)` assertions on the next lines are unchanged.
- No fixed sleep remains before any `isRunnerLive` assertion (verified with grep: only `waitFor` + `expect` remain).

Files changed: `apps/runner/src/connect.test.ts`, `work/T-0201-runner-connect-test-flake.md`.

Commands and real results:
- `pnpm install`: pass (10.4s).
- `pnpm --filter @zilar/runner test --maxWorkers=2 src/connect.test.ts`, three runs in a row: 13 passed each time (336ms / 268ms / 505ms).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (oxlint clean).
- `pnpm typecheck`: pass (11 tasks successful).
- `pnpm gate`: GATE PASS — install/format/lint/typecheck/tests @zilar/runner all PASS, "every changed file is inside the Allowed files".

Problems/deviations: none. Security checklist: test-only change, no secrets, no routes, no deletes, no caps — not applicable.

## Review (written by Claude)

**Verdict:** Approved, first round. Both fixed 200 ms sleeps in `connect.test.ts` now poll `isRunnerLive` with the existing `waitFor` helper (5 s deadline), which removes the CI flake seen on 2026-10-05; nothing else changed. Three local runs green, gate PASS, pre-review clean. Note: launched on MiniMax M3, the session failed at once because `effort: low` is not a MiniMax variant; the lead moved it to Muse with `lead switch-model` (the `model:` line above now says what ran).
