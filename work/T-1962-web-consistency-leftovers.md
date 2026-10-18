---
id: T-1962
title: "Web UI consistency W2–W5 leftovers: info sub-pages use ScreenHeader, narrow folder tabs use the D24 segmented track, Stickers' hand-made label becomes SectionLabel"
status: merged
milestone: M5
branch: task/T-1962-web-consistency-leftovers
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1949]
estimate: 35 min
---

# T-1962: Web consistency leftovers

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". `docs/audit/ui-consistency.md` §5 planned W2–W5. The lead found that every web settings page already renders through `SettingsShell`, so they all take the new header from W1 (T-1949). These are the only leftovers.

### Facts (read by the lead on 2026-10-18)
- **The info sub-page frame,** `apps/web/src/components/group-info/GroupInfoPage.tsx` (38 lines), has its own `<header className="flex shrink-0 items-center gap-2 border-b border-divider p-3">` with `<h2 className="... text-[16px] font-semibold">` (`:26-30`). The settings pages use the W1 header: a 64 px row and a 17/600 title.
- **The narrow folder tabs,** `apps/web/src/components/FolderTabs.tsx` (94 lines), draw pills: `h-[30px] rounded-full border px-3 text-[13px]`, with the active one `segment-raised` (`:56-80`), and an unread `Badge` (`:86`).
  - D24 asks for a segmented control: a recessed well track with 3 px padding and 10 px radius, 30 px tabs with 7 px radius, the active tab raised (`docs/design/ui-style.md:170-174`, audit §1.4).
  - The kit is `apps/web/src/components/ui/segmented-control.tsx`.
- **`apps/web/src/routes/StickersPage.tsx:236`** has a hand-made label, `<h2 className="px-1 text-[11px] font-medium uppercase tracking-[0.06em] text-subtle-foreground">`. The kit `SectionLabel` is in `apps/web/src/components/ui/card.tsx`.
- **W1 (T-1949)** adds `apps/web/src/components/ui/screen-header.tsx`. Read the merged file for its API.

### Steps
1. **`GroupInfoPage.tsx`:** render its header with `ScreenHeader variant="sub"` (back, title, any right key it has), in place of the hand-made `<header>`. Every group and channel info sub-page that uses this frame follows.
2. **`FolderTabs.tsx`:** draw the folder strip as the D24 segmented track.
   - Use the kit `SegmentedControl` if it can carry an icon and the unread badge. If not, reproduce its track and tab classes here: a `well` track with 3 px padding and 10 px radius, 30 px tabs with 7 px radius, the active tab `segment-raised`, inactive tabs muted text, no border on inactive tabs.
   - Keep horizontal scrolling when the folders overflow, and keep the unread badges and icons.
3. **`StickersPage.tsx:236`:** use `<SectionLabel>`.
4. **No tests** (UI). Every file stays at 400 lines or fewer.

### Allowed files
- `apps/web/src/components/group-info/GroupInfoPage.tsx`
- `apps/web/src/components/FolderTabs.tsx`
- `apps/web/src/routes/StickersPage.tsx`
- `work/T-1962-web-consistency-leftovers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The lead checks web mock screenshots:
- **group info, 1440 px:** a sub-page such as People shows the 64 px header with a 17/600 title;
- **the chat list, 390 px:** the folder strip is the recessed segmented track with the active tab raised;
- **`/settings/stickers`:** its label matches the others.

The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`apps/web/src/components/group-info/GroupInfoPage.tsx`:** replaced the hand-made `<header>` (p-3, 16/600 title, ChevronLeft) with `ScreenHeader variant="sub" title={title} onBack={onBack} right={<IconButton … Close …>}`. The body and the `noun`-specific close label are unchanged, so the group and channel info sub-pages both take the W1 64 px row and 17/600 title.
- **`apps/web/src/components/FolderTabs.tsx`:** replaced the pill strip with the D24 track: an outer `px-3 pt-1 pb-2` wrapper around a `well-surface flex gap-1 overflow-x-auto rounded-[10px] p-[3px]` tablist. Tabs are `h-[30px] shrink-0 rounded-[7px] px-3 text-[13px] font-medium`; the active tab keeps `segment-raised text-foreground`, inactive tabs are `text-muted-foreground hover:text-foreground` with no border. Icons, unread `Badge`s, keyboard movement and horizontal scrolling are kept. The doc comment now says "folder track" rather than "chips".
- **`apps/web/src/routes/StickersPage.tsx`:** the "Added" heading now uses `<SectionLabel>Added</SectionLabel>` from `@/components/ui/card` instead of the hand-made `h2`.
- No tests added (UI-only, per spec). All three files are under 400 lines (`FolderTabs.tsx` 96, `GroupInfoPage.tsx` 40, `StickersPage.tsx` 328).

### Checks run

- `pnpm install`: 17 workspace projects, done in 20.6s (only the existing `uuid@7.0.3` deprecation and `@types/react` peer warnings).
- `pnpm gate` (first run): `FAIL format` on `apps/web/src/components/FolderTabs.tsx`; everything else passed, scope clean, `GATE FAIL`.
- `pnpm exec prettier --write apps/web/src/components/FolderTabs.tsx`: reformatted, 57ms.
- `pnpm gate` (final run): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `SKIP tests @zilar/web (no nearby test files)`; `scope: every changed file is inside the Allowed files`; `migration` and `images` clean; `size: every changed source file is within 400 lines`; **`GATE PASS`**.
- No single-file tests were run: the change is UI-only and the gate reports no nearby web test files.

### Notes for the lead

- **Why not the kit `SegmentedControl`:** it can carry an icon and a unread count, but its tabs are hard-coded `flex flex-1` and it exposes no `className`, so it cannot be a horizontally scrolling, non-stretching folder strip. Using it would have required editing `apps/web/src/components/ui/segmented-control.tsx`, which is outside the Allowed files. Per step 2 I reproduced its track and tab classes in `FolderTabs.tsx` instead.
- **Back label:** `ScreenHeader`'s sub variant draws its back key with the kit's fixed `aria-label="Back"`, so the old `"Back to group info"` / `"Back to channel info"` label is now just `"Back"`. The close key keeps its noun-specific label. I did not change the kit (outside scope); flagging it in case the lead wants a `backLabel` prop in a later task.
- **Not run:** no mock screenshots — I have no browser step in this task, so the 1440 px group-info, 390 px folder-strip and `/settings/stickers` visuals are for the lead's acceptance check.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean, with 1 follow-up. The lead checked the web mock (Playwright) on `9891d73dc`:
- **The chat list at 390 px:** the folder strip is the recessed segmented track with All chats raised and icons kept.
- **Group info > People and AIs at 1440 px:** the shared 64 px header with a 36 px back key, a 17/600 title and the close key.

**Left for the next batch (W6):**
- the back key's label is now "Back" where it was "Back to group info". Restoring it needs a `backLabel` prop on `ScreenHeader`;
- the sentence-case "AIs", "People" and "Roles" labels in the People page are audit batch W6.
