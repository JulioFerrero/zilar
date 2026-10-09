---
id: T-0806
title: "H2 + H3: runner-tunnel http-agent.ts on Effect, markers for demo.ts (D4) and keys.ts verify, and apps/runner cli.ts and connect.ts on Effect"
status: merged
milestone: M5
branch: task/T-0806-runner-chain
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0806: H2 + H3: runner-tunnel http-agent.ts on Effect, markers for demo.ts (D4) and keys.ts verify, and apps/runner cli.ts and connect.ts on Effect

## Spec (written by Claude, do not edit)

### Why
This is part of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. It runs in **wave 1** of the batch mode Julio chose on 2026-10-09: the lead checks the whole wave once and sends every failure back. Plan rows H2 and H3 (lines 354-355); Julio chose one worker per chain. H1 (`mux.ts`, T-0798) is merged. The plan flags "Julio: runner traffic (AI desks)".

### Verified facts (do not re-derive)
- **`packages/runner-tunnel/src/http-agent.ts`** (76 lines, H1 H8; `node:http` at line 1). Convert it; `node:http` stays as the platform edge.
- **`packages/runner-tunnel/src/demo.ts`** (198 lines) has an npm script (`packages/runner-tunnel/package.json:12`, `"demo": "node src/demo.ts"`). Decision D4 (plan line 501) is to **mark it**: `// effect-plain: manual demo script (npm run demo), not shipped`.
- **`packages/runner-tunnel/src/keys.ts`** (99 lines, W4): `verifyNonce` (line 44) is a pure check that returns false and never throws (`try` at line 45, around `createPublicKey` and the verify). Use `Effect.runSync(Effect.try(...).pipe(Effect.orElseSucceed(() => false)))` or a marker with the reason "pure signature check; failure is false". Prefer the Effect, and keep the result identical for every input.
- **`apps/runner/src/cli.ts`** (296 lines, H1 W4 W7), tested in `cli.test.ts`, and **`apps/runner/src/connect.ts`** (154 lines, H1 W4), tested in `connect.test.ts`. The CLI entry may run its program with `NodeRuntime.runMain` (`@effect/platform-node`; add it to `apps/runner/package.json` only if it is missing) and keep its env reads (W7 at the entry is allowed). Keep its output text and exit codes identical; `cli.test.ts` checks them.
- **The runner-tunnel tests** (12 files, 71 tests after T-0798) and the `apps/runner` tests must pass unchanged.

### What to build
Convert and mark as above.

Follow `docs/EFFECT_BRIEF.md` (the wave rules, the building blocks and the traps).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, `packages/runner-tunnel/src/http-agent.ts`, `keys.ts`, `keys.test.ts`, `demo.ts:1-20`, `apps/runner/src/cli.ts`, `connect.ts` and their tests, and `packages/runner-tunnel/src/mux.ts` (the T-0798 pattern).

### Allowed files
`packages/runner-tunnel/src/http-agent.ts`, `packages/runner-tunnel/src/demo.ts`, `packages/runner-tunnel/src/keys.ts`, `apps/runner/src/cli.ts`, `apps/runner/src/connect.ts`, `apps/runner/package.json`, `pnpm-lock.yaml`, `work/T-0806-runner-chain.md`.

### Checks (wave mode: your own tests and your package typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/runner-tunnel exec vitest run --reporter=dot
pnpm --filter @zilar/runner exec vitest run --reporter=dot
pnpm --filter @zilar/runner-tunnel typecheck
pnpm --filter @zilar/runner typecheck
```
Run the tests 3 times when the code has timers or concurrency. Run `pnpm exec prettier --write` on your changed files before committing.

### Acceptance
- Each listed source file is `effect` (or carries a valid marker where the task says so) in `pnpm effect:map`.
- Exported names, signatures, texts and behaviour are unchanged, or each difference is listed in the Report.
- Existing tests pass unchanged; new tests pass; the package typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

- effect:map kinds (after): `http-agent.ts` effect (tier B: `Deferred.await` matches the H1 `await` pattern, `node:http` is H8), `keys.ts` effect (no signals left), `connect.ts` effect (tier B: only `Deferred.await` hits H1), `cli.ts` effect (only `process.env` in `defaultIo`, W7 at the entry), `demo.ts` exempt (marker `effect-plain: manual demo script (npm run demo), not shipped`, markers now 9/25). Before: all five were needs-effect.
- What changed: `keys.ts` `verifyNonce` is `Effect.runSync(Effect.try(...).pipe(Effect.orElseSucceed(() => false)))`. `http-agent.ts` `createLoopbackPair` is `createLoopbackPairEffect` (Effect.callback for listen, Deferred for the accepted socket) plus a Promise export of the same name; `createConnection` runs the dial with `Effect.runFork(Effect.tryPromise(...).pipe(Effect.match(...)))`. `connect.ts` has `runRunnerEffect` (Deferred for the failure, `Effect.raceFirst` of failure and abort, `Effect.ensuring` for cleanup) and `runRunner` as `Effect.runPromise` of it; `validateHubUrl` keeps its throwing signature on top of a `Result`. `cli.ts` has `runCliEffect` (commands are Effects, `Effect.matchCause` plus `Cause.squash` feeds the unchanged `describeError`) and `runCli` as `Effect.runPromise` of it; the entry uses `Effect.runFork` then `process.exit(exitCode)`. `runRunner` is still imported from `./connect.ts` as a Promise function because `cli.test.ts` mocks it.
- Exports, signatures, texts and exit codes: unchanged. `NodeRuntime.runMain` not used, so `apps/runner/package.json` and the lockfile are unchanged (no new dependency).
- Tests: runner-tunnel 12 files / 71 tests before and after, 3 runs all green. apps/runner 6 files / 63 tests before and after, 3 runs all green (plus 8 extra runs of `connect.test.ts`). Both typechecks clean. One early runner-tunnel run (right after `pnpm install`) failed once in `server.effect.test.ts` (`raw.destroy()` area), not reproduced in 7 later runs; I did not run a baseline for it.
- Bug caught on the way: my first `waitForSignalOrFailure` checked `signal.aborted` when the Effect was built, not when it ran, so an abort during `client.start()` hung (`connect.test.ts` timed out about 50 percent of runs, baseline 0/8). Fixed with `Effect.suspend`; 8 of 8 green after.
- Behaviour differences: (1) the SIGINT/SIGTERM listeners in `run` are now removed also when `runRunner` rejects (before they leaked); (2) a `process.exit` / output order is the same, but the entry no longer uses top-level `await` (same exit code, same moment). Otherwise none.
- Unsure: the tier B tag on `connect.ts` and `http-agent.ts` is only the `Deferred.await` name matching the H1 regex; I left it rather than rename calls.

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved. The lead reviewed the Report. The wave 1 combined check (all 12 branches on one tree, by hand) passed the whole-repo typecheck and every package suite: web 1916, server 2279, mobile 2222, xmpp-core 245, runner 63, runner-tunnel 71, devtools 796 after the T-0799 fix, chat-core 174, protocol 174.
- Worker: Sonnet 5.5. H2 + H3: http-agent, keys, connect and cli are Effect files, and `demo.ts` is marked; runner 63 and tunnel 71 tests pass 3 of 3 runs. Accepted: the signal listeners are now removed on failure as well.
