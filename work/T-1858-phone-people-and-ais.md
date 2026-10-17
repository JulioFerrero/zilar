---
id: T-1858
title: "Phone Group info: one 'People and AIs' row (avatar stack, total, chevron; PhoneGroup.dc.html:56-61) replaces Members, AIs and Invite links, and opens one combined page — AIs first, then the members page content (search, Add members, Invite with a link, members, Roles)"
status: merged
milestone: M5
branch: task/T-1858-phone-people-and-ais
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1858: One "People and AIs" page in phone Group info

## Spec (written by Claude, do not edit)

### Why
**Julio (2026-10-17, question tool):** the group screen's single "People and AIs" row opens **one combined page**:
- AIs first, then People;
- Add, invite links and roles on it.

**This is web T-1857's phone twin.** Today the phone root has separate Members, AIs and Invite links rows.

### Facts (read by the lead on 2026-10-17)
- **The board** `docs/design/mockups/topic-people/PhoneGroup.dc.html:56-61` draws one row: an avatar stack, "People and AIs", the total in mono `#a1a1a1`, and a chevron.
- **`apps/mobile/src/components/group-info/root-page.tsx`** (211 lines) has an `InfoRowGroup`:
  - Members, with `count={peopleCount}` and `onOpenMembers` (`:156`);
  - AIs, with `count={aisCount}` and `onOpenAis` (`:157`);
  - Invite links for managers (`:158`).

  `groupMembers` and `groupAis` are already props, passed to `TopicsSection`.
- **`apps/mobile/src/components/group-info/topics-section.tsx`** (341 lines) has a local `Stack({ people })` (`:63`).
- **`apps/mobile/src/components/group-info/members-page.tsx`** (380 lines), `MembersPage`:
  - a header with Back and the title "Members" (`:155-161`);
  - then a `ScrollView` with the search field, the manager's Add members and Invite with a link rows (`:178-183`), the member rows, and Roles (`:241-242`).
- **`apps/mobile/src/components/group-info/ais-page.tsx`** (199 lines), `AisPage({ groupId, ais, isManager, onBack })`: a header, then a `ScrollView` with the AI rows (orb, name, ⋮ actions), "Add AI" for managers (`:106-107`), and its sheets.
- **The page switch:** `apps/mobile/src/components/group-info/group-info-pages.tsx`:
  - `GroupInfoPage` is `'root' | 'members' | 'ais' | …` (`:25-26`);
  - `'members'` renders `MembersPage` and `'ais'` renders `AisPage` (`:212-220`).
- **The route:** `apps/mobile/src/app/group-info/[id].tsx` sets the page (`:139`, `:151`, `:196`).

### Steps
1. **New `apps/mobile/src/components/group-info/ais-list.tsx`:** move the body of `AisPage` into `GroupAisList({ groupId, ais, isManager })`. That's the rows, "Add AI" and the sheets, without the header or the `ScrollView`, with a small "AIs" section label and count. Delete `ais-page.tsx` once nothing uses it.
2. **`MembersPage`:**
   - the title becomes "People and AIs";
   - `<GroupAisList …>` renders first inside the `ScrollView`, before the search field;
   - then a "People" section label with the count;
   - the rest stays as it is.

   Pass `ais` into `MembersPage` from `group-info-pages.tsx`. `members-page.tsx` must stay at most 400 lines; move the members' rows into a new `members-list.tsx` if needed.
3. **`root-page.tsx`:** replace the three rows with one row: the avatar stack (AIs first, then people, up to 5), "People and AIs", the total, and a chevron, calling `onOpenMembers`.
   - **Move `Stack`** to a shared `group-info/avatar-stack.tsx` used by both files.
   - **Remove** the `onOpenAis` and the root `onOpenLinks` props, and their wiring in `[id].tsx`. Invite with a link stays on the page.
4. **The page switch:** drop `'ais'` from `GroupInfoPage` and its branch.
5. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/components/group-info/ais-list.tsx`
- `apps/mobile/src/components/group-info/ais-page.tsx`
- `apps/mobile/src/components/group-info/members-page.tsx`
- `apps/mobile/src/components/group-info/members-list.tsx`
- `apps/mobile/src/components/group-info/root-page.tsx`
- `apps/mobile/src/components/group-info/avatar-stack.tsx`
- `apps/mobile/src/components/group-info/topics-section.tsx`
- `apps/mobile/src/components/group-info/group-info-pages.tsx`
- `apps/mobile/src/app/group-info/[id].tsx`
- `work/T-1858-phone-people-and-ais.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone Group info shows one "People and AIs" row** with the stack and the total.
- **It opens one page:** AIs (with Add AI for managers), then the people part with search, Add members, Invite with a link, the members and Roles.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **New `avatar-stack.tsx`**: moved the topics section's local `Stack` here as
  `AvatarStack`, with the same 22 px circles, 2 px ring and 7 px overlap. Both
  `topics-section.tsx` and the root use it.
