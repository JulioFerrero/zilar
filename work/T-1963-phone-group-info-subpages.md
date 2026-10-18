---
id: T-1963
title: "Phone UI consistency M6: group info sub-pages (People, Tools, Settings, Activity, Always allowed) use the shared ScreenHeader; People label becomes SectionLabel"
status: merged
milestone: M5
branch: task/T-1963-phone-group-info-subpages
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1948]
estimate: 30 min
---

# T-1963: Phone group info sub-pages (M6)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". This is batch M6 of `docs/audit/ui-consistency.md` §5, against the target in §1.2.

Every other pushed screen now has the shared header: a 56 dp back row, then the 28/600 title under it (T-1948, T-1959, T-1960). The group info sub-pages still draw back and title on one row.

### Facts (read by the lead on 2026-10-18)
- **The shared header.** `apps/mobile/src/components/ui/screen-header.tsx` exports `ScreenHeader({ variant: 'root' | 'sub', title, subtitle?, onBack?, right?, bare? })`.
- **The five pages** each draw their own row: `<View className="h-14 flex-row items-center gap-2 px-3">`, an `IconButton label="Back"` with `ChevronLeft`, and then a `text-[28px]` title on the same row.

  | File | Back key | Title |
  |---|---|---|
  | `apps/mobile/src/components/group-info/members-page.tsx` | `:150` | `:153` |
  | `apps/mobile/src/components/group-info/tools-page.tsx` | `:110` | `:113` |
  | `apps/mobile/src/components/group-info/settings-page.tsx` | `:82` | `:85` |
  | `apps/mobile/src/components/group-info/activity-page.tsx` | `:21` | `:24` |
  | `apps/mobile/src/components/group-info/allowed-page.tsx` | `:154` | `:157` |

  None of these rows has a right key.
- **The hand-made label.** `members-page.tsx:165` has `<Text className="text-[13px] font-semibold text-muted-foreground">People</Text>`. The kit label is `SectionLabel` in `apps/mobile/src/components/ui/card.tsx`, styled 12/500 uppercase.

### Steps
1. **Swap the header.** In each of the five files, replace the hand-made `h-14` row (back key plus title) with `<ScreenHeader variant="sub" title="…" onBack={onBack} />`. Use the same title text.
   - Keep the page's `SafeAreaView` and body.
   - Remove the imports that are no longer used.
2. **Swap the label.** In `members-page.tsx:165`, use `<SectionLabel>People</SectionLabel>`. If that row also shows a count or a key on its right, keep that next to the label in a flex row.
3. **Change nothing else.** No tests, since this is UI. Every file stays at or under 400 lines.

### Allowed files
- `apps/mobile/src/components/group-info/members-page.tsx`
- `apps/mobile/src/components/group-info/tools-page.tsx`
- `apps/mobile/src/components/group-info/settings-page.tsx`
- `apps/mobile/src/components/group-info/activity-page.tsx`
- `apps/mobile/src/components/group-info/allowed-page.tsx`
- `work/T-1963-phone-group-info-subpages.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The lead checks the phone smoke and taps through the sub-pages from `/group-info/g-devteam`.
- People and AIs, Tools and routines, and Settings all show the 56 dp back row with the 28/600 title under it, the same as `/settings/devices`.
- The People label is 12/500 uppercase.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Replaced the hand-made `h-14` back/title row in all five group info sub-pages with the shared `ScreenHeader` (`variant="sub"`, same title text, `onBack`), keeping each page's `SafeAreaView` and body unchanged. Removed the imports that became unused (`ChevronLeft`, `IconButton`, `ICON`, and `Text` where the title was its only use).

- `members-page.tsx` — `ScreenHeader variant="sub" title="People and AIs"`; the People label is now `<SectionLabel>People</SectionLabel>` and the count stays on the right of the same flex row (the row's own `px-1` was dropped because `SectionLabel` carries that padding, so the count still lines up with the search field's right edge).
- `tools-page.tsx` — `ScreenHeader variant="sub" title="Tools and routines"`.
- `settings-page.tsx` — `ScreenHeader variant="sub" title="Settings"`.
- `activity-page.tsx` — `ScreenHeader variant="sub" title="Activity"`.
- `allowed-page.tsx` — `ScreenHeader variant="sub" title="Always allowed"`.

No tests added (UI-only change, per the spec and AGENTS.md). All five files are under 400 lines (334, 121, 159, 26, 196).

### Checks run

- `pnpm install` — done, 25.1s.
- `pnpm gate` (first run) — `FAIL format`: `[warn] apps/mobile/src/components/group-info/members-page.tsx`; fixed with `pnpm exec prettier --write src/components/group-info/members-page.tsx` inside `apps/mobile` (it collapsed the now-short lucide import to one line).
- `pnpm gate` (second run) — GATE PASS:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.8s)
  PASS  lint  (2.1s)
  PASS  typecheck  (4.8s)
  PASS  effect  (1.6s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the gate reports no nearby tests for `@zilar/mobile`, and the change is UI-only.

### Notes for the lead

Nothing was visually run on a phone or simulator in this session; the acceptance smoke (tapping through `/group-info/g-devteam`) still needs your pass. Every page keeps the same title text as before, so only the header layout should change.


## Review (written by Claude)

**Approved and merged.** The pre-review was clean.

The lead checked the phone smoke (mock build of `fb5bdf162`) by opening `/group-info/g-devteam` and tapping into People and AIs on the emulator:
- the page now shows the shared 56 dp back row, with the 28/600 title under it;
- PEOPLE is the 12/500 uppercase kit label.

The sentence-case "AIs" label above it lives in `ais-list.tsx`, which T-1964 covers.
