---
id: T-1789
title: "Topic people W6b (phone): the 'Add people or AIs' key opens a new topic-add-sheet.tsx drawn like PhoneAdd.dc.html (People/AIs, search, In <group> with Add or Here, Your contacts / Your other AIs '+ joins <group>', New AI); drop the unused listTopicAis read"
status: merged
milestone: M5
branch: task/T-1789-phone-topic-add-sheet
model: auto
effort: default
depends_on: [T-1785]
estimate: 45 min
---

# T-1789: Phone In this topic, part 2 (the Add sheet)

## Spec (written by Claude, do not edit)

### Why
This is plan item **W6**, part 2 (`docs/plan/topic-people.md` §3.4 and §4). The approved board is `docs/design/mockups/topic-people/PhoneAdd.dc.html` (390 × 844).
- Part 1 (T-1785, merged) added the primary key behind an `onAdd` prop that the host doesn't pass yet.
- The web twin is T-1784.

### Facts (read by the lead on 2026-10-17)
- **The sheet and its host:**
  - `apps/mobile/src/components/chat/topic-info-sheet.tsx` takes `onAdd?: () => void` (`:116`) and renders the Add key when it is set (`:199`);
  - `apps/mobile/src/components/chat/topic-info-host.tsx` (153 lines) renders the sheet and doesn't pass `onAdd`.
- **The unused read (T-1785 review, F1):** `apps/mobile/src/components/chat/use-chat-screen.ts:249-252` still calls `listTopicAis` on every info open, and nothing renders `infoAis` any more (`:86`, `:309`). Remove that read and the `infoAis` state, and remove its pass-through if the host still passes it.
- **The data:**
  - the group detail: `useChatStore((state) => state.groupDetail(groupId))`, with `members[].userId/name/handle?/avatarUrl?/role` and `ais[].aiId/name/ownerId/avatarUrl?`;
  - my AIs: `useChatStore((state) => state.ownedAis)` (`apps/mobile/src/store/types-groups.ts:72`);
  - contacts: `useChatStore((state) => state.contacts)` (`apps/mobile/src/store/types.ts:70`; `Contact { userId, name, jid, avatarUrl?, handle? }`);
  - the topic's people and AIs: `chat.topic.memberIds`, `chat.topic.ais`;
  - the caller: `currentUserId`;
  - a manager is a group member whose `role` is `owner` or `admin`.
- **The adds:** `addTopicMember(chatId, userId)` and `addTopicAi(chatId, aiId)` in the store (`types-groups.ts:86,90`). Since T-1769 the server adds the group half first, but only for a group owner or admin. Anyone else gets 403.
- **The board** (`PhoneAdd.dc.html:40-87`):
  - the title "Add to {topic}" with Close;
  - a segmented People/AIs control;
  - a search well ("Search people" / "Search AIs");
  - "IN {GROUP}" rows, either with a light **Add** key or with a muted "Here" tick when already in the topic;
  - "YOUR OTHER AIS" (AIs tab) or "YOUR CONTACTS" (People tab) rows with a `+ joins {group}` mono tag and Add;
  - a "New AI" row with a chevron (AIs tab).
- **The primitives:** `apps/mobile/src/components/ui/bottom-sheet.tsx` (`BottomSheet`); the avatar is `apps/mobile/src/components/chat/avatar.tsx` (seed = display name, the real picture when there is one).

### Steps
1. **A new `apps/mobile/src/components/chat/topic-add-sheet.tsx`,** drawn to the board, opened from the host with `onAdd`.
   - **People tab:**
     - "IN {GROUP}": the group's members, other than me, each with Add, or "Here" when already in `memberIds`;
     - then, **only for a manager**, "YOUR CONTACTS": contacts who aren't in the group, with `+ joins {group}`.
   - **AIs tab:**
     - "IN {GROUP}": the group's AIs, with Add or "Here" (in `topic.ais`). Show an owner label like the board ("Marta's"; none for my own).
     - Then, **only for a manager**, "YOUR OTHER AIS": `ownedAis` not in the group, with `+ joins {group}`.
     - Then "New AI", which navigates to the existing new-AI route. Find it with `git grep -n "new-ai" apps/mobile/src/app`; hide the row if there is none.
   - **Search** filters by name or handle, case-insensitively.
   - **Add** shows a busy state, then "Here" on success or "Couldn't add" on failure.
2. **`topic-info-host.tsx`:** pass `onAdd` to open the Add sheet, and render the sheet.
3. **`use-chat-screen.ts`:** drop the `listTopicAis` read and the `infoAis` state (F1).
4. Keep every file at most 400 lines.
5. **The dev catalog:** append a static example of the sheet's two tabs to `apps/mobile/src/mock/dev-topic-header-screen.tsx`, so the lead can screenshot them.
6. **No tests.**

