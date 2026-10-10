---
id: T-1008
title: "Size split T83: apps/web/src/components/tools/ToolDetailPanel.tsx (513 lines) into tools/{toolDetailOps,ToolSourceSection,ToolRunSection,DeleteToolButton}; one RunOutput"
status: todo
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

## Review (written by Claude)
