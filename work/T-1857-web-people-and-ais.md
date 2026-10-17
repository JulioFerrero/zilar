---
id: T-1857
title: "Web Group info: one 'People and AIs' row (avatar stack, total count, chevron; WebGroup.dc.html) replaces the Members, AIs and Invite links rows and opens one combined page — AIs first, then People with Add and Invite with a link, then Roles for managers"
status: merged
milestone: M5
branch: task/T-1857-web-people-and-ais
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1857: One "People and AIs" page in web Group info

## Spec (written by Claude, do not edit)

### Why
**Julio (2026-10-17, question tool):** the group screen's single "People and AIs" row (boards `PhoneGroup`/`WebGroup`) opens **one combined page**:
- AIs first, then People, like the topic sheet;
- Add, invite links and roles move onto it.

Today web Group info has separate Members, AIs and Invite links rows, each with its own page.

### Facts (read by the lead on 2026-10-17)
- **The boards:**
  - `docs/design/mockups/topic-people/WebGroup.dc.html:60-64` draws one row: an avatar stack, "People and AIs", the total in mono `#a1a1a1`, and a chevron;
  - the phone twin is `PhoneGroup.dc.html:56-61`.
- **`apps/web/src/components/group-info/GroupInfoRoot.tsx`** (297 lines):
  - `GroupInfoPageId` and `GROUP_INFO_TITLES` (`:35-48`);
  - the `<nav aria-label="People">` holds three `ListRow`s: Members (`:200-206`), AIs (`:207-213`) and, for managers, Invite links (`:214-222`).
- **`apps/web/src/components/GroupPanel.tsx`** (359 lines):
  - `page === 'members'` renders `GroupMembersSection` (with `onOpenLinks={() => setPage('links')}` and `openPickerOnMount`), then `GroupRolesSection` for managers (`:204-230`);
  - `page === 'ais'` renders `GroupAiSection`, the `AiMemoryDialog` and the error (`:232-259`);
  - `openMembersWithPicker` sets `'members'` (`:171`);
  - `page === 'links'` stays as it is (`:262-272`).
- **Avatar stacks already exist** as local helpers: `TopicPeopleLine.tsx:98` and `group-info/TopicsSection.tsx:91`.

