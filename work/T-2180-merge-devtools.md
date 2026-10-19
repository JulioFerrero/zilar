---
id: T-2180
title: "Merge back devtools' size-split folders (lead client, cli, autopilot, watch-app, xmpp-e2e): each folder of pieces goes back into its parent file; no behaviour change"
status: merged
milestone: M5
branch: task/T-2180-merge-devtools
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2180: Merge back devtools' split folders

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "we can overwrite the 400 lines if we can save on lines of code". About 400 lines per file is now a soft limit; only a file over 800 lines must be split. Files that the old hard cap split only for size may be merged back when that saves lines (`CLAUDE.md`).

The old splits in `packages/devtools/src` left plumbing behind:
- parent files that only re-export their pieces;
- pieces importing each other;
- the same imports repeated in every piece.

One file per module is also easier to read, for people and for AIs.

### Facts (the lead read these on 2026-10-19)
Each group is a parent file plus a folder of the same name. Line counts are `wc -l`. The importers of the pieces outside their own folder are listed.

1. `packages/devtools/src/lead/client.ts` (12, only re-exports) + `packages/devtools/src/lead/client/`:
   - `interface.ts` (40);
   - `opencode-cli.ts` (205);
   - `payload.ts` (16);
   - `fake.ts` (125).

   `fake.ts` (`FakeOpenCodeClient`, `FakeSession`) is used only by tests: `lead/autopilot.test.ts`, `lead/free-pause.test.ts` and `lead/launch.test.ts`.
2. `packages/devtools/src/lead/cli.ts` (311) + `packages/devtools/src/lead/cli/`:
   - `args.ts` (11);
   - `commands.ts` (385).

   707 lines in total.
3. `packages/devtools/src/lead/autopilot.ts` (223) + `packages/devtools/src/lead/autopilot/`:
   - `actions.ts` (213);
   - `doctor-tick.ts` (186);
   - `task-info.ts` (68).

   690 lines in total. Outside importer: `packages/devtools/src/lead/doctor.ts:3` imports `extractCounts` and `extractVerdict` from `./autopilot/task-info.js`.
4. `packages/devtools/src/lead/watch-app.tsx` (9, only re-exports) + `packages/devtools/src/lead/watch-app/`:
   - `chrome.tsx` (183);
   - `lines.tsx` (204);
   - `live.tsx` (132);
   - `segments.tsx` (141);
   - `view.tsx` (110).

   779 lines in total.
5. `packages/devtools/src/xmpp-e2e.ts` (13) + `packages/devtools/src/xmpp-e2e/`:
   - `connect.ts` (57);
   - `harness.ts` (110);
   - `main.ts` (271);
   - `muc.ts` (50);
   - `push-pending.ts` (252).

   753 lines in total. Outside importer: `packages/devtools/src/smoke.ts:8` imports `errorMessage` from `./xmpp-e2e/harness`.

### Steps
1. For each group, move every piece's code into the parent file, then delete the folder.
   - Order the code so a reader meets types first, then helpers, then the main entry.
   - Keep each piece's code word for word. Change only the imports.
2. **Group 1, `fake.ts`:** it is test-only code. Move it to `packages/devtools/src/lead/client.test-support.ts` instead of into `client.ts`. The three tests import it from there.
3. Imports:
   - Merge the imports into one block at the top. Drop every import of a sibling piece and every re-export line.
   - A name that was only exported for a sibling stops being exported, unless another file imports it.
4. Importers (`doctor.ts`, `smoke.ts`, the tests and any other file that imported a piece or a parent) import from the parent file. No re-export shims, no aliases.
5. Comments:
   - Keep every "why" comment.
   - Drop file headers that only said "split from" or "moved unchanged".
   - When two pieces' headers said the same thing, keep one.
6. A merged file must stay under 800 lines. If one would pass it, skip that group and say why in the Report.
7. Change no behaviour: no logic, no wording, no output text, no renames beyond what the merge needs. The `lead` CLI, the autopilot and `lead watch` must work exactly as before. Prettier formatting.
8. No new tests.
9. Report the line counts per group.

