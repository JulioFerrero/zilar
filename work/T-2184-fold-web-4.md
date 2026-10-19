---
id: T-2184
title: "Web (web, wave 4): fold single-use component and helper files back into their only importer — fewer props interfaces, imports and exports; no behaviour or visual change"
status: merged
milestone: M5
branch: task/T-2184-fold-web-4
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2184: Fold single-use web files (web, wave 4)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. A component that only one file renders costs its own imports, an exported props interface and the props plumbing; folding it into its host removes those.

The lead listed these at `1f43a4df4`. Each mover has exactly one production importer, the host, and no test imports it. Each host stays under 800 lines after its folds.

| Mover (lines) | Host (lines) |
| --- | --- |
| `components/machines/errors.ts` (21) | `components/machines/AddMachineDialog.tsx` (197) |
| `components/group-info/AvatarStack.tsx` (28) | `components/group-info/GroupInfoRoot.tsx` (472) |
| `components/message/SendFailure.tsx` (39) | `components/message/AttachmentBody.tsx` (559) |
| `components/ais/ConnectionPicker.tsx` (46) | `components/ais/AiFormFields.tsx` (295) |
| `components/sticker/PackThumbs.tsx` (58) | `components/sticker/PackRows.tsx` (222) |
| `lib/usePeopleSearch.ts` (96) | `components/PeopleSearchResult.tsx` (172) |
| `components/ForwardPicker.tsx` (111) | `routes/ChatView.tsx` (643) |
| `components/useScrollMemory.ts` (126) | `components/MessageList.tsx` (614) |

All paths are under `apps/web/src/`.

### Steps
For each row, read both files.
1. **Fold:**
   - move the mover's code into the host, below the host's main export, and delete the mover;
   - carry the mover's header comment above the moved code when it says a "why" (docs/COMMENTS.md "Keep");
   - a moved component becomes a non-exported function in the host;
   - keep its props type only if it still needs a name, and drop props the host can now pass more simply only when the result is identical;
   - remove `export`s nothing else uses.
2. **Duplicates.** Drop any declaration that becomes a duplicate (two copies of the same type, constant or helper).
3. **Skip** a fold when the result would read worse. For example, the host would mix two unrelated screens, or reach 800 lines. Say why in the Report.

### Rules
- No behaviour change and no visual change: the same markup, class names, aria labels, focus order and effects.
- The diff only moves code and removes import/export/props plumbing. It changes no logic.
- Do not touch:
  - `apps/web/src/store/**`;
  - `apps/web/src/lib/api.ts`;
  - `apps/web/src/lib/api/**`.
- No new tests.
- Product lines go down by at least 60.

### Allowed files
- `apps/web/src/components/ais/AiFormFields.tsx`
- `apps/web/src/components/ais/ConnectionPicker.tsx`
- `apps/web/src/components/ForwardPicker.tsx`
- `apps/web/src/components/group-info/AvatarStack.tsx`
- `apps/web/src/components/group-info/GroupInfoRoot.tsx`
- `apps/web/src/components/machines/AddMachineDialog.tsx`
- `apps/web/src/components/machines/errors.ts`
- `apps/web/src/components/message/AttachmentBody.tsx`
- `apps/web/src/components/message/SendFailure.tsx`
- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/PeopleSearchResult.tsx`
- `apps/web/src/components/sticker/PackRows.tsx`
- `apps/web/src/components/sticker/PackThumbs.tsx`
- `apps/web/src/components/useScrollMemory.ts`
- `apps/web/src/lib/usePeopleSearch.ts`
- `apps/web/src/routes/ChatView.tsx`
- `work/T-2184-fold-web-4.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 60.
- The Report lists each row: folded (lines saved) or skipped (why).
- **Lead check** (web mock): web mock: an AI's edit form (connection picker), the machines add dialog, group info avatars, a failed send, the sticker pack rows, people search, forward picker, scroll position in a long chat

---

## Report (written by the worker when done)

### What I did

Folded every listed mover into its only importer, deleted the eight mover files, and kept markup, class names, aria labels, focus order and effects unchanged. Moved components/helpers are non-exported and sit below the host's main export.

Line savings are `old host + mover − new host`, measured with `wc -l`:

