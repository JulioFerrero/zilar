---
id: T-1882
title: "People and AIs page: tapping a member's or a group AI's avatar/name opens them — phone MembersList + GroupAisList via PersonPressable, web GroupAiRowView via PersonLink (web members already link); self stays plain"
status: merged
milestone: M5
branch: task/T-1882-people-page-links
model: auto
effort: default
depends_on: [T-1858, T-1859]
estimate: 25 min
---

# T-1882: People and AIs rows open the person

## Spec (written by Claude, do not edit)

### Why
**Julio's easy-life pass (2026-10-17):** "clicking in the circles or profile pictures" should open the person everywhere.
- **What already links:** messages, topic sheets and @mention chips on both platforms (T-1851, T-1859, T-1861, T-1877), and web group members (`apps/web/src/components/group-info/MemberRow.tsx`, T-1851).
- **Still dead:** the rows of the new combined People and AIs page (T-1857, T-1858) on the phone, and the group AI rows on the web.

### Facts (read by the lead on 2026-10-17)
- **Phone:**
  - `apps/mobile/src/components/group-info/members-list.tsx` (95 lines): each member row is a `View` holding `EntityAvatar` (`:56`), a name/handle column (`:57-77`), and an optional ⋮ `IconButton` (`:78-88`). `GroupMember` has `userId`, `name` and `handle?`.
  - `apps/mobile/src/components/group-info/ais-list.tsx` (191 lines): each AI row has `EntityAvatar person={{ id: ai.jid, … }}` (`:76-80`), the name `Text` (`:81-83`) and an optional ⋮ key.
  - `PersonPressable({ target, name, children })` (`apps/mobile/src/components/chat/person-pressable.tsx`) opens a contact's or my own AI's DM, or `/u/<handle>`. It renders plain children for me and for unknown people, and forwards a long hold to the message menu only when one exists.
- **Web:**
  - `apps/web/src/components/panels/GroupAiRowView.tsx` (77 lines): the row `div` holds `EntityAvatar person={{ id: ai.jid, … }}` (`:37`), then the name and badge column (`:38-44`).
  - `PersonLink({ target, name, className, children })` (`apps/web/src/components/personLink.tsx:107`) is used the same way in `MemberRow.tsx`.
- **The topic AI type** (`TopicAi`, `packages/api-contract/src/topics.ts:171-176`) has no JID, so the topic panel's AI rows are out of scope.

### Steps
1. **Phone `members-list.tsx`:** wrap the avatar and the name column in one `PersonPressable target={{ userId: member.userId, handle: member.handle }} name={member.name}`. Keep the layout: the pressable takes `flex-1 flex-row items-center gap-3` (pass a `className` prop through, or wrap in a `View` with those classes inside). The ⋮ key stays outside it.
2. **Phone `ais-list.tsx`:** the same for the avatar and name, with `target={{ jid: ai.jid }}`.
3. **Web `GroupAiRowView.tsx`:** wrap the avatar and the name column in `PersonLink target={{ jid: ai.jid }} name={ai.name} className="flex min-w-0 flex-1 items-center gap-2"`. The extra keys stay outside it.
4. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/components/group-info/members-list.tsx`
- `apps/mobile/src/components/group-info/ais-list.tsx`
- `apps/mobile/src/components/chat/person-pressable.tsx`
- `apps/web/src/components/panels/GroupAiRowView.tsx`
- `work/T-1882-people-page-links.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **On the phone People and AIs page,** tapping a member or an AI (avatar or name) opens them; my own row stays plain; the ⋮ keys still open their menus.
- **On the web group AI rows,** clicking the avatar or name opens the AI.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **Phone `members-list.tsx`:** wrapped the avatar and the name/role column in one
  `PersonPressable` (`target={{ userId, handle }}`, `name={member.name}`) with
  `className="min-w-0 flex-1 flex-row items-center gap-3"`. The ⋮ `IconButton`
  stays outside. React keys and all layout classes are unchanged.
- **Phone `ais-list.tsx`:** the same wrapper for the AI avatar and name, with
  `target={{ jid: ai.jid }}`. The ⋮ key stays outside.
- **Phone `person-pressable.tsx`:** added an optional `className` prop and passed
  it to the inner `Pressable`, as the spec allows (needed so the pressable takes
  `flex-1` row layout). No other behaviour changed: self and unknown people still
  render plain children, and the message-menu long press is still forwarded.
- **Web `GroupAiRowView.tsx`:** wrapped the avatar and the name/"Added by" column
  in `PersonLink target={{ jid: ai.jid }} name={ai.name}` with
  `className="flex min-w-0 flex-1 items-center gap-2"`; `extra` and the remove
  controls stay outside.

### Checks run
- `pnpm install` — done, 20.1s, only the pre-existing `@types/react-dom` peer warning.
- `pnpm gate` — first run: `FAIL format` on
  `apps/web/src/components/panels/GroupAiRowView.tsx`; fixed with
  `pnpm exec prettier --write` on that one file.
- `pnpm gate` (final):
  ```
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.2s)
  PASS  lint  (1.4s)
  PASS  typecheck  (6.8s)
  PASS  effect  (1.4s)
  PASS  tests @zilar/mobile  (2.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No tests were added or run individually (UI-only change; the gate's mobile tests
  passed). Behaviour on a device was not smoke-tested by me.

### Notes for the lead
- `PersonPressable` gained one optional prop (`className`); existing callers are
  unaffected because it defaults to `undefined`.
- The largest touched file is `ais-list.tsx` at 198 lines.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `337924397`.
- **Web mock check** at 1440 px: Dev team, Group info, People and AIs; clicking Dev-1's avatar opens the Dev-1 chat.
- **Phone:**
  - the diff wraps the avatar and the name in `PersonPressable` (with a new `className` pass-through), and the ⋮ keys stay outside;
  - a row with no route (me) falls back to the same flex layout.
  - **Not checked on the emulator** (it is off). The tap check is on the next-APK list.

