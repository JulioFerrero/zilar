---
id: T-0981
title: "Size split T31: apps/web/src/components/PackEditor.tsx (783 lines) into components/sticker/{packEditorModel,BlobPreview,PackEditorForm,PackEditorItems,usePackSave}"
status: merged
milestone: M5
branch: task/T-0981-split-web-pack-editor
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0981: Split `PackEditor.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/PackEditor.tsx` is 783 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #27 (task T31). The new files go in a new `apps/web/src/components/sticker/` folder:
- `packEditorModel.ts`, `usePackSave.ts`;
- `BlobPreview.tsx`, `PackEditorForm.tsx`, `PackEditorItems.tsx`.

`PackEditor.tsx` keeps the `PackEditor` component and every export it has today.

The in-file Dedup is in scope:
- `setEmoji` and `retryItem` use `updateRow`;
- `moveItem` and the drop handler share one move helper.

The behaviour must stay the same. T-0982 splits `StickersPage.tsx` into the same new folder at the same time; touch only your own file names.

The lead checks it in Chrome in mock mode: create a pack, add a sticker, set its emoji, reorder, then save.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #27, and `apps/web/src/components/PackEditor.tsx`.

### Allowed files
`apps/web/src/components/PackEditor.tsx`, `apps/web/src/components/sticker/packEditorModel.ts`, `apps/web/src/components/sticker/BlobPreview.tsx`, `apps/web/src/components/sticker/PackEditorForm.tsx`, `apps/web/src/components/sticker/PackEditorItems.tsx`, `apps/web/src/components/sticker/usePackSave.ts`, `work/T-0981-split-web-pack-editor.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's Chrome check passes.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/components/PackEditor.tsx` (783 lines) per
`docs/audit/size-plan.md` §2.2 #27 into a new `apps/web/src/components/sticker/`
folder, keeping `PackEditor.tsx` as the component plus a thin barrel of every
name it exported before:

- `packEditorModel.ts` — item/props types, `PACK_ACCEPT`, `nextKey`,
  `takeSingleEmoji`, `isEmojiLike`, the `call`/`CallFailed`/`messageOf`
  helpers, `prepareItem` and the `PrepareBatch` component (plan 20–185).
- `BlobPreview.tsx` — the object-URL preview (plan 195–218).
- `PackEditorForm.tsx` — title, visibility, drop zone and the preparing
  batches (plan 530–625).
- `PackEditorItems.tsx` — the sticker rows: emoji, reorder, retry, remove
  (plan 627–753).
- `usePackSave.ts` — `flushRemovals`, create/edit/resume, `saveEffect` and the
  pre-save validation, plus the progress/form-error state they drive
  (plan 352–519).

The in-file Dedup from the plan is applied, both kept inside my files:
`setEmoji` and `retryItem` now call `updateRow`; `moveItem` and the drop
handler share one `moveByIndex` helper in the barrel.

`PackEditor.tsx` still holds the `PackEditor` component (state, handlers and
the composed JSX) and re-exports every name it exported before. No importer
changed: `apps/web/src/routes/StickersPage.tsx` still imports `PackEditor`
from `@/components/PackEditor`.

### Files changed

- `apps/web/src/components/PackEditor.tsx` (barrel + `PackEditor`)
- `apps/web/src/components/sticker/packEditorModel.ts`
- `apps/web/src/components/sticker/BlobPreview.tsx`
- `apps/web/src/components/sticker/PackEditorForm.tsx`
- `apps/web/src/components/sticker/PackEditorItems.tsx`
- `apps/web/src/components/sticker/usePackSave.ts`
- `work/T-0981-split-web-pack-editor.md` (status)

### Sizes (split-rules item 8)

Old: `git show main:apps/web/src/components/PackEditor.tsx | wc -l` = **783**.

New (`wc -l`):

```
218 apps/web/src/components/PackEditor.tsx
178 apps/web/src/components/sticker/packEditorModel.ts
256 apps/web/src/components/sticker/usePackSave.ts
 35 apps/web/src/components/sticker/BlobPreview.tsx
142 apps/web/src/components/sticker/PackEditorForm.tsx
157 apps/web/src/components/sticker/PackEditorItems.tsx
```

Every file is under 400; no `max-lines` warning appeared (lint passed).

### Exports before and after (split-rules item 8)

Before (`git show main:apps/web/src/components/PackEditor.tsx | grep -nE "^export"`):

```
20:export type PackEditorItemStatus = 'ready' | 'uploading' | 'done' | 'error';
22:export interface PackEditorItem {
40:export interface PackEditorProps {
57:export const PACK_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
66:export function takeSingleEmoji(value: string): string {
236:export function PackEditor({
```

After (`grep -nE "^export"` on the barrel plus the new files):

