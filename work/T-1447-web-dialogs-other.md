---
id: T-1447
title: "Web dialogs follow the approved standard (E2+E3): invite, forward, Telegram import, attach, crop, chat background, folder editor, add machine, group members: no Cancel/Close footer key, Enter submits, kit error line and busy, first field focused"
status: merged
milestone: M5
branch: task/T-1447-web-dialogs-other
model: auto
effort: default
depends_on: [T-1431]
estimate: 0.6 day
---

# T-1447: Web dialogs on the standard (the rest)

## Spec (written by Claude, do not edit)

### Why
This is the same standard as T-1446 (`docs/design/mockups/new-ai/README.md`, "Rules the design set"):
- one way out: the header close key or Esc;
- one primary in the footer;
- no new subtitles or hints.

T-1431 gave every `Dialog` the close key. This task moves the remaining dialogs onto the rest of the standard. **Only chrome and keyboard behaviour change**: copy, data and flow stay the same.

### Facts (the lead read them on main, 2026-10-15)
- **The kit:** `apps/web/src/components/ui/dialog.tsx:7-39`: `actions` (old footer keys), `footer`, `error` (fixed error line), `onSubmit` (Enter submits), `busy` (locks Esc, backdrop and close), `[data-autofocus]`.
- **The dialogs:**
  - **Invite:** `apps/web/src/components/InviteDialog.tsx` (71 lines). `actions` (`:39`); its own error `<p role="alert">` (`:46`).
  - **Forward:** `apps/web/src/components/ForwardPicker.tsx` (134 lines). `actions` (`:86`).
  - **Telegram import:** `apps/web/src/components/TelegramImportDialog.tsx` (287 lines). Four `actions` blocks (`:117`, `:152`, `:188`, `:233`); a ghost Cancel or Close (`:235`); its own error (`:264`).
  - **Attach:** `apps/web/src/components/attach/AttachSendDialog.tsx` (187 lines). A ghost Cancel in `actions` (`:127-129`); its own error (`:179`).
  - **Crop:** `apps/web/src/components/avatar/CropDialog.tsx` (120 lines). A ghost Cancel in `actions` (`:55-57`).
  - **Chat background:** `apps/web/src/components/ChatBackgroundDialog.tsx` (313 lines). Its own error `<span role="alert">` (`:306`).
  - **Folder editor:** `apps/web/src/components/FolderEditorDialog.tsx` (220 lines). A ghost Cancel in `actions` (`:113-126`); its own error (`:199`); it uses `ConfirmDialog` for delete, which stays.
  - **Add machine:** `apps/web/src/components/machines/AddMachineDialog.tsx` (228 lines). A ghost Close key (`:92`).
  - **Group members:** `apps/web/src/components/GroupMembersSection.tsx` (368 lines). Its dialog's `actions` has a ghost key (`:323-325`). The other ghost keys at `:153-307` are row actions, not dialog chrome, so leave them alone.

