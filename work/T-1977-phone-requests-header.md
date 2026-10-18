---
id: T-1977
title: "Phone consistency leftovers: Contact requests uses the shared ScreenHeader; Approvals' 'Always allowed' becomes SectionLabel"
status: merged
milestone: M5
branch: task/T-1977-phone-requests-header
model: deepseek/deepseek-flash
effort: default
estimate: 15 min
---

# T-1977: Phone consistency leftovers

## Spec (written by Claude, do not edit)

### Why
Julio asked on 2026-10-18 that "all the ui follows the same style and flow". The lead's phone sweep of main found the two last screens that don't match:
- **Contact requests** still draws back and a 20 px title on one row. Every other sub-screen now has the 56 dp back row with the 28/600 title under it.
- **Approvals** draws "Always allowed" as a 16/600 sentence-case heading. The other section labels use the 12/500 uppercase kit label.

### Facts (read by the lead on 2026-10-18)
- **The requests header.** `apps/mobile/src/app/settings/requests.tsx:122-137` is a hand-made header:
  - a `View` row holding `IconButton label="Back"` with `ChevronLeft` (`:123-125`);
  - a 20/600 "Contact requests" title (`:127-129`);
  - a 14 px subtitle (`:130-136`) that reads `'No pending requests.'`, `` `${pending} pending` `` or `'People who want to add you.'`, depending on `status` and `pending`.
- **The shared header.** `apps/mobile/src/components/ui/screen-header.tsx` exports `ScreenHeader({ variant, title, subtitle?, onBack?, right?, bare? })`.
- **The approvals label.** `apps/mobile/src/components/approvals/rules-section.tsx:29` is `<Text className="text-[16px] font-semibold">Always allowed</Text>`.
- **The kit label.** `SectionLabel` lives in `apps/mobile/src/components/ui/card.tsx`.

### Steps
1. **Requests header.** In `requests.tsx`, replace the hand-made header with `<ScreenHeader variant="sub" title="Contact requests" subtitle={…same expression…} onBack={() => router.back()} />`, then remove the imports nothing uses any more.
2. **Approvals label.** In `rules-section.tsx`, use `<SectionLabel>Always allowed</SectionLabel>`.
3. **Change nothing else.** Add no tests (this is UI), and keep every file at or under 400 lines.

### Allowed files
- `apps/mobile/src/app/settings/requests.tsx`
- `apps/mobile/src/components/approvals/rules-section.tsx`
- `work/T-1977-phone-requests-header.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`/settings/requests`:** the phone smoke shows the shared back row, then the 28/600 "Contact requests" title, then the "2 pending" subtitle.
- **`/settings/approvals`:** the phone smoke shows ALWAYS ALLOWED in the kit label style.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/app/settings/requests.tsx`: replaced the hand-made back row + 20/600 title + subtitle with `<ScreenHeader variant="sub" title="Contact requests" subtitle={…} onBack={() => router.back()} />`. The subtitle expression is unchanged (`'No pending requests.'` / `` `${pending} pending` `` / `'People who want to add you.'`). Removed the now-unused `ChevronLeft`, `IconButton` imports. `ICON`, `View` and `Text` are still used elsewhere in the file and stay.
- `apps/mobile/src/components/approvals/rules-section.tsx`: replaced the 16/600 `<Text>Always allowed</Text>` with `<SectionLabel>Always allowed</SectionLabel>` (the 12/500 uppercase kit label from `components/ui/card.tsx`) and added that import. `Text` is still used elsewhere in the file and stays.
- No other changes. No tests added (UI-only change).

### Checks run

- `pnpm gate` from the repo root:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (2.2s)`
  - `PASS  format  (1.2s)`
  - `PASS  lint  (1.3s)`
  - `PASS  typecheck  (4.7s)`
  - `PASS  effect  (1.1s)`
  - `PASS  tests @zilar/mobile  (1.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test files were run: the change is UI-only, so the gate's mobile run is the only test execution.

### Notes for the lead

- I did not run the phone smoke; the acceptance screenshots are for the lead/Julio.
- `SectionLabel` carries `px-1`, so "Always allowed" is inset by 4 px relative to the old bare `Text`. That matches the other section labels (e.g. the AI name rows below it keep their own layout).
- Files changed: `apps/mobile/src/app/settings/requests.tsx`, `apps/mobile/src/components/approvals/rules-section.tsx`, `work/T-1977-phone-requests-header.md` (status and this Report).

## Review (written by Claude)

**Approved and merged.** The pre-review was clean. The lead checked the phone smoke (mock build of `f62c350fd`):
- **`/settings/requests`:** the shared back row, the 28/600 "Contact requests" title and "2 pending" under it.
- **`/settings/approvals`:** ALWAYS ALLOWED in the kit label style.

The lead's phone sweep of 24 routes on main found no other hand-made headers.
