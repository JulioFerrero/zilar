---
id: T-2179
title: "Merge back runner-tunnel's size-split folders (mux, runner, server): each folder of pieces goes back into its parent file; no behaviour change"
status: merged
milestone: M5
branch: task/T-2179-merge-runner-tunnel
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2179: Merge back runner-tunnel's split folders

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "we can overwrite the 400 lines if we can save on lines of code". About 400 lines per file is now a soft limit; only a file over 800 lines must be split. Files that the old hard cap split only for size may be merged back when that saves lines (`CLAUDE.md`).

The old splits in `packages/runner-tunnel/src` left plumbing behind:
- a parent file that only re-exports its pieces;
- the pieces importing each other;
- each piece repeating the same imports.

One file per module is also easier to read, for people and for AIs.

### Facts (the lead read these on 2026-10-19)
Each group is a parent file plus a folder of the same name. Line counts are `wc -l`. The only importers of the pieces outside their own folder are listed.

1. `packages/runner-tunnel/src/mux.ts` (4 lines, only re-exports) + `packages/runner-tunnel/src/mux/`:
   - `errors.ts` (7);
   - `socket-bridge.ts` (85);
   - `stream-mux.ts` (342);
   - `types.ts` (15).

   453 lines in total; no importer of a piece outside `mux.ts`.
2. `packages/runner-tunnel/src/runner.ts` (66) + `packages/runner-tunnel/src/runner/`:
   - `connection.ts` (149);
   - `handshake.ts` (147);
   - `lifecycle.ts` (229);
   - `options.ts` (74).

   665 lines in total; no importer of a piece outside `runner.ts`.
3. `packages/runner-tunnel/src/server.ts` (194) + `packages/runner-tunnel/src/server/`:
   - `conn.ts` (169);
   - `engine.ts` (61);
   - `handshake.ts` (65);
   - `heartbeat.ts` (22);
   - `options.ts` (43);
   - `preview.ts` (74);
   - `ready.ts` (48).

   676 lines in total. Outside importer: `packages/runner-tunnel/src/desk-server.test.ts`.

### Steps
1. For each group, move every piece's code into the parent file (`mux.ts`, `runner.ts`, `server.ts`), then delete the folder.
   - Order the code so a reader meets types and options first, then helpers, then the main class or function.
   - Keep each piece's code word for word. Change only the imports.
2. Imports:
   - Merge the imports into one block at the top. Drop every import of a sibling piece and every re-export line.
   - A name that was only exported for a sibling stops being exported, unless another file imports it.
3. Importers: `packages/runner-tunnel/src/index.ts` and `packages/runner-tunnel/src/desk-server.test.ts` import from the parent file. No re-export shims, no aliases.
4. Comments:
   - Keep every "why" comment.
   - Drop the file headers that only said "split from" or "moved unchanged".
   - When two pieces' headers said the same thing, keep one.
5. A merged file must stay under 800 lines. If one would pass it, skip that group and say why in the Report.
6. Change no behaviour: no logic, no wording, no renames beyond what the merge needs. Prettier formatting.
7. No new tests.
8. Report the line counts per group.

