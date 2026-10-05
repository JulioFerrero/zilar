---
id: T-0273
title: "Web kit migration 6: the NewChatButton pickers and the GroupHandleRoute dialogs render through the kit Dialog"
status: todo
milestone: M5
branch: task/T-0273-web-kit-dialogs-4
model: auto
effort: low
depends_on: [T-0270]
estimate: 0.3 day
---

# T-0273: last chat dialogs on the kit Dialog

## Spec (written by Claude, do not edit)

### Why
This is audit step 6, batch 4. The kit `Dialog` (`apps/web/src/components/ui/dialog.tsx`, after T-0270) has:
- the topmost-only Escape, the focus trap and focus return, and `initialFocusRef`;
- `dismissable`, `ariaLabel` and `size: 'sm' | 'md' | 'lg'`;
- an 85vh cap with a scrolling body between a fixed title and a fixed footer.

### Verified facts (do not re-derive)
- `apps/web/src/components/NewChatButton.tsx` has its own Escape handlers at lines 132 and 148 and two shells:
  - `role="dialog"` at line 267, `aria-label="Choose a group"`, with a `max-w-xs … bg-panel p-4` panel;
  - `role="dialog"` at line 298, `aria-label="New message"`.
  - Test: `apps/web/src/components/NewChatButton.test.tsx`. It queries dialogs by name, for example `getByRole('dialog', { name: 'New group' })`; that name comes from `NewGroupDialog`, already on the kit.
- `apps/web/src/routes/GroupHandleRoute.tsx` has two shells:
  - `role="dialog"` at line 108 (`aria-label={`Open @${handle}`}`), panel `max-w-sm … bg-background p-6 text-center`;
  - `role="dialog"` at line 199, with its own Escape at line 157.
  - Test: `apps/web/src/routes/GroupHandleRoute.test.tsx`.

### What to build
1. All four shells render through the kit `Dialog`:
   - keep each accessible name, through `title` or `ariaLabel`;
   - use `size="sm"`; a `max-w-xs` panel may become `sm`, or add `size: 'xs'` to the kit with a fixture case and a kit test if the narrower width matters for the picker;
   - delete the own Escape handlers, backdrops and panel markup;
   - keep every text, list, button and behaviour; GroupHandleRoute's centered text may stay centred inside the body.
2. Existing tests keep passing, changed only where they relied on the old markup. Each migrated dialog has a test that Escape closes it.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/dialog.tsx`, `work/T-0270-web-kit-dialogs-3.md` (Report), and the two files with their tests.

### Allowed files
`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/components/NewChatButton.test.tsx`, `apps/web/src/routes/GroupHandleRoute.tsx`, `apps/web/src/routes/GroupHandleRoute.test.tsx`, `work/T-0273-web-kit-dialogs-4.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit NewChatButton GroupHandleRoute fixtures
pnpm gate
```

### Acceptance
- Neither file contains `role="dialog"` or its own Escape handler. Behaviour and texts are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
`AvatarUploader`, `StickerPanel`, `ExplorePage` and the side panels.

---

## Report (written by the worker when done)

## Review (written by Claude)
