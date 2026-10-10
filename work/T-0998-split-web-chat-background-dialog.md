---
id: T-0998
title: "Size split T66: apps/web/src/components/ChatBackgroundDialog.tsx (555 lines) into components/background/{backgroundOps,backgroundWrites,PresetGrid,BackgroundImages}"
status: merged
milestone: M5
branch: task/T-0998-split-web-chat-background-dialog
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0998: Split `ChatBackgroundDialog.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/ChatBackgroundDialog.tsx` is 555 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #62 (task T66). The new files go in a new `apps/web/src/components/background/` folder: `backgroundOps.ts`, `backgroundWrites.ts`, `PresetGrid.tsx` and `BackgroundImages.tsx`. `ChatBackgroundDialog.tsx` keeps the dialog and every export it has today. The entry has no Dedup.

The lead checks it in Chrome in mock mode: open a chat's background dialog, pick a preset and save.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #62, and `apps/web/src/components/ChatBackgroundDialog.tsx`.

### Allowed files
`apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/background/backgroundOps.ts`, `apps/web/src/components/background/backgroundWrites.ts`, `apps/web/src/components/background/PresetGrid.tsx`, `apps/web/src/components/background/BackgroundImages.tsx`, `work/T-0998-split-web-chat-background-dialog.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the Report names how to open the dialog, for the lead's Chrome check.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/components/ChatBackgroundDialog.tsx` (555 lines) into the four
files named by `docs/audit/size-plan.md` §2.3 #62, following `split-rules.md`. No
behaviour change: the moved code is unchanged except for the minimum needed to
turn it into modules/components, and `ChatBackgroundDialog.tsx` keeps every export
it had.

- `background/backgroundOps.ts` — the plain helpers moved from the old lines 29–82:
  `Scope`, `DIM_SAVE_DELAY_MS`, the three `Data.TaggedError` classes, `SaveRequest`,
  `UploadRequest`, `writeSave`, `presetLabel`, `uploadErrorMessage`. They were
  module-private before; they are now `export`ed so the dialog and the other new
  files can import them.
- `background/backgroundWrites.ts` — the four store-write helpers moved from the old
  lines 157–210 (`persist`, `writePreset`, `writeImage`, `clearDeletedSelection`).
  They close over store setters and current values, so they are wrapped in
  `createBackgroundWrites(deps)`. The parameter object is destructured into the
  original local names, so every function body is byte-identical to the original;
  only the enclosing function signature is new.
- `background/PresetGrid.tsx` — the preset grid JSX moved from the old lines
  369–393, now `PresetGrid({ selected, onChoose })`.
- `background/BackgroundImages.tsx` — the "Your images" section moved from the old
  lines 394–453 plus the `BackgroundRow` component moved from 480–555, now
  `BackgroundImages({...})` with `BackgroundRow` below it. The hidden file input and
  its `fileRef` moved with the section (it was used nowhere else).

The dialog keeps its own state, `useQuery`, `useAction` (`runSave`/`runUpload`),
`deleteImage`, `choose`, `selectImage`, `changeDim`, `startUpload`, `startDelete`
and `close`; it now renders `<PresetGrid>` and `<BackgroundImages>` and builds the
write helpers with `createBackgroundWrites`.

### Files and `wc -l`

Old file: `apps/web/src/components/ChatBackgroundDialog.tsx` 555.

New/changed (all ≤ 400):

| File | Lines |
| --- | ---: |
| `apps/web/src/components/ChatBackgroundDialog.tsx` | 313 |
| `apps/web/src/components/background/backgroundOps.ts` | 57 |
| `apps/web/src/components/background/backgroundWrites.ts` | 97 |
| `apps/web/src/components/background/PresetGrid.tsx` | 41 |
| `apps/web/src/components/background/BackgroundImages.tsx` | 199 |

### Export list before / after

`grep -nE "^export"` on the old file (from `main`) listed only:

```
90: export function ChatBackgroundDialog({
```

After, the barrel `ChatBackgroundDialog.tsx` still exports `ChatBackgroundDialog`
(line 39), so no importer changes (`ChatHeader.tsx` and `GroupPanel.tsx` import
`./ChatBackgroundDialog` unchanged). The new files add only names that were private
in the old file, plus the two new factory types/props:

```
backgroundOps.ts:    type Scope; const DIM_SAVE_DELAY_MS; class SaveFailed;
                     class UploadFailed; class DeleteFailed; interface SaveRequest;
                     interface UploadRequest; const writeSave; function presetLabel;
                     function uploadErrorMessage
backgroundWrites.ts: interface BackgroundWriteDeps; interface BackgroundWrites;
                     function createBackgroundWrites
PresetGrid.tsx:      function PresetGrid
BackgroundImages.tsx: function BackgroundImages
```

### Effect ratchet

No `// effect-plain:` marker was added and none was needed. `backgroundOps.ts` and
`backgroundWrites.ts` import `effect` as a value, so the map classifies them
`effect`; `PresetGrid.tsx` and `BackgroundImages.tsx` have no hard/weak signals
(`BackgroundImages.tsx` imports `Effect` only as a type), so they classify `plain`.
The gate's `effect` step passed.

### Commands

- `pnpm install` → done, 1172 packages added, no errors.
- `pnpm --filter @zilar/web build` → `✓ built in 972ms` (only the pre-existing
  "chunks larger than 500 kB" warning).
- `pnpm gate` (repo root, base `main`) summary:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (6.5s)
  PASS  effect  (1.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- Single test files: none run — this is UI code, and there are no test files near
  the change (the gate reports `SKIP tests @zilar/web`).

### Deviations from the spec

None. The plan's line ranges were re-read and held. No dedup (the entry has none).
No file outside the Allowed set was touched.

### How to open the dialog (for the lead's Chrome check)

In mock mode, open any chat and use the chat-header overflow menu (⋯) → **Chat
background**; pick a preset (the grid of four) and it saves on click. For the group
variant, open a group you manage → the **Group background** section button opens the
same dialog with `groupId` (title "Group background", no This-chat/All-chats switch).

### Security checklist

No auth/keys/permissions/money/message-pipeline code: this is a size split of UI
only, all logic unchanged. No new routes, no deletes/updates, no logging, no secrets
introduced.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `ChatBackgroundDialog.tsx` (555 lines) is now 313 lines, plus `components/background/{backgroundOps,backgroundWrites,PresetGrid,BackgroundImages}`, the largest `BackgroundImages.tsx` at 199.
- **The lead checked it in Chrome at `?mock=1`, in Marta's chat:**
  - ⋮ › Chat background opens the dialog with the This chat / All chats switch, seven presets, "Your images" with Upload image, and "Use default";
  - picking the blue preset turns the chat background blue.
- **Check:** the gate passed, and so did the web build.