### Allowed files
- `packages/runner-tunnel/src/mux.ts`
- `packages/runner-tunnel/src/mux/errors.ts`
- `packages/runner-tunnel/src/mux/socket-bridge.ts`
- `packages/runner-tunnel/src/mux/stream-mux.ts`
- `packages/runner-tunnel/src/mux/types.ts`
- `packages/runner-tunnel/src/runner.ts`
- `packages/runner-tunnel/src/runner/connection.ts`
- `packages/runner-tunnel/src/runner/handshake.ts`
- `packages/runner-tunnel/src/runner/lifecycle.ts`
- `packages/runner-tunnel/src/runner/options.ts`
- `packages/runner-tunnel/src/server.ts`
- `packages/runner-tunnel/src/server/conn.ts`
- `packages/runner-tunnel/src/server/engine.ts`
- `packages/runner-tunnel/src/server/handshake.ts`
- `packages/runner-tunnel/src/server/heartbeat.ts`
- `packages/runner-tunnel/src/server/options.ts`
- `packages/runner-tunnel/src/server/preview.ts`
- `packages/runner-tunnel/src/server/ready.ts`
- `packages/runner-tunnel/src/index.ts`
- `packages/runner-tunnel/src/desk-server.test.ts` (import path only)
- `packages/runner-tunnel/src/**` (import lines only, in a file that imported a merged piece)
- `work/T-2179-merge-runner-tunnel.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; the runner-tunnel tests pass unchanged.
- `packages/runner-tunnel/src/mux/`, `runner/` and `server/` no longer exist (or the Report says why one stays).
- Product lines are at least 40 lower.

---

## Report (written by the worker when done)

### What I did

Merged all three split groups back into their parent files, in the order
types/options → helpers → main class or function:

1. `mux.ts`: `types.ts` → `errors.ts` → `notifyFailed` → `StreamMux` → `attachSocketToStream`.
   Deleted `mux/`.
2. `runner.ts`: `options.ts` → runtime type and lifecycle helpers → connection helpers →
   handshake helpers → `RunnerClient`. Deleted `runner/`.
3. `server.ts`: `options.ts` → `ServerConn`/`PendingOpen`/`ServerRuntime` → conn helpers →
   handshake → ready → heartbeat → engine → preview → `TunnelServer`. Deleted `server/`.

Imports were merged into one block per file; all sibling imports and re-export lines are gone.
`desk-server.test.ts` now imports `dropConn`, `ServerConn` and `ServerRuntime` from
`./server.ts`; `index.ts` needed no change (it already imported from the parent files).

Names that only existed for a sibling are no longer exported: `mux.ts` had none to change;
`runner.ts` `stringUrl`, `RunnerOptionsSchema`, `RunnerOptionsDecoded`, `RunnerRuntime`,
`createRunnerRuntime`, `onRunnerEvent`, `startRunner`, `stopRunner`, `installReadyConnection`,
`startHeartbeat`, `interruptHeartbeat`, `teardownConnection`, `notifyClosed`, `routeControl`,
`connectOnce`, `openSocket`, `waitForType`; `server.ts` `HOP_BY_HOP_HEADERS`,
`ServerOptionsSchema`, `ServerOptionsDecoded`, `handleConnection`, `closeWith`,
`takeHandshakeFiber`, `handleBinary`, `handleText`, `handleHello`, `handleAuth`,
`handleReadyMessage`, `failStream`, `checkHeartbeats`, `openEngineStream`, `engineAgent`,
`createPreviewToken`, `handlePreviewRequest`. Still exported because something imports them:
`TunnelServer`, `TunnelServerOptions`, `ServerConn`, `PendingOpen`, `ServerRuntime`, `dropConn`,
`RunnerOptions`, `computeBackoff`, `StreamMux`, `TunnelClosedError`, `attachSocketToStream`,
`StreamSink`, `StreamMuxOptions`.

### Line counts

| Group | Before | After | Saved |
| --- | ---: | ---: | ---: |
| `mux.ts` | 453 | 445 | 8 |
| `runner.ts` | 665 | 618 | 47 |
| `server.ts` | 676 | 628 | 48 |
| **Total** | **1794** | **1691** | **103** |

Every merged file is under 800 lines. The gate's size check prints them as soft-limit warnings only.

### Files changed

- `packages/runner-tunnel/src/mux.ts`, `runner.ts`, `server.ts` (merged code)
- Deleted: `mux/{errors,socket-bridge,stream-mux,types}.ts`,
  `runner/{connection,handshake,lifecycle,options}.ts`,
  `server/{conn,engine,handshake,heartbeat,options,preview,ready}.ts`
- `packages/runner-tunnel/src/desk-server.test.ts` (import path only)
- `work/T-2179-merge-runner-tunnel.md` (status + this report)

### Commands and results

- `pnpm install` from the repo root: done in 23.6s.
- `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot`:
  4 files passed, 27 tests passed.
- `pnpm gate` (final run):
  ```
  gate: 20 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.7s)
  PASS  lint  (0.7s)
  PASS  typecheck  (1.5s)
  PASS  effect  (0.9s)
  PASS  build @zilar/server  (0.5s)
  PASS  tests @zilar/runner-tunnel  (1.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  WARN  size: packages/runner-tunnel/src/mux.ts: 445 lines (main 4); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  WARN  size: packages/runner-tunnel/src/runner.ts: 618 lines (main 66); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  WARN  size: packages/runner-tunnel/src/server.ts: 628 lines (main 194); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```

### Problems found and fixed

- First gate run failed typecheck: `mux.ts` used `Cause` (from the socket bridge) without
  importing it. Added `Cause` to the `effect` import; gate then passed.
- The first package test run failed to resolve `../desk-runner.ts` in `runner.ts` because the
  moved code kept its folder-relative `../` paths. Changed them to `./` (imports only); tests
  then passed.

### Deviations and notes

- Code and comments were moved word for word. The `// effect-plain:` tool directives from
  `engine.ts`, `heartbeat.ts` and `preview.ts` are kept next to their code; the merged files
  import `effect` values, so the effect ratchet classifies them as `effect` anyway.
- The `ServerRuntime` doc comment still says the class "hands it to the sibling modules",
  kept word for word as the spec requires; it is now slightly stale wording, but changing it
  would break the "no wording changes" rule.
- No new tests, no dependency changes.

### Blocked / needs a decision

None.

### Round: pre-review fixes

- Fixed finding 1 (should-fix): `HOP_BY_HOP_HEADERS` in `server.ts` is now a plain `const`
  instead of `export const`, so it is no longer exported. The original Report's claim that
  it had already been unexported was inaccurate; that is corrected here.
- No tests added or adjusted: the finding is a keyword-only, zero-behaviour change and it
  named no test. The touching test file still passes:
  `pnpm --filter @zilar/runner-tunnel test --maxWorkers=2 --reporter=dot src/desk-server.test.ts`
  -> 1 file passed, 7 tests passed.
- Prettier then put the set on one line, so `server.ts` is now 623 lines (was 628);
  every merged file is still under 800 lines.
- No nits, follow-ups, or disagreements.
- `pnpm gate` (final run): GATE PASS — install, format, lint, typecheck, effect,
  build @zilar/server and tests @zilar/runner-tunnel all PASS; scope clean; three
  soft-limit size WARNs; no changed source file over 800 lines.


## Review (written by Claude)

Approved; the pre-review was clean after one autofix round, which dropped an `export` that nothing used. Net −108 across 19 files.

The runner-tunnel `mux/`, `runner/` and `server/` folders are gone. Each module is one file: `mux.ts` (445 lines), `runner.ts` (618), `server.ts` (623). `desk-server.test.ts` imports from `server.ts`.

**Comments:** none lost, by the comment-line diff.

**Checks:** the gate ran the runner-tunnel tests unchanged.