### Allowed files
- `apps/mobile/src/components/chat/topic-add-sheet.tsx`
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/mobile/src/mock/dev-topic-header-screen.tsx`
- `apps/mobile/src/mock/dev-topic-add-screen.tsx`
- `work/T-1789-phone-topic-add-sheet.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On the phone, In this topic's "Add people or AIs" opens the board's sheet. Add works, and people or AIs already in the topic read "Here".
- Only managers see contacts and AIs from outside the group.
- No more `listTopicAis` read on info open.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/chat/topic-add-sheet.tsx` (400 lines), drawn to
  `PhoneAdd.dc.html`:
  - `TopicAddSheet` is the `BottomSheet` shell with the "Add to {topic}" title and the
    standard Close key; `TopicAddContent` is its body so the dev catalog can render both
    tabs inline.
  - People tab: the group's members other than the caller under "IN {GROUP}", each with a
    light Add key or the green "Here" mark when in `topic.memberIds`; managers also get
    "YOUR CONTACTS" (contacts not in the group) with a mono `+ joins {group}` tag.
  - AIs tab: the group's AIs with Add / "Here" and the board's owner label ("Marta's", none
    for the caller's own AIs); managers also get "YOUR OTHER AIS" (`ownedAis` not in the
    group) with `+ joins {group}`. The board's "New AI" row is left out: `git grep -n
    "new-ai" apps/mobile/src/app` finds no route (the new-AI sheet lives in the AIs tab),
    which the spec says means hiding the row.
  - One search well per tab ("Search people" / "Search AIs") filtering by name or handle,
    case-insensitively; per-row Add shows "Adding…", then "Here" on success or a retryable
    "Couldn't add" (the Add key stays).
- `topic-info-host.tsx`: passes `onAdd` (closes the info sheet, opens the Add sheet) and
  renders `TopicAddSheet` with `detail`, contacts, `ownedAis`, `addTopicMember` and
  `addTopicAi`. `isManager` is `mayManageRoles(detail member role)` (owner or admin).
- `topic-info-sheet.tsx`: exported `aiOwnerLabel` and added an optional `mineLabel` (the Add
  sheet passes `null`, so the caller's own AIs show no label, as on the board).
- `use-chat-screen.ts`: removed the `listTopicAis` subscription, the `infoAis` state, its
  `openInfo` read and its return value (T-1785 review F1). `infoMembers` stays: it feeds
  `isPrivateMember`.
- `dev-topic-header-screen.tsx`: appended an "Add people or AIs" section with both tabs
  rendered from `TopicAddContent` and the board's sample data (JULITO, Marta, Luis,
  Deepseek, Claude, GLM, Ana/Pablo), for the lead's screenshots.
- Set the task status to `review`; no other files touched.

### Checks run

- `pnpm gate` (from the repo root, once):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/mobile  (0.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run: the spec says "No tests", and UI code gets no tests here;
  `pnpm gate` ran the mobile package's existing tests (PASS).

### Notes for the lead

- **New AI row:** hidden, per the spec's conditional — there is no new-AI route in
  `apps/mobile/src/app`; `git grep` only matches the `NewAiSheet` component used by the AIs
  tab. Re-adding the row needs a route or a way to open that sheet from the chat screen.
- **Outside-group sections wait for the group detail:** contacts and "Your other AIs" only
  render once `detail` is loaded, so a manager never sees a contact as "not in the group"
  merely because the member list has not arrived (the web twin does the same).
- **Sheet switch:** opening Add closes the info sheet first, one native sheet at a time, the
  same pattern the host already uses for the AI-memory sheet. Closing Add returns to the
  chat, not to the info sheet; the board's Close links back to the info mockup but the spec
  only asks for the sheet to open from the key.
- **No visual run:** I could not run the phone app here; the dev catalog addition is the
  screenshot surface. Everything else was checked through the gate (format, lint, typecheck,
  effect, mobile tests) only.

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `5232e3d10`.
- **`topic-add-sheet.tsx` (400 lines, at the cap):**
  - People and AIs tabs;
  - "In {group}" rows, with Add or "Here";
  - contacts and other AIs marked `+ joins {group}`, for managers only;
  - New AI.
- The host opens the sheet through `onAdd`.
- **F1 from T-1785 is done:** the `listTopicAis` read and the `infoAis` state are gone from `use-chat-screen.ts`.
- **`topic-add-sheet.tsx` is full:** any later change must split it first.
- **The emulator check is still to do.**

