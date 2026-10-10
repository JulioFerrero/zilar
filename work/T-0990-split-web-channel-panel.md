---
id: T-0990
title: "Size split T65: apps/web/src/components/ChannelPanel.tsx (559 lines) into components/panels/{channelPanelOps,ChannelAdminsSection,ChannelHeader}"
status: todo
milestone: M5
branch: task/T-0990-split-web-channel-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0990: Split `ChannelPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/ChannelPanel.tsx` is 559 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #61 (task T65): `components/panels/channelPanelOps.ts`, `panels/ChannelAdminsSection.tsx`, `panels/ChannelHeader.tsx`, under `apps/web/src/`. `ChannelPanel.tsx` keeps the state, the actions, the composition and every export it has today.

- **Skip both Dedup items:** `panelFailure.ts` and the shared `GroupAiRow` both cross files.
- **The local `GroupAiRow`:** keep it, either in `ChannelPanel.tsx` or in one of your own new files, whichever keeps every file at or under 400 lines.

The lead checks it in Chrome in mock mode: the Acme Announcements channel's info panel.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #61, and `apps/web/src/components/ChannelPanel.tsx`.

### Allowed files
`apps/web/src/components/ChannelPanel.tsx`, `apps/web/src/components/panels/channelPanelOps.ts`, `apps/web/src/components/panels/ChannelAdminsSection.tsx`, `apps/web/src/components/panels/ChannelHeader.tsx`, `work/T-0990-split-web-channel-panel.md`.

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
