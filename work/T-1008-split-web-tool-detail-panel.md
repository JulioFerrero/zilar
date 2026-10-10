---
id: T-1008
title: "Size split T83: apps/web/src/components/tools/ToolDetailPanel.tsx (513 lines) into tools/{toolDetailOps,ToolSourceSection,ToolRunSection,DeleteToolButton}; one RunOutput"
status: merged
milestone: M5
branch: task/T-1008-split-web-tool-detail-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1008: Split `ToolDetailPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/tools/ToolDetailPanel.tsx` is 513 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #79 (task T83): `components/tools/toolDetailOps.ts`, `tools/ToolSourceSection.tsx`, `tools/ToolRunSection.tsx`, `tools/DeleteToolButton.tsx`, under `apps/web/src/`. `ToolDetailPanel.tsx` keeps the panel and every export it has today.

- **In scope:** the in-file Dedup. The `TruncatedText` + `truncateOutput` rendering in recent runs and in `RunResultBlock` becomes one `RunOutput({ text })`.
- **Existing files:** `CodeBlock.tsx`, `RoutinesSection.tsx` and `ToolsSection.tsx` are already in the folder. Leave them as they are.

The lead checks it in Chrome in mock mode: open a tool from an AI's panel, then Run now and the recent runs.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #79, and `apps/web/src/components/tools/ToolDetailPanel.tsx`.

### Allowed files
`apps/web/src/components/tools/ToolDetailPanel.tsx`, `apps/web/src/components/tools/toolDetailOps.ts`, `apps/web/src/components/tools/ToolSourceSection.tsx`, `apps/web/src/components/tools/ToolRunSection.tsx`, `apps/web/src/components/tools/DeleteToolButton.tsx`, `work/T-1008-split-web-tool-detail-panel.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/components/tools/ToolDetailPanel.tsx` per `docs/audit/split-rules.md` and size-plan §2.2 #79 (T83), moving code unchanged into four new files and applying only the in-scope Dedup:

- `toolDetailOps.ts` — constants, tagged errors, `LoadedTool`, and the helpers (`hostsLine`, `runStatusText`, `failureText`, `settledFailure`, `loadDetail`, `runToolWithInput`, `parseRunInput`, `inputErrorText`, `runErrorText`).
- `ToolSourceSection.tsx` — the Source section plus the Version history section (plan 283–340).
- `ToolRunSection.tsx` — Run now (342–373) and Recent runs (375–401), plus `RunResultBlock` (434–460) and the new `RunOutput`.
- `DeleteToolButton.tsx` — the delete button + confirm (462–513).
- `ToolDetailPanel.tsx` — kept as the panel: state, handlers, header, load/empty states, the revert `ConfirmDialog`, and the calls to the three sections. It still exports `ToolDetailPanel`.

**In-scope Dedup (one `RunOutput`):** the `TruncatedText` + `truncateOutput` rendering that repeated in Recent runs and in `RunResultBlock` is now one `RunOutput({ text })` in `ToolRunSection.tsx`; `RunOutput` calls `truncateOutput` itself. Both call sites behave the same (Recent runs still only renders an ok run with a non-null output; the failed-result text is computed once instead of twice).

No behaviour change otherwise. `ToolsSection.tsx` still imports `ToolDetailPanel` from the same path and was not touched. `CodeBlock.tsx`, `RoutinesSection.tsx`, `ToolsSection.tsx` untouched.

### wc -l

| file | before | after |
| --- | --- | --- |
| `ToolDetailPanel.tsx` | 513 | 242 |
| `toolDetailOps.ts` | — | 117 |
| `ToolSourceSection.tsx` | — | 97 |
| `ToolRunSection.tsx` | — | 111 |
| `DeleteToolButton.tsx` | — | 63 |

All at most 400 lines.

### Export list before / after

```
== OLD (main) ==
export function ToolDetailPanel({

== AFTER (barrel + new files) ==
export function ToolDetailPanel({                              (ToolDetailPanel.tsx)
export type RunFailure = InputNotJson | InputTooLarge | ApiFailure;   (toolDetailOps.ts)
export interface LoadedTool {                                  (toolDetailOps.ts)
export function hostsLine(hosts: readonly string[]): string {  (toolDetailOps.ts)
export function runStatusText(run: ToolRun): string {          (toolDetailOps.ts)
export function failureText(failure: ApiFailure | undefined, fallback: string): string {  (toolDetailOps.ts)
export function settledFailure<A, E>(state: AsyncResult.AsyncResult<A, E>): E | undefined {  (toolDetailOps.ts)
export function loadDetail(toolId: string): Effect.Effect<LoadedTool, ApiFailure> {  (toolDetailOps.ts)
export function runToolWithInput(                               (toolDetailOps.ts)
export function inputErrorText(failure: RunFailure | undefined): string | undefined {  (toolDetailOps.ts)
export function runErrorText(failure: RunFailure | undefined): string | undefined {  (toolDetailOps.ts)
export function ToolSourceSection({                            (ToolSourceSection.tsx)
export function ToolRunSection({                               (ToolRunSection.tsx)
export function DeleteToolButton({                             (DeleteToolButton.tsx)
```

The original path keeps its only export, `ToolDetailPanel`. The new names were module-private helpers/components before; they are exported now because sibling files import them. No importer outside the task's files changed.

### Commands I ran

- `pnpm install` — done, no errors (peer-dep warnings only).
- `pnpm --filter @zilar/web build` — success, `✓ built in 855ms`.
- `pnpm gate` (first run) — `FAIL format` (Prettier warned on `ToolRunSection.tsx`), scope ok. Fixed the one long line to Prettier's wrapping, then:
- `pnpm gate` (final) — summary:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.0s)
  PASS  lint  (1.0s)
  PASS  typecheck  (5.3s)
  PASS  effect  (1.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

No single test files were run: no test sits near these UI files (the gate reports "no nearby test files" for `@zilar/web`), and per `AGENTS.md` UI code gets no tests.

### Notes / deviations

- No `// effect-plain:` marker was needed: `toolDetailOps.ts` and `DeleteToolButton.tsx` import Effect (kind `effect`), and `ToolSourceSection.tsx` / `ToolRunSection.tsx` carry no Effect signals, so the ratchet step passed.
- No new dependencies. No files outside the Allowed list were changed.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `tools/ToolDetailPanel.tsx` (513 lines) is now 242 lines, plus `toolDetailOps` (117), `ToolSourceSection`, `ToolRunSection` and `DeleteToolButton`. One `RunOutput` replaces the two copies.
- **The lead checked it in Chrome at `?mock=1`, under Dev AI settings › Tools › prices:**
  - the detail shows the hosts, the approval note, the read-only source and the version history with "Revert to this version";
  - Run now shows "Ok in 42 ms · 2 fetches" with the output, and a new recent-run row with the same output;
  - the older runs and Delete tool render.
- **Check:** the gate passed, and so did the web build.
