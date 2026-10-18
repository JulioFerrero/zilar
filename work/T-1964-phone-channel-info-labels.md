---
id: T-1964
title: "Phone UI consistency M9: channel info sub-pages use the shared ScreenHeader; group info 'Your topics', 'Other topics' and 'AIs' become SectionLabel"
status: merged
milestone: M5
branch: task/T-1964-phone-channel-info-labels
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1948]
estimate: 30 min
---

# T-1964: Phone channel info headers and info labels (M9)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". This is batch M9 of `docs/audit/ui-consistency.md` §5, against the targets in §1.2 and §1.3.

The lead saw sentence-case 13/600 "Your topics" in group info, while Settings uses the 12/500 uppercase kit label.

### Facts (read by the lead on 2026-10-18)
- **The shared header.** `apps/mobile/src/components/ui/screen-header.tsx` exports `ScreenHeader({ variant: 'root' | 'sub', title, subtitle?, onBack?, right?, bare? })`.
- **Two channel sub-pages draw their own row.** Each has an `h-14` row with an `IconButton label="Back"` (`ChevronLeft`) and a `text-[28px]` title on the same row, and no right key:
  - `apps/mobile/src/components/channel-info/settings-page.tsx`: back key `:24`, title `:27`;
  - `apps/mobile/src/components/channel-info/people-page.tsx`: back key `:78`, title `:81`.
- **Hand-made labels.** Each is a `text-[13px] font-semibold text-muted-foreground` `Text`:
  - `apps/mobile/src/components/group-info/topics-section.tsx:267` ("Your topics");
  - `apps/mobile/src/components/group-info/topics-section.tsx:285` ("Other topics");
  - `apps/mobile/src/components/group-info/ais-list.tsx:67` ("AIs").
- **The kit label** is `SectionLabel` in `apps/mobile/src/components/ui/card.tsx`, styled 12/500 uppercase 0.06em. It takes a `className`.

### Steps
1. **Swap the header.** In both channel-info files, replace the hand-made `h-14` row with `<ScreenHeader variant="sub" title="…" onBack={onBack} />`. Use the same title.
   - Keep the `SafeAreaView` and body.
   - Remove the imports that are no longer used.
2. **Swap the labels.** Replace the three hand-made labels with `<SectionLabel>`, keeping their text. If a label shares a row with a count or a key, keep that row and put `SectionLabel` in it.
3. **Change nothing else.** No tests, since this is UI. Every file stays at or under 400 lines.

### Allowed files
- `apps/mobile/src/components/channel-info/settings-page.tsx`
- `apps/mobile/src/components/channel-info/people-page.tsx`
- `apps/mobile/src/components/group-info/topics-section.tsx`
- `apps/mobile/src/components/group-info/ais-list.tsx`
- `work/T-1964-phone-channel-info-labels.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The lead checks the phone smoke of `/group-info/g-devteam`: YOUR TOPICS and OTHER TOPICS show in the kit label style.
- A channel's info sub-pages (People, Settings) show the shared back row with the 28/600 title under it.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Shared header.** `channel-info/settings-page.tsx` and `channel-info/people-page.tsx` now draw
  `<ScreenHeader variant="sub" title="Settings" | "Subscribers" onBack={onBack} />` instead of the
  hand-made `h-14` back row plus 28 px title. The `SafeAreaView` and bodies are unchanged, and the
  imports that the old row needed (`ChevronLeft`, `IconButton` in settings-page, `ICON` and `Text` in
  settings-page) are removed. `people-page.tsx` keeps `IconButton`, `ICON` and `Text` because the
  subscriber rows still use them.
- **Kit labels.** `group-info/topics-section.tsx` now uses `<SectionLabel>Your topics</SectionLabel>`
  and `<SectionLabel>Other topics</SectionLabel>` (the old `px-1 text-[13px] font-semibold` class is
  gone because `SectionLabel` already carries `px-1`). `group-info/ais-list.tsx` puts
  `<SectionLabel>AIs</SectionLabel>` in the existing row and keeps the count `Text` beside it.
- Only the four Allowed source files plus this task file were touched. No tests added (UI change).

### Checks run

- `pnpm install`: completed, 17.2s (one pre-existing unmet peer warning: `@types/react@^19.3.0`
  vs 19.2.18).
- No single test files were run: the change is UI-only and the mobile package has no nearby tests.
- `pnpm gate` (repo root), exit 0:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (1.0s)
PASS  lint  (1.7s)
PASS  typecheck  (5.0s)
PASS  effect  (1.1s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Deviation: none from the spec. The People page title keeps "Subscribers" and the Settings page keeps
  "Settings", as instructed.
- Not verified on a device: I did not run the phone smoke. The visual check of `/group-info/g-devteam`
  and the channel People/Settings pages is still yours.
- `settings-page.tsx` is 32 lines and `people-page.tsx` 175 lines after the change; all files stay well
  under 400.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean. The lead checked the phone smoke (mock build of `248d53e9c`):
- **The group info root** (`/group-info/g-devteam`) shows YOUR TOPICS and OTHER TOPICS as the 12/500 uppercase kit label.
- **People and AIs** (opened on the emulator) shows AIS the same way.

**What the smoke didn't reach:**
- The channel info sub-pages have no route the smoke can open. They change in exactly the same way as T-1963's group pages: the lead read the diff, and the pre-review confirmed it.
- This branch predates T-1963, so the People header and the PEOPLE label come from that merge.
