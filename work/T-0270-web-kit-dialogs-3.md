---
id: T-0270
title: "Web kit migration 5: NewTopicDialog and FolderEditorDialog render through the kit Dialog (kit gains size lg)"
status: merged
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

### What I did

Moved `NewTopicDialog` and `FolderEditorDialog` onto the kit `Dialog`, and added `size: 'lg'` to the kit. Neither file keeps its own backdrop, panel markup or Escape handler.

- **Kit `Dialog`** (`apps/web/src/components/ui/dialog.tsx`): `size` is now `'sm' | 'md' | 'lg'`; the panel width is `max-w-sm`, `max-w-md` or `max-w-lg`. Added fixture case `Large` (`dialog.fixture.tsx`) and kit test `applies the panel width for each size` (`kit.test.tsx`).
- **`NewTopicDialog`**: renders through `<Dialog open onClose title="New topic" description={\`in ${…}\`} size="sm" actions={Cancel + Create topic}>`. Deleted the Escape effect, the backdrop/pane and the `<h2>`/`<p>` header. The visible title equals the old `aria-label="New topic"`, so no `ariaLabel` is needed. The name field, type chips, visibility control, private people/AI/roles list, error and both buttons are kept as children/`actions`, with the same texts.
- **`FolderEditorDialog`**: renders through `<Dialog open onClose title={New folder|Edit folder} ariaLabel={New folder|Edit folder <name>} size="lg" actions={Delete folder? + Cancel + Save}>`, with the stacked `ConfirmDialog` next to it. Deleted its Escape/Tab `onKeyDown`, the focus effect, the `dialogRef`/`returnFocusRef` refs and the backdrop/pane/header/footer markup; the kit owns the focus trap, focus return, initial focus and Escape. `ariaLabel` keeps the old accessible name (`Edit folder Personal`), which differs from the visible `Edit folder`. The name input is still the first focusable child, so the kit's default initial focus matches the old effect. In the `actions` slot, `ml-auto` keeps Delete on the left and Cancel/Save on the right.
- **`FolderEditorDialog.test.tsx`**: added `Escape closes only the delete confirm` — opens the editor, opens the delete confirm, fires Escape on `document`, and asserts only the confirm closed (`Edit folder Personal` still present). The existing `closes with Escape` in `NewTopicDialog.test.tsx` now exercises the kit.

### Files changed

`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/NewTopicDialog.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/FolderEditorDialog.test.tsx`, `work/T-0270-web-kit-dialogs-3.md`. (`NewTopicDialog.test.tsx` was allowed but needed no change.)

### Commands and real results

- `pnpm install`: exit 0; `pnpm-lock.yaml` is untouched (`git status` is clean of it).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit NewTopicDialog FolderEditorDialog FoldersPage fixtures`: 5 files passed, 118 tests passed.
- `pnpm gate` (first run): `FAIL format` — `prettier --check` flagged `FolderEditorDialog.tsx` and `NewTopicDialog.tsx`.
- `pnpm exec prettier --write apps/web/src/components/FolderEditorDialog.tsx apps/web/src/components/NewTopicDialog.tsx`: formatted both.
- `pnpm gate` (second run):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (2.6s)
  PASS  format  (25.5s)
  PASS  lint  (1.1s)
  PASS  typecheck  (11.9s)
  PASS  tests @zilar/web  (27.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance

- `NewTopicDialog.tsx` and `FolderEditorDialog.tsx` contain no `role="dialog"` and no Escape/`addEventListener` handler (grep for `role="dialog"|Escape|addEventListener|dialogRef|onKeyDown|FOCUSABLE` returns no matches).
- Behaviour and texts unchanged.
- `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed files; `pnpm-lock.yaml` is not modified.

### Deviations / open questions

- The folder editor panel chrome changes from the old `border-border-strong bg-surface max-h-full` plus bordered header/footer to the kit's `border-border bg-panel max-h-[85vh]` without those borders, because the spec says to delete the panel markup and the kit owns the chrome. Texts, sections and buttons are unchanged.
- No other deviations.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (1 test-naming nit).
- The kit gained `size="lg"`.
- With the delete confirm stacked on top, Escape closes only the confirm, and a test covers it.
- I checked Edit folder in mock mode in the browser: the icon grid, switches and chat picker scroll between the fixed title and the Delete/Cancel/Save footer.