### Allowed files
- `packages/devtools/src/lead/client.ts`
- `packages/devtools/src/lead/client/interface.ts`
- `packages/devtools/src/lead/client/opencode-cli.ts`
- `packages/devtools/src/lead/client/payload.ts`
- `packages/devtools/src/lead/client/fake.ts`
- `packages/devtools/src/lead/client.test-support.ts` (new)
- `packages/devtools/src/lead/cli.ts`
- `packages/devtools/src/lead/cli/args.ts`
- `packages/devtools/src/lead/cli/commands.ts`
- `packages/devtools/src/lead/autopilot.ts`
- `packages/devtools/src/lead/autopilot/actions.ts`
- `packages/devtools/src/lead/autopilot/doctor-tick.ts`
- `packages/devtools/src/lead/autopilot/task-info.ts`
- `packages/devtools/src/lead/doctor.ts` (import line only)
- `packages/devtools/src/lead/watch-app.tsx`
- `packages/devtools/src/lead/watch-app/chrome.tsx`
- `packages/devtools/src/lead/watch-app/lines.tsx`
- `packages/devtools/src/lead/watch-app/live.tsx`
- `packages/devtools/src/lead/watch-app/segments.tsx`
- `packages/devtools/src/lead/watch-app/view.tsx`
- `packages/devtools/src/xmpp-e2e.ts`
- `packages/devtools/src/xmpp-e2e/connect.ts`
- `packages/devtools/src/xmpp-e2e/harness.ts`
- `packages/devtools/src/xmpp-e2e/main.ts`
- `packages/devtools/src/xmpp-e2e/muc.ts`
- `packages/devtools/src/xmpp-e2e/push-pending.ts`
- `packages/devtools/src/smoke.ts` (import line only)
- `packages/devtools/src/**` (import lines only, in a file or test that imported a merged piece or parent)
- `packages/devtools/package.json` (only if a script path points into a deleted folder)
- `work/T-2180-merge-devtools.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; the devtools tests pass unchanged except for import paths.
- The five folders no longer exist (or the Report says why one stays).
- Product lines are at least 60 lower. `client.test-support.ts` counts as test code.

---

## Report (written by the worker when done)

### What I did

Merged all five split groups back into their parent files and deleted the folders:

1. `lead/client.ts` (253 lines) now holds the interface types, the payload helpers and
   `OpencodeCliClient`. `fake.ts` moved unchanged to
   `lead/client.test-support.ts` (125 lines, test code); the three tests now import
   `FakeOpenCodeClient` from `./client.test-support.js`.
2. `lead/cli.ts` (689) now holds `flag`/`flagValue`, the spec-check helpers, the
   command functions, the batch/merge helpers, `HELP`, `main` and the entry check.
3. `lead/autopilot.ts` (667) now holds `task-info`'s readers, `applyActions`,
   `maybeSweep`, the doctor tick and the poll loop.
4. `lead/watch-app.tsx` (740) now holds the segment helpers, card lines, chrome,
   `WatchApp` and `WatchLive`.
5. `xmpp-e2e.ts` (728) now holds the harness, connect, MUC, push-pending probe and
   `main`.

I also updated the importers: `lead/doctor.ts` imports `extractCounts`/`extractVerdict`
from `./autopilot.js`, `smoke.ts` imports `errorMessage` from `./xmpp-e2e.js`, and the
three tests import the fake from `./client.test-support.js`.

### Line counts per group

| Group | Before | After |
| --- | --- | --- |
| `client` (product; `fake.ts` excluded, `client.test-support.ts` is test code) | 273 | 253 |
| `client.test-support.ts` (test code) | 125 | 125 |
| `cli` | 707 | 689 |
| `autopilot` | 690 | 667 |
| `watch-app` | 779 | 740 |
| `xmpp-e2e` | 753 | 728 |
| **Total** | **3327** | **3202** |
| **Product total** (test code excluded) | **3202** | **3077** |

Product lines are 125 lower (target: at least 60). No file is over 800 lines.

### Files changed

- `packages/devtools/src/lead/client.ts`, `lead/client.test-support.ts` (new)
- `packages/devtools/src/lead/cli.ts`
- `packages/devtools/src/lead/autopilot.ts`
- `packages/devtools/src/lead/watch-app.tsx`
- `packages/devtools/src/xmpp-e2e.ts`
- Import lines only: `lead/doctor.ts`, `smoke.ts`, `lead/autopilot.test.ts`,
  `lead/free-pause.test.ts`, `lead/launch.test.ts`
- Deleted: the five now-empty folders (`lead/client/`, `lead/cli/`,
  `lead/autopilot/`, `lead/watch-app/`, `xmpp-e2e/`)
- `work/T-2180-merge-devtools.md`

### Commands and real results

- `pnpm install`: done in 23.2s (1 deprecated subdependency warning; peer warning in
  `apps/mobile` only).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/autopilot.test.ts src/lead/free-pause.test.ts src/lead/launch.test.ts`:
  3 test files passed, 18 tests passed.
