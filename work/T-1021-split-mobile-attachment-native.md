---
id: T-1021
title: "Size split T75: apps/mobile/src/lib/attachment-native.ts (528 lines) into lib/{attachment-picker,attachment-uploader,attachment-opener,gif-downloader}.ts, the old path re-exports"
status: merged
milestone: M5
branch: task/T-1021-split-mobile-attachment-native
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1021: Split `attachment-native.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/lib/attachment-native.ts` is 528 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #71 (task T75): `lib/attachment-picker.ts`, `lib/attachment-uploader.ts`, `lib/attachment-opener.ts`, `lib/gif-downloader.ts`, under `apps/mobile/src/`. `attachment-native.ts` re-exports every name it exports today.

- **Skip the Dedup:** it crosses files to `packages/chat-core` and `voice-native.ts`.
- **Shared code:** the shared `NativeFailure` types, the message constants (`attachment-native.ts:32-56`) and `authHeadersFor` (`attachment-native.ts:508-528`) go into one new `lib/attachment-common.ts`, so the new files don't import the barrel.
- **Move unchanged:** `authHeadersFor` decides which host gets the user's session token, so not one line of it changes.

The lead runs a phone smoke of the composer's attach button in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #71, and `apps/mobile/src/lib/attachment-native.ts`.

