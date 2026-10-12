---
id: T-1254
title: "Web follow-up to T-1249: in the topic panel header the group name ('Familia ›') is a button that opens the group panel, and ?panel=group deep links open the group panel from any group topic"
status: merged
milestone: M5
branch: task/T-1254-web-topic-header-group-link
model: auto
effort: default
depends_on: [T-1249]
estimate: 0.1 day
---

# T-1254: The group name in the topic header opens the group panel

## Spec (written by Claude, do not edit)

### Why
These are T-1249's follow-up and its nit 2.
- **The header group name:** `apps/web/src/components/panels/TopicHeader.tsx:30-35` (54 lines) shows the group name (`Familia › `) as a plain `<span>`. In Telegram, tapping it opens the group info.
- **The deep link:** `initialPanel` in `apps/web/src/routes/ChatView.tsx:26-40` (268 lines) opens `?panel=group` only when `chat.kind === 'group' && chat.topic === undefined` (`:34`), so the deep link does nothing on a topic row. T-1249 fixed the menu path; ChatView already computes `groupChat` and passes `onOpenGroupPanel: () => setPanel('group')` at `:202`.

### What to build
1. **`TopicHeader.tsx`:** take an optional `onOpenGroup?: () => void`.
   - When it's set, render the group name as a `<button type="button">` (same text styles, `hover:underline`, `aria-label="Open {group} info"`).
   - Without it, keep the span.
2. **`TopicPanel.tsx`:** take an optional `onOpenGroup` (`:26`, `:37-41`) and pass it to `TopicHeader` (`:116-122`).
3. **`ChatView.tsx`:**
   - render `<TopicPanel ... onOpenGroup={() => setPanel('group')} />` (`:253`) when `groupChat !== undefined`;
   - in `initialPanel`, `value === 'group'` opens `'group'` for any chat with `chat.groupId !== undefined || chat.kind === 'group'`, not only topic-less rows (match how `groupChat` is gated);
   - keep the channel branch.
4. Keep every file at most 400 lines. No tests (UI).

### Read first
`AGENTS.md`, `work/T-1249-web-group-panel-reachable.md`, `apps/web/src/components/panels/TopicHeader.tsx`, `apps/web/src/components/TopicPanel.tsx` and `apps/web/src/routes/ChatView.tsx`.

### Allowed files
`apps/web/src/components/panels/TopicHeader.tsx`, `apps/web/src/components/TopicPanel.tsx`, `apps/web/src/routes/ChatView.tsx`, `work/T-1254-web-topic-header-group-link.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:** in Familia › General, Topic info → clicking "Familia" opens the group panel, and `?panel=group` on a topic URL opens it too.

---

## Report (written by the worker when done)

### What I did
1. **`apps/web/src/components/panels/TopicHeader.tsx`** — added an optional
   `onOpenGroup?: () => void` prop. When it is set, the group name renders as a
   `<button type="button">` (`aria-label="Open {group} info"`, text styles
   `font-normal text-muted-foreground` plus `hover:underline`, `onClick`
   `onOpenGroup`); the ` › ` separator stays a plain span so its spacing is
   unchanged. Without the prop the group name is the original static `<span>`.
2. **`apps/web/src/components/TopicPanel.tsx`** — `TopicPanel` and its
   `TopicPanelBody` take an optional `onOpenGroup` and pass it to `TopicHeader`
   (conditional spread, required by `exactOptionalPropertyTypes`).
3. **`apps/web/src/routes/ChatView.tsx`**
   - `initialPanel`: `value === 'group'` now returns `'group'` for
     `chat.groupId !== undefined || chat.kind === 'group'` (any group topic),
     not only topic-less rows; the channel branch is kept unchanged.
   - the `TopicPanel` render passes `onOpenGroup: () => setPanel('group')` when
     `groupChat !== undefined` (conditional spread, matching how the header prop
     is passed at `:202`).

### Files changed
- `apps/web/src/components/panels/TopicHeader.tsx`
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `work/T-1254-web-topic-header-group-link.md`

All are inside the Allowed files and under 400 lines (TopicHeader 71,
TopicPanel 251, ChatView 272).

### Commands run
- `pnpm install` — done, 16 workspace projects, one pre-existing peer-dependency
  warning (`@types/react-dom` vs `@types/react` in `apps/mobile`).
- `pnpm gate`, from the repo root (final run, report included):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (3.6s)
  PASS  format  (1.7s)
  PASS  lint  (1.9s)
  PASS  typecheck  (1.4s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test files were run: the spec says "No tests (UI)", AGENTS.md says UI
  code gets no tests, and the gate reports `SKIP tests @zilar/web`.

### Deviations / notes
- None from the spec. The ` › ` separator is kept outside the button so the
  breadcrumb spacing does not change; the clickable name itself is a button.

### Open questions
- None.

### Security checklist
- UI-only change; no route, auth, secret, delete or update logic touched.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (0 nits).**
- **Lead's check on the local web mock (Familia › General):**
  - `?panel=group` on the topic URL opens the group panel with the members and Delete group;
  - `?panel=topic` shows the topic panel, whose header has a button labelled "Open Familia info";
  - clicking it opens the group panel.
