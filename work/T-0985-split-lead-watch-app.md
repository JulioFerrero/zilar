---
id: T-0985
title: "Size split T39: packages/devtools/src/lead/watch-app.tsx (735 lines) into lead/watch-app/{segments,lines,chrome,view,live}.tsx, the old path a barrel; one useSpinner"
status: merged
milestone: M5
branch: task/T-0985-split-lead-watch-app
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0985: Split `lead/watch-app.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/devtools/src/lead/watch-app.tsx` is 735 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #35 (task T39): `lead/watch-app/segments.tsx`, `lead/watch-app/lines.tsx`, `lead/watch-app/chrome.tsx`, `lead/watch-app/view.tsx`, `lead/watch-app/live.tsx`, under `packages/devtools/src/`. `lead/watch-app.tsx` becomes the barrel.

- **In scope:** the in-file Dedup. The two spinner-frame expressions become one `useSpinner()` in `segments.tsx`.
- **Already done:** T-0975 split `lead/watch.ts`, and it lazy-imports `../watch-app.js`. That path must still resolve.
- **Proof:** run `pnpm exec tsx src/lead/cli.ts watch --data` in `packages/devtools`, check that it still exits 0, and paste the first line of its output.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #35, `packages/devtools/src/lead/watch-app.tsx`, and `packages/devtools/src/lead/watch/cli.ts`.

### Allowed files
`packages/devtools/src/lead/watch-app.tsx`, `packages/devtools/src/lead/watch-app/segments.tsx`, `packages/devtools/src/lead/watch-app/lines.tsx`, `packages/devtools/src/lead/watch-app/chrome.tsx`, `packages/devtools/src/lead/watch-app/view.tsx`, `packages/devtools/src/lead/watch-app/live.tsx`, `work/T-0985-split-lead-watch-app.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the `watch --data` line.

---

## Report

**What I did.** Split `packages/devtools/src/lead/watch-app.tsx` (735 lines) exactly as
`docs/audit/split-rules.md` and `docs/audit/size-plan.md` §2.2 #35 say, into
`lead/watch-app/{segments,lines,chrome,view,live}.tsx`; `watch-app.tsx` is now a 13-line barrel.
Code was moved unchanged. The one in-file dedup is applied: the spinner-frame expression that
`LiveStepLine` and `TaskCard` each repeated is now one `useSpinner()` in `segments.tsx`. No
importer changed: `watch/cli.ts` still dynamically imports `../watch-app.js`, which now resolves
to the barrel, and the barrel re-exports all 11 names the old file exported. No plan module came
out over 400 lines, so no further split was needed.

**Files changed (Allowed files only).**
- `packages/devtools/src/lead/watch-app.tsx` — 735 → 13 lines (barrel).
- `packages/devtools/src/lead/watch-app/segments.tsx` — new.
- `packages/devtools/src/lead/watch-app/lines.tsx` — new.
- `packages/devtools/src/lead/watch-app/chrome.tsx` — new.
- `packages/devtools/src/lead/watch-app/view.tsx` — new.
- `packages/devtools/src/lead/watch-app/live.tsx` — new.
- `work/T-0985-split-lead-watch-app.md` — this report and the status.

**`wc -l`.** old `watch-app.tsx`: **735**. New: `segments.tsx` **146**, `lines.tsx` **206**,
`chrome.tsx` **191**, `view.tsx` **112**, `live.tsx` **137**; barrel `watch-app.tsx` **13**.
Every file is ≤ 400 lines.

**Export list before → after.** Before (`git show main:packages/devtools/src/lead/watch-app.tsx | grep -E "^export"`), 11 names:
`badgeSegs`, `ModelBadge`, `StepTracker`, `speedSegs`, `FilesLine`, `Header`, `TaskCard`,
`Footer`, `WatchAppProps` (interface), `WatchApp`, `WatchLive`.

After, the barrel re-exports exactly those 11:

```
export { WatchLive } from './watch-app/live.js';
export type { WatchAppProps } from './watch-app/view.js';
export { WatchApp } from './watch-app/view.js';
export { Footer, Header, TaskCard } from './watch-app/chrome.js';
export { badgeSegs, FilesLine, ModelBadge, speedSegs, StepTracker } from './watch-app/lines.js';
```

The new modules export additional names only for cross-file use inside the split
(`Seg`, `Border`, `HEADER_ROWS`, `rowsOf`, `rowHeights`, `segLen`, `truncateSegs`, `Line`,
`topBorder`, `plainTop`, `bottom`, `bodyLine`, `useSpinner` in `segments.tsx`; `EmptyCard`,
`LiveStepLine` were private before and are now exported by `chrome.tsx`/`lines.tsx`). None of
these is added to the barrel, so the public surface is unchanged.

**Commands run.**
- `pnpm exec tsx src/lead/cli.ts watch --data` in `packages/devtools`: **exit 0**.
  First output line: `{"clock":"19:52:38","refreshFailed":false,"mergedToday":133,"entries":[{"id":"T-0979","title":"\"Size split T28: apps/mo…` (truncated for this report).
- `pnpm gate` from the repo root:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.5s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/devtools  (19.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- Single tests: none run separately. The gate ran `tests @zilar/devtools` (the package's nearest
  tests; `packages/devtools` has no test beside `watch-app`).

**Effect ratchet.** No `// effect-plain:` marker was added. `packages/devtools/` is exempt in the
map (`packages/devtools/src/effect-map/generate.ts`), and the gate's `effect` step passed.

**Security checklist.** Pure terminal-view code: no network, storage, permissions, secrets or
data handling; no new route. Nothing in the checklist applies.

**Open questions.** None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `lead/watch-app.tsx` (735 lines) becomes a barrel plus 5 files under `lead/watch-app/`, the largest `lines.tsx` at 206. One `useSpinner` replaces the two copies.
- **The command still works:** `lead watch --data` exits 0.
- **Check:** the gate passed.