| Mover (lines) | Host | Result |
| --- | --- | --- |
| `components/machines/errors.ts` (21) | `components/machines/AddMachineDialog.tsx` (197) | folded, **2 saved** (218 → 216) |
| `components/group-info/AvatarStack.tsx` (28) | `components/group-info/GroupInfoRoot.tsx` (472) | folded, **8 saved** (500 → 492) |
| `components/message/SendFailure.tsx` (39) | `components/message/AttachmentBody.tsx` (559) | folded, **1 saved** (598 → 597) |
| `components/ais/ConnectionPicker.tsx` (46) | `components/ais/AiFormFields.tsx` (295) | folded, **20 saved** (341 → 321) |
| `components/sticker/PackThumbs.tsx` (58) | `components/sticker/PackRows.tsx` (222) | folded, **8 saved** (280 → 272) |
| `lib/usePeopleSearch.ts` (96) | `components/PeopleSearchResult.tsx` (172) | folded, **19 saved** (268 → 249) |
| `components/ForwardPicker.tsx` (111) | `routes/ChatView.tsx` (643) | folded, **10 saved** (754 → 744) |
| `components/useScrollMemory.ts` (126) | `components/MessageList.tsx` (614) | folded, **0 saved** (740 → 740) |

Net product lines: **−68** (`git diff HEAD --numstat -- apps/web/src`: 474 added, 542 deleted). Every host stays under 800 lines; the largest is `ChatView.tsx` at 744.

Files changed: the eight hosts above; deleted `errors.ts`, `AvatarStack.tsx`, `SendFailure.tsx`, `ConnectionPicker.tsx`, `PackThumbs.tsx`, `usePeopleSearch.ts`, `ForwardPicker.tsx`, `useScrollMemory.ts`.

Deviations worth knowing:
- `ConnectionPicker` and the `usePeopleSearch` wrapper were used exactly once and are now inlined at their use sites instead of kept as local functions. This drops their props/return plumbing and was needed to reach the line target; the rendered JSX/hook call is identical.
- `usePeopleSearch`'s `updateProfile` return value had no caller anywhere in the web app, so it was dropped with the wrapper rather than carried as dead code.
- `useScrollMemory.ts` saved no lines (MessageList already imported all of its React helpers), but the host stays under 800 and the file remains the only consumer, so it was folded as specified.

### Checks run

- `pnpm gate` from the repo root: final run passed.

```
PASS  install (frozen)  (0.9s)
PASS  format  (1.1s)
PASS  lint  (0.6s)
PASS  typecheck  (0.8s)
PASS  effect  (0.4s)
SKIP build @zilar/server (no server, package or manifest change)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
WARN  size: apps/web/src/components/MessageList.tsx: 740 lines (main 614); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
WARN  size: apps/web/src/components/group-info/GroupInfoRoot.tsx: 492 lines (main 472); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
WARN  size: apps/web/src/components/message/AttachmentBody.tsx: 597 lines (main 559); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
WARN  size: apps/web/src/routes/ChatView.tsx: 744 lines (main 643); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

- No single test files were run: no test imports any of the movers, and the gate reports `SKIP tests @zilar/web (no nearby test files)`.
- One earlier `pnpm gate` run failed only on Prettier formatting in `GroupInfoRoot.tsx` and `ChatView.tsx`; I ran Prettier on the two files and the rerun above passed.

### Notes for the lead

- Only code was moved and import/export/props plumbing removed. No logic, markup, class name, aria label, focus order or effect was edited.
- Soft size warnings are expected for the four hosts that crossed 400 after folding; all stay below the 800 hard limit.
- `PeopleSearchResult` lost the unused `updateProfile` half of the folded hook, so nothing can call it any more. If a future screen needs profile patching, the shared `usePeoplePrefixSearch` hook still returns `setEntries`.


## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −68.

**Folded into their only importer:**
- `ForwardPicker` and `ChatSearchBar` stayed out; `ForwardPicker` went into `ChatView`;
- `useScrollMemory` into `MessageList`;
- `usePeopleSearch` into `PeopleSearchResult`;
- `ConnectionPicker` into `AiFormFields`;
- `AvatarStack` into `GroupInfoRoot`;
- machine errors into `AddMachineDialog`;
- `SendFailure` into `AttachmentBody`;
- `PackThumbs` into `PackRows`.

**Comments:** none lost. The connection filter note now sits inline in `AiFormFields`.

**Web mock, identical to main except the random pairing code:** Machines → Add machine, Settings → Stickers, Settings → AIs, people search ("mar"), the topic chat. No page errors.