### Allowed files
`apps/mobile/src/lib/attachment-native.ts`, `apps/mobile/src/lib/attachment-picker.ts`, `apps/mobile/src/lib/attachment-uploader.ts`, `apps/mobile/src/lib/attachment-opener.ts`, `apps/mobile/src/lib/gif-downloader.ts`, `apps/mobile/src/lib/attachment-common.ts`, `work/T-1021-split-mobile-attachment-native.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did
Split `apps/mobile/src/lib/attachment-native.ts` (528 lines on main) into the four files of
`docs/audit/size-plan.md` §2.2 #71, plus one shared `attachment-common.ts` as the spec directs.
Code is moved unchanged; nothing was re-implemented. `attachment-native.ts` is now a thin barrel
that re-exports every name it exported before, so no importer changed.

- `lib/attachment-picker.ts` — `createAttachmentPicker`, `createSizeReader`, `SizeReader`, plus the
  private `tooLarge`/`pickedFile` helpers (old lines 58–240).
- `lib/attachment-uploader.ts` — `createAttachmentUploader`, plus the private
  `checkUploadStatus`/`uploadEffect` helpers (old lines 243–314).
- `lib/attachment-opener.ts` — `createAttachmentOpener`, `cacheDestinationFor`, plus the private
  `openFailureOf`/`openEffect` helpers (old lines 317–394).
- `lib/gif-downloader.ts` — `createGifDownloader`, `GIF_DOWNLOAD_FAILED_MESSAGE`, plus the private
  `isRecord`/`headerMimeType`/`downloadGifEffect`/`fileSize` helpers (old lines 396–502).
- `lib/attachment-common.ts` — the shared message constants + `NativeFailure` + `ErrorResult` +
  `orErrorResult` (old lines 32–56) and `authHeadersFor` (old lines 508–528), moved unchanged.
- `lib/attachment-native.ts` — barrel re-exporting the old public names.

**Dedup skipped, as the spec says:** the §2.2 #71 dedup into
`packages/chat-core/src/media.ts` (`sameOriginAuthHeaders` replacing voice-native's copy) crosses
files, so it is left for a separate F task.

### Files changed (all inside Allowed files)
- `apps/mobile/src/lib/attachment-native.ts` (modified → barrel)
- `apps/mobile/src/lib/attachment-common.ts` (new)
- `apps/mobile/src/lib/attachment-picker.ts` (new)
- `apps/mobile/src/lib/attachment-uploader.ts` (new)
- `apps/mobile/src/lib/attachment-opener.ts` (new)
- `apps/mobile/src/lib/gif-downloader.ts` (new)
- `work/T-1021-split-mobile-attachment-native.md` (this report)

### `wc -l` (old vs new)
```
(old, main) apps/mobile/src/lib/attachment-native.ts : 528
(new)       apps/mobile/src/lib/attachment-native.ts :  19  (barrel)
(new)       apps/mobile/src/lib/attachment-common.ts :  61
(new)       apps/mobile/src/lib/attachment-picker.ts : 206
(new)       apps/mobile/src/lib/attachment-uploader.ts : 83
(new)       apps/mobile/src/lib/attachment-opener.ts :  99
(new)       apps/mobile/src/lib/gif-downloader.ts   : 123
```
Every new file and the barrel stay well under 400 lines.

### Export list, before vs after
`git show main:apps/mobile/src/lib/attachment-native.ts | grep -E "^export"` (before, 9 names):
```
export type { PickedFile, PickResult } from './attachment-ports';
export function createAttachmentPicker(sizeReader?: SizeReader): AttachmentPicker {
export interface SizeReader {
export function createSizeReader(
export function createAttachmentUploader(): AttachmentUploader {
export function createAttachmentOpener(options?: {
export function cacheDestinationFor(name: string): string {
export const GIF_DOWNLOAD_FAILED_MESSAGE = 'Could not load that GIF. Try another.';
export function createGifDownloader(options?: {
```
`grep -hE "^export"` on the barrel + the new files (after). Barrel lines are the public surface
and match the old names and kinds; the extra lines are the new private-to-the-split exports in
`attachment-common.ts` and the moved definitions (not on the barrel path, so importers see no
change):
```
# barrel (public surface, unchanged names/kinds)
export type { PickedFile, PickResult } from './attachment-ports';
export { createAttachmentPicker, createSizeReader } from './attachment-picker';
export type { SizeReader } from './attachment-picker';
export { createAttachmentUploader } from './attachment-uploader';
export { cacheDestinationFor, createAttachmentOpener } from './attachment-opener';
export { createGifDownloader, GIF_DOWNLOAD_FAILED_MESSAGE } from './gif-downloader';
# attachment-common.ts (internal to the split)
export const TOO_LARGE_MESSAGE / EMPTY_MESSAGE / DENIED_MESSAGE / CAMERA_DENIED_MESSAGE /
             PICK_FAILED_MESSAGE / OPEN_FAILED_MESSAGE
export class NativeFailure ...
export type ErrorResult = ...
export const orErrorResult = ...
export const authHeadersFor = ...
# attachment-picker.ts
export function createAttachmentPicker / export interface SizeReader / export function createSizeReader
# attachment-uploader.ts
export function createAttachmentUploader
# attachment-opener.ts
export function createAttachmentOpener / export function cacheDestinationFor
# gif-downloader.ts
export const GIF_DOWNLOAD_FAILED_MESSAGE / export function createGifDownloader
```
No importer outside the Allowed files was edited.

### Effect ratchet
No `// effect-plain:` marker was added. Every new file imports `effect` as a value (`Effect`,
`EffectType`, `Data`), so the ratchet classifies them `effect`; the gate's `effect` step printed
`PASS effect`.

### Commands and real results
- `pnpm install` — done, 1172 packages.
- `pnpm --filter @zilar/mobile typecheck` — PASS (`tsc --noEmit`, no output).
- `pnpm gate` (from repo root) — `GATE PASS`; summary lines:
```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (1.1s)
PASS  lint  (2.1s)
PASS  typecheck  (3.8s)
PASS  effect  (1.0s)
PASS  tests @zilar/mobile  (3.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```
The format step failed once on `attachment-common.ts`; I ran `prettier --write` on the changed
files and re-ran the gate, which then passed.

### Tests
No new tests, per `split-rules.md` item 5 and the task (move-only split). I ran no single test file
individually; the gate's `tests @zilar/mobile` step ran the nearest mobile tests and passed.

### Security checklist
Not applicable to this change: it is a move-only split with no new routes, no logging, no deletes
or updates, no caps and no audit entries. `authHeadersFor` (which decides which host receives the
session token) was moved byte-for-byte into `attachment-common.ts`; its logic is unchanged.

### Deviations from the spec
None beyond the spec's own instruction to skip the cross-file dedup. `SizeReader` is re-exported
from the barrel as a type (`export type`) to preserve its kind.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `attachment-native.ts` (528 lines) is now a 19-line barrel, plus `attachment-{picker,uploader,opener,common}` and `gif-downloader`. The largest is the picker at 206.
- **The nit:** a line count in the Report is off by 2.
- **The lead's diff of `authHeadersFor`** (which host gets the session token) against main: only `export` was added.
- **The lead's phone smoke** (mock, Ana's chat):
  - the attach sheet shows Photo or video, Take a photo, File and the demo files;
  - attaching the demo `tickets.pdf` stages it ("2.3 MB · sending with your message").
- **Check:** the gate passed.
