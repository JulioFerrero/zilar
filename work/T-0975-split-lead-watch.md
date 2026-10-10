---
id: T-0975
title: "Size split T27: packages/devtools/src/lead/watch.ts (818 lines) into lead/watch/{live-step,changed-files,format,speed,view,collect,cli}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0975-split-lead-watch
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0975: Split `lead/watch.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/devtools/src/lead/watch.ts` is 818 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #23 (task T27): `lead/watch/live-step.ts`, `lead/watch/changed-files.ts`, `lead/watch/format.ts`, `lead/watch/speed.ts`, `lead/watch/view.ts`, `lead/watch/collect.ts`, `lead/watch/cli.ts`, under `packages/devtools/src/`. `lead/watch.ts` becomes the barrel.

Skip the entry's Dedup (`findRepoRoot` and `isRecord`), because it crosses files.

`lead watch` must still start. Run `pnpm exec tsx src/lead/cli.ts watch --once` in `packages/devtools`, or the nearest one-shot, no-side-effect form (read `cli.ts`), and paste the first lines of output.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #23, and `packages/devtools/src/lead/watch.ts`.

### Allowed files
`packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/watch/live-step.ts`, `packages/devtools/src/lead/watch/changed-files.ts`, `packages/devtools/src/lead/watch/format.ts`, `packages/devtools/src/lead/watch/speed.ts`, `packages/devtools/src/lead/watch/view.ts`, `packages/devtools/src/lead/watch/collect.ts`, `packages/devtools/src/lead/watch/cli.ts`, `work/T-0975-split-lead-watch.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the watch output.

---

## Report (written by the worker when done)

### What I did

Split `packages/devtools/src/lead/watch.ts` (818 lines) into `lead/watch/{live-step,changed-files,format,speed,view,collect,cli}.ts` following `docs/audit/split-rules.md` and `docs/audit/size-plan.md` §2.2 #23. `lead/watch.ts` is now a 20-line barrel that re-exports the same 23 names, with the same value/type kinds. Code was moved unchanged; only import specifiers were rebased to the new folder depth and three formerly file-private helpers were exported (see Deviations). The plan entry's Dedup (`findRepoRoot` → `lead/repo-root.ts`, `isRecord` → `lead/is-record.ts`) was skipped exactly as the spec says, because it crosses files.

### Files changed (all inside Allowed files)

- `packages/devtools/src/lead/watch.ts` (barrel, rewritten)
- `packages/devtools/src/lead/watch/live-step.ts` (new)
- `packages/devtools/src/lead/watch/changed-files.ts` (new)
- `packages/devtools/src/lead/watch/format.ts` (new)
- `packages/devtools/src/lead/watch/speed.ts` (new)
- `packages/devtools/src/lead/watch/view.ts` (new)
- `packages/devtools/src/lead/watch/collect.ts` (new)
- `packages/devtools/src/lead/watch/cli.ts` (new)
- `work/T-0975-split-lead-watch.md` (this Report + status)

### `wc -l` before and after

- old `lead/watch.ts`: 818
- `lead/watch.ts` (barrel): 20
- `lead/watch/live-step.ts`: 88
- `lead/watch/changed-files.ts`: 76
- `lead/watch/format.ts`: 84
- `lead/watch/speed.ts`: 113
- `lead/watch/view.ts`: 117
- `lead/watch/collect.ts`: 286
- `lead/watch/cli.ts`: 90

Every file is well under the 400-line limit; the net +56 lines are the seven file headers and one set of imports per file (the old single file had one import block).

### Export diff (`grep -E "^export"`)

Old `lead/watch.ts` exported 23 names, in this order: `REFRESH_INTERVAL_MS`; `FileKind` (type); `ChangedFile` (type); `liveStep`; `parseChangedFiles`; `modelLabel`; `formatContext`; `sparkline`; `SessionSpeed` (type); `sessionSpeed`; `formatDuration`; `WatchEntry` (type); `WatchView` (type); `parseWatchView`; `formatClock`; `collectFiles`; `boardModelFor`; `BoardTaskFacts` (type); `boardTaskEntry`; `buildView`; `runWatchData`; `fullClearOnResize`; `runWatch`.

The barrel re-exports all 23, unchanged:

```diff
+ export { REFRESH_INTERVAL_MS, fullClearOnResize, runWatch, runWatchData } from './watch/cli.js';
+ export type { ChangedFile, FileKind } from './watch/changed-files.js';
+ export { parseChangedFiles } from './watch/changed-files.js';
+ export { liveStep } from './watch/live-step.js';
+ export { formatClock, formatContext, formatDuration, modelLabel, sparkline } from './watch/format.js';
+ export type { SessionSpeed } from './watch/speed.js';
+ export { sessionSpeed } from './watch/speed.js';
+ export type { WatchEntry, WatchView } from './watch/view.js';
+ export { parseWatchView } from './watch/view.js';
+ export type { BoardTaskFacts } from './watch/collect.js';
+ export { boardModelFor, boardTaskEntry, buildView, collectFiles } from './watch/collect.js';
```

No name was dropped or changed kind. The only entries in the new files that are not in the old file's export list are three helpers that were private in the old file and had to become module exports so a sibling module could use them (they are **not** re-exported by the barrel, so the public surface is unchanged): `isRecord` (`live-step.ts`), `isRunningPhase` and `chooseSessionId` (`view.ts`).

### Commands and real results

- `pnpm install` — `Done in 13.7s` (peer-dependency warnings only, pre-existing).
- `pnpm exec tsx src/lead/cli.ts watch --data` (run in `packages/devtools`) — exit 0, one JSON line on stdout, first lines:
  `{"clock":"19:39:02","refreshFailed":false,"mergedToday":127,"entries":[{"id":"T-0971","title":"\"Size split T25: apps/web/src/components/MessageBubble.tsx (846 lines) into components/message/{SendFailure,MessageMeta,BigEmoji,AttachmentBody,MessageTextBody,MessageMenu}.tsx; one MessageMenu for both bubbles\"","modelLabel":"deepseek-flash (default)","model":"deepseek/deepseek-flash","effort":"defaul...`
  This is the nearest one-shot, no-side-effect form of the `watch` command (`--data` calls `runWatchData`, which builds the view once and prints it; plain `watch` only takes `--no-icons` and starts the live Ink app). `lead watch` still starts and decodes its own output.
- `pnpm gate` (repo root) — summary:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.5s)
  PASS  lint  (0.9s)
  PASS  typecheck  (2.6s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/devtools  (16.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (First gate run failed `format` on the barrel's over-long `format.js` export line; reformatted and re-ran to the pass above.)
- Single test files: none. There is no test for `watch.ts` (`ls src/lead | grep watch.*test` → none), and split-rules item 5 says write no new tests. No other package was touched, so the gate ran only the `@zilar/devtools` tests.

### Deviations from the spec

- **Skipped Dedup, as instructed.** To avoid creating `lead/is-record.ts` / `lead/repo-root.ts` (outside Allowed files), the helpers that the moved code still shares across the new files are handled by exporting them from their new home: `isRecord` lives in `live-step.ts` (its plan range, 40–117, contains it) and is imported by `speed.ts`; `isRunningPhase` and `chooseSessionId` stay in `view.ts` (range 369–478) and are imported by `collect.ts`. None is added to the barrel.
- `REFRESH_INTERVAL_MS` (old line 27) is not named by any range in the plan entry; I put it in `watch/cli.ts`, next to `runWatch`, which is what the live app refreshes against. Say the word if you want it elsewhere.
- Import specifiers were rebased for the new folder (e.g. `./collect-snapshot.js` → `../collect-snapshot.js`, `../effect-map/generate.js` → `../../effect-map/generate.js`, the lazy `./watch-format.js` → `../watch-format.js`, `./watch-app.js` → `../watch-app.js`). No file outside the Allowed files was edited, so importers are unchanged.
- Each new file got a one-line header comment; the old file's top comment was replaced by the barrel comment.

No blocked items, no open questions, no security-relevant surface (this is a TUI/read-only viewer; no routes, writes, secrets or DB access).

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `lead/watch.ts` (818 lines) becomes a barrel plus 7 files under `lead/watch/`, the largest `collect.ts` at 286.
- **The command still works:** `lead watch --data` prints the view as one JSON line.
- **Check:** the gate passed.
