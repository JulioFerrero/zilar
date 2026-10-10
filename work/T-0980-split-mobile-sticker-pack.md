---
id: T-0980
title: "Size split T24: apps/mobile/src/app/settings/sticker-pack.tsx (859 lines) into components/stickers/{use-pack-editor,pack-visibility-field,pack-saved-grid,pack-fresh-list,pack-actions}; one VisibilityOption"
status: merged
milestone: M5
branch: task/T-0980-split-mobile-sticker-pack
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0980: Split the mobile sticker pack screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/sticker-pack.tsx` is 859 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #20 (task T24): `components/stickers/use-pack-editor.ts`, `stickers/pack-visibility-field.tsx`, `stickers/pack-saved-grid.tsx`, `stickers/pack-fresh-list.tsx`, `stickers/pack-actions.tsx`, under `apps/mobile/src/`. The route file keeps its default export, the shell and the load states.

- **One more split:** `use-pack-editor.ts` would be about 400 lines from the plan's range 85–484. If it goes over 400, split it once more (`split-rules.md` item 4), for example into `use-pack-editor.ts` plus `use-pack-items.ts`, and name the new file in the Report.
- **In scope:** the in-file Dedup, one `VisibilityOption` for the two duplicated radios.
- **Out of scope:** `use-session-token.ts`, because it is shared with `stickers.tsx` and so crosses files.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #20, and `apps/mobile/src/app/settings/sticker-pack.tsx`.

### Allowed files
`apps/mobile/src/app/settings/sticker-pack.tsx`, `apps/mobile/src/components/stickers/use-pack-editor.ts`, `apps/mobile/src/components/stickers/use-pack-items.ts`, `apps/mobile/src/components/stickers/pack-visibility-field.tsx`, `apps/mobile/src/components/stickers/pack-saved-grid.tsx`, `apps/mobile/src/components/stickers/pack-fresh-list.tsx`, `apps/mobile/src/components/stickers/pack-actions.tsx`, `work/T-0980-split-mobile-sticker-pack.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for. The lead runs a phone smoke of `/settings/sticker-pack` in a mock build.

---

## Report (written by the worker when done)

**Status:** review

### What I did
Split `apps/mobile/src/app/settings/sticker-pack.tsx` (859 lines) into the five files the plan lists, plus the extra `use-pack-items.ts` the spec allows. The route keeps its default export, the shell and the load states. Code moved unchanged; no importers change (the route was the only importer); no tests written or edited.

Files:
- `apps/mobile/src/app/settings/sticker-pack.tsx` — route/shell, pack name field, load states, the two confirm dialogs.
- `apps/mobile/src/components/stickers/use-pack-editor.ts` — pack state, load, delete, back guard, session token, composition.
- `apps/mobile/src/components/stickers/use-pack-items.ts` — **the extra split** (named here): saved/fresh/removed items, pick/retry/remove/emoji, and the Save/upload loop.
- `apps/mobile/src/components/stickers/pack-visibility-field.tsx` — `PackVisibilityField` and the deduped `VisibilityOption`.
- `apps/mobile/src/components/stickers/pack-saved-grid.tsx` — `PackSavedGrid`.
- `apps/mobile/src/components/stickers/pack-fresh-list.tsx` — `PackFreshList`.
- `apps/mobile/src/components/stickers/pack-actions.tsx` — `PackActions`.
- `work/T-0980-split-mobile-sticker-pack.md` — status/report.

### Sizes (split-rules item 8)
`wc -l` old file (`git show HEAD:apps/mobile/src/app/settings/sticker-pack.tsx | wc -l`): **859**.
New files, all ≤ 400:
```
177 apps/mobile/src/app/settings/sticker-pack.tsx
291 apps/mobile/src/components/stickers/use-pack-editor.ts
389 apps/mobile/src/components/stickers/use-pack-items.ts
 94 apps/mobile/src/components/stickers/pack-visibility-field.tsx
117 apps/mobile/src/components/stickers/pack-saved-grid.tsx
111 apps/mobile/src/components/stickers/pack-fresh-list.tsx
 87 apps/mobile/src/components/stickers/pack-actions.tsx
```

### Extra split (split-rules item 4)
At the plan's range plus imports/return, `use-pack-editor.ts` came out at 427 lines, over 400. I split it once more into `use-pack-editor.ts` + `use-pack-items.ts` (the name the spec suggests). The first boundary left `use-pack-editor.ts` at 274 and `use-pack-items.ts` at 409 (still over 400), so I moved the session-token fork (moved unchanged) into `use-pack-editor.ts`; the final counts are 291 and 389.

