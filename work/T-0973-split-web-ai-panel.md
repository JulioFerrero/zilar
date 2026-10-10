---
id: T-0973
title: "Size split T23: apps/web/src/components/ais/AiPanel.tsx (870 lines) into ais/{aiPanelOps,AiUsageSection,AiPictureSection,AiFormFields,AiMachineSection,AiDelegationSection,AiDangerZone}; one writeAi helper"
status: todo
milestone: M5
branch: task/T-0973-split-web-ai-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0973: Split `AiPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/ais/AiPanel.tsx` is 870 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #19 (task T23). The new files go in `apps/web/src/components/ais/`:
- `aiPanelOps.ts`;
- `AiUsageSection.tsx`, `AiPictureSection.tsx`, `AiFormFields.tsx`, `AiMachineSection.tsx`, `AiDelegationSection.tsx`, `AiDangerZone.tsx`.

`AiPanel.tsx` keeps the panel and every export it has today.

The in-file Dedup is in scope. The stop, resume, delete and delegation actions repeat the same steps: clear the error, call `fromApi`, tap `setAi`, catch, then set the error and refetch. They become one `writeAi` helper in `aiPanelOps.ts`, and each action keeps its own error text.

The lead checks it in Chrome in mock mode: open an AI's panel, then use stop or resume, the machine picker, delegation and the delete confirmation.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #19, and `apps/web/src/components/ais/AiPanel.tsx`.

### Allowed files
`apps/web/src/components/ais/AiPanel.tsx`, `apps/web/src/components/ais/aiPanelOps.ts`, `apps/web/src/components/ais/AiUsageSection.tsx`, `apps/web/src/components/ais/AiPictureSection.tsx`, `apps/web/src/components/ais/AiFormFields.tsx`, `apps/web/src/components/ais/AiMachineSection.tsx`, `apps/web/src/components/ais/AiDelegationSection.tsx`, `apps/web/src/components/ais/AiDangerZone.tsx`, `work/T-0973-split-web-ai-panel.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's Chrome check passes.

---

## Report (written by the worker when done)

## Review (written by Claude)
