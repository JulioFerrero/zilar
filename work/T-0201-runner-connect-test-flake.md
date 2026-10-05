---
id: T-0201
title: Runner: connect.test.ts waits for the runner to be live instead of a fixed 200 ms sleep (CI flake)
status: planned
milestone: M5
branch: task/T-0201-runner-connect-test-flake
model: minimax-coding-plan/MiniMax-M3
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

## Review (written by Claude)
