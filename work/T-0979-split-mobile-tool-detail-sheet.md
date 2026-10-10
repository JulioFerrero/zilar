---
id: T-0979
title: "Size split T28: apps/mobile/src/components/ais/tool-detail-sheet.tsx (808 lines) into ais/{tool-run-blocks,tool-detail-body,tool-detail-loader}.tsx; one ShowMoreButton"
status: merged
milestone: M5
branch: task/T-0979-split-mobile-tool-detail-sheet
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0979: Split `tool-detail-sheet.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/ais/tool-detail-sheet.tsx` is 808 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #24 (task T28): `components/ais/tool-run-blocks.tsx`, `ais/tool-detail-body.tsx` and `ais/tool-detail-loader.tsx`, under `apps/mobile/src/`. `tool-detail-sheet.tsx` keeps the sheet and every export it has today.

The in-file Dedup is in scope: the three "Show all" / "Show less" ghost buttons become one `ShowMoreButton` in `tool-run-blocks.tsx`, with the same texts and styles.

The lead runs a phone smoke of an AI's tools in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #24, and `apps/mobile/src/components/ais/tool-detail-sheet.tsx`.

### Allowed files
`apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `apps/mobile/src/components/ais/tool-run-blocks.tsx`, `apps/mobile/src/components/ais/tool-detail-body.tsx`, `apps/mobile/src/components/ais/tool-detail-loader.tsx`, `work/T-0979-split-mobile-tool-detail-sheet.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the Report names the route that opens this sheet, for the lead's smoke.

---

## Report (written by the worker when done)

### What I did

Split `apps/mobile/src/components/ais/tool-detail-sheet.tsx` (808 lines) into three new
files exactly as `docs/audit/size-plan.md` §2.2 #24 lays out, following
`docs/audit/split-rules.md`:

- `tool-run-blocks.tsx` — `RunRow` + `RunResultBlock` plus the in-file Dedup: the three
  identical "Show all"/"Show less" ghost buttons are now one private `ShowMoreButton`
  (same texts, same styles, same `accessibilityLabel`). The two block functions are
  exported so the body can use them; they were private before and are not re-exported
  by the barrel.
- `tool-detail-body.tsx` — `ToolDetailBodyState`, `ToolDetailBodyActions` and
  `ToolDetailBody` (the read-only body). Hook-free as before.
- `tool-detail-loader.tsx` — the load + revert/run/delete controller `ToolDetailLoader`,
  plus the `LoadedDetail` type, `ToolCallFailed`, `toolCall` and `failureText`, and the
  three exported constants (`TOOL_DETAIL_LOAD_FAILED_MESSAGE`,
  `TOOL_VERSION_LOAD_FAILED_MESSAGE`, `SHEET_SCROLL_TAPS_PERSIST`).
- `tool-detail-sheet.tsx` — now a 58-line file that keeps `ToolDetailSheet` and
  re-exports every name it exported before (same names and kinds). The `ToolCallFailed`
  class is not exported.

No behaviour change: all moved code is byte-identical apart from the `ShowMoreButton`
Dedup (3 copies → 1). No importer changed; `tools-section.tsx` still imports
`ToolDetailSheet` from `./tool-detail-sheet`.

### Files changed

`apps/mobile/src/components/ais/tool-detail-sheet.tsx` (modified),
`apps/mobile/src/components/ais/tool-run-blocks.tsx` (new),
`apps/mobile/src/components/ais/tool-detail-body.tsx` (new),
`apps/mobile/src/components/ais/tool-detail-loader.tsx` (new),
`work/T-0979-split-mobile-tool-detail-sheet.md` (this file).

### Line counts (`wc -l`)

| File | Before | After |
| --- | ---: | ---: |
| `tool-detail-sheet.tsx` | 808 | 58 |
| `tool-run-blocks.tsx` | — | 97 |
| `tool-detail-body.tsx` | — | 328 |
| `tool-detail-loader.tsx` | — | 336 |

Every file is ≤ 400 lines. No module needed a second split.

### Exports, before (`git show HEAD:…tool-detail-sheet.tsx`) vs after

Before:

```ts
export const TOOL_DETAIL_LOAD_FAILED_MESSAGE
export const TOOL_VERSION_LOAD_FAILED_MESSAGE
export const SHEET_SCROLL_TAPS_PERSIST
export type ToolDetailBodyState
export type ToolDetailBodyActions
export function ToolDetailBody
export function ToolDetailSheet
```

After — the barrel re-exports the same seven names/ kinds,
`export type { ToolDetailBodyActions, ToolDetailBodyState } from './tool-detail-body'`,
`export { ToolDetailBody } from './tool-detail-body'`,
`export { SHEET_SCROLL_TAPS_PERSIST, TOOL_DETAIL_LOAD_FAILED_MESSAGE, TOOL_VERSION_LOAD_FAILED_MESSAGE } from './tool-detail-loader'`,
and keeps `export function ToolDetailSheet`. The new files additionally export `RunRow`,
`RunResultBlock` (run-blocks) and `ToolDetailLoader` (loader) for cross-file use; these
were private before and are not re-exported, so the public surface is unchanged.

### Checks

I ran no per-file test: there is no test file near this component, and the gate reported
`SKIP tests @zilar/mobile (no nearby test files)`. I did not run format/lint/typecheck by
hand; the gate ran them once.

`pnpm gate` from the repo root:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (0.6s)
PASS  lint  (1.4s)
PASS  typecheck  (3.2s)
PASS  effect  (1.6s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Effect ratchet

No `// effect-plain:` marker was added. `tool-detail-loader.tsx` imports `effect` as a
value (`Data`, `Effect`) and `AsyncResult`, so the map classifies it `effect`.
`tool-run-blocks.tsx`, `tool-detail-body.tsx` and the barrel are plain UI with no hard or
weak signals. The gate's `effect` step passed.

### Route for the lead's phone smoke

Expo Router route `ais/[id]` (`apps/mobile/src/app/ais/[id].tsx`): open an AI, scroll to
its **Tools** section, tap a tool row — that opens `ToolDetailSheet`, which renders
`ToolDetailLoader` → `ToolDetailBody` with source, version history, Run now and Recent
runs blocks. Running a tool with a truncated output shows the single `ShowMoreButton`.

### Deviations / open questions

None. The plan's line ranges matched the current file except for small drift; I followed
the current code. The three constants are placed in `tool-detail-loader.tsx` (they are
used there) and re-exported by the barrel, which keeps the export list identical.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `tool-detail-sheet.tsx` (808 lines) becomes the sheet plus `tool-run-blocks`, `tool-detail-body` (328) and `tool-detail-loader` (336). One `ShowMoreButton` replaces the three copies.
- **The lead's phone smoke** (mock build, `/ais/ai-dev-1`): tapping the "Morning briefing" tool opens the sheet. It shows the detail, the hosts, the read-only source, the version history with Revert to v2 and v1, the Run now input and the recent runs. Run now shows "Ok in 120 ms · 1 fetch" and adds a run row.
- **Check:** the gate passed.
