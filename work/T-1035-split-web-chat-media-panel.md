---
id: T-1035
title: "Size split T123: apps/web/src/components/ChatMediaPanel.tsx (403 lines) into components/media/{mediaModel,useShowInChat,MediaRows,MediaBody}"
status: merged
milestone: M5
branch: task/T-1035-split-web-chat-media-panel
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1035: Split `ChatMediaPanel.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/ChatMediaPanel.tsx` is 403 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #119 (task T123). The new files go in a new `apps/web/src/components/media/` folder: `mediaModel.ts`, `useShowInChat.ts`, `MediaRows.tsx` and `MediaBody.tsx`. The panel keeps the shell, the tab state and every export it has today. Move the code unchanged; the plan lists no Dedup.

The lead checks the chat media panel in Chrome in mock mode.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #119, and `apps/web/src/components/ChatMediaPanel.tsx`.

### Allowed files
`apps/web/src/components/ChatMediaPanel.tsx`, `apps/web/src/components/media/mediaModel.ts`, `apps/web/src/components/media/useShowInChat.ts`, `apps/web/src/components/media/MediaRows.tsx`, `apps/web/src/components/media/MediaBody.tsx`, `work/T-1035-split-web-chat-media-panel.md`.

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

Split `apps/web/src/components/ChatMediaPanel.tsx` into the new `components/media/` folder, following `docs/audit/split-rules.md`. `ChatMediaPanel.tsx` keeps the shell component and the tab state; every other export it had (`ChatMediaPanel`) is unchanged, and the importer (`apps/web/src/routes/ChatView.tsx`) is untouched.

- `media/mediaModel.ts`: `TABS`, `EMPTY_TITLE`, `DATE_FORMAT`/`formatDate` (private), `formatDuration`, `byline`, `rowSubtitle`, `mediaItemKey`, `JumpTarget`.
- `media/useShowInChat.ts`: the `useShowInChat` hook.
- `media/MediaRows.tsx`: `ShowInChatButton` (local), `FileRow`, `LinkRow`, `MediaThumb`.
- `media/MediaBody.tsx`: `MediaBody`.
- `ChatMediaPanel.tsx`: shell + tab state, imports `MediaBody` and `TABS`/`JumpTarget` from the new files.

Code is moved unchanged except for adding `export` (or making a type visible) to the helpers the new files use; no logic, text or markup changed.

### Files changed

- `apps/web/src/components/ChatMediaPanel.tsx` (rewritten as the shell)
- `apps/web/src/components/media/mediaModel.ts` (new)
- `apps/web/src/components/media/useShowInChat.ts` (new)
- `apps/web/src/components/media/MediaRows.tsx` (new)
- `apps/web/src/components/media/MediaBody.tsx` (new)
- `work/T-1035-split-web-chat-media-panel.md` (this report)

### `wc -l`

```
old: apps/web/src/components/ChatMediaPanel.tsx   403
new: apps/web/src/components/ChatMediaPanel.tsx    84
new: apps/web/src/components/media/mediaModel.ts   59
new: apps/web/src/components/media/useShowInChat.ts 31
new: apps/web/src/components/media/MediaRows.tsx   115
new: apps/web/src/components/media/MediaBody.tsx   143
```
Every file is well under 400 lines.

### Export list, before and after

Before (`grep -E "^export"` on the old file, at `main`):
```
export function ChatMediaPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
```

After (`grep -nE "^export"` on the barrel plus the new files):
```
ChatMediaPanel.tsx:17:export function ChatMediaPanel(...)
media/mediaModel.ts:4:export const TABS: { value: MediaTab; label: string }[] = [
media/mediaModel.ts:11:export const EMPTY_TITLE: Record<MediaTab, string> = {
media/mediaModel.ts:25:export function formatDuration(ms: number | undefined): string {
media/mediaModel.ts:33:export function byline(item: MediaItem): string {
media/mediaModel.ts:41:export function rowSubtitle(item: MediaItem): string {
media/mediaModel.ts:49:export function mediaItemKey(item: MediaItem, index: number): string {
media/mediaModel.ts:54:export interface JumpTarget {
media/useShowInChat.ts:12:export function useShowInChat(target: JumpTarget): (item: MediaItem) => void {
media/MediaRows.tsx:30:export function FileRow({ item, jump }: { item: MediaItem; jump: JumpTarget }) {
media/MediaRows.tsx:57:export function LinkRow({ item, jump }: { item: MediaItem; jump: JumpTarget }) {
media/MediaRows.tsx:86:export function MediaThumb({
media/MediaBody.tsx:19:export function MediaBody({
```
The only previously exported name, `ChatMediaPanel`, is still exported from its original path with the same kind. The new exports are the moved module-local helpers, now shared between the new files.

### Commands run

- `pnpm install` — done, `Done`.
- `pnpm --filter @zilar/web build` — `✓ built in 1.52s` (only the pre-existing >500 kB chunk-size warning).
- `pnpm gate` (repo root), summary:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (1.4s)
PASS  lint  (1.3s)
PASS  typecheck  (5.8s)
PASS  effect  (1.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```
No single test file was run: the web package has no nearby tests for these UI components (gate reports `SKIP tests @zilar/web`), and AGENTS.md says UI code gets no tests.

### Effect ratchet

No `// effect-plain:` marker was added and none was needed. `mediaModel.ts` and `MediaRows.tsx` hold no signals, so they classify `plain`; `useShowInChat.ts` and `MediaBody.tsx` import `effect` as a value, so they classify `effect`; the shell no longer imports Effect and classifies `plain`. Gate printed `PASS effect`.

### Deviations from the spec

`docs/audit/size-plan.md` §2.2 #119 assigns lines 77–118 to `media/useShowInChat.ts`, but lines 98–118 are the `ShowInChatButton` component, which contains JSX and cannot live in a `.ts` file. To keep the file name the spec lists and stay inside the Allowed files, `useShowInChat.ts` holds the `useShowInChat` hook only, and `ShowInChatButton` moved into `MediaRows.tsx` (the JSX row file, where it is used by `FileRow`/`LinkRow`). The code is unchanged; only its location differs. No other deviation.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `ChatMediaPanel.tsx` (403 lines) is now 84 lines, plus `components/media/{mediaModel,useShowInChat,MediaRows,MediaBody}`.
- **The nit:** the new files import via `@/components/ui` while the shell uses `./ui`. That is harmless.
- **The lead checked it in Chrome** (mock, Ana's chat): Chat menu › "Media, files and links" opens the panel with the Media, Files, Links and Voice tabs, the tabs switch, and Retry runs.
- **Not checked:** the rows. The mock backend has no media domain, so the panel shows "Could not load media".
- **The lead's line check:** the old file's non-import code lines against the new files'. The only change is `MediaThumb`'s signature, which Prettier wrapped.
- **Check:** the gate passed, and so did the web build.
