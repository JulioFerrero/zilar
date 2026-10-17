---
id: T-1785
title: "Topic people W6a (phone): split the roles block out of topic-info-sheet.tsx, then redraw its top like PhonePeople.dc.html — primary 'Add people or AIs' key (onAdd prop), AIs with an owner label, People listed from memberIds for every topic"
status: merged
milestone: M5
branch: task/T-1785-phone-topic-sheet
model: auto
effort: default
depends_on: [T-1777]
estimate: 45 min
---

# T-1785: Phone In this topic, part 1

## Spec (written by Claude, do not edit)

### Why
This is plan item **W6** (`docs/plan/topic-people.md` §3.4 and §4), part 1. The approved board is `docs/design/mockups/topic-people/PhonePeople.dc.html` (390 px).
- Part 1 splits the sheet and draws the people part.
- Part 2 (the Add sheet) is a later task and plugs into the `onAdd` prop added here.

### Facts (read by the lead on 2026-10-17)
- **The sheet:** `apps/mobile/src/components/chat/topic-info-sheet.tsx` is **371 lines**. It must be split before it grows (plan §3.4).
  - The roles block is `:217-341` (the access rows, the approver picker and their pickers).
  - The top (`:143-210`) has a 44 px avatar, the title, `{group} · Public|Private` and the link row.
  - **Members:** private topics list `members`. Public ones only say "All N members of the group" (`:165-180`).
  - **AIs:** "AIs in this topic (N)", each with an optional memory button (`:182-209`).
- **The host:** `apps/mobile/src/components/chat/topic-info-host.tsx` (153 lines) renders it at `:89`.
- **The data (T-1777):**
  - `chat.topic.memberIds` (user ids; every non-General topic lists its own people);
  - `chat.topic.ais` (`{ id, name, avatarUrl? }`);
  - the group detail is `useChatStore((state) => state.groupDetail(groupId))`, with `members[].userId/name/avatarUrl?` and `ais[].aiId/ownerId`.
  - `chat-header.tsx` (T-1780) already maps `memberIds` to people through the group detail, with the local `memberPerson` (`apps/mobile/src/components/chat/chat-header.tsx:55`). **Move** it into `topic-people-line.tsx` as an export and import it in both places. Don't copy it.
- **The board** (`PhonePeople.dc.html`):
  - `.sec` (`:19`: 13px/600, `#a1a1a1`, label left and mono count right);
  - `.group` (`:17`: `#111111`, a `#1f1f1f` border, radius 14);
  - `.row` (`:18`: min-height 52, gap 12, 16 px text, a `#1a1a1a` divider);
  - `.av` 34 px (`:20`);
  - the `AI` `.badge` (`:22`);
  - the `.primary` key (`:29`: 48 px, radius 14, light);
  - the AI row's owner label ("yours", `:62`), muted, before an options key;
  - the People rows: the caller is marked "(you)".

### Steps
1. **Split first, no behaviour change.** Move the roles block (`:217-341`) and its local state into a new `apps/mobile/src/components/chat/topic-info-roles.tsx` (`TopicInfoRoles`, taking the same props). The sheet renders `<TopicInfoRoles …/>` where the block was.
2. **Redraw the top to the board:**
   - **Header:** topic avatar, name, and a group line with a lock or globe icon.
   - **Add key:** a new optional `onAdd?: () => void` prop. When set, the primary "Add people or AIs" key (lucide `Plus`) shows under the header. The host doesn't pass it yet; part 2 does.
   - **AIs section:** the `.sec` "AIs" plus count, then a `.group` of rows (avatar, name, AI badge), an owner label and the existing memory button as the options key.
     - The owner label is "yours" when `ownerId` is the caller, otherwise "{first name}'s", from the group detail. Omit it when unknown.
   - **People section:** "People" plus count.
     - For a non-General topic, list `memberIds` mapped through the group detail (unknown ids are skipped), with "(you)" on the caller.
     - For General, list the group's members.
     - Drop the private-only "Members (N)" and "All N members of the group" texts.
   - The link row, the error line, the roles and the archive stay as they are, below.
