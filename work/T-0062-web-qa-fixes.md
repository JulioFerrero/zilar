---
id: T-0062
title: Web QA fixes — Esc closes every menu and dialog, reduced motion covers the spinner and skeleton, a few cheap polish items
status: planned
milestone: M2
branch: task/T-0062-web-qa-fixes
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0060]
estimate: 0.5 day
---

# T-0062: Web QA fixes

## Spec (written by Claude, do not edit)

### Goal

T-0060's QA sweep (`work/T-0060-web-qa-sweep.md`) found two real bugs and some cheap polish. Fix them.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0060-web-qa-sweep.md`, Bugs 1 and 2 and polish items 1, 2, 5 (the ones this task covers)
- `docs/design/ui-style.md` §4 (focus rings), §6 (motion)
- `apps/web/src/components/NewChatButton.tsx`, `NewGroupDialog.tsx`, `ais/NewAiDialog.tsx`, `Skeleton.tsx`, `ProgressCard.tsx`, `index.css`, `MessageActionsMenu.tsx`

### Allowed files
- `apps/web/src/components/NewChatButton.tsx`, `NewGroupDialog.tsx`, `ais/NewAiDialog.tsx`, `Skeleton.tsx`, `ProgressCard.tsx`, `index.css`, `MessageActionsMenu.tsx`, `Composer.tsx`
- Their test files
- `work/T-0062-web-qa-fixes.md` and `work/screenshots/T-0062/**`

**Not allowed:** anything else. In particular, don't touch reactions, edits or deletes: T-0059 and T-0061 own that ground.

### What to fix

1. **Bug 1 — Esc closes every menu and dialog.**
   - The New chat menu (`NewChatButton.tsx`): Esc closes it regardless of whether focus is on the trigger button or inside the menu. A document-level (or container-level) Escape handler while the menu is open, not just the menu's own `onKeyDown`.
   - `NewGroupDialog.tsx`, `ais/NewAiDialog.tsx`, and the inline "New message" dialog: add an Escape handler that closes/cancels them, same as clicking Cancel or the overlay.
   - Closing returns focus to the control that opened it (the New chat trigger, or the menu item that opened the dialog).
   - Test each: menu Esc-closes from both focus positions; each dialog Esc-closes and returns focus.

2. **Bug 2 — reduced motion covers all animation.**
   - Extend the `prefers-reduced-motion: reduce` block in `index.css` to also stop `animate-pulse` (the loading skeleton) and `animate-spin` (the progress spinner, `Loader2` in `ProgressCard.tsx`).
   - Under reduced motion, the skeleton can show a static muted fill instead of pulsing, and the spinner can show a static icon (still legible as "in progress") instead of spinning. Don't remove the loading semantics, just the motion.
   - Test with the media query mocked/emulated in Testing Library (`window.matchMedia`), asserting the relevant class or style is absent/static.

3. **Polish (do all three, they're cheap):**
   - Polish 1: push an explicit `outline` on focus rings (2px, `#a1a1a1`, matching ui-style.md §4) instead of relying on the UA default.
   - Polish 2: add `id`/`name` to the search input and the message composer textarea.
   - Polish 5: Approve/Deny buttons (currently `console.log`-only no-ops) get `disabled` plus a small "coming soon" affordance (a `title` tooltip is enough; don't invent a bigger feature).

### Visual check
Mock mode, 1440×900: the New chat menu and each dialog open, Esc closing them; the reduced-motion skeleton and spinner (emulate the media query); the focus ring on a key. Screenshots to `work/screenshots/T-0062/`. **Stop any dev server you start.** Use `localhost`, not `127.0.0.1`. Never use ports 3000, 3188, 5173, 8081.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/web
pnpm build
```

### Out of scope
- Wiring Approve/Deny to anything real.
- The AI panel's mock-fixture gap (a separate follow-up).
- Anything reactions/edit/delete related.

## Report (written by the worker when done)

## Review (written by Claude)
