---
id: T-0979
title: "Size split T28: apps/mobile/src/components/ais/tool-detail-sheet.tsx (808 lines) into ais/{tool-run-blocks,tool-detail-body,tool-detail-loader}.tsx; one ShowMoreButton"
status: todo
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

## Review (written by Claude)