### What to build (the same rules for each dialog)
1. **Remove the footer's Cancel, Close or Done key.**
   - The header key, Esc and the backdrop close the dialog.
   - A state whose only key was Close or Done (for example the add-machine code screen, or the Telegram import's result) has no footer.
2. **The footer's one primary stays.** In a dialog with steps, it is Back plus the primary when a Back already exists.
3. **A dialog with a text field and a primary uses `onSubmit`**, so Enter submits. The primary becomes `type="submit"`.
4. **The dialog's own `role="alert"` error moves to the `error` prop.** Keep the text.
5. **While a request runs, pass `busy`.**
6. **The first text field gets `data-autofocus`**, where there is one.
7. **Every file stays at 400 lines or fewer.** Remove imports that are no longer used.

### Tests
None (UI).

### Allowed files
- `apps/web/src/components/InviteDialog.tsx`, `apps/web/src/components/ForwardPicker.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`
- `apps/web/src/components/attach/AttachSendDialog.tsx`, `apps/web/src/components/avatar/CropDialog.tsx`
- `apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/FolderEditorDialog.tsx`
- `apps/web/src/components/machines/AddMachineDialog.tsx`, `apps/web/src/components/GroupMembersSection.tsx`
- `work/T-1447-web-dialogs-other.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead opens the dialogs headless in mock mode: one close key, no Cancel or Close in the footer.

---

## Report (written by the worker when done)

### What I did

Chrome and keyboard only: copy, data and flow are unchanged. Each dialog now has one way out (header close key / Esc / backdrop), one footer primary, Enter submits where there is a text field and a primary, the dialog's own `role="alert"` moved to the kit `error` line, `busy` while a request runs, and the first text field focused with `data-autofocus`.

- **InviteDialog** — dropped the Close footer key; the error sentence moved to `error` (the body now renders nothing on failure, as before).
- **ForwardPicker** — dropped Cancel; `onSubmit` added (Send is `type="submit"`, Enter in the search field sends); search field got `data-autofocus`.
- **TelegramImportDialog** — dropped the Close/Done/Cancel footer keys in all four states; the result state's close now calls `onDone()` so the list still refreshes (the old Done did both); form uses `onSubmit`, `busy`, kit `error`, and `data-autofocus` instead of `initialFocusRef`; removed the duplicate in-body close icon (it was a second close key beside the kit header key). The two message states now have no footer.
- **AttachSendDialog** — dropped Cancel; `onSubmit` added (Send is `type="submit"`; the caption textarea keeps its Enter handler); error moved to `error`; `data-autofocus` on the caption instead of `initialFocusRef`.
- **CropDialog** — dropped Cancel; `busy` replaces `dismissable={!busy}` so the close key is off while saving too.
- **ChatBackgroundDialog** — the save error span moved to `error`; `busy` passed (upload).
- **FolderEditorDialog** — dropped Cancel; the Delete folder key and ConfirmDialog stay; `onSubmit` added (Save is `type="submit"`); error moved to `error`; `busy` passed.
- **AddMachineDialog** — dropped Close from the error state (only "Try again" stays); dropped the Done key from the code screen (ready now has no footer, expired keeps "New code").
- **GroupMembersSection** — dropped Cancel from the Add members dialog footer; `busy` passed. Left the row-action ghost keys untouched, as the spec says.

Files changed (all inside Allowed files):
`apps/web/src/components/{InviteDialog,ForwardPicker,TelegramImportDialog,ChatBackgroundDialog,FolderEditorDialog,GroupMembersSection}.tsx`, `apps/web/src/components/attach/AttachSendDialog.tsx`, `apps/web/src/components/avatar/CropDialog.tsx`, `apps/web/src/components/machines/AddMachineDialog.tsx`, `work/T-1447-web-dialogs-other.md`.

### Commands and real results

`pnpm install` — done (19.1s).
`pnpm gate` (from the repo root), final output:
```
gate: 10 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.8s)
PASS  lint  (1.0s)
PASS  typecheck  (4.2s)
PASS  effect  (1.2s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
No single test files were run: these are UI components and no test sits in their folders (the gate confirmed "no nearby test files").

### Problems / deviations

- **Telegram import in-body close icon:** the spec rules only name footer keys, but the acceptance says "one close key", and that file also had its own ghost X in the body (a second close key next to the kit header key). I removed it; Esc/backdrop/header cover every state, and `busy` now blocks all three while the import runs.
- **Folder editor first field:** the first text field is the folder-name input, which lives in `apps/web/src/components/folder/FolderIconPicker.tsx` — outside the Allowed files, so I could not add `data-autofocus` there. The dialog therefore has no `data-autofocus`; focus falls back to the popup. If you want it, the picker needs an allowed change.
- **`busy` where the request is automatic on open** (InviteDialog's link fetch, AddMachineDialog's code fetch): I did not pass `busy` there, so the dialog stays closable while it loads. `busy` is only passed where a user-started action runs (import, save/delete, upload, add members, crop).

### Open questions

None. This is done and the gate is green.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 2, follow-up 1.
- The lead opened Add machine and Invite headless (mock mode, 1280 px):
  - each has one close-like key (the header X);
  - Add machine shows only Copy;
  - Invite puts its error on the kit error line.
- Invite fails in mock mode because the mock has no invite route. The old dialog failed the same way.
- Follow-up: `data-autofocus` on the folder-name input (`folder/FolderIconPicker.tsx`) goes into the next web batch.
