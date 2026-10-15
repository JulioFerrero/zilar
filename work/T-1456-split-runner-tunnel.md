---
id: T-1456
title: "400-line rule: split packages/runner-tunnel runner.ts (656), server.ts (619) and mux.ts (471) by the size plan, with one shared closeQuietly and stringUrl; no behaviour change"
status: merged
milestone: M5
branch: task/T-1456-split-runner-tunnel
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1456: Split runner-tunnel

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-10): at most 400 lines per source file. The split plan is `docs/audit/size-plan.md`, items #44, #50 and #88 (lines 143, 149 and 190). Their line numbers are from an older version, so split by the **sections** they name, not by the numbers.

### Facts (the lead read them on main, 2026-10-15)
- **The files:**
  - `packages/runner-tunnel/src/runner.ts` is 656 lines;
  - `packages/runner-tunnel/src/server.ts` is 619;
  - `packages/runner-tunnel/src/mux.ts` is 471.
- **Tests:** the package has `auth.test.ts`, `desk-runner.test.ts`, `desk-server.test.ts` and `keys.test.ts`, run with `vitest run`. `packages/runner-tunnel/src/index.ts` is the public barrel. Consumers import from the package, so keep every export name and its path through `index.ts`.

### What to build
1. **`runner.ts`** → `src/runner/options.ts`, `runner/lifecycle.ts`, `runner/handshake.ts`, `runner/connection.ts` and `runner/model-listener.ts` (plan #44). The `RunnerClient` class shell stays in `runner.ts`, which re-exports what it re-exported before.
2. **`server.ts`** → `src/server/options.ts`, `server/conn.ts`, `server/handshake.ts`, `server/ready.ts`, `server/engine.ts`, `server/preview.ts` and `server/heartbeat.ts` (plan #50). The class shell stays.
3. **`mux.ts`** → `src/mux/errors.ts`, `mux/types.ts`, `mux/stream-mux.ts` and `mux/socket-bridge.ts` (plan #88). `mux.ts` becomes a barrel.
4. **Dedup** (plan): one `closeQuietly(ws, code?, reason?)` in a new `src/ws-close.ts`, used by runner and server; one `stringUrl` shared; one `notifyFailed` in the mux.
5. **No behaviour change**: the same exports, messages, timers and close codes. Every new and old file is at 400 lines or fewer (aim for 350).

### Tests
None new. All existing runner-tunnel tests must pass unchanged.

### Allowed files
- `packages/runner-tunnel/src/runner.ts`, `packages/runner-tunnel/src/server.ts`, `packages/runner-tunnel/src/mux.ts`, `packages/runner-tunnel/src/index.ts`, `packages/runner-tunnel/src/ws-close.ts`
- new files under `packages/runner-tunnel/src/runner/`, `packages/runner-tunnel/src/server/` and `packages/runner-tunnel/src/mux/`
- `work/T-1456-split-runner-tunnel.md`

### Checks
```bash
pnpm --filter @zilar/runner-tunnel exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes and the existing tests pass.
- No file in the package is above 400 lines.

---

## Report (written by the worker when done)

Status: done, gate green. Pure size split of `packages/runner-tunnel` (`runner.ts`
656, `server.ts` 619, `mux.ts` 471) with the three dedups the plan names. No
behaviour change: same exports, messages, timers, close codes and stream-id
parity.

### What I did

- **`mux.ts` (471) → barrel** re-exporting everything it exported before:
  `TunnelClosedError`, `StreamMux`, `attachSocketToStream`, `StreamSink`,
  `StreamMuxOptions` (plan #88).
- **`runner.ts` (656) → shell** (`RunnerClient` + `computeBackoff`/`RunnerOptions`
  re-exports) plus `runner/options.ts`, `runner/lifecycle.ts`,
  `runner/handshake.ts`, `runner/connection.ts`, `runner/model-listener.ts`
  (plan #44).
- **`server.ts` (619) → shell** (`TunnelServer` + `TunnelServerOptions`
  re-export) plus `server/options.ts`, `server/conn.ts`, `server/handshake.ts`,
  `server/ready.ts`, `server/engine.ts`, `server/preview.ts`,
  `server/heartbeat.ts` (plan #50).
- **Dedup (plan).** One `closeQuietly(ws, code?, reason?)` in the new
  `src/ws-close.ts`, used by runner and server (no code terminates, a code closes
  gracefully, so both old `close`/`terminate` blocks keep their behaviour). One
  `stringUrl` in `runner/options.ts`, imported by `server/options.ts`. One
  module-private `notifyFailed(sink, err)` in `mux/stream-mux.ts` replacing the
  three `try`/`sink.onFailed` blocks in `handleBinary`/`failStream`/`failAll`.
- **How the class methods moved.** TypeScript `private` fields cannot be reached
  from another module, so each class keeps a private runtime object
  (`RunnerRuntime` in `runner/lifecycle.ts`, `ServerRuntime` in `server/conn.ts`)
  and the sibling modules are functions over it. The class keeps its fields
  (`runnerId`), constructor, getters, `on`, `start`, `stop`, `static start`,
  `close` and the public getters/helpers; every method body moved unchanged
  (`this.x` → `rt.x`). `index.ts` is untouched.

### Files and `wc -l` (old → new)

```
runner.ts       656 -> 90   server.ts      619 -> 205   mux.ts  471 -> 4
runner/options.ts          80      server/options.ts     47
runner/lifecycle.ts       248      server/conn.ts       167
runner/handshake.ts       147      server/handshake.ts   65
runner/connection.ts      151      server/ready.ts       73
runner/model-listener.ts   35      server/engine.ts      61
                                   server/preview.ts     75
                                   server/heartbeat.ts   22
mux/errors.ts               7      mux/socket-bridge.ts  87
mux/types.ts               19      mux/stream-mux.ts    359
ws-close.ts (new, shared)  20
```

Largest file 359 (`mux/stream-mux.ts`); all ≤ 400.

### Exports

Before (from `main`):

```
runner.ts: RunnerOptionsSchema, RunnerOptions (type), computeBackoff, RunnerClient
server.ts: TunnelServerOptions (type), TunnelServer
mux.ts:    TunnelClosedError, StreamSink (type), StreamMuxOptions (type), StreamMux, attachSocketToStream
```

After (the barrels):

```
runner.ts: export { computeBackoff } from './runner/options.ts'
           export type { RunnerOptions } from './runner/options.ts'
           export class RunnerClient
server.ts: export type { TunnelServerOptions } from './server/options.ts'
           export class TunnelServer
mux.ts:    export { TunnelClosedError } from './mux/errors.ts'
           export { StreamMux } from './mux/stream-mux.ts'
           export { attachSocketToStream } from './mux/socket-bridge.ts'
           export type { StreamSink, StreamMuxOptions } from './mux/types.ts'
```

Same names and kinds. `RunnerOptionsSchema` now also exists in
`runner/options.ts` (it was module-private in `runner.ts` and is still not part of
the package index). No importer changed; `index.ts` is untouched.

### Effect ratchet

`docs/audit/split-rules.md` item 6 applies to six new files that hold code moved
unchanged from `runner.ts`/`server.ts` and hit a hard/weak signal without an
`effect` value import. Each carries a marker in its first line:

- `runner/model-listener.ts`, `server/engine.ts`, `server/ready.ts`,
  `server/preview.ts`: `// effect-plain: moved unchanged from packages/runner-tunnel/src/server.ts (size split)` (model-listener names `runner.ts`).
- `server/heartbeat.ts`: `// effect-plain: moved unchanged from packages/runner-tunnel/src/server.ts (size split)`.
- `ws-close.ts`: `// effect-plain: moved unchanged from packages/runner-tunnel/src/runner.ts and server.ts (size split)`.

No marker was added for any other reason. The other new files import `effect`
(`lifecycle.ts`, `connection.ts`, `handshake.ts`, `conn.ts`, …) or are signal-free
(`options.ts`, `types.ts`, `errors.ts`, the barrels), so no marker was needed.

### Commands run (real results)

- `pnpm install` — Done in 25s (no lockfile change).
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot src/auth.test.ts` — **15 passed**.
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot` — **4 files, 25 tests passed**.
- `pnpm gate` — **GATE PASS** (install, format, lint, typecheck, effect, tests
  `@zilar/runner-tunnel`, scope, size). Summary lines:

```
PASS  install (frozen)  (0.9s)
PASS  format  (1.2s)
PASS  lint  (1.1s)
PASS  typecheck  (1.9s)
PASS  effect  (2.3s)
PASS  tests @zilar/runner-tunnel  (4.1s)
scope: every changed file is inside the Allowed files
size: every changed source file is within 400 lines
GATE PASS
```

Two earlier gate runs failed and were fixed in scope: prettier formatting in
`server/conn.ts` (ran `prettier --write` on the task's files), and an unused
`Cause` import in `mux/stream-mux.ts` lint error.

### Deviations / notes

- Method bodies were moved as free functions over a private runtime object rather
  than copied verbatim; the plan says the class shell stays, and TypeScript cannot
  share `private` state across files any other way. No `any`, no `@ts-ignore`, no
  new dependency.
- The dedup changed `closeQuietly` call sites from `try { ws.close(...) } catch {}`
  to one helper; the close/terminate choice is preserved exactly.
- `TunnelServer.desk` was a public `readonly` field and is now a getter returning
  the same `DeskServer`; reads are unchanged.

### Open questions / blocked

None.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 2. This is a pure split:
- `runner.ts`, `server.ts` and `mux.ts` now delegate to `runner/`, `server/` and `mux/`, with a shared `ws-close.ts`.
- The largest source file is `mux/stream-mux.ts` at 359 lines.
- The 25 runner-tunnel tests pass, and `apps/runner` typechecks.
