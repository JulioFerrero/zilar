---
id: T-0806
title: "H2 + H3: runner-tunnel http-agent.ts on Effect, markers for demo.ts (D4) and keys.ts verify, and apps/runner cli.ts and connect.ts on Effect"
status: todo
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

## Review (written by Claude)
