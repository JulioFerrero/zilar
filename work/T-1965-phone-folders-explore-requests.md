---
id: T-1965
title: "Phone UI consistency M7: folder strip becomes the D24 segmented track (keeping the pager animation), Explore's filter uses the kit SegmentedControl, Chats request rows use 52 dp avatars like chat rows"
status: merged
milestone: M5
branch: task/T-1965-phone-folders-explore-requests
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1948]
estimate: 40 min
---

# T-1965: Phone folders, Explore filter, request rows (M7)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". This is batch M7 of `docs/audit/ui-consistency.md` §5, against the targets in §1.4 and §1.7.

Today Chats draws filled round folder pills and Explore draws outlined pills: two pill styles for the same "pick one" job. D24 asks for one segmented control. The web strip got the same change in T-1962.

### Facts (read by the lead on 2026-10-18)
- **Folder strip.** `apps/mobile/src/components/chat/folder-tabs.tsx`:
  - It is a horizontal `ScrollView` (around `:79-105`) of `FolderChipView`s (`:120-183`).
  - Each chip is `h-[34px] ... rounded-full px-3` (`:143`). It has two animated layers tied to the pager's `progress`: a `bg-surface` fill (`:145-148`) and the raised `segment` layer (`:150-153`).
  - Each chip also has a glyph, a 13/500 label and an unread count badge.
- **Kit control.** `apps/mobile/src/components/ui/segmented-control.tsx` is a `well` track (`rounded-[10px] p-[3px]`, `:58`) holding `rounded-[7px]` tabs, 34 px high (`:86-87`). It cannot follow a pager's progress, so the folder strip must keep its own animation. `well` and `segment` come from `@/lib/depth`.
- **Explore's filter.** `apps/mobile/src/app/explore.tsx`:
  - The options are at `:39` (All / Groups / Channels), with state `kind` and `setKind` at `:65`.
  - The pills are hand-made at `:237-248` (`rounded-full border px-3 py-1`, accent border when active).
- **Chats request rows.** `apps/mobile/src/components/chat/request-rows.tsx:228-231` draws `EntityAvatar size={44}` and a 15/500 name. Chat rows next to them use 52 dp avatars and 16/600 names (audit §1.5).

### Steps
1. **Reshape the folder strip** (`folder-tabs.tsx`). Keep the pager animation, the glyphs, the counts and the horizontal scroll.
   - Wrap the chips in a `well` track (`rounded-[10px] p-[3px]`, using the `well` style from `@/lib/depth`, as `segmented-control.tsx` does).
   - Make each chip `rounded-[7px]`.
   - Drop the inactive `bg-surface` fill layer, so inactive tabs sit on the well. The raised `segment` layer stays and still follows `progress`.
   - The track must hug its content when there are few folders, and it must still scroll when there are many.
2. **Swap the Explore filter** (`explore.tsx:237-248`). Replace the hand-made pills with `<SegmentedControl mode="radio" …>` over the same three options and the same `kind`/`setKind` state. Check the kit's props (`:9-30`) for the exact option shape.
3. **Resize the request rows** (`request-rows.tsx:228-231`). Use `size={52}` for the avatar and `text-[16px] font-semibold` for the name, keeping the subtitle and the Accept/Decline keys. Leave `apps/mobile/src/app/settings/requests.tsx` at 44: settings people lists stay at 44, like Contacts and Blocked (audit §1.5).
4. **Change nothing else.** No tests, since this is UI. Every file stays at or under 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/folder-tabs.tsx`
- `apps/mobile/src/app/explore.tsx`
- `apps/mobile/src/components/chat/request-rows.tsx`
- `work/T-1965-phone-folders-explore-requests.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The lead checks the phone smoke:
- **`/`:** the folder strip is a recessed track with the active tab raised, and swiping between folders still moves the raised tab. The request rows (Theo, Nora in the mock) use 52 dp avatars, the same as chat rows.
- **`/explore`:** the All / Groups / Channels filter is the segmented control, and it still filters.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

- **Folder strip** (`apps/mobile/src/components/chat/folder-tabs.tsx`): wrapped the chips in the kit `well` track (`flex-row gap-0.5 rounded-[10px] p-[3px]`, `well` from `@/lib/depth` with the kit's `#1a1a1a` border) inside the existing horizontal `ScrollView`. Chips are now `rounded-[7px]`, and the inactive `bg-surface` fill layer and its `surfaceStyle` were removed, so inactive chips sit directly on the well. The raised `segment` layer still cross-fades with the pager's `progress`. Glyphs, labels, unread counts and the scroll-to-active behaviour are unchanged; new `TRACK_PADDING = 3` keeps the scroll target aligned with the track's padding, and the track hugs its content because it has no `flex-1` (the outer ScrollView still scrolls when there are many folders).
- **Explore filter** (`apps/mobile/src/app/explore.tsx`): replaced the hand-made outlined pills with `<SegmentedControl mode="radio" accessibilityLabel="Kind filter" options={...} value={kind} onChange={...} />` over the same All / Groups / Channels options and the same `kind`/`setKind` state (value cast to `KindFilter`, the same pattern used in `group-info/settings-page.tsx`). Removed the now-unused `Pressable` import.
- **Request rows** (`apps/mobile/src/components/chat/request-rows.tsx`): avatar is `size={52}` and the name is `text-[16px] font-semibold`; subtitle and Accept/Decline keys untouched. `app/settings/requests.tsx` was left at 44 as instructed.

Files changed: the three mobile files above plus this task file. No other files.

### Checks run

- `pnpm install`: done, 1155 packages, no errors (one deprecated transitive `uuid@7.0.3` warning and an unmet peer `@types/react` warning in `apps/mobile`, both pre-existing).
- `pnpm gate` (repo root): `gate: 4 changed file(s) against main`; PASS install (frozen) 2.2s, PASS format 1.9s, PASS lint 1.5s, PASS typecheck 4.5s, PASS effect 0.6s, PASS tests @zilar/mobile 1.8s; `scope: every changed file is inside the Allowed files`; `migration: every added migration continues from the base`; `images: every workspace package an app image needs is copied into its Dockerfile`; `size: every changed source file is within 400 lines`; `GATE PASS`.
- No single test files were run separately: this is UI-only and the gate's mobile tests passed. The phone smoke was not run by me; it is the lead's check.

### Notes for the lead

- Track spacing between chips is `gap-0.5` (2 px), matching the kit segmented control, where the old strip had 8 px gaps. The outer row keeps its 16 px horizontal inset and 8 px bottom padding.
- Verify on the phone that the 52 dp request-row avatars do not crowd the Accept/Decline buttons on narrow screens; the row keeps its existing gap and button sizes.
- The inactive unread badge still uses `bg-surface`, which now sits on the well rather than on the removed surface-filled chip; check its contrast in the smoke.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean, with 1 nit. The lead checked the phone smoke (mock build of `0e2ec0865`) and the emulator:
- **`/` folder strip:** it is a recessed well track that hugs its three tabs, with All chats raised. A horizontal swipe on the list moves to Personal, and the raised tab follows.
- **`/` request rows:** Theo and Nora now use 52 dp avatars and 16/600 names, the same as the chat rows under them.
- **`/explore`:** All, Groups and Channels form the kit segmented control.

**Nit accepted as is:** `scrollToActive` lands about 3 px off. That shows only when the folders overflow the row.
