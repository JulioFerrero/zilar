---
id: T-2091
title: "Delete dead web component code: ui/select.tsx and its fixture, the unused AddMemberButton/AddAiButton and PickerToggle, the menu radio items, and GifPanel's unused availability probe exports — nothing imports them"
status: merged
milestone: M5
branch: task/T-2091-web-dead-components
model: deepseek/deepseek-flash
effort: default
estimate: 25 min
---

# T-2091: Dead web component code

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count must really go down. These exports have no importer outside their own file. The lead checked each with `git grep -lw <name> -- apps/web/src packages`.

### Facts (read by the lead on 2026-10-18 at `77c826ad8`)
- **`apps/web/src/components/ui/select.tsx`** (116 lines). No app file imports it; only `apps/web/src/components/ui/select.fixture.tsx` (50 lines) does.
- **`apps/web/src/components/panels/TopicActionButtons.tsx`** (135 lines). `AddMemberButton` (`:51`) and `AddAiButton` (`:105`) are used nowhere else.
- **`apps/web/src/components/panels/TopicListNotices.tsx`** (55 lines). `PickerToggle` is used nowhere else.
- **`apps/web/src/components/ui/menu.tsx`** (168 lines). `MenuRadioGroup` and `MenuRadioItem` are used only by `apps/web/src/components/ui/menu.fixture.tsx` (53 lines).
- **`apps/web/src/components/GifPanel.tsx`** (342 lines). `resetGifsAvailability` (`:49`) and `probeGifsAvailability` (`:75`) are used nowhere else. Check `probeGifsAvailabilityEffect` (`:68`) the same way before touching it.

### Steps
1. Delete `select.tsx` and `select.fixture.tsx`.
2. Delete `AddMemberButton`, `AddAiButton`, `PickerToggle`, `MenuRadioGroup` and `MenuRadioItem`, and the radio section of `menu.fixture.tsx`.
3. Delete each `GifPanel.tsx` export above that `git grep -lw` shows is unused outside the file. Keep anything the file itself still calls.
4. Remove the imports and helpers that become unused. If a whole file becomes empty, delete it.
5. **Before deleting anything,** re-run `git grep -lw <name> -- apps packages`. If anything outside the file uses a name, keep it and say so in the Report.
6. No tests. Report the line counts.

### Allowed files
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/select.fixture.tsx`
- `apps/web/src/components/panels/TopicActionButtons.tsx`
- `apps/web/src/components/panels/TopicListNotices.tsx`
- `apps/web/src/components/ui/menu.tsx`
- `apps/web/src/components/ui/menu.fixture.tsx`
- `apps/web/src/components/GifPanel.tsx`
- `work/T-2091-web-dead-components.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 200.

---

## Report (written by the worker when done)

### What I did

Re-ran `git grep -lw <name> -- apps packages` for every name before deleting anything.

- Deleted `apps/web/src/components/ui/select.tsx` (116 lines) and `select.fixture.tsx` (50 lines); no file imports either, and no fixture registry references the fixture.
- `apps/web/src/components/panels/TopicActionButtons.tsx` (135 → 64): deleted `AddMemberButton` and `AddAiButton`, plus the imports and `GroupMemberRow` alias that became unused (`Button`, `EntityAvatar`, `AiBadge`, `GroupDetail`, `PublicAi`). `useRemoveMember` and `useRemoveAi` stay.
- `apps/web/src/components/panels/TopicListNotices.tsx` (55 → 24): deleted `PickerToggle`; `Button` and `FieldError` are still used by `LoadFailed` and `RefreshFailed`.
- `apps/web/src/components/ui/menu.tsx` (168 → 124): deleted `MenuRadioGroup`, `MenuRadioItem` and their props interfaces.
- `apps/web/src/components/ui/menu.fixture.tsx` (53 → 30): removed the radio section (`OpenRadioMenu`, `RadioGroup` entry and the radio imports).
- `apps/web/src/components/GifPanel.tsx` (342 → 334): deleted `resetGifsAvailability` and `probeGifsAvailability`. Kept `probeGifsAvailabilityEffect` because `apps/web/src/components/StickerPanel.tsx:113` imports and calls it, and kept `gifsAvailability` (also imported by `StickerPanel`). The matching names in `apps/mobile/src/**` are that package's own module, not imports of these web files.

Product lines: 919 → 576 across these files, net −343 (344 deleted, 1 added import line), so the ≥ 200 requirement is met.

### Checks run

- `pnpm install`: Done in 25.9s.
- `git grep -lw AddMemberButton|AddAiButton|PickerToggle|MenuRadioGroup|MenuRadioItem|resetGifsAvailability`: only the defining files (and `menu.fixture.tsx` for the radio pair) match.
- `git grep -lw probeGifsAvailability`: only `apps/web/src/components/GifPanel.tsx` (the mobile hits are separate files).
- `git grep -lw probeGifsAvailabilityEffect`: `apps/web/src/components/GifPanel.tsx` and `apps/web/src/components/StickerPanel.tsx` (kept).
- Gate: I could not get the plain `pnpm gate` to pass for an environment reason explained below. The same gate CLI against the branch point passes:

```
gate: 8 changed file(s) against origin/main
PASS  install (frozen)  (1.6s)
PASS  format  (1.5s)
PASS  lint  (1.4s)
PASS  typecheck  (5.5s)
PASS  effect  (1.0s)
SKIP build @zilar/server (no server, package or manifest change)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

No single test file was run: the gate reports no nearby test files for `@zilar/web`, and UI code gets no tests per AGENTS.md.

### Notes for the lead

- **Gate base drift (needs your call, but the work itself is green).** `package.json`'s `gate` script hardcodes `--base main` (an extra `--base` on the pnpm command is appended, so the first one wins). This worktree's branch point is `origin/main` = `77c826ad8`, but the local `main` ref is one commit ahead: `219409cd1 T-2077: comments: phone components outside chat and AIs (-1,204)`. Plain `pnpm gate` therefore diffs those 165 unrelated T-2077 files and fails only the comment check ("added comment line(s) cite a task ID") in files I did not touch. `git rebase main` and `git merge main` are blocked in this session, so I ran the identical gate CLI with the real branch point: `pnpm --filter @zilar/devtools exec tsx src/gate/cli.ts --base origin/main` → `GATE PASS`, 8 changed files, all inside Allowed files above. When you merge or re-base onto current `main`, plain `pnpm gate` should be green; if you need the literal command recorded, the only blocker is that ref.
- No spec deviations; nothing was kept that the spec asked to delete, except `probeGifsAvailabilityEffect`, which step 3 explicitly said to check and keep if used (it is).
- Commit on `task/T-2091-web-dead-components`, not pushed.

## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** Deletions only (−343):
  - `ui/select.tsx` and its fixture;
  - `AddMemberButton`, `AddAiButton` and `PickerToggle`;
  - the menu radio items;
  - GifPanel's unused `resetGifsAvailability` and `probeGifsAvailability`. `probeGifsAvailabilityEffect` is still used, so it stays.
- **The worker's gate note was correct.** The new task-ID comment check (`cli.ts:150`) diffs against the tip of `base`, not the merge base, so it flags comments that other merged tasks removed. The fix is T-2095. The merge gate rebases first, so this merge is not affected.
