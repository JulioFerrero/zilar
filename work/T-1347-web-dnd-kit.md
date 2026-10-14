---
id: T-1347
title: "Web reorder on dnd-kit: replace the native HTML5 drag-and-drop in Folders settings and the sticker pack editor with @dnd-kit sortable lists (mouse, touch and keyboard), keeping the Up/Down buttons"
status: merged
milestone: M5
branch: task/T-1347-web-dnd-kit
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-1347: Web reorder on dnd-kit

## Spec (written by Claude, do not edit)

### Why
The library audit (T-1342, row 10). Web reorders with native HTML5 drag-and-drop, which has no touch and no keyboard path:
- `apps/web/src/routes/FoldersPage.tsx` (226 lines; `draggable`/`onDragStart` at `:109-115`);
- `apps/web/src/components/sticker/PackEditorItems.tsx` (157; `:29`, `:40-47`);
- `apps/web/src/components/sticker/PackEditorForm.tsx` (`:96`).

### Library rule (Julio, 2026-10-13)
Use the named library; do **not** hand-roll its behaviour. First check it with `npm view <pkg> version time.modified peerDependencies` and confirm it fits React 19 / Vite. Pin an exact version at least two weeks old. If it does not fit, set `status: blocked` and report. Every file stays at most 400 lines. **No tests** (UI). The plan is `docs/audit/library-plan.md` (T-1342).

### What to build
1. **Add `@dnd-kit/core` and `@dnd-kit/sortable`** (check both; the audit saw core 6.3.1) to `apps/web/package.json`.
2. **Folders page and sticker pack editor:** use `DndContext` + `SortableContext` (vertical list) with pointer, touch and keyboard sensors, a drag handle (the existing grip icon if there is one, else lucide `GripVertical`), and the same reorder callback as today.
   - Keep the Up/Down buttons.
   - Delete the HTML5 `draggable` handlers and the `dragId`/`dragIndexRef` state.
3. **Also check** `apps/web/src/components/folder/FolderHideSection.tsx` (65); change it only if it has its own drag code.

### Read first
`AGENTS.md`, `apps/web/src/routes/FoldersPage.tsx`, `apps/web/src/components/sticker/PackEditorItems.tsx`, `apps/web/src/components/sticker/PackEditorForm.tsx`.

### Allowed files
`apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/routes/FoldersPage.tsx`, `apps/web/src/components/sticker/PackEditorItems.tsx`, `apps/web/src/components/sticker/PackEditorForm.tsx`, `apps/web/src/components/folder/FolderHideSection.tsx`, `apps/web/src/components/ui/sortable-list.tsx`, `work/T-1347-web-dnd-kit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's web mock check:** Settings → Folders: drag a folder by its handle and the order changes; the keyboard (Space, arrows) reorders too.

---

## Report (written by the worker when done)

### What I did
- Added pinned `@dnd-kit/core` `6.3.1` and `@dnd-kit/sortable` `10.0.0` to `apps/web/package.json`.
- New shared component `apps/web/src/components/ui/sortable-list.tsx` (143 lines): `SortableList` (DndContext + SortableContext, `verticalListSortingStrategy`, closest-centre collision, Pointer (+4 px distance) / Touch (200 ms delay) / Keyboard (`sortableKeyboardCoordinates`) sensors), `SortableItem` (the `<li>`, ref + transform) and `SortableHandle` (the grip button, lucide `GripVertical`).
- `FoldersPage.tsx`: replaced the native HTML5 rows (`draggable`/`onDragStart`/`onDragEnd`/`onDragOver`/`onDrop`) and the `dragId` state with `SortableList`/`SortableItem`/`SortableHandle`. The grip button is now the drag handle; the same `move(fromId, toId)` → `reorderChatFolders` callback still drives the order and keeps its busy/rollback behaviour. Removed the old Alt+Arrow `moveByKey` path (now dead); keyboard is the sensor's (focus handle, Space to lift, arrows to move, Space to drop, Esc to cancel).
- `PackEditorItems.tsx`: replaced `draggable`/`onDragStart`/`onDragOver`/`onDrop` and the `dragIndexRef` with `SortableList`/`SortableItem`, added a `GripVertical` handle; the same `onMoveByIndex(from, to)` callback is used. Up/Down, retry, emoji and remove are unchanged; error rows and the busy state disable the handle as before.
- `FolderHideSection.tsx`: read; it has no drag code, left unchanged.
- `PackEditorForm.tsx`: read; its `onDragOver`/`onDrop` is the file-drop zone (accepts dropped files), not a reorder, so it was left unchanged. dnd-kit does not replace native file drops.

### Library check (the spec requires it)
`npm view` on 2026-10-13:
- `@dnd-kit/core` version `6.3.1`, time.modified `2024-12-05`, peers `react >=16.8.0`, `react-dom >=16.8.0`.
- `@dnd-kit/sortable` version `10.0.0`, time.modified `2024-12-04`, peers `react >=16.8.0`, `@dnd-kit/core ^6.3.0`.
Both fit React 19 / Vite and are older than two weeks; pinned exactly (not `^`). Core `6.3.1` matches what the audit saw.

### Files changed (6, every one inside Allowed files)
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `apps/web/src/components/ui/sortable-list.tsx` (new)
- `apps/web/src/routes/FoldersPage.tsx`
- `apps/web/src/components/sticker/PackEditorItems.tsx`
- `work/T-1347-web-dnd-kit.md`

### Commands and real results
- `pnpm install`: done in 14.5 s (only the pre-existing mobile `@types/react-dom` peer warning).
- `pnpm --filter @zilar/web add --save-exact @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0`: added 4 packages, done.
- `pnpm gate` (repo root):
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.6s)
PASS  lint  (1.7s)
PASS  typecheck  (3.9s)
PASS  effect  (0.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```
- No single test file was run: the change is UI-only and there are no nearby test files, so the gate skipped tests (per AGENTS, UI gets no tests).