```
PackEditor.tsx:21: export type { PackEditorItem, PackEditorItemStatus, PackEditorProps } from './sticker/packEditorModel';
PackEditor.tsx:26: export { PACK_ACCEPT, takeSingleEmoji } from './sticker/packEditorModel';
PackEditor.tsx:37: export function PackEditor({
packEditorModel.ts:13: export type PackEditorItemStatus = ...
packEditorModel.ts:15: export interface PackEditorItem {
packEditorModel.ts:33: export interface PackEditorProps {
packEditorModel.ts:50: export const PACK_ACCEPT = ...
packEditorModel.ts:53: export type PrepareSticker = typeof prepareStickerImage;
packEditorModel.ts:56: export function nextKey(): string {
packEditorModel.ts:62: export function takeSingleEmoji(value: string): string {
packEditorModel.ts:73: export function isEmojiLike(value: string): boolean {
packEditorModel.ts:88: export class CallFailed extends ...
packEditorModel.ts:91: export function call<A>(...)
packEditorModel.ts:96: export function messageOf(...)
packEditorModel.ts:131: export interface PrepareBatchJob {
packEditorModel.ts:142: export function PrepareBatch({
BlobPreview.tsx:12: export function BlobPreview(...)
PackEditorForm.tsx:13: export interface PackEditorFormProps {
PackEditorForm.tsx:28: export function PackEditorForm({
PackEditorItems.tsx:9: export interface PackEditorItemsProps {
PackEditorItems.tsx:20: export function PackEditorItems({
usePackSave.ts:20: export interface UsePackSaveOptions {
usePackSave.ts:41: export interface PackSaveControls {
usePackSave.ts:54: export function usePackSave({
```

The six old exports keep the same names and kinds: the three types
(`PackEditorItemStatus`, `PackEditorItem`, `PackEditorProps`), the const
`PACK_ACCEPT` and the function `takeSingleEmoji` are re-exported by the barrel;
`PackEditor` stays in the barrel. The new files export only their own new APIs
(their functions/hooks/props types). No module imported them before and none
does now.

### Commands run (real results)

- `pnpm install` — done in 18.4s; only the pre-existing `@types/react` unmet
  peer notice.
- `pnpm --filter @zilar/web build` — success: `✓ built in 1.00s`; only the
  pre-existing ">500 kB chunk" warning.
- `pnpm gate` — `GATE PASS`:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (1.6s)
PASS  lint  (1.0s)
PASS  typecheck  (4.4s)
PASS  effect  (0.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

- Single test files run: **none**. `apps/web` has no tests near the changed
  files and the gate's nearest-test step skipped the package
  ("no nearby test files"). UI code gets no tests (AGENTS.md).

### Effect ratchet (split-rules item 6)

No `// effect-plain:` marker was needed or added. `packEditorModel.ts`,
`BlobPreview.tsx` and `usePackSave.ts` import `effect` as a value, so the map
classifies them `effect`; `PackEditorForm.tsx`, `PackEditorItems.tsx` and the
barrel import no Effect and hold no signals, so they are `plain` (accepted).
The gate's `PASS effect` confirms it.

### Behaviour

No behaviour change. Code moved unchanged except the two named Dedup items,
both inside my files: `setEmoji`/`retryItem` → `updateRow`, and
`moveItem`/drop → one `moveByIndex`. The barrel composes `PackEditorForm` and
`PackEditorItems` as direct children of the same `flex flex-col gap-4` outer
div, so rendered DOM order, classes and handlers are unchanged. The form owns
the file-input ref (its only use); the items list owns the drag-index ref (its
only use). `PackEditorItemStatus` is still exported as a type. `SaveInput`
(plan 220–225) moved into `usePackSave.ts`, its only user, and is not exported.

### Deviations from the spec

1. `usePackSave.ts` also owns `formError`, `doneCount` and `activeCount` (the
   plan's range starts the hook at 352, after those declarations at 283–285).
   The pre-save validation and `saveEffect` both set them, and `shownFormError`
   (plan 498) and the progress text (plan 526–527) read them, so the hook owns
   the three pieces of state and returns `shownFormError` and `progress`. The
   rendered output is unchanged; `readyCount`/`errorCount` stay in the barrel.
2. `PackEditorProps` uses a small internal `PrepareSticker = typeof
   prepareStickerImage` alias in the model so the new files can name the
   injected prepare function; the barrel re-exports `PackEditorProps`
   unchanged.

### Security checklist

Internal web UI refactor: no secrets, no scoped deletes/updates, no routes, no
caps, no audit entries. Nothing on the checklist applies. No dependency was
added; no check, test or lint rule was disabled.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `PackEditor.tsx` (783 lines) is now 218 lines, plus `components/sticker/{packEditorModel,BlobPreview,PackEditorForm,PackEditorItems,usePackSave}`, the largest `usePackSave.ts` at 256.
- **The nit:** `moveItem` reads the index from the render closure. It's harmless for one click at a time.
- **The lead checked it in Chrome at `?mock=1`:**
  - Edit on Cats opens the editor with the name, visibility, the drop zone and the rows;
  - moving 🐱 down puts 😂 first;
  - Save goes back to the list, and Cats now starts 😂, 🐱.
- **Not checked:** the emoji field for new uploads, which needs a file pick. Saved stickers have no emoji input.
- **Check:** the gate passed, and so did the web build.