### Steps
1. **`GroupInfoRoot`:** replace the three rows with one `ListRow`:
   - leading: an avatar stack of up to 5 (the group's AIs first, then people), 18 px, overlapping like `TopicsSection`'s stack. Move that stack to a small shared `group-info/AvatarStack.tsx` and use it in both places;
   - title "People and AIs";
   - trailing: the members + AIs count;
   - a chevron;
   - `onClick={() => onOpenPage('people')}`.

   Add `'people'` to `GroupInfoPageId` with the title "People and AIs". Drop `'members'` and `'ais'` from the type and fix every use.
2. **`GroupPanel`, `page === 'people'`,** in this order:
   1. the AIs block (today's `ais` page body);
   2. the people block (`GroupMembersSection` with its Add and Invite with a link);
   3. `GroupRolesSection` for managers.

   `openMembersWithPicker` opens `'people'`.
   - **`GroupPanel.tsx` stays at most 400 lines.** If needed, move the page body to a new `group-info/PeoplePage.tsx`.
3. **Fixture:** keep `group-info/TopicsSection.fixture.tsx` compiling after the stack moves.
4. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/web/src/components/group-info/GroupInfoRoot.tsx`
- `apps/web/src/components/group-info/AvatarStack.tsx`
- `apps/web/src/components/group-info/TopicsSection.tsx`
- `apps/web/src/components/group-info/PeoplePage.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `apps/web/src/components/group-info/TopicsSection.fixture.tsx`
- `apps/web/src/components/ui/list-row.tsx` (added by the lead in the fix round: a `leading` slot)
- `work/T-1857-web-people-and-ais.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Group info shows one "People and AIs" row** with a stack and the total.
- **It opens one page:** AIs, then People with Add and Invite with a link, then Roles for managers.
- **The links page** still opens from Invite with a link.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Shared stack:** added `group-info/AvatarStack.tsx` (`AvatarStack`, `AvatarStackEntry`) with the overlapping-avatar markup that used to be local to `TopicsSection`, and `TopicsSection` now imports it (its local helper and `StackEntry` interface are gone; `peopleOf`/`aisOf` take `AvatarStackEntry`).
- **One row:** `GroupInfoRoot`'s People nav now holds a single `ListRow` — the leading 18 px stack of up to 5 (AIs first, then people, passed in as `stack`), the title "People and AIs", the total count in mono and a chevron — and opens `'people'`. `'members'` and `'ais'` are gone from `GroupInfoPageId`; `GROUP_INFO_TITLES` has `people: 'People and AIs'`. The now-unused `aisCount` / `linksCount` props and their `Bot` / `Link` / `Users` imports were removed.
- **One page:** `GroupPanel` builds the stack from `info` (AIs then members), `openMembersWithPicker` opens `'people'`, and `page === 'people'` renders the new `group-info/PeoplePage.tsx`: the AIs block (`GroupAiSection`, the memory dialog, the inline error), then `GroupMembersSection` (Add and Invite with a link, with the picker-on-mount behaviour kept), then `GroupRolesSection` for managers. The page state it owns (`memoryAi`, `errorMessage`) moved with the body. Invite links still opens from Invite with a link; the links page is unchanged.
- **Fixture:** `TopicsSection.fixture.tsx` needed no edit: it only imports `TopicsList`, and it still typechecks after the stack moved.
- `GroupPanel.tsx` is 329 lines; every changed file is under 400.
- **Fix round 1 (lead's 1440 px screenshot):** `ListRow` gained an optional `leading` prop that paints a plain leading element with no key tile (`icon` is unchanged), so the "People and AIs" row now passes its 18 px stack as `leading` and the label is no longer covered; the row's total is an explicit `font-mono text-[12px]` span in `trailing`.
- **Fix round 2 (lead's People and AIs page screenshot):** `PeoplePage` now draws the topic panel's counted section headings — "AIs" with the AI count, then "People" with the member count directly above the search field. It uses a local `SectionHeading` with the topic panel's classes (`px-0.5 text-[12px] font-semibold text-muted-foreground`, count in `font-mono font-normal`). `GroupAiSection` still renders its own plain "AIs" label and is outside this task's Allowed files, so the page hides that inner label (`[&>section>h2]:hidden`) and draws the counted one instead.

### Checks run

```
$ pnpm gate
gate: 6 changed file(s) against main
PASS  install (frozen)  (2.3s)
PASS  format  (0.9s)
PASS  lint  (1.3s)
PASS  typecheck  (2.0s)
PASS  effect  (2.0s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

I ran no single test files: the task asks for no tests, and the gate reports no nearby test files for `@zilar/web`. I did not run the app or look at the rendered panel.

Fix round (same command, after the `leading` change):

```
$ pnpm gate
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.5s)
PASS  lint  (0.8s)
PASS  typecheck  (2.8s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Fix round 2 (same command, after the headed sections):

```
$ pnpm gate
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.0s)
PASS  lint  (0.7s)
PASS  typecheck  (4.0s)
PASS  effect  (0.9s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- The fix round resolved the earlier tile-overflow note: `ListRow` now takes a tile-less `leading` element, and the People and AIs row uses it, so the stack no longer covers the label.
- No deviations from the Spec otherwise.

## Review (written by Claude)

Merged on 2026-10-17 at HEAD `091047cf3`, after two lead fix rounds from screenshots:
1. the avatar stack overflowed `ListRow`'s 32 px tile and covered the label; it now has a `leading` slot;
2. the page had no "People" heading and no counts; it now has `AIs 2` and `People 4` like the topic panel.
- **The mock check** ran on the branch in vite at 1440 px, in Dev team's Group info:
  - one row: the stack, "People and AIs", a mono 6 and a chevron;
  - the page: AIs (Dev-1, QA-1, Add my AI), People with search, Add members, Invite with a link and the 4 members, then Roles.