### Export list before → after (split-rules item 8)
Before (`grep -E "^export"` on the old file):
```
export default function StickerPackScreen() {
export interface StickerPackScreenDeps {
```
After (`grep -E "^export"` route + new files):
```
apps/mobile/src/app/settings/sticker-pack.tsx:export default function StickerPackScreen() {
apps/mobile/src/app/settings/sticker-pack.tsx:export type StickerPackScreenDeps = PackEditorDeps;
apps/mobile/src/components/stickers/use-pack-editor.ts:export type { PackVisibility };
apps/mobile/src/components/stickers/use-pack-editor.ts:export type LoadStatus = 'loading' | 'ready' | 'load-error' | 'not-found' | 'forbidden';
apps/mobile/src/components/stickers/use-pack-editor.ts:export interface PackEditorDeps {
apps/mobile/src/components/stickers/use-pack-editor.ts:export interface PackEditor {
apps/mobile/src/components/stickers/use-pack-editor.ts:export function usePackEditor({ picker, preparer }: PackEditorDeps): PackEditor {
apps/mobile/src/components/stickers/use-pack-items.ts:export type PackVisibility = 'private' | 'server';
apps/mobile/src/components/stickers/use-pack-items.ts:export interface UsePackItemsDeps {
apps/mobile/src/components/stickers/use-pack-items.ts:export interface PackItems {
apps/mobile/src/components/stickers/use-pack-items.ts:export function usePackItems({
apps/mobile/src/components/stickers/pack-visibility-field.tsx:export function VisibilityOption({
apps/mobile/src/components/stickers/pack-visibility-field.tsx:export function PackVisibilityField({
apps/mobile/src/components/stickers/pack-saved-grid.tsx:export function PackSavedGrid({
apps/mobile/src/components/stickers/pack-fresh-list.tsx:export function PackFreshList({
apps/mobile/src/components/stickers/pack-actions.tsx:export function PackActions({
```
The route still exports the same names and kinds (default component + a type); `StickerPackScreenDeps` is now a type alias of `PackEditorDeps`.

### Dedup
- `VisibilityOption` (in `pack-visibility-field.tsx`) replaces the two duplicated radios.
- `use-session-token.ts` is out of scope (crosses files with `stickers.tsx`), so the token fork was moved unchanged, not shared.

### Commands (real results)
- `pnpm install` → `Done in 12.5s`, 1172 packages added.
- Effect ratchet on the changed files only: `pnpm --filter @zilar/devtools exec tsx src/effect-map/ratchet-cli.ts --base main <7 files>` → `effect: ok (7 files checked)`.
- `pnpm gate` (from the repo root):
```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (0.9s)
PASS  lint  (0.7s)
PASS  typecheck  (4.7s)
PASS  effect  (2.0s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```
- Single test files: none — no test sits next to this route (the gate reports `SKIP tests @zilar/mobile (no nearby test files)`) and the task is UI-only, which AGENTS says gets no tests.
- The task's Checks also list `pnpm --filter @zilar/mobile typecheck`; I did not run it standalone, per the instruction not to run typecheck one by one before the gate. The gate's `typecheck` step covers it (it runs the affected packages, `@zilar/mobile` included) and passed.

### Deviations / boundary choices
- The two `ConfirmDialog`s stay in the route shell (they are direct children of `SettingsScreenShell`, outside the content column). The plan's `pack-actions.tsx` range (789–856) includes them, but the dialogs render outside the `gap-5` column; keeping them in the shell avoids nesting Modals inside the content column. `PackActions` holds the save feedback, the Save/Cancel row and the delete button.
- The route keeps the `<View className="gap-2">` stickers-section wrapper, with `PackSavedGrid` (which returns a fragment) and `PackFreshList` as its children, so the extracted pieces keep the exact original spacing. No behavior or layout change.
- The session-token fork now lives in `use-pack-editor.ts` (it was the extra split's balance).

### Effect ratchet
No `// effect-plain:` marker was added. `use-pack-editor.ts` and `use-pack-items.ts` import `effect` as a value; the four presentational files classify `plain`. The gate's `effect` step passed.

### Security checklist
UI-only change: no routes, writes, permissions, caps or audit entries are touched, and no secrets are handled. Nothing to change.

### Problems / open questions
None. No blockers.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `settings/sticker-pack.tsx` (859 lines) becomes the screen plus six files in `components/stickers/`. `use-pack-items.ts` (389) is the extra split the spec allowed. One `VisibilityOption` replaces the two radios.
- **The lead's phone smoke** (mock build, `/settings/sticker-pack`): "New pack" shows the name field, both visibility options, the stickers grid with Add and 0 / 120, the format hint, and Create pack (disabled) with Cancel. Tapping "Shared on this server" moves the radio from Private to Shared.
- **Check:** the gate passed.
