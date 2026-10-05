---
id: T-0270
title: "Web kit migration 5: NewTopicDialog and FolderEditorDialog render through the kit Dialog (kit gains size lg)"
status: todo
milestone: M5
branch: task/T-0270-web-kit-dialogs-3
model: auto
effort: low
depends_on: [T-0263]
estimate: 0.3 day
---

# T-0270: two more dialogs on the kit Dialog

## Spec (written by Claude, do not edit)

### Why
This is audit step 6, batch 3. The kit `Dialog` (`apps/web/src/components/ui/dialog.tsx`, after T-0258 and T-0263) has:
- the topmost-only Escape, the focus trap and focus return, and `initialFocusRef`;
- `dismissable`, `ariaLabel` and `size: 'sm' | 'md'`;
- an 85vh cap with a scrolling body between a fixed title and a fixed footer.

### Verified facts (do not re-derive)
- `apps/web/src/components/NewTopicDialog.tsx` (428 lines): its own Escape at line 111; `role="dialog"` with `aria-label="New topic"` at lines 195-197; the panel is `flex max-h-[85vh] w-full max-w-sm flex-col … bg-panel` (line 203). Test: `apps/web/src/components/NewTopicDialog.test.tsx`.
- `apps/web/src/components/FolderEditorDialog.tsx` (480 lines): its own Escape at line 76; `role="dialog"` with `aria-label` "New folder" / "Edit folder {name}" at lines 164-166; the panel is `max-w-lg … border-border-strong bg-surface` (line 174). Its delete confirm is a `ConfirmDialog` stacked on top (around line 345). Test: `apps/web/src/components/FolderEditorDialog.test.tsx`.

### What to build
1. Kit: add `size: 'lg'` (`max-w-lg`) to `Dialog`, with a fixture case and a kit test.
2. Both dialogs render through the kit `Dialog`:
   - NewTopicDialog uses `size="sm"`; FolderEditorDialog uses `size="lg"`;
   - keep the accessible names through `ariaLabel` where the title differs;
   - delete their own Escape handlers, backdrops and panel markup;
   - keep every text, section, button and behaviour.
   With the folder editor's delete `ConfirmDialog` open, Escape must close only the confirm. Add or keep a test for this.
3. Existing tests keep passing, changed only where they relied on the old markup.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/dialog.tsx`, `work/T-0263-web-kit-dialogs-2.md` (Report), and the two dialogs with their tests.

### Allowed files
`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/NewTopicDialog.tsx`, `apps/web/src/components/NewTopicDialog.test.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/FolderEditorDialog.test.tsx`, `work/T-0270-web-kit-dialogs-3.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit NewTopicDialog FolderEditorDialog FoldersPage fixtures
pnpm gate
```

### Acceptance
- Neither file contains `role="dialog"` or its own Escape handler. Behaviour and texts are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
`AvatarUploader`, `GroupHandleRoute`, `NewChatButton`, `StickerPanel`, `ExplorePage` and the side panels.

---

## Report (written by the worker when done)

## Review (written by Claude)
