---
id: T-1351
title: "Web: Escape in a confirm opened from a sheet or dialog closes only the confirm (Base UI nesting): render each such ConfirmDialog inside its parent overlay's React tree, not as a sibling"
status: merged
milestone: M5
branch: task/T-1351-nested-confirm-escape
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1351: Nested confirm Escape

## Spec (written by Claude, do not edit)

### Why
This is a follow-up from T-1350's pre-review (`work/T-1350-web-base-ui.md`). The kit `Dialog`/`Sheet`/`ConfirmDialog` are now Base UI (`@base-ui/react` 1.8.0). Base UI decides the topmost dialog from **React-tree nesting** (`escapeKey: isTopmost` in its `useDialogRoot`). A `ConfirmDialog` rendered as a **sibling** of its parent overlay is therefore a second top-level dialog, and one Escape closes both.

Known sites:
- `apps/web/src/components/TopicPanel.tsx`: two `ConfirmDialog`s at `:242` and `:251`, after `</Sheet>` at `:239`;
- `apps/web/src/components/FolderEditorDialog.tsx`: a `ConfirmDialog` at `:207`, after `</Dialog>` at `:205`.

### What to build
1. **Move each `ConfirmDialog` that's opened while a kit `Sheet` or `Dialog` is open** inside that overlay's children, so it's React-nested. Escape then closes only the confirm, and the parent stays open.
2. **Check every other `<ConfirmDialog` site** (`git grep -n "<ConfirmDialog" -- apps/web/src`, 13 files) for the same sibling pattern while a kit overlay is open. Fix those in the Allowed files, and list any others in the Report.
3. **Nested look:** T-1350 nit 2 says a nested confirm shows one dim layer instead of two. If the parent stays visible and the confirm stands out clearly, leave it; otherwise give the nested popup its own backdrop and say which.
4. No behaviour change otherwise. Every file stays at most 400 lines. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/sheet.tsx`, `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`.

### Allowed files
`apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/ContactPanel.tsx`, `apps/web/src/components/tools/ToolDetailPanel.tsx`, `apps/web/src/components/ais/AiMemorySection.tsx`, `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/ui/dialog.tsx`, `work/T-1351-nested-confirm-escape.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's headless web mock check:** Settings → Folders → edit a folder → Delete → Escape closes only the "Delete folder" confirm, and the folder editor stays open.

---

## Report (written by the worker when done)

### What I did

Made every `ConfirmDialog` that opens while a kit `Sheet`/`Dialog` is open a **React
child** of that overlay, so Base UI nests it (its `useDialogRoot` reads the nearest
`Dialog.Root` context as the parent and sets `escapeKey: isTopmost`). Escape now
closes only the confirm; the parent overlay stays open.

Changed the two known sibling sites:

- `apps/web/src/components/TopicPanel.tsx` — moved the "Make this topic public?"
  and "Archive …?" confirms from after `</Sheet>` to inside the `Sheet`, before
  `</Sheet>`.
- `apps/web/src/components/FolderEditorDialog.tsx` — moved the "Delete folder"
  confirm from after `</Dialog>` to inside the `Dialog`, before `</Dialog>`.

Nested look (spec item 3): **I gave the nested confirm its own backdrop.**
Base UI deliberately renders no backdrop for a nested dialog (`DialogBackdrop`
runs with `enabled: forceRender || !nested`), so an un-nested-in-the-DOM confirm
would sit over a fully bright parent and read as less clearly modal. I restored
Radix's two dim layers:

- `apps/web/src/components/ui/dialog.tsx` — new optional `forceRenderBackdrop`
  prop (default `false`) passed to `DialogPrimitive.Backdrop`'s documented
  `forceRender` prop.
- `apps/web/src/components/ConfirmDialog.tsx` — passes `forceRenderBackdrop`, so
  only confirms force it. Non-nested dialogs already rendered their backdrop, so
  nothing changes for them.

