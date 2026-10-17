---
id: T-1787
title: "Topic people W8 (phone): the group info screen lists 'Your topics' and 'Other topics' (glyph/lock, subtitle, avatar stack, muted icon; Join on other topics) — plus the phone joinTopic client path"
status: merged
milestone: M5
branch: task/T-1787-phone-group-topics
model: auto
effort: default
depends_on: [T-1777]
estimate: 45 min
---

# T-1787: Phone group screen with Your topics and Other topics

## Spec (written by Claude, do not edit)

### Why
This is the phone twin of T-1786 (plan **W8**, `docs/plan/topic-people.md` §3.5, §3.6 and §4). The approved board is `docs/design/mockups/topic-people/PhoneGroup.dc.html:64-107`. The server's `POST /api/topics/:id/join` exists (T-1760), but the phone has no client call for it.

### Facts (read by the lead on 2026-10-17)
- **The root page:** `apps/mobile/src/components/group-info/root-page.tsx` (180 lines), with props at `:24-56`.
  - The Members, AIs and Invite links rows are at `:135-139`.
  - "Shared media", "Pinned", "Tools and routines" and the rest follow.
  - It is rendered by `apps/mobile/src/app/group-info/[id].tsx` (355 lines; `rootProps` at `:157`, `currentUserId` at `:50`).
  - `groupChatId` is the General topic's chat row (`root-page.tsx:25-26`).
- **The topics of a group** are the chat rows with the same `groupId` and a `topic` (`useChatStore((state) => state.chats)`). Sort them with `sortTopics` from `@zilar/chat-core`.
  - A row has `title`, `muted` and `topic` (`isGeneral`, `visibility`, `memberIds?`, `ais?`).
  - Joined is `isTopicJoined(topic, currentUserId)` (`packages/chat-core/src/topics.ts:57-62`).
- **Opening a topic:** `router.push({ pathname: '/chat/[id]', params: { id } })` (as in `apps/mobile/src/components/chat/message-search-list.tsx:111`).
- **New topic:** `NewTopicSheet` (`apps/mobile/src/components/chat/new-topic-sheet.tsx`, used at `apps/mobile/src/app/group/[id].tsx:312`).
- **The add path to mirror for join:**
  - `addTopicMember` in `apps/mobile/src/lib/topics-api.ts:117,227`;
  - `apps/mobile/src/store/effects/group-actions.ts:115-121` (`changeTopicCore`);
  - `apps/mobile/src/store/types-groups.ts:90`;
  - and `apps/mobile/src/store/effects/groups.ts`. Grep `addTopicMember` there and mirror whatever it wires.
- **The mock join route** is added by the web twin T-1786 in `packages/mock-backend`. Don't touch the mock.
- **The board** (`PhoneGroup.dc.html:64-107`), at phone sizes:
  - The glyph tile shows `#` or a lock.
  - Name and subtitle ("Everyone" for General; otherwise "{N} people · {first AI}"; a private topic names up to 2 people, then "· {AI}").
  - An optional muted `BellOff` icon.
  - An avatar stack (up to 4: people from `memberIds` via the group detail, seed = display name, then AIs).
  - A chevron.
  - A "New topic" row ends Your topics.
  - Other topics rows carry a light **Join** key. Read the board's sizes.

### Steps
1. **The join client path:**
   - `joinTopic(id): Promise<Topic>` in `lib/topics-api.ts`;
   - `joinTopic: (chatId: string) => Promise<void>` in `types-groups.ts` and `group-actions.ts`, mirroring `addTopicMember` (`changeTopicCore`, then refresh the row);
   - plus whatever `groups.ts` wires for `addTopicMember`.
2. **A new `apps/mobile/src/components/group-info/topics-section.tsx`,** drawn to the board and rendered in `root-page.tsx` under the Members/AIs group.
   - "Your topics" holds General plus the joined topics, then "New topic", which opens `NewTopicSheet`. Add an `onNewTopic` prop to the root page and wire it in `[id].tsx`.
   - "Other topics" holds the unjoined public topics, each with Join (busy state, then "Couldn't join" on failure), and is hidden when empty.
   - Tapping a row opens the topic.
3. Keep every file at most 400 lines. `[id].tsx` is 355 lines, so add only the wiring there.
4. **The dev catalog:** append a static TopicsSection example to the hidden catalog in the existing `apps/mobile/src/mock/dev-topic-header-screen.tsx` (T-1780; rename nothing), so the lead can screenshot it.
5. **No tests.**