### Deviations from the spec
- Removed the old Alt+Arrow keyboard path in `FoldersPage` (and its `moveByKey` helper): the keyboard sensor now owns keyboard reordering, and keeping the helper would leave dead code (AGENTS forbids dead code). The acceptance path is the dnd-kit one (focus the handle, Space, arrows).
- `PackEditorForm.tsx` and `FolderHideSection.tsx` are in Allowed files but were intentionally not changed (reasons above). Allowed is a ceiling, not a mandate.
- Did not add `@dnd-kit/utilities`: the transform style is built inline (`translate3d(...)`) so the added dependencies stay exactly the two the spec names (AGENTS: no deps the spec doesn't list).

### Blocked / needs a decision
None.

### Honesty note
I did not run a browser smoke test. The acceptance drag/keyboard check is the lead's mock check; I verified the wiring by reading the code and the gate's typecheck passed, but I did not exercise a drag or the keyboard with a real browser.

### Fix round: screen-reader announcements (lead request)
Lead confirmed the mouse and keyboard reorder both work in the web mock, and asked for one a11y fix: dnd-kit's default announcements read the internal ids (the live region said "Draggable item mock-folder-personal was dropped over droppable area mock-folder-ais").
- Added `sortableAccessibility(ids, labelOf)` to `sortable-list.tsx` and passed it to `DndContext` as `accessibility={{ announcements, screenReaderInstructions }}`:
  - `onDragStart`: "Picked up Personal."
  - `onDragOver`: "Personal moved to position 2 of 2."
  - `onDragEnd`: "Personal dropped at position 2 of 2."
  - `onDragCancel`: "Reorder cancelled."
  - `screenReaderInstructions`: dnd-kit's `defaultScreenReaderInstructions` (Space/arrow instructions).
- `SortableList` now takes a required `labelOf: (id: string) => string`.
- Folders name a row by its folder name; the sticker pack editor names a sticker by its emoji, else "Sticker N" (1-based position).
- `pnpm gate` after the fix:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (3.7s)
PASS  format  (4.3s)
PASS  lint  (2.3s)
PASS  typecheck  (6.7s)
PASS  effect  (2.0s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after the lead's fix round (1 nit); the packet is current for `0e1994fb`.**
- **Lead's headless web mock check:** Settings → Folders: a mouse drag by the handle reorders (Personal, AIs → AIs, Personal), and the keyboard (Space, ArrowDown, Space) reorders too.
- **Fix round:** the screen-reader announcements now name the rows instead of internal ids.
