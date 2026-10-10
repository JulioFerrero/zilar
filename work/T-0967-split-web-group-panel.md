---
id: T-0967
title: "Size split T20: apps/web/src/components/GroupPanel.tsx (995 lines) into components/panels/{groupPanelOps,GroupAiSection,GroupPictureSection,GroupRolesSection,GroupSettingSwitch}"
status: todo
milestone: M5
branch: task/T-0967-split-web-group-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0967: Split `GroupPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/GroupPanel.tsx` is 995 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #16 (task T20). The new files go in the existing `apps/web/src/components/panels/` folder:
- `groupPanelOps.ts`;
- `GroupAiSection.tsx`, `GroupPictureSection.tsx`, `GroupRolesSection.tsx`, `GroupSettingSwitch.tsx`.

`GroupPanel.tsx` keeps the info panel and the background and visibility wiring, plus every export it has today.

- **In scope:** the in-file Dedup (the two `Switch` + `FieldError` rows become one `GroupSettingSwitch`).
- **Out of scope:** moving `GroupAiRow` out of `ChannelPanel.tsx`, because it crosses files.

There are no web UI tests. The lead checks the group panel in Chrome in mock mode.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #16, and `apps/web/src/components/GroupPanel.tsx`.

### Allowed files
`apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/panels/groupPanelOps.ts`, `apps/web/src/components/panels/GroupAiSection.tsx`, `apps/web/src/components/panels/GroupPictureSection.tsx`, `apps/web/src/components/panels/GroupRolesSection.tsx`, `apps/web/src/components/panels/GroupSettingSwitch.tsx`, `work/T-0967-split-web-group-panel.md`.

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
