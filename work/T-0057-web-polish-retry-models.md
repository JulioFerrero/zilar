---
id: T-0057
title: Web polish — chat-list Retry keeps the loaded list visible; model picker clearly separates the input from the suggestions (D24)
status: planned
milestone: M2
branch: task/T-0057-web-polish
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0042, T-0052]
estimate: 0.5 day
---

# T-0057: Web polish (Retry, model picker)

## Spec (written by Claude, do not edit)

### Goal

Two small things the lead noticed in reviews.

1. **Retry flashes skeletons over a loaded list** (from the T-0042 review). When the chat list is already on screen and a refresh fails, the error bar shows **Retry**. Clicking it briefly replaces the loaded list with skeleton rows, then brings the list back. A retry of a list that is already loaded must keep the list on screen. It shows a pending state on the Retry button only (disabled, with a spinner or "Retrying…"). Skeletons are only for a list that has never loaded.
2. **The model picker looks like three inputs** (seen live after T-0052). In the AI panel and the New AI dialog, the model text input and the suggestion options have the same look, so the suggestions read as more inputs.
   - Keep the input as a **well**.
   - Label the options as suggestions (a small muted mono `SUGGESTED` caption).
   - Render each option as a **raised segment/pill** row, with the selected one as the pressed or active segment, a check icon, and `aria-checked`.
   - Picking a suggestion fills the input. Typing a custom model deselects them all.
   Keep the behavior and the radiogroup semantics.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0042-web-loading-states.md`: its Review and its "Retry" notes
- `apps/web/src/components/ChatList.tsx` and its test; the store's chat-list load and retry path in `apps/web/src/store/realStore.ts` (read it; change it only if the flash comes from the store, see below)
- `apps/web/src/components/ais/ModelPicker.tsx` and its test; `AiPanel.tsx` and `NewAiDialog.tsx` (only to see how it's used)
- `docs/design/ui-style.md` §4 (the well and raised-segment recipes), and `apps/web/src/index.css` (the utilities to reuse)

### Allowed files
- `apps/web/src/components/ChatList.tsx`, plus its test
- `apps/web/src/store/realStore.ts`: **only** the chat-list retry path, if the flash comes from the store setting a loading state, plus a test in `realStore.test.ts`
- `apps/web/src/components/ais/ModelPicker.tsx`, plus its test
- `work/T-0057-web-polish-retry-models.md` and `work/screenshots/T-0057/**`

**Not allowed:** anything else. In particular, not `markdown.ts`, not the group or mention files (other tasks are editing those), not the server or mobile.

### Tests
- ChatList: with a loaded list and a failed refresh, Retry keeps the rows rendered (no skeleton), the button is pending while retrying, and success clears the bar. A never-loaded list still shows skeletons.
- ModelPicker:
  - the caption is there;
  - picking a suggestion fills the input and marks it `aria-checked`;
  - typing a custom value clears the selection;
  - keyboard selection within the radiogroup works.

### Visual check
Mock mode (`?mock=1`):
- the model picker in the AI panel (1440×900);
- the chat list with the error bar while retrying. Force the error through the mock or test seam; say how.

Save the screenshots to `work/screenshots/T-0057/` and look at them. **Stop any dev server you start.**

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

## Report (written by the worker when done)

## Review (written by Claude)