### Files changed

- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/components/FolderEditorDialog.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ConfirmDialog.tsx`
- `work/T-1351-nested-confirm-escape.md` (front matter + this Report)

All at or under 400 lines (263 / 220 / 96 / 62). No tests (UI, per spec).

### Other `<ConfirmDialog` sites checked

`git grep -n "<ConfirmDialog" -- apps/web/src` → 17 sites in 14 files. Besides the
two known ones:

- **Allowed files, already nested, no change needed:**
  - `ContactPanel.tsx:322` is inside its `Sheet` (closes at `:331`) — T-1350
    already verified this one.
  - `tools/ToolDetailPanel.tsx:225` is inside the panel's root div, which is
    rendered inside a kit `Sheet` (via `ToolsSection`), so it is React-nested.
  - `ais/AiMemorySection.tsx:242` is inside `AiMemoryDialog` (a `Dialog`) and
    inside `AiPanel`'s `Sheet`, so it is React-nested in both parents.
- **Not allowed files, no sibling-of-an-open-overlay shape (listed for the record):**
  `ChatActionsMenu.tsx:175`, `ChatHeader.tsx:296`, `ChatList.tsx:190`,
  `SelectionBar.tsx:131` and `:154`, `message/MessageMenu.tsx:235/252/264`,
  `tools/DeleteToolButton.tsx:53`, `routes/SettingsHubPage.tsx:130`,
  `routes/StickersPage.tsx:294`.
  None of these files import `ui/sheet` or `ui/dialog`; their confirms are
  top-level (opened from a menu/popover, a bar, or a route page), so there is no
  open kit overlay to escape from. Two are worth naming: `ChatHeader`'s confirm
  is a sibling of `ChatBackgroundDialog` and `ChatList`'s is a sibling of
  `InviteDialog`/`ExplorePage`/`NewTopicDialog`, but in both the states are
  mutually exclusive (you cannot open the confirm while that dialog is open), so
  neither is the "confirm opened from inside an overlay" pattern.

### Commands run

- `pnpm install` — done in 12.9s; only a deprecated-subdep (`uuid@7.0.3`) and an
  unmet peer (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18)
  warning, both pre-existing. No failure.
- `git grep -n "<ConfirmDialog" -- apps/web/src` — 17 matches, listed above.
- Verified the Base UI behaviour from source
  (`@base-ui/react@1.8.0` `dialog/root/useRenderDialogRoot.js`,
  `dialog/backdrop/DialogBackdrop.js`): the parent `Dialog.Root` provides
  `DialogRootContext` around its children, a nested root reads it, and
  `DialogBackdrop` is disabled when nested unless `forceRender` is set.
- `pnpm gate` — final summary lines:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.8s)
  PASS  lint  (1.8s)
  PASS  typecheck  (8.0s)
  PASS  effect  (1.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

No format/lint/typecheck steps were run separately; no test file was run (UI, and
gate reported no nearby tests).

### Deviations, decisions, open questions

- The only judgement call is spec item 3: I chose to give the nested popup its
  own backdrop (above), rather than leaving the single dim layer.
- `forceRenderBackdrop` is scoped to `ConfirmDialog`, so other nested dialogs
  (e.g. `AiMemoryDialog` opened from `TopicPanel`'s `Sheet`) still keep Base UI's
  single-layer look. If the lead wants every nested dialog to dim its parent,
  that is a one-word change (drop the prop and set `forceRender` on the
  `Backdrop`).
- Acceptance not run here: the headless web mock check (Settings → Folders →
  edit a folder → Delete → Escape) is the lead's check. The behaviour is argued
  from the Base UI source, not observed in a browser.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean (0 nits); the packet is current for `ec55089b`.**
Lead's headless web mock check, Settings → Folders → Edit → Delete:
- the "Delete folder" confirm opens;
- the first Escape closes only the confirm, and the folder editor stays open;
- the second Escape closes the editor.