### Allowed files
- `apps/mobile/src/components/group-info/topics-section.tsx`
- `apps/mobile/src/components/group-info/root-page.tsx`
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/lib/topics-api.ts`
- `apps/mobile/src/store/types-groups.ts`
- `apps/mobile/src/store/effects/group-actions.ts`
- `apps/mobile/src/store/effects/groups.ts`
- `apps/mobile/src/mock/dev-topic-header-screen.tsx`
- `work/T-1787-phone-group-topics.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The phone group screen shows Your topics and Other topics like the board.
- Join calls the server.
- Muted topics show the icon.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **Join client path** (step 1): `joinTopic(id): Promise<Topic>` in `lib/topics-api.ts`
  (calls the contract's `client.topics.join`, T-1760); `joinTopic(chatId)` in
  `store/types-groups.ts`; the implementation in `store/effects/group-actions.ts`
  mirrors `addTopicMember` (`changeTopicCore`, which repaints the row, so the topic
  moves to Your topics); `store/effects/groups.ts` adds `joinTopic` to the
  `GroupActions` pick so the store type carries it.
- **`components/group-info/topics-section.tsx`** (new): Your topics (General plus the
  joined topics, then a New topic key with an `IconTile` and a `Plus`) and Other
  topics (public, not joined; each with a Join key that shows `Joining…` while busy
  and `Couldn't join` on failure). Rows: a 34 px glyph tile (`#`, or a `Lock` when
  private), name and subtitle ("Everyone" for General, otherwise "N people · <first
  AI>", or 2 names then the AI for a private topic), the muted `BellOff` icon, an
  up-to-4 avatar stack (people first, then AIs; General reads the whole group), and a
  chevron. Drawn to `PhoneGroup.dc.html:64-107`; Other topics is hidden when empty.
- **`root-page.tsx`**: renders `TopicsSection` under the Members/AIs group; new props
  `topics`, `currentUserId`, `groupMembers`, `groupAis`, `onOpenTopic`, `onNewTopic`,
  `onJoinTopic`.
- **`app/group-info/[id].tsx`**: builds the topic props, opens the topic through
  `/chat/[id]`, wires `onJoinTopic` to the store action, and adds the `NewTopicSheet`
  (the group screen's `useGroupNewTopic` hook) behind `onNewTopic`. `mayCreateTopic`
  gates opening the sheet the same way the file already gates its other sheets.
- **`mock/dev-topic-header-screen.tsx`** (step 4): appended a static "Group topics"
  `TopicsSection` example with the board's sample data; nothing renamed.
- No tests (step 5).

### Checks run

- `pnpm gate` (from the repo root), final lines:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (4.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first run failed on `format` for `topics-section.tsx` only; I ran
  `pnpm exec prettier --write apps/mobile/src/components/group-info/topics-section.tsx`
  and re-ran the gate, which passed. No single test files were run (the task says no
  tests; the mobile suite in the gate passed).

### Notes for the lead

- **Data source:** per this task's Facts I read the group's topics from the chat rows
  (`state.chats` + `topicsOfGroup`/`sortTopics`) and split them with
  `isTopicJoined`, not from the plan's `GET /groups/:id/topics` read (§3.5/§2.3). The
  mock join route is T-1786's; I did not touch `packages/mock-backend`.
- **Decisions (not spelled out in the spec):** archived topics (manager- or per-user)
  are hidden from both lists, like the group screen's active list; the New topic row
  is always drawn (like the board) but its key only opens the sheet when the viewer
  may create (`mayCreateTopic`) and the group's own chat row is loaded, matching the
  file's existing "hidden sheet behind a gate" pattern (openLinks/openSettings). The
  sheet's `aiError` toast is not rendered here (the hook navigates to the new chat on
  success, where the topic panel can retry adding an AI); say the word if you want it
  on this screen too.
- I could not run the phone UI myself: the Join button, muted icon, stacks and the
  split are drawn to the board but only verified by reading, not on a device.

### Round 1 (fix round)

Fixing the findings in `PREREVIEW.md` (counts there: must-fix=0, should-fix=1, nit=2).

- **Finding 1 (should-fix) — fixed.** In
  `apps/mobile/src/mock/dev-topic-header-screen.tsx` I dropped `"p1"` from the
  `memberIds` of the Marketing and Random topics (kept on Financial and Design).
  With the section rendered at `currentUserId="p1"`, General, Financial and Design
  are joined ("Your topics") and Marketing and Random are public and unjoined, so
  they now land in "Other topics" with their Join keys — the state step 4 exists to
  let the lead screenshot. Verified by reading `TopicsSection`'s split
  (`topics-section.tsx:296-301`) and `isTopicJoined` (`chat-core/src/topics.ts:57-62`),
  not on a device.
- **Nits left untouched.** Finding 2 (`topics-section.tsx:305,321`, an empty `your`
  renders no New-topic row) and finding 3 (`[id].tsx`, the New topic row is always
  drawn and `onNewTopic` no-ops without create rights) are nits and sit on lines
  this round does not change, so per the round brief they are left as they are.
  Finding 3 is also the deliberate board-faithful choice disclosed in the Report
  above and it fails closed.
- **Tests: none added.** The only fix this round is dev-catalog fixture data, not
  the crucial code the test rule names (auth/keys, permissions, the message
  pipeline); spec step 5 says "No tests", and the finding names no test. A test file
  under `apps/mobile/src/mock/` would also fall outside this task's Allowed files
  and be flagged by the gate's scope check, so no test is added.
- **Gate:** `pnpm gate` from the repo root, final lines:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.3s)
  PASS  lint  (1.3s)
  PASS  typecheck  (5.0s)
  PASS  effect  (1.4s)
  PASS  tests @zilar/mobile  (7.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No single test files were run (no test was added; the task says "No tests" and the
  mobile suite in the gate passed).

### Round 2 (fix round)

Picked up in a fresh session. `git log --oneline main..HEAD` shows the previous round
already landed the one should-fix: commit `a4a3fef49` ("T-1787: fix finding 1 - dev
catalog fixture shows Other topics"), with the "Round 1" section above.

- **Finding 1 (should-fix, `mock/dev-topic-header-screen.tsx`) — already fixed.** The
  Marketing and Random topics no longer list `p1` in `memberIds`; `p1` remains only on
  Financial and Design (plus the member list and `currentUserId="p1"`), so with
  `currentUserId="p1"` General, Financial and Design are "Your topics" and the public
  Marketing and Random land in "Other topics" with their Join keys. Re-verified by
  reading `dev-topic-header-screen.tsx:86-110`, the split in `topics-section.tsx:296-301`
  and `isTopicJoined` (`chat-core/src/topics.ts:57-62`). No code change was needed this
  round.
- **Findings 2 and 3 (nits) — untouched**, as before: they sit on lines this round does
  not change and finding 3 is the deliberate board-faithful, fail-closed choice disclosed
  above.
- **Tests: none added.** The only finding was dev-catalog fixture data, not the crucial
  code the test rule names (auth/keys, permissions, the message pipeline); spec step 5
  says "No tests" and a test file under `apps/mobile/src/mock/` would fall outside the
  Allowed files.
- **Gate:** `pnpm gate` from the repo root, final lines:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/mobile  (3.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No single test files were run (none added). `PREREVIEW.md` was read only and left
  unmodified/untracked.

### Lead round

Lead fix-round request: the catalog's "Group topics" example must show both lists.

- **Fixture:** already correct in the tree. Marketing and Random no longer list `p1`
  in `memberIds`; `p1` stays on Financial and Design
  (`apps/mobile/src/mock/dev-topic-header-screen.tsx:70,82,95,108`). With
  `currentUserId="p1"`, General/Financial/Design are "Your topics" and public
  Marketing/Random are "Other topics" with their Join keys (split at
  `topics-section.tsx:296-301`, `isTopicJoined` at `chat-core/src/topics.ts:57-62`).
  No code change was needed this round.
- **Commit:** `T-1787: catalog example shows Other topics`.
- **Gate:** `pnpm gate` from the repo root:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.4s)
  PASS  lint  (0.8s)
  PASS  typecheck  (0.9s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (6.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- **Tests:** none added (dev-catalog fixture data, not crucial code; spec step 5 says
  "No tests"; a test under `apps/mobile/src/mock/` would be outside the Allowed files).

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `fb52952fe`, after two autopilot rounds and one lead round.
- **Join:**
  - `joinTopic` in `topics-api.ts:233` calls `client.topics.join`;
  - the store action goes through `changeTopicCore`, like the other topic adds.
- **`topics-section.tsx` (341 lines):**
  - Your topics: General plus the joined ones, then New topic;
  - Other topics, each with Join;
  - the muted icon and the avatar stack.
- The catalog example now shows both lists.
- **To watch:** `app/group-info/[id].tsx` is at 397 lines, so the next task that touches it must split it first.
- **The emulator check is still to do.**