3. **The host:** pass whatever new data the sheet needs (the group detail and my user id are already on `screen`). Don't wire `onAdd`.
4. **No tests.** Every file must end at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/components/chat/topic-info-roles.tsx`
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/components/chat/topic-people-line.tsx`
- `apps/mobile/src/components/chat/chat-header.tsx`
- `work/T-1785-phone-topic-sheet.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The roles block lives in its own file with the same behaviour.
- The sheet's top matches `PhonePeople.dc.html`: header, an optional Add key, AIs with owner labels, and People from `memberIds`.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

**1. Split the roles block out (no behaviour change).**
- New `apps/mobile/src/components/chat/topic-info-roles.tsx` (`TopicInfoRoles`): the old roles block (`topic-info-sheet.tsx:217-341`), its `pickerOpen` / `approverOpen` state, its `RetryRow` helper and the `topicAccessRows` / `approverOptions` / `approverLine` derivations, moved verbatim. Props: `visibility` plus the roles/approver inputs and callbacks. On a non-private topic it renders the unchanged "Roles are only available on private topics." line.
- The sheet renders `<TopicInfoRoles visibility={topic.visibility} … />` exactly where the block was.

**2. Moved `memberPerson` (not copied).**
- `memberPerson(memberId, detail)` now lives in `topic-people-line.tsx` as an export (next to `TopicLinePerson`, its return type); `chat-header.tsx` and `topic-info-sheet.tsx` both import it.

**3. Redrew the sheet top after `PhonePeople.dc.html`.**
- Header: 52 px topic avatar, 20 px name, and a `Lock` (private) / `Globe` (public) group line.
- Add key: a new optional `onAdd?: () => void`. When set, the primary "Add people or AIs" key (`Plus`, `Button variant="key"`, 48 px, radius 14) shows under the header. The host does not pass it (Spec step 3).
- `AIs` section: the `.sec` label + mono count, then a `.group` of 52 px rows — 34 px avatar, name, the `AI` badge, the owner label ("yours" when `GroupAi.ownerId` is the caller, else "{first name}'s", omitted when unknown) and the existing memory button as the options key.
- `People` section: the `.sec` label + mono count; a non-General topic lists `topic.memberIds` mapped through the group detail (unknown ids skipped) with "(you)" on the caller, General lists the group's members. The private-only "Members (N)" and "All N members of the group" texts are gone.
- The link row, the error line, the roles block, the done row and Leave / Archive are unchanged and stay below.

**4. Host.**
- Passes `detail={screen.detail}` and `myUserId={screen.myUserId}`; dropped `members`, `ais` and `aiCount`. AIs now come from `chat.topic.ais` (which carries `avatarUrl`).

Files changed (all inside the Allowed files):
- `apps/mobile/src/components/chat/topic-info-sheet.tsx` (345 lines)
- `apps/mobile/src/components/chat/topic-info-roles.tsx` (new, 223 lines)
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/components/chat/topic-people-line.tsx`
- `apps/mobile/src/components/chat/chat-header.tsx`
- `work/T-1785-phone-topic-sheet.md`

### Checks run

`pnpm gate` (from the repo root) — exit 0:

```text
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (0.6s)
PASS  lint  (1.1s)
PASS  typecheck  (5.6s)
PASS  effect  (2.3s)
PASS  tests @zilar/mobile  (5.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- While working I ran `pnpm exec prettier --check --ignore-unknown` on the changed files (two needed formatting; fixed with `prettier --write` on just those files).
- No single test files were run: this is UI-only and the Spec says no tests (step 4). The gate ran the mobile package's tests.

### Notes for the lead

- **New prop / data source.** The sheet no longer takes `members` / `ais` / `aiCount`. The host passes `detail` and `myUserId`. Consequence: `screen.infoAis` (and its `listTopicAis` load in `use-chat-screen.ts:249-252`) is now unused by the sheet, and `memberIds` replaces the `infoMembers` read. `infoMembers` is still used for `isPrivateMember` and I could not touch `use-chat-screen.ts` (outside the Allowed files); part 2 can drop the now-dead `listTopicAis` load.
- **Header sizes** follow the board (52 px avatar, 20 px name, 14 px group line) rather than the old 44/17/13; the Spec gave no numbers, only "redraw the top to the board".
- **Empty lists.** I kept the existing "No AIs here yet." inline message (the board shows a full list) and added a matching "No people here yet." so an empty `.group` is not just a bare box.
- **Out of scope by design (part 1).** No settings key in the header and no "Tools and routines" row: the Spec's Steps for this task list only the header, the Add key, AIs and People; the plan's settings key / tools row belong to part 2 / a later task. `onAdd` is added but not wired.
- No architecture or security decisions were needed; no dependencies added; no files outside scope touched.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `d18beac75`.
- **The split:** the roles block moved into `topic-info-roles.tsx` (223 lines), and the sheet is now 342 lines.
- **The redraw follows `PhonePeople.dc.html`:**
  - the header, and the Add key (behind `onAdd`, not wired yet);
  - AIs with "yours" or "{name}'s";
  - People from `memberIds` for every non-General topic.
- `memberPerson` moved into `topic-people-line.tsx` and is shared with the header.
- **Part 2 (T-1788) owns both follow-ups:**
  - drop the unused `listTopicAis` read in `use-chat-screen.ts:249-252`;
  - add the "Tools and routines" row.
  - The header's settings key stays out: the phone has no topic settings page.
- **The emulator check is still to do** (with the other phone screens).