- **New `ais-list.tsx`**: `GroupAisList({ groupId, ais, isManager })` holds what
  `AisPage` had below its header: an "AIs" section label with the mono count, the
  AI rows (orb, name, ⋮ Remove for their owner or a manager), the Add AI row for
  managers, the error line and the add/options sheets and remove dialog. No header
  and no `ScrollView`, so it fits inside another page.
- **`ais-page.tsx`**: now a thin page around `GroupAisList` (header with Back and
  "AIs", then a `ScrollView`). It could not be deleted: `channel-screen.tsx`
  (outside this task's Allowed files) still renders it as the channel's AIs page.
- **`members-page.tsx`**:
  - the title is "People and AIs";
  - `GroupAisList` renders first inside the `ScrollView`;
  - then a "People" section label with the member count, then the search field,
    the manager's Add members and Invite with a link rows, the member rows and
    Roles, unchanged.
  - the member rows moved to the new `members-list.tsx` (`MembersList`), so the
    page stays at 341 lines; `MembersPage` takes the new `ais` prop.
- **`root-page.tsx`**: the Members, AIs and Invite links rows are replaced by one
  row: the avatar stack (AIs first, then people, at most 5), "People and AIs", the
  total (`memberCount`, people + AIs) in mono and a chevron, opening `onOpenMembers`.
  The `onOpenAis`, `onOpenLinks`, `peopleCount` and `aisCount` props are gone.
- **`group-info-pages.tsx`**: `'ais'` is gone from `GroupInfoPage` and its branch;
  the now-unused `ais` and `isManager` props of `GroupInfoPages` are removed.
- **`app/group-info/[id].tsx`**: dropped the removed root props and their wiring
  (`onOpenAis`, `onOpenLinks` on the root); `membersProps` now passes `ais`, and
  `GroupInfoPages` no longer takes `ais`/`isManager`. `openLinks` stays because
  MembersPage's Invite with a link uses it.

Deviations from the spec:
- **`ais-page.tsx` was kept, not deleted.** The spec says to delete it "once
  nothing uses it", but `apps/mobile/src/components/chat/channel-screen.tsx:22,189`
  still imports and renders it for the channel's AIs page, and that file is not in
  the Allowed files. It is now a 38-line wrapper around `GroupAisList`, so there is
  no duplicated list logic. If the lead wants it gone, the channel screen needs its
  own follow-up task.

### Checks run

- `pnpm install` — done (21.2 s).
- No single test files: the spec says no tests, and the gate found no nearby test
  files (`SKIP tests @zilar/mobile (no nearby test files)`).
- `pnpm gate` (final run, from the repo root):

```
gate: 10 changed file(s) against main
PASS  install (frozen)  (2.3s)
PASS  format  (1.2s)
PASS  lint  (0.9s)
PASS  typecheck  (4.9s)
PASS  effect  (1.8s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Earlier gate runs failed and were fixed: one format warning in `members-list.tsx`
(fixed with `pnpm exec prettier --write` on that file) and one typecheck error
(`Crown` was still used by the "Make owner" item in `members-page.tsx`; re-added
the import).

### Notes for the lead

- Line counts: `members-page.tsx` 341, `ais-list.tsx` 191, `members-list.tsx` 93,
  `root-page.tsx` 234, `topics-section.tsx` 301, `avatar-stack.tsx` 50,
  `ais-page.tsx` 38, `group-info-pages.tsx` 221, `[id].tsx` 392 — all ≤ 400.
- The AIs count and the People count on the combined page are the full counts
  (`ais.length`, `members.length`), not the filtered search result.
- The combined row's total is the existing `memberCount` (people + AIs), the same
  number the header uses; `peopleCount`/`aisCount` were removed as unused.
- Did not run the app or a device smoke test (UI task, no simulator flow run here);
  typecheck, lint, format and the gate are the verification.
- No dependencies, migrations, routes or security-relevant code were touched, so
  the security checklist does not apply beyond the unchanged server-enforced writes.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `1a9b5fdce`.
- **The emulator check** ran on the mock build (the smoke passed). I tapped Dev team, then its header, to reach Group info:
  - **one row:** five orbs, "People and AIs", 6 and a chevron, matching `PhoneGroup.dc.html:56-61`;
  - **the page "People and AIs":**
    1. AIs 2 (Dev-1, QA-1 with ⋮) and Add AI;
    2. People 4 with Search, Add members and Invite with a link;
    3. the members with role chips, crown and admin shield;
    4. Roles.
- **Follow-up:** `ais-page.tsx` stays as a 38-line wrapper because `channel-screen.tsx` imports it. Drop it when a task may touch the channel screen.

