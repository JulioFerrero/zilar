---
id: T-1949
title: "Web UI consistency W1: one ScreenHeader kit component used by SettingsShell (64 px row, 36 px back key, 17/600 title), and SectionLabel at the D24 11/500 0.06em"
status: merged
milestone: M5
branch: task/T-1949-web-screen-header
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1947]
estimate: 30 min
---

# T-1949: Web ScreenHeader (W1)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". This is batch **W1** of `docs/audit/ui-consistency.md` §5 (T-1947): the targets are in §1.2 and §1.3, and the web API in §4.1. T-1948 is the phone twin.

### Facts (read by the lead on 2026-10-18)
- **`apps/web/src/components/SettingsShell.tsx`** (59 lines):
  - a `<header className="shrink-0 border-b border-divider px-4 py-3">` (`:29`);
  - a ghost round back `Button` with `ArrowLeft size-5` (`:31-41`);
  - `<h1 className="text-[20px] leading-7 font-semibold">` (`:42`);
  - `action` on the right (`:43`) and `subtitle` at 14 px (`:45-47`).
  - Every web settings page uses it.
- **`apps/web/src/components/ui/card.tsx:22-30`:** `SectionLabel` is `text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase`. D24 asks for 11/500 (audit §1.3).
- **The kit** (`apps/web/src/components/ui/`) has `icon-button.tsx` and `button.tsx`, and no `screen-header.tsx`.

### Steps
1. **New `apps/web/src/components/ui/screen-header.tsx`**, with the props from audit §4.1: `variant: 'root' | 'sub'`, `title`, `subtitle?`, `onBack?`, `right?`, `bare?`.
   - **`sub`:** a 64 px row with a bottom border (`border-b border-divider`) and `px-4`.
     - The back key is the kit `IconButton` at 36 px with radius 10 (lucide `ArrowLeft` at 18), with `aria-label="Back"`.
     - The `<h1>` title is 17/600 with tracking `-0.02em`, and the optional subtitle 14/400 `text-muted-foreground` sits under the title in the same block.
     - `right` goes at the row's end.
   - **`root`:** a 28/600 `<h1>` with tracking `-0.02em` and `px-4 pt-2` (for the narrow list; no caller in this batch).
   - **`bare`:** only the row, no title.
2. **`SettingsShell.tsx`:** render `<ScreenHeader variant="sub" title subtitle onBack right={action} />` in place of its own `<header>` block (`:29-48`). The body and `SETTINGS_COLUMN` stay the same.
3. **`card.tsx` `SectionLabel`:** `font-medium` in place of `font-semibold` (11/500, 0.06em, uppercase, muted). Update its doc comment.
4. **No other files.** The pages adopt the header through `SettingsShell` automatically. W2–W6 handle the panels.
5. **No tests** (UI). Every file stays at 400 lines or fewer.

### Allowed files
- `apps/web/src/components/ui/screen-header.tsx`
- `apps/web/src/components/SettingsShell.tsx`
- `apps/web/src/components/ui/card.tsx`
- `work/T-1949-web-screen-header.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The lead checks web mock screenshots at 1440 px and 390 px of `/settings/notifications`, `/settings/stickers` and `/settings/devices`:
- each has a 64 px header with a 36 px back key and a 17/600 title, plus the subtitle where the page has one;
- section labels are 11/500.

The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/web/src/components/ui/screen-header.tsx` with the audit §4.1 web API
  (`variant: 'root' | 'sub'`, `title`, `subtitle?`, `onBack?`, `right?`, `bare?`):
  - `sub` renders a `<header>` with a bottom border (`border-b border-divider`, `px-4`)
    and a 64 px row (`h-16`): back is the kit `IconButton` (36 px, radius 10) with lucide
    `ArrowLeft` at 18 and `aria-label="Back"`; the title is 17/600 with tracking
    `-0.02em`; the optional 14/400 muted subtitle sits directly under it; `right` is at
    the row's end with `ml-auto`.
  - `bare` draws the row (back and right) without the title or subtitle.
  - `root` renders a 28/600 `<h1>` with `leading-9`, tracking `-0.02em` and `px-4 pt-2`.
- `SettingsShell.tsx` now renders `<ScreenHeader variant="sub" title subtitle onBack
  right={action} />` in place of its own header block; the body and `SETTINGS_COLUMN`
  are unchanged.
- `card.tsx` `SectionLabel`: `font-semibold` → `font-medium` (11/500), doc comment
  updated.
- No other files. No tests (UI only), matching the spec.

Files changed:
- `apps/web/src/components/ui/screen-header.tsx` (new)
- `apps/web/src/components/SettingsShell.tsx`
- `apps/web/src/components/ui/card.tsx`
- `work/T-1949-web-screen-header.md`

### Checks run

- `pnpm install`: done (warned about the existing mobile `@types/react-dom` peer mismatch
  only).
- `pnpm gate`: GATE PASS. Summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.7s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Single test files: none run; the gate reports no nearby test files for this UI-only
  change.
- Two gate rounds failed before the pass: round 1 failed format on the new file (fixed
  with `prettier --write` on that file only); round 2 failed typecheck because
  `exactOptionalPropertyTypes` rejected passing `string | undefined` to `subtitle?: string`
  (fixed by typing the optional props `| undefined`, the pattern used elsewhere in
  `apps/web/src/components`). The gate was run once more after the Report was filled in
  and passed with the summary above.

### Notes for the lead

- Screenshots were not taken (this worker cannot run the app); the classes to check are
  `h-16` (64 px row), `IconButton` defaults 36/10, `text-[17px] font-semibold
  tracking-[-0.02em]` title, `text-[14px] text-muted-foreground` subtitle, and
  `text-[11px] font-medium tracking-[0.06em] uppercase` for `SectionLabel`.
- Sections: `root` has no caller in this batch, as the spec says; `bare` has no caller
  yet either.
- The subtitle truncates to one line (`truncate`) so the row stays at 64 px. At 390 px
  the longer ones (Devices, Contacts, Folders) are cut with an ellipsis; the old header
  wrapped them and grew taller. If you want the full text at 390 px, the 64 px row has to
  grow instead — say so in review.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean, with 0 findings. The lead checked web mock screenshots of `685fbc461`:
- **`/settings/notifications` at 1440 px:** a 64 px header with a bottom border, a 36 px back key, a 17/600 title and a 14 px subtitle. The section labels (THIS DEVICE, DEVICES, MESSAGE PREVIEWS, TEST, MUTED CHATS) are 11/500 uppercase.
- **`/settings/devices` at 390 px:** the same header. The long subtitle ends in an ellipsis on one line, and that's kept: a one-line subtitle matches Telegram's nav bar, and the full text is the page's own description.
