---
id: T-1635
title: "Size split: packages/desk/src/agent/docker.ts is at 397 lines — move the pure docker-run argument builders (createArgs and its flag helpers) into docker-args.ts, re-exported from docker.ts, no behaviour change"
status: merged
milestone: M5
branch: task/T-1635-split-desk-docker
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1635: Split the desk agent's docker.ts

## Spec (written by Claude, do not edit)

### Why
`packages/desk/src/agent/docker.ts` is at 397 lines, against a limit of 400. AI computers just went live, and the next jail flag (a resource limit, an extra host) would cross the limit.

### Facts (the lead read them on 2026-10-16)
- **The pure argument builders** are `keepAliveFlags` (`:64`), `mountFlags` (`:68`), `proxyFlags` (`:72`), `isIpv4Literal` (`:86`), `export async function proxyAddress(network, host)` (`:101`, which pins the proxy IP because gVisor can't use Docker's DNS) and `export function createArgs(...)` (`:135`).
- **The runtime part** stays: `execFile` (`:34`), `daemonRequest` (`:55`), `readDaemon` (`:182`), `decodeResponse`, `decodeDaemonLine`, `createDockerLayer` (`:269`) and `bridgeDaemon` (`:374`).
- **`DockerLayer`** (`:12`) and **`DESK_LABEL`** (`:32`) stay in `docker.ts`.
- **The importers** of these names: `packages/desk/src/agent/index.ts`, `packages/desk/src/agent/main.ts` and `packages/desk/src/agent/server.test.ts`.

### Steps
1. **Move `keepAliveFlags`, `mountFlags`, `proxyFlags`, `isIpv4Literal`, `proxyAddress` and `createArgs`** (with their comments) into a new file `packages/desk/src/agent/docker-args.ts`.
   - If `proxyAddress` calls `execFile`, pass it in or move a small shared `execFile` into `docker-args.ts` and import it back in `docker.ts`. Don't duplicate it.
2. **In `docker.ts`,** import what it uses and add `export { createArgs, proxyAddress } from './docker-args';`, so no importer changes.
3. **No behaviour change.** The jail's `docker run` arguments must be byte-identical.
4. **Say in the Report** what moved and the new line counts.

### Allowed files
- `packages/desk/src/agent/docker.ts`
- `packages/desk/src/agent/docker-args.ts`
- `work/T-1635-split-desk-docker.md`

### Checks
```bash
pnpm --filter @zilar/desk exec vitest run src/agent --reporter=dot
pnpm gate
```

### Acceptance
- **`docker.ts` is under 300 lines.**
- **The desk agent tests pass unchanged.**

---

## Report (written by the worker when done)

### What I did
Moved the pure `docker run` argument builders out of `docker.ts` into the new
`docker-args.ts`, with their comments and no logic change:

- Moved: `keepAliveFlags`, `mountFlags`, `proxyFlags`, `isIpv4Literal`,
  `proxyAddress` (still `export`ed) and `createArgs` (still `export`ed).
- Also moved the shared `execFile` helper into `docker-args.ts` (now
  `export function execFile`) and imported it back into `docker.ts` (spec step 1
  alternative: "move a small shared `execFile` into `docker-args.ts` and import it
  back"). It is not duplicated, and `proxyAddress`'s signature is unchanged.
- `docker.ts` imports `createArgs`, `execFile` and `proxyAddress` from
  `./docker-args` and re-exports the two public names, so `index.ts` and
  `server.test.ts` need no changes.
- `DockerLayer` and `DESK_LABEL` stay in `docker.ts`. `docker-args.ts` imports
  `DESK_LABEL` from `./docker`, which creates a `docker.ts` ↔ `docker-args.ts`
  cycle. It is safe: `DESK_LABEL` is only read inside `createArgs`, which runs at
  call time, after both modules have finished evaluating. All 39 agent tests pass,
  so the cycle loads fine.
- No behaviour change: the `createArgs` body and every flag string are byte-identical.

Deviation from spec step 2: it suggested `export { createArgs, proxyAddress } from './docker-args';`.
I used `export { createArgs, proxyAddress };` after the local import instead, so the
module has a single `import ... from './docker-args'` line (avoids a duplicate-import
lint hit) while exporting exactly the same names. No importer changed.

Line counts: `docker.ts` 397 → 264 lines; new `docker-args.ts` 146 lines.

### Files changed
- `packages/desk/src/agent/docker.ts` (modified, 264 lines)
- `packages/desk/src/agent/docker-args.ts` (new, 146 lines)
- `work/T-1635-split-desk-docker.md` (status + this report)

### Checks run
- `pnpm --filter @zilar/desk exec vitest run src/agent --maxWorkers=2 --reporter=dot`
  → `Test Files 4 passed (4)`, `Tests 39 passed (39)`.
- `pnpm gate` from the repo root → `GATE PASS`. Summary lines:
```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (0.8s)
PASS  lint  (2.2s)
PASS  typecheck  (2.9s)
PASS  effect  (0.9s)
PASS  tests @zilar/desk  (1.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead
- Acceptance met: `docker.ts` is 264 lines (< 300) and the desk agent tests pass
  unchanged (39 passed).
- The only non-obvious point is the `docker.ts` ↔ `docker-args.ts` cycle described
  above; it works at runtime because `DESK_LABEL` is read lazily. If you would rather
  remove the cycle, `DESK_LABEL` would have to move to `docker-args.ts` and be
  re-exported from `docker.ts`, which the spec said not to do, so I left it in place.
- No new dependencies, no API/signature changes.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 1 nit.
- **The split:** `docker.ts` went from 397 to 264 lines, and the new `docker-args.ts` is 146. `createArgs` and `proxyAddress` are re-exported, so no importer changed.
- **The tests:** the lead ran `vitest run src/agent` in `@zilar/desk`: 4 files, 39 tests passed.
- **The nit, accepted:** `docker-args.ts` imports `DESK_LABEL` from `docker.ts`, which imports back. `DESK_LABEL` is only read inside `createArgs` at call time, so the ESM cycle is safe, and the gate's lint passed. If the cycle ever bites, move `DESK_LABEL` into `docker-args.ts` and re-export it.
