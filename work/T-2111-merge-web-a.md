---
id: T-2111
title: "Merge back 2 size-split pieces into their only user (web: message actions menu, sticker grid): a hook returning a big object, or a child with a long prop list, goes back into the one file that uses it, so the return object, the destructuring and the prop types disappear — no behaviour change"
status: merged
milestone: M5
branch: task/T-2111-merge-web-a
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2111: Merge split pieces back (web: message actions menu, sticker grid)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "we can overwrite the 400 lines if we can save on lines of code". About 400 lines per file is now a soft limit; only a file over 800 lines must be split. Files that the old hard cap split only for size may be merged back when that saves lines (`CLAUDE.md`, `docs/ARCHITECTURE.md`).

The old splits left plumbing behind:
- a hook returns 20 fields, and its one screen destructures all 20;
- a child declares a 15-prop interface that only its one parent fills.

Merging each piece back deletes that plumbing.

### Facts (the lead's import graph on 2026-10-19)
Each row is `piece (lines) → its only production user (lines)`, with the kind of plumbing it carries:
- `hook` means the hook's return object;
- `props` means the child's props type.

- `apps/web/src/components/MessageActionsMenu.tsx` (154) → `apps/web/src/components/message/MessageMenuBody.tsx` (236) — props
- `apps/web/src/components/sticker/StickerGrid.tsx` (269) → `apps/web/src/components/StickerPanel.tsx` (265) — props

### Steps
1. **Hook rows.** Move the hook's body into the component that calls it, at the top of that component. Delete the return object and the destructuring, so the component uses the variables directly. Then delete the hook file.
   - If the host passes the hook's values on to children, keep passing them; only the hook boundary goes.
2. **Props rows.** Move the child component into its parent's file, as a function in the same file, and keep its JSX as it is. Where the child only received values the parent computes, read them from the parent's scope or keep a short props list. Delete the child file.
3. **Exported types.** A type the piece exported moves with it. Keep it exported only if another file imports it, and update those imports.
4. **Skip a row**, and list it in the Report with the reason, when:
   - the merged file would pass 700 lines;
   - the piece is imported lazily (`lazy(() => import(…))`);
   - the piece is used by a test that tests it on its own;
   - the merge would create an import cycle.
5. **Change no behaviour:** no logic, no wording, no styling, no hook order change inside a component. Prettier formatting.
6. **No new tests.** Tests and fixtures that imported a merged piece import from its new home.
7. **Report** the line counts per row and the skipped rows.

### Allowed files
- `apps/web/src/components/message/MessageMenuBody.tsx`
- `apps/web/src/components/MessageActionsMenu.tsx`
- `apps/web/src/components/sticker/StickerGrid.tsx`
- `apps/web/src/components/StickerPanel.tsx`
- `work/T-2111-merge-web-a.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines are at least 35 lower.

---

## Report (written by the worker when done)

### What I did

Merged both prop rows; neither was skipped.

| Piece (lines) | Only user (lines) | Kind | After | Saved |
| --- | --- | --- | --- | --- |
| `apps/web/src/components/MessageActionsMenu.tsx` (154) | `apps/web/src/components/message/MessageMenuBody.tsx` (236) | props | `MessageMenuBody.tsx` (333) | 57 |
| `apps/web/src/components/sticker/StickerGrid.tsx` (269) | `apps/web/src/components/StickerPanel.tsx` (265) | props | `StickerPanel.tsx` (530) | 4 |

- **Message actions menu:** inlined the `Menu` JSX at its one call site in
  `MessageMenuBody`, so `MessageActionsMenuProps`, the wrapper function and the
  props it passed all disappear; the JSX now reads the parent's values directly.
  `MessageActionsMenu.tsx` is deleted.
- **Sticker grid:** moved `FavoriteStar`, `TILE_PX` and `StickerGrid` into
  `StickerPanel.tsx` as non-exported functions in the same file, with the props
  type inlined in the signature. The grid's own `useState` stays in `StickerGrid`,
  so mounting and hook order are unchanged. `StickerGrid.tsx` is deleted.
- **Exported types:** `MessageMenuProps` stays exported (used by `MessageMenu.tsx`);
  `StickerChoice` stays exported (used by `useComposerAttachments.ts`,
  `StickerPackPage.tsx`, `StickerThumb.tsx`). `MessageActionsMenuProps` and
  `StickerGridProps` had no other importers and are gone.
- **Skipped rows:** none. No lazy importers, no tests importing either piece, no
  merged file over 700 lines, and no import cycle (`StickerGrid`'s type import of
  `StickerChoice` from its own parent disappeared).
- No behaviour, wording, styling or logic change; no tests added.

Product lines: 924 before → 863 after, **61 lower**.

### Checks run

- `pnpm install`: done (warnings about an existing `@types/react` peer mismatch in
  `apps/mobile`).
- No test file is near the web components (the gate reports no nearby test files),
  so I ran no individual tests.
- `pnpm gate` from the repo root:

```
PASS  install (frozen)  (1.2s)
PASS  format  (1.0s)
PASS  lint  (1.3s)
PASS  typecheck  (4.0s)
PASS  effect  (0.7s)
SKIP build @zilar/server (no server, package or manifest change)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/web/src/components/StickerPanel.tsx: 530 lines (main 265); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

The first gate run failed `format` on `StickerPanel.tsx`; I ran
`pnpm exec prettier --write apps/web/src/components/StickerPanel.tsx` and the second
run passed everything.

### Notes for the lead

- `StickerPanel.tsx` is 530 lines (soft limit warning only, under the 800 hard limit);
  keeping the grid whole is what this task asks for.
- `git status` also shows only the five allowed files (the two deletions, the two
  merged files and this task file).

## Review (written by Claude)

Approved; the pre-review was clean. Net −61: `MessageActionsMenu.tsx` went back into `message/MessageMenuBody.tsx`, and `sticker/StickerGrid.tsx` went back into `StickerPanel.tsx` (530 lines, under 800).
- **Web mock** (`:5239`):
  - right-clicking a message in Marta's chat opens the menu with the six reactions, Reply, Forward, Select, Copy text, Delete for me and Pin;
  - the composer's Stickers tab shows 19 sticker images.
  - No page errors.
