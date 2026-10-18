---
id: T-1960
title: "Phone UI consistency M4: Devices, Folders, Folder editor, Integrations, Sticker pack editor and New group use the shared ScreenHeader"
status: merged
milestone: M5
branch: task/T-1960-phone-settings-headers
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1948]
estimate: 40 min
---

# T-1960: Phone settings headers (M4)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". This is batch **M4** of `docs/audit/ui-consistency.md` §5. The target is §1.2.

These screens draw their own header with a 20 px title, for example `apps/mobile/src/app/settings/devices.tsx:213` and `apps/mobile/src/app/group/new.tsx:129`.

### Facts (read by the lead on 2026-10-18)
- T-1948 (M1) adds `apps/mobile/src/components/ui/screen-header.tsx`, where `ScreenHeader variant="sub"` is a 56 dp back row, then the 28/600 title, then an optional 14 px subtitle, with `right`. **Read the merged file** for the API.
- **The six screens:** `apps/mobile/src/app/settings/devices.tsx` (369 lines), `apps/mobile/src/app/settings/folders.tsx`, `apps/mobile/src/app/settings/folder/[id].tsx`, `apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/app/settings/sticker-pack.tsx` and `apps/mobile/src/app/group/new.tsx`.

### Steps
1. **In each file,** replace the hand-made header with `ScreenHeader variant="sub"`, using the same title, subtitle, back handler and right action (for example Save or Create).
2. **Remove the now-unused imports.** Change nothing else.
3. **No tests** (UI). Every file stays at 400 lines or fewer.

### Allowed files
- `apps/mobile/src/app/settings/devices.tsx`
- `apps/mobile/src/app/settings/folders.tsx`
- `apps/mobile/src/app/settings/folder/[id].tsx`
- `apps/mobile/src/app/settings/integrations.tsx`
- `apps/mobile/src/app/settings/sticker-pack.tsx`
- `apps/mobile/src/app/group/new.tsx`
- `work/T-1960-phone-settings-headers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On phone smoke screenshots of `/settings/devices`, `/settings/folders`, `/settings/folder/new`, `/settings/integrations`, `/settings/sticker-pack` and `/group/new`, the headers match M3: a 56 dp back row and a 28/600 title.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/app/settings/devices.tsx`: replaced the hand-made 20 px header row (back button, title, subtitle) with `ScreenHeader variant="sub"`, same title, subtitle, back handler; removed the now-unused `ChevronLeft` and `IconButton` imports and added the `ScreenHeader` import.
- `apps/mobile/src/app/group/new.tsx`: replaced the hand-made 20 px header row with `ScreenHeader variant="sub"`, keeping the step-dependent subtitle, `goBack` and the Next/Create button as `right`; removed the now-unused `ChevronLeft`, `View`, `IconButton` and `ICON` imports and added the `ScreenHeader` import.
- The other four screens already rendered through `SettingsScreenShell`, which delegates to `ScreenHeader` (sub when `onBack` is set): `folders.tsx`, `folder/[id].tsx`, `integrations.tsx`, `sticker-pack.tsx`. They needed no change, so I left them untouched.
- No other files changed, no tests added (UI task), every changed file is under 400 lines.

### Checks run

- `pnpm install`: succeeded (silent, no output).
- `pnpm gate` from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.3s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (5.1s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: the change is UI only and the gate reported no nearby test files.

### Notes for the lead

- The task described six screens with a hand-made header, but four of them (`folders`, `folder/[id]`, `integrations`, `sticker-pack`) already use `SettingsScreenShell` → `ScreenHeader` on this branch, so only `devices` and `group/new` still drew their own. I changed just those two.
- `sticker-pack.tsx` still passes the unused `largeTitle` prop to `SettingsScreenShell`; outside this task's scope, left as is.
- Not visually verified on a device; phone smoke screenshots are the lead's step.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean, with 1 follow-up. The lead checked the phone smoke (mock build of `eefe6156c`): `/settings/devices`, `/settings/folders`, `/settings/integrations` and `/group/new` all show the 56 dp back row, then the 28/600 title and the 14 px subtitle. New group keeps Next in the row.
- Only `devices.tsx` and `group/new.tsx` had their own headers; the other four already used the shell from T-1948.
- **Follow-up:** remove the dead `largeTitle` prop from `SettingsScreenShell` and its two callers. It goes into the next phone cleanup batch.
