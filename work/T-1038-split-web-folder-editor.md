---
id: T-1038
title: "Size split T120: apps/web/src/components/FolderEditorDialog.tsx (404 lines) into components/folder/{folderEditorModel,ChatPicker,FolderIconPicker,FolderHideSection}"
status: merged
milestone: M5
branch: task/T-1038-split-web-folder-editor
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1038: Split `FolderEditorDialog.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/FolderEditorDialog.tsx` is 404 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #116 (task T120). The new files go in a new `apps/web/src/components/folder/` folder: `folderEditorModel.ts`, `ChatPicker.tsx`, `FolderIconPicker.tsx` and `FolderHideSection.tsx`. The dialog keeps every export it has today.

Move the code unchanged; the plan lists no major Dedup.

The lead checks the folder editor in Chrome in mock mode: create a folder, pick an icon, include a chat, and save.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #116, and `apps/web/src/components/FolderEditorDialog.tsx`.

### Allowed files
`apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/components/folder/folderEditorModel.ts`, `apps/web/src/components/folder/ChatPicker.tsx`, `apps/web/src/components/folder/FolderIconPicker.tsx`, `apps/web/src/components/folder/FolderHideSection.tsx`, `work/T-1038-split-web-folder-editor.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/components/FolderEditorDialog.tsx` (404 lines) into a new `apps/web/src/components/folder/` folder, following `docs/audit/split-rules.md`. The dialog keeps its state, the "Show these chats" section, the write flow and its only export (`FolderEditorDialog`); the moved pieces are now:

- `folder/folderEditorModel.ts`: `TYPE_SWITCHES`, `SECTION_LABEL`, `FolderDeleteFailed`, `FolderWrite`, `saveErrorMessage`.
- `folder/ChatPicker.tsx`: the `ChatPicker` component (unchanged body; now exported and imported by the dialog and `FolderHideSection`).
- `folder/FolderIconPicker.tsx`: the "Name and icon" section (name field + icon radiogroup) as `FolderIconPicker`, taking the state setters `name/setName` and `icon/setIcon` so the moved JSX is byte-identical.
- `folder/FolderHideSection.tsx`: the "Hide" section (muted/read switches + the exclude `ChatPicker`), taking `excludeMuted/excludeRead/excludeChats/excludeSearch` state, their setters and the shared `toggle` helper.
- `FolderEditorDialog.tsx`: now 217 lines; renders `<FolderIconPicker/>` and `<FolderHideSection/>` and keeps the inline type switches.

The importers (`apps/web/src/components/FolderRail.tsx`, `apps/web/src/routes/FoldersPage.tsx`) import `FolderEditorDialog` from the original path and are untouched. Code is moved unchanged; the only edits are adding `export`, turning the two inline JSX blocks into components with props, and adapting imports. No logic, text, markup or behaviour changed.

### Files changed

- `apps/web/src/components/FolderEditorDialog.tsx` (rewritten as the shell)
- `apps/web/src/components/folder/folderEditorModel.ts` (new)
- `apps/web/src/components/folder/ChatPicker.tsx` (new)
- `apps/web/src/components/folder/FolderIconPicker.tsx` (new)
- `apps/web/src/components/folder/FolderHideSection.tsx` (new)
- `work/T-1038-split-web-folder-editor.md` (this report)

### `wc -l`

```
old: apps/web/src/components/FolderEditorDialog.tsx      404
new: apps/web/src/components/FolderEditorDialog.tsx      217
new: apps/web/src/components/folder/folderEditorModel.ts  28
new: apps/web/src/components/folder/ChatPicker.tsx       101
new: apps/web/src/components/folder/FolderIconPicker.tsx  70
new: apps/web/src/components/folder/FolderHideSection.tsx 65
```

Every file is well under 400 lines.

### Export list, before and after

Before (`git show main:apps/web/src/components/FolderEditorDialog.tsx | grep -E "^export"`):
```
export function FolderEditorDialog({
```

After (`grep -E "^export"` on the barrel plus the new files):
```
FolderEditorDialog.tsx:35:export function FolderEditorDialog({
folder/folderEditorModel.ts:5:export const TYPE_SWITCHES: { type: FolderChatType; label: string }[] = [
folder/folderEditorModel.ts:12:export const SECTION_LABEL =
folder/folderEditorModel.ts:15:export class FolderDeleteFailed extends Data.TaggedError('FolderDeleteFailed') {}
folder/folderEditorModel.ts:18:export type FolderWrite = 'save' | 'delete';
folder/folderEditorModel.ts:20:export function saveErrorMessage(error: ApiFailure): string {
folder/ChatPicker.tsx:8:export function ChatPicker({
folder/FolderIconPicker.tsx:7:export function FolderIconPicker({
folder/FolderHideSection.tsx:6:export function FolderHideSection({
```

The only previously exported name, `FolderEditorDialog`, is still exported from its original path with the same kind (function). The extra exports are the moved module-local helpers/components, now shared between the new files. No importer changes.

### Commands run

- `pnpm install` — `Done in 19s` (pre-existing `@types/react-dom` peer warning only).
- `pnpm --filter @zilar/web build` — `✓ built in 967ms` (only the pre-existing >500 kB chunk-size warning).
- `pnpm gate` (repo root), summary:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.8s)
PASS  lint  (1.1s)
PASS  typecheck  (3.1s)
PASS  effect  (0.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```
No single test file was run: these are UI components with no nearby tests (gate reports `SKIP tests @zilar/web`), and AGENTS.md says UI code gets no tests. One gate run started red on `format` because adding `export` to `SECTION_LABEL` pushed that line past 100 chars; I wrapped it with `prettier --write` on that single file and re-ran gate, which then passed fully.

### Effect ratchet

No `// effect-plain:` marker was added and none was needed. `folderEditorModel.ts` imports `effect` as a value (`Data` for the tagged error), so it classifies `effect`; `ChatPicker.tsx`, `FolderIconPicker.tsx` and `FolderHideSection.tsx` hold no signals and classify `plain`; the barrel still imports `Effect`. Gate printed `PASS effect`.

### Deviations from the spec

`docs/audit/size-plan.md` §2.2 #116 assigns lines 157–231 to `folder/FolderIconPicker.tsx`. That range ends inside the "Show these chats" `<section>` (which closes at line 243), so moving it literally would split a JSX section and change the accessibility grouping — a behaviour change, which rule 2 forbids. `FolderIconPicker.tsx` therefore holds the complete "Name and icon" section (157–206), and the type switches (208–231) stay in the dialog together with their section. This also matches the entry's own "Move ~200" (22 + 94 + 50 + 34 ≈ 200 lines). No other deviation.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `FolderEditorDialog.tsx` (404 lines) is now 217 lines, plus `components/folder/{folderEditorModel,ChatPicker,FolderIconPicker,FolderHideSection}`.
- **The lead checked it in Chrome** (mock):
  - New folder opens the dialog with the name field, icon grid, "Show these chats" toggles, Add chats, the Hide toggles and Exclude chats;
  - the lead typed "Work" (4/24), picked the star icon, turned Groups on and added Ana ("1 of 100 selected");
  - Save adds "Work" with the star icon to the rail, and the folder lists the six groups plus Ana.
- **Check:** the gate passed, and so did the web build.