- `pnpm gate`: first run **failed** typecheck because three relative paths still
  pointed one directory too high after the move (`../types.js`, `../watch.js`,
  `../lead/processes.js`). Fixed them, then reran:
  ```
  gate: 31 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.4s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.7s)
  PASS  effect  (0.8s)
  PASS  build @zilar/server  (0.3s)
  PASS  tests @zilar/devtools  (29.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  comments: no task IDs in added comments
  GATE PASS
  ```
  The size check printed soft-limit WARNs for `autopilot.ts`, `cli.ts`,
  `watch-app.tsx` and `xmpp-e2e.ts` (all under 800 and merged on purpose).

### Deviations from the spec

- Moving files up one directory required changing relative module paths, not just
  imports: `client.ts` uses `./types.js`, `watch-app.tsx` uses `./watch.js`, and
  `xmpp-e2e.ts` uses `./lead/processes.js` plus `../../../apps/server/src/xmpp/*`.
  Its `repoRoot` URL also went from `../../../../` to `../../../`.
- `xmpp-e2e.ts` now runs `main()` only when `process.argv[1]` ends with
  `xmpp-e2e.ts`, like `lead/cli.ts` does. The old entry ran unconditionally, but
  `smoke.ts` imports `errorMessage` from this module, so an unconditional run would
  start the spike on import.
- Dropped the `view.tsx` header because it repeated the parent's `WatchApp` header
  (spec step 5).
- Kept the descriptive section comments from `chrome.tsx`, `lines.tsx`,
  `segments.tsx`, `harness.ts` and `main.ts`; all "why" comments are unchanged.
- Names that were exported only for sibling pieces are no longer exported
  (`readDataPayload`, `sessionIdSchema`, `applyActions`, `maybeSweep`,
  `tickDoctor`, `readTaskInfo`, `prereviewInfo`, `TickResult`, the segment helpers,
  `EmptyCard`, `LiveStepLine`, the xmpp helpers). `extractCounts`/`extractVerdict`,
  `tickOnce`, `runAutopilot`, `AutopilotDeps`, `errorMessage` and all names the
  parent re-exported publicly stay exported.

### Problems / open questions

None. No new tests, no dependency changes, and no behaviour changes beyond the
entry guard noted above.


## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −125 product lines.

The five size-split folders are gone (lead `client/`, `cli/`, `autopilot/`, `watch-app/`, `xmpp-e2e/`). Each now lives in one file:
- `client.ts`: 253 lines;
- `cli.ts`: 689;
- `autopilot.ts`: 667;
- `watch-app.tsx`: 740;
- `xmpp-e2e.ts`: 728.

The test-only fake client moved to `lead/client.test-support.ts`.

**Comments:** only the "barrel over `client/`" header went. The `WatchApp` testing note moved into the file header.

**Checks:**
- The lead ran `lead status` and `lead` (usage) from the branch; both work.
- The only lazy import (`watch.ts` → `./watch-app.js`) still resolves.
- The gate ran the devtools tests.
