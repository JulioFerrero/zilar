---
id: T-1035
title: "Size split T123: apps/web/src/components/ChatMediaPanel.tsx (403 lines) into components/media/{mediaModel,useShowInChat,MediaRows,MediaBody}"
status: todo
milestone: M5
branch: task/T-1035-split-web-chat-media-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1035: Split `ChatMediaPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/ChatMediaPanel.tsx` is 403 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #119 (task T123). The new files go in a new `apps/web/src/components/media/` folder: `mediaModel.ts`, `useShowInChat.ts`, `MediaRows.tsx` and `MediaBody.tsx`. The panel keeps the shell, the tab state and every export it has today. Move the code unchanged; the plan lists no Dedup.

The lead checks the chat media panel in Chrome in mock mode.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #119, and `apps/web/src/components/ChatMediaPanel.tsx`.

### Allowed files
`apps/web/src/components/ChatMediaPanel.tsx`, `apps/web/src/components/media/mediaModel.ts`, `apps/web/src/components/media/useShowInChat.ts`, `apps/web/src/components/media/MediaRows.tsx`, `apps/web/src/components/media/MediaBody.tsx`, `work/T-1035-split-web-chat-media-panel.md`.

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
