---
id: T-2143
title: "Packages: fold single-use files into their only importer — the seven desk tool files into desk/tools/index.ts, docker-network into docker.ts, the xmpp-core stanza decoder into stanza.ts, protocol block choices into blocks.ts; no behaviour change"
status: merged
milestone: M5
branch: task/T-2143-package-folds
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2143: Fold single-use package files

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit; only a file over 800 lines must split. The lead read these at `d2ebd6afd`. Each mover has exactly one production importer, the host:

| Mover (lines) | Host (lines) | Tests that import the mover |
| --- | --- | --- |
| `packages/desk/src/tools/bash.ts` (41), `edit.ts` (62), `git.ts` (77), `glob.ts` (44), `grep.ts` (99), `read.ts` (48), `write.ts` (33) | `packages/desk/src/tools/index.ts` (19) | `packages/desk/src/file-tools.test.ts` (edit, read), `packages/desk/src/git.test.ts` (git) |
| `packages/desk/src/agent/docker-network.ts` (136) | `packages/desk/src/agent/docker.ts` (323) | — |
| `packages/xmpp-core/src/stanza/decode.ts` (278) | `packages/xmpp-core/src/stanza.ts` (125) | `packages/xmpp-core/src/stanza.test.ts` |
| `packages/protocol/src/blocks-choices.ts` (153) | `packages/protocol/src/blocks.ts` (258) | — |

### Steps
1. **Fold.** For each row, move the mover's code into the host and delete the mover. Then:
   - remove `export`s that nothing outside the host uses, but keep every name the package's `src/index.ts` re-exports;
   - drop declarations that become duplicates.
2. **The desk tools.** `index.ts` keeps the `tools` record as its main export, with the seven `run…`/`…Args` pairs above it.
3. **The stanza decoder.** `stanza/decode.ts` imports `MAX_STATUS_CHARS` from `./build-outgoing`; keep that import working. If folding would create an import cycle between `stanza.ts` and `stanza/build-outgoing.ts`, skip this row and say why.
4. **Tests.** Update the import path, or the `vi.mock(...)` path, in each listed test; change nothing else in it. No new tests.

### Rules
- No behaviour change: the same tool arguments, outputs, errors and stanza parsing.
- The diff only moves code and removes import/export lines and duplicates.
- Product lines go down by at least 25.

### Allowed files
- `packages/desk/src/tools/bash.ts`
- `packages/desk/src/tools/edit.ts`
- `packages/desk/src/tools/git.ts`
- `packages/desk/src/tools/glob.ts`
- `packages/desk/src/tools/grep.ts`
- `packages/desk/src/tools/read.ts`
- `packages/desk/src/tools/write.ts`
- `packages/desk/src/tools/index.ts`
- `packages/desk/src/file-tools.test.ts`
- `packages/desk/src/git.test.ts`
- `packages/desk/src/agent/docker-network.ts`
- `packages/desk/src/agent/docker.ts`
- `packages/xmpp-core/src/stanza/decode.ts`
- `packages/xmpp-core/src/stanza.ts`
- `packages/xmpp-core/src/stanza.test.ts`
- `packages/protocol/src/blocks-choices.ts`
- `packages/protocol/src/blocks.ts`
- `work/T-2143-package-folds.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, including the desk, xmpp-core and protocol tests.
- Product lines go down by at least 25.
- The Report lists each row: folded (lines saved) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Folded every mover into its only production importer and deleted the mover:

- **desk tools — folded, 31 lines saved.** The seven `run…`/`…Args` pairs now live in `packages/desk/src/tools/index.ts` above the `tools` record; `tools/bash.ts`, `edit.ts`, `git.ts`, `glob.ts`, `grep.ts`, `read.ts` and `write.ts` are deleted. `runEdit`, `runRead` and `runGit` stay exported because the two tests import them from `./tools`; the other run functions and all `…Args` types are now module-private. The two `DEFAULT_MAX_RESULTS` constants became `DEFAULT_GLOB_RESULTS` (1000) and `DEFAULT_MAX_RESULTS` (200) so both survive without a duplicate. `file-tools.test.ts` now imports `{ runEdit, runRead } from './tools'`; `git.test.ts` imports `{ runGit } from './tools'`.
- **docker-network — folded, 2 lines saved.** `packages/desk/src/agent/docker-network.ts` is deleted; its network helpers live in `docker.ts` next to `DESK_LABEL`. Only `docker.ts` used them, so they are private now; `containerAddress` and `egressContainerId` were added to the existing `./docker-args` import.
- **xmpp-core stanza decoder — folded, 3 lines saved.** `packages/xmpp-core/src/stanza/decode.ts` is deleted and its contents live in `stanza.ts`. `MAX_STATUS_CHARS` is imported from `./stanza/build-outgoing` (no cycle: nothing under `stanza/` imports `stanza.ts`). The module augmentation now names `'./types'`. The test imports `MAX_BODY_BYTES`, `capBody` and `utf8ByteLength` from `./stanza`.
- **protocol block choices — folded, 14 lines saved.** `packages/protocol/src/blocks-choices.ts` is deleted; its six schemas and types live in `blocks.ts` before `BlockSchema`, with the `export * from './blocks-choices'` removed. The schemas keep their `export`s because `src/index.ts` reaches them through `blocks.ts`.

Net product change: 50 lines fewer (953 insertions, 1004 deletions including the task file status change).

### Checks run

- `pnpm install`: completed, 1155 packages.
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/file-tools.test.ts src/git.test.ts`: 2 files, 9 tests passed.
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/stanza.test.ts`: 1 file, 95 tests passed.
- `pnpm --filter @zilar/protocol test --maxWorkers=2 --reporter=dot src/payload.test.ts`: 1 file, 17 tests passed.
- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent/lifecycle.test.ts`: 1 file, 16 tests passed.
- `pnpm gate`: GATE PASS. Summary lines:
  - `gate: 18 changed file(s) against main`
  - `PASS  install (frozen)  (2.0s)`
  - `PASS  format  (1.0s)`
  - `PASS  lint  (1.3s)`
  - `PASS  typecheck  (3.3s)`
  - `PASS  effect  (0.9s)`
  - `PASS  build @zilar/server  (0.4s)`
  - `PASS  tests @zilar/desk  (1.7s)`
  - `PASS  tests @zilar/protocol  (1.0s)`
  - `PASS  tests @zilar/xmpp-core  (0.9s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
  - `GATE PASS`

### Notes for the lead

- The gate reports `WARN size: packages/desk/src/agent/docker.ts: 457 lines (main 323); limit 400 (soft limit 400; fine when keeping the file whole saves lines)`. This is the expected consequence of folding `docker-network.ts` into its host; the spec's fold keeps that file whole and it stays under the hard 800-line limit.
- Nothing was skipped: every row was folded and no import cycle appeared.
- No behaviour change: only imports/exports were removed and declarations moved.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit). Net −51, all rows folded:
- the seven desk tool files into `desk/tools/index.ts`, where glob's `DEFAULT_MAX_RESULTS` became `DEFAULT_GLOB_RESULTS` so it no longer collides with grep's;
- `docker-network.ts` into `docker.ts`;
- the stanza decoder into `xmpp-core/src/stanza.ts`, with no import cycle;
- the block choices into `protocol/src/blocks.ts`.

The pre-review checked mechanically that every moved line exists verbatim in its host. No comment was lost (the lead diffed the comment lines). The gate ran the desk, xmpp-core and protocol tests.
