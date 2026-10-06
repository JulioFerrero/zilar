---
id: T-0266
title: "Mobile: settings and AI sub-pages leave room for the gesture bar at the end of their scroll; the folder summary matches web"
status: merged
milestone: M5
branch: task/T-0266-mobile-subpage-inset-folder-summary
model: auto
effort: low
depends_on: [T-0251, T-0262]
estimate: 0.1 day
---

# T-0266: sub-page bottom inset and folder summary

## Spec (written by Claude, do not edit)

### Why
QA run 8 (2026-10-06, emulator):
- In the folder editor, the "Delete folder" confirm opened mostly under the Android gesture bar; you had to scroll to see it (screenshots `~/.claude/jobs/fcd95e40/tmp/qa8/24.png` and `25.png`).
- The folder list summary differs from web's: web shows types plus the chat count, or "No rules yet".

### Verified facts (do not re-derive)
- `apps/mobile/src/components/nav/floating-tab-bar.tsx` lines 27-29: `tabScreenBottomPadding(hasBack, insetBottom)` returns `32` for a page with a back key, ignoring the inset, and `TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insetBottom + 16` for a tab screen. Both shells use it (`apps/mobile/src/components/settings/screen-shell.tsx` and `apps/mobile/src/components/ais/screen-shell.tsx`), and their `SafeAreaView` uses `edges={['top']}`, so nothing else adds the bottom inset.
- Tests: `apps/mobile/src/components/nav/floating-tab-bar.test.tsx` and `apps/mobile/src/components/settings/screen-shell.test.tsx` (T-0251).
- Mobile summary: `folderSummary` in `apps/mobile/src/components/settings/folders.ts` lines 33-37 returns the type labels or "No chat types"; tested in `apps/mobile/src/components/settings/folders.test.ts` line 26.
- Web summary: `summary` in `apps/web/src/routes/FoldersPage.tsx` lines 214-228 returns the types, then ", N chats" (or "1 chat") when `includeChats` is not empty; just the chat count when there are no types; and "No rules yet" when both are empty.

### What to build
1. `tabScreenBottomPadding(true, insetBottom)` returns `32 + insetBottom`; the tab-screen case is unchanged. Update both tests (cover a non-zero inset with a back key).
2. `folderSummary` mirrors the web `summary` exactly, with the same strings. Update `folders.test.ts` to cover all four cases.

### Read first
`AGENTS.md`, `apps/mobile/src/components/nav/floating-tab-bar.tsx` (lines 15-30), `apps/web/src/routes/FoldersPage.tsx` (lines 205-230).

### Allowed files
`apps/mobile/src/components/nav/floating-tab-bar.tsx`, `apps/mobile/src/components/nav/floating-tab-bar.test.tsx`, `apps/mobile/src/components/settings/screen-shell.test.tsx`, `apps/mobile/src/components/settings/folders.ts`, `apps/mobile/src/components/settings/folders.test.ts`, `work/T-0266-mobile-subpage-inset-folder-summary.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot floating-tab-bar screen-shell components/settings/folders
pnpm gate
```

### Acceptance
- The last content of every settings and AI sub-page scrolls fully above the gesture bar. The folder summary matches web.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

---

## Report (written by the worker when done)

### What I did
- `tabScreenBottomPadding(hasBack, insetBottom)` now returns `32 + insetBottom` for a page with a back key. The tab-screen branch (`TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insetBottom + 16`) is unchanged. Updated the doc comment accordingly.
- `folderSummary` now mirrors the web `summary` in `apps/web/src/routes/FoldersPage.tsx` exactly: type labels from `FOLDER_TYPE_LABELS`, then the chat count (`1 chat` / `N chats`) when `includeChats` is non-empty; just the count when there are no types; and `No rules yet` when both are empty. The old `No chat types` string is gone.
- Tests:
  - `floating-tab-bar.test.tsx`: the back-key case now asserts `tabScreenBottomPadding(true, 0) === 32` and `tabScreenBottomPadding(true, 34) === 66` (non-zero inset).
  - `screen-shell.test.tsx`: made the safe-area mock's insets mutable via `vi.hoisted`, added a `beforeEach` reset, and the back-key case now sets `bottom = 34` and expects `tabScreenBottomPadding(true, 34)` through both shells.
  - `folders.test.ts`: covers all four web cases — types only, count only (1 and N), types plus count (1 and N), and neither (`No rules yet`).

### Files changed
All six are inside the Allowed files (five code/test files plus this task file):
- `apps/mobile/src/components/nav/floating-tab-bar.tsx`
- `apps/mobile/src/components/nav/floating-tab-bar.test.tsx`
- `apps/mobile/src/components/settings/screen-shell.test.tsx`
- `apps/mobile/src/components/settings/folders.ts`
- `apps/mobile/src/components/settings/folders.test.ts`
- `work/T-0266-mobile-subpage-inset-folder-summary.md`

### Commands and results
- `pnpm install`: completed, 0 errors (3 pre-existing deprecated-subdep warnings).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot floating-tab-bar screen-shell components/settings/folders`: `Test Files 3 passed (3)`, `Tests 23 passed (23)`.
- `pnpm gate` (repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.7s)
  PASS  format  (43.0s)
  PASS  lint  (2.0s)
  PASS  typecheck  (17.0s)
  PASS  tests @zilar/mobile  (7.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- None. Spec items 1 and 2 done as written. No files outside scope; `pnpm-lock.yaml` untouched.
- I did not run the app on a simulator, so the "scrolls fully above the gesture bar" acceptance is verified through the padding value (`32 + inset`) and the shell tests, not visually on device.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (1 test nit, accepted).
- Sub-pages pad `32 + insetBottom`.
- `folderSummary` matches the web `summary` line for line.
