---
id: T-1958
title: "Phone UI consistency M2: one section-label style (12/500 uppercase 0.06em) on Settings, Notifications, Requests, Routines and Stickers"
status: merged
milestone: M5
branch: task/T-1958-phone-section-labels
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1948]
estimate: 30 min
---

# T-1958: Phone section labels (M2)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". This is batch **M2** of `docs/audit/ui-consistency.md` §5. The target is §1.3, and the component is §4.3.

The lead saw "ACCOUNT" (uppercase, tracked) on Settings, while Group info uses sentence-case "Your topics" at a larger size.

### Facts (read by the lead on 2026-10-18)
- **`apps/mobile/src/components/ui/card.tsx:17-27`:** `SectionLabel` is `px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground`.
- **The audit's §4.3 target for phone:** `text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground`, 4 px left inset (`px-1`), plus an optional `className` prop.
- **The other files in this batch** draw their own labels: `apps/mobile/src/components/stickers/packs-tab.tsx`, `apps/mobile/src/app/settings/notifications.tsx`, `apps/mobile/src/app/settings/requests.tsx`, `apps/mobile/src/app/settings/routines.tsx` and `apps/mobile/src/app/settings/stickers.tsx`. Find each hand-made section heading (an uppercase or small semibold `Text` above a group of rows) by reading the file.

### Steps
1. **`card.tsx` `SectionLabel`:** apply the §4.3 classes, and add `className?: string`, merged with `cn`.
2. **In the other five files,** replace every hand-made section heading with `<SectionLabel>`. Keep the label text, and only change its case if the source text was already a heading.
3. **Nothing else changes:** no layout, no rows, no header. The headers came in T-1948.
4. **No tests** (UI). Every file stays at 400 lines or fewer. `notifications.tsx` is at 388, so make no net additions there.

### Allowed files
- `apps/mobile/src/components/ui/card.tsx`
- `apps/mobile/src/components/stickers/packs-tab.tsx`
- `apps/mobile/src/app/settings/notifications.tsx`
- `apps/mobile/src/app/settings/requests.tsx`
- `apps/mobile/src/app/settings/routines.tsx`
- `apps/mobile/src/app/settings/stickers.tsx`
- `work/T-1958-phone-section-labels.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On phone smoke screenshots of `/settings`, `/settings/notifications`, `/settings/requests`, `/settings/stickers` and `/settings/routines`, every section label is the same 12/500 uppercase muted style.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/mobile/src/components/ui/card.tsx`: changed `SectionLabel` to the §4.3 target classes
  (`text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground`, `px-1` inset) and
  added an optional `className?: string` merged with `cn`. Updated the doc comment.
- `apps/mobile/src/components/stickers/packs-tab.tsx`: replaced the hand-made `Added` heading
  (local 12/500 at `ml-1`) with `<SectionLabel>Added</SectionLabel>`.
- `apps/mobile/src/app/settings/routines.tsx`: replaced the hand-made heading in `RoutineGroup`
  (11/500 `tracking-wide` at `px-1`) with `<SectionLabel>{label}</SectionLabel>`.
- `apps/mobile/src/app/settings/notifications.tsx`, `apps/mobile/src/app/settings/requests.tsx`:
  no change needed. Every section heading in both files already renders through `SectionLabel`
  (notifications: "On this phone", "Message previews", "Test"; requests: "Incoming", "Sent"), so
  they pick up the new style from `card.tsx`.
- `apps/mobile/src/app/settings/stickers.tsx`: no change needed. It has no section labels of its
  own; the labels on that screen live in `PacksTab` (changed above) and the Discover/Favorites
  tabs, which have no uppercase/section headings (grep found none).
- No layout, rows or headers changed. All six files stay at 400 lines or fewer
  (31 / 128 / 388 / 283 / 250 / 321).

### Checks run

- `pnpm install`: done, no errors (one peer-dependency warning: `@types/react-dom 19.3.0` wants
  `@types/react ^19.3.0`, found 19.2.18 — pre-existing, not touched by this task).
- `pnpm gate` from the repo root:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (2.6s)
PASS  format  (1.3s)
PASS  lint  (1.5s)
PASS  typecheck  (6.8s)
PASS  effect  (1.3s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: this is UI-only and the spec says no tests.

### Notes for the lead

- The task listed notifications, requests and stickers as files with hand-made labels; by the time
  this ran they were already on `SectionLabel` (or had no labels), so only three of the six files
  needed edits.
- `packs-tab.tsx` used `ml-1` where the kit uses `px-1`; both are a 4 px inset, so the 4 px rule
  holds and the look is unchanged.
- Acceptance needs the phone smoke screenshots on `/settings`, `/settings/notifications`,
  `/settings/requests`, `/settings/stickers` and `/settings/routines`; not run here (UI).


## Review (written by Claude)

**Approved and merged.** The pre-review was clean, with 0 findings. The lead checked the phone smoke (mock build of `9b76b1302`) on `/settings`, `/settings/notifications`, `/settings/requests` and `/settings/routines`: every section label (ON THIS PHONE, DEVICES, MESSAGE PREVIEWS, TEST, ACCOUNT…) is the same 12/500 uppercase muted style. Only `card.tsx`, `routines.tsx` and `packs-tab.tsx` needed changes; the other pages already used `SectionLabel`.
