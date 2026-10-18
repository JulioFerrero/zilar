---
id: T-1967
title: "Web UI consistency W6: group and channel info labels use SectionLabel; ScreenHeader takes a backLabel so info sub-pages say 'Back to group info' again"
status: merged
milestone: M5
branch: task/T-1967-web-info-labels
model: deepseek/deepseek-flash
effort: default
depends_on: [T-1949]
estimate: 30 min
---

# T-1967: Web info labels (W6)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow". This is batch W6 of `docs/audit/ui-consistency.md` §5, against the target in §1.3, plus the T-1962 review follow-up.

The lead saw "AIs", "People" and "Roles" in sentence case in group info > People and AIs. Settings uses the 11/500 uppercase kit label.

### Facts (read by the lead on 2026-10-18)
- **The kit label.** `SectionLabel` lives in `apps/web/src/components/ui/card.tsx`, styled 11/500 uppercase 0.06em.
- **Hand-made labels to replace:**
  - `apps/web/src/components/group-info/PeoplePage.tsx:13` is a label row: `flex items-center justify-between px-0.5 text-[12px] font-semibold` with a count on the right.
  - `apps/web/src/components/group-info/TopicsSection.tsx:150` ("Your topics") and `:174` ("Other topics"), both `text-[12px] font-semibold`.
  - `apps/web/src/components/channel-info/ChannelPeople.tsx:106` ("Admins") and `:120` ("Subscribers"), both `<h2 className="px-2 text-[13px] font-semibold">`.
  - `apps/web/src/components/channel-info/ChannelAisPage.tsx:48` ("AIs").
- **The back key's label.** `apps/web/src/components/ui/screen-header.tsx:31` hard-codes `aria-label="Back"`. `apps/web/src/components/group-info/GroupInfoPage.tsx:30` passes `onBack`. Before T-1962, the key there said "Back to group info" or "Back to channel info".

### Steps
1. **Add `backLabel`.** `screen-header.tsx` gets an optional `backLabel?: string`, defaulting to `'Back'`, which is used as the back key's `aria-label`.
2. **Use it in `GroupInfoPage.tsx`.** Pass ``backLabel={`Back to ${noun} info`}``, the same `noun` that the close key uses at `:32`.
3. **Swap the labels.** Replace each label above with `<SectionLabel>`, keeping the text. Where a count sits on the right (`PeoplePage.tsx:13`), keep the flex row and put `SectionLabel` in it, with the count unchanged. Keep `h2` semantics where there was an `h2`: use `SectionLabel`'s element prop if it has one; otherwise wrap it in the `h2`.
4. **Change nothing else.** No tests, since this is UI. Every file stays at or under 400 lines.

### Allowed files
- `apps/web/src/components/ui/screen-header.tsx`
- `apps/web/src/components/group-info/GroupInfoPage.tsx`
- `apps/web/src/components/group-info/PeoplePage.tsx`
- `apps/web/src/components/group-info/TopicsSection.tsx`
- `apps/web/src/components/channel-info/ChannelPeople.tsx`
- `apps/web/src/components/channel-info/ChannelAisPage.tsx`
- `work/T-1967-web-info-labels.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The lead checks the web mock at 1440 px:
- **Group info, root and People and AIs:** the labels (YOUR TOPICS, AIS, PEOPLE, ROLES where present) match the Settings labels.
- **The back key:** its accessible name is "Back to group info".
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did
- **`ScreenHeader`** (`apps/web/src/components/ui/screen-header.tsx`): added optional `backLabel?: string`, defaulting to `'Back'`, used as the back key's `aria-label`.
- **`GroupInfoPage`** (`apps/web/src/components/group-info/GroupInfoPage.tsx`): passes ``backLabel={`Back to ${noun} info`}`` (same `noun` as the close key), so group and channel info sub-pages read "Back to group info" / "Back to channel info" again.
- **Labels swapped to `SectionLabel`** (11/500 uppercase 0.06em):
  - `PeoplePage.tsx`: `SectionHeading` now puts `SectionLabel` in the existing flex row; the right-hand count keeps its 12 px mono muted styling. Applies to AIs and People.
  - `TopicsSection.tsx`: "Your topics" and "Other topics".
  - `ChannelPeople.tsx`: "Admins" and "Subscribers" (h2 semantics kept via `SectionLabel`'s default `as="h2"`).
  - `ChannelAisPage.tsx`: "AIs".
- **Roles label** (see Notes): `PeoplePage.tsx` now draws a `SectionLabel` "Roles" above `GroupRolesSection` and hides that component's own plain h2 with the same `[&>section>h2]:hidden` pattern already used for `GroupAiSection` in this file.

### Files changed
- `apps/web/src/components/ui/screen-header.tsx`
- `apps/web/src/components/group-info/GroupInfoPage.tsx`
- `apps/web/src/components/group-info/PeoplePage.tsx`
- `apps/web/src/components/group-info/TopicsSection.tsx`
- `apps/web/src/components/channel-info/ChannelPeople.tsx`
- `apps/web/src/components/channel-info/ChannelAisPage.tsx`
- `work/T-1967-web-info-labels.md` (status + this report)

### Checks run
- `pnpm install`: Done in 24.3s; 1155 packages, 1 deprecated subdependency warning (`uuid@7.0.3`), one peer-dependency warning in `apps/mobile` (`@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18). No files changed by install.
- `pnpm gate` (from repo root):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.8s)
PASS  lint  (1.2s)
PASS  typecheck  (4.7s)
PASS  effect  (1.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No single test files were run: the task has no test step and UI code gets no tests; the gate reported no nearby web tests.

### Notes for the lead
- **Deviation, ROLES:** the acceptance names ROLES, but the Roles h2 lives in `apps/web/src/components/panels/GroupRolesSection.tsx`, which is not in the Allowed files. To meet the acceptance without touching that file, `PeoplePage.tsx` draws the `SectionLabel` and hides `GroupRolesSection`'s own h2, mirroring the existing `GroupAiSection` pattern in the same file. If you would rather change `GroupRolesSection.tsx` directly, it needs to be added to the Allowed files in a follow-up.
- The decorative `px-0.5` / `px-2` on the old labels was dropped so these labels align to the card edge like the Settings labels; spacing between label and card is unchanged.
- I did not run the web app or inspect the mock visually; only the gate was run. Visual acceptance at 1440 px is yours.


## Review (written by Claude)

**Approved and merged.** The pre-review was clean, with 1 follow-up. The lead checked the web mock (Playwright, 1440×900) on `03755de11`:
- **Group info root:** YOUR TOPICS and OTHER TOPICS are the 11/500 uppercase kit label.
- **People and AIs:** AIS, PEOPLE and ROLES are the kit label, and the counts stay on the right.
- **The back key:** its accessible name is "Back to group info" again (`backLabel`).

**Follow-up, kept for a later clean-up:** `PeoplePage.tsx` hides the panel sections' own `h2` with `[&>section>h2]:hidden`. The fix is to make `panels/GroupRolesSection.tsx` and `panels/GroupAiSection.tsx` render `SectionLabel` themselves. There's no visible effect today.
