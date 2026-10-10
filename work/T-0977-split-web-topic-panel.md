---
id: T-0977
title: "Size split T32: apps/web/src/components/TopicPanel.tsx (780 lines) into components/panels/{topicPanelOps,TopicRulesSection,TopicRolesSection}; one list loader for members and AIs"
status: todo
milestone: M5
branch: task/T-0977-split-web-topic-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0977: Split `TopicPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/TopicPanel.tsx` is 780 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #28 (task T32): `components/panels/topicPanelOps.ts`, `panels/TopicRulesSection.tsx` and `panels/TopicRolesSection.tsx`, under `apps/web/src/`. `TopicPanel.tsx` keeps the panel and every export it has today.

`topicPanelOps.ts` would be about 330 lines from the plan's range, which is fine.

The in-file Dedup is in scope:
- the members load and the AIs load become one generic `useListLoader`;
- `removeMember` and `removeAi` share one helper.

Every user-facing text stays the same.

The lead checks it in Chrome in mock mode: Dev team › General topic info, with the members, the AIs, adding and removing one, and the roles section.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #28, and `apps/web/src/components/TopicPanel.tsx`.

### Allowed files
`apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/panels/topicPanelOps.ts`, `apps/web/src/components/panels/TopicRulesSection.tsx`, `apps/web/src/components/panels/TopicRolesSection.tsx`, `work/T-0977-split-web-topic-panel.md`.

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
