---
id: T-1786
title: "Topic people W7 (web): the group info screen lists 'Your topics' and 'Other topics' (rows with glyph/lock, subtitle, avatar stack, muted icon; Join on other topics) — plus the web joinTopic client path and the mock join route"
status: merged
milestone: M5
branch: task/T-1786-web-group-topics
model: auto
effort: default
depends_on: [T-1777]
estimate: 45 min
---

# T-1786: Web group screen with Your topics and Other topics

## Spec (written by Claude, do not edit)

### Why
This is plan item **W7** (`docs/plan/topic-people.md` §3.5, §3.6 and §4), from the approved board `docs/design/mockups/topic-people/WebGroup.dc.html:66-104`.
- **Your topics:** General, plus the topics the caller is in.
- **Other topics:** the group's public topics the caller hasn't joined, each with a **Join** key.

The server already has `POST /api/topics/:id/join` (T-1760). The web app has no client call for it yet.

### Facts (read by the lead on 2026-10-17)
- **The group screen root:** `apps/web/src/components/group-info/GroupInfoRoot.tsx` (293 lines), props at `:61-95`, rendered by `apps/web/src/components/GroupPanel.tsx:177-193` (359 lines).
  - Today it has a "People" nav with Members, AIs and Invite links rows (`:194-220`) and **no topics list**.
  - `chat` is the group's chat row, and `chat.groupId` is the group.
- **The topics of a group** are the chat rows with the same `groupId` and a `topic` (`useChatSelector((s) => s.chats)`). The chat list already groups and sorts them this way: `apps/web/src/components/chatList/ChatListBody.tsx:140-150` and `sortTopics` in `packages/chat-core/src/topics.ts:33`.
  - A row has `title`, `muted` (`packages/chat-core/src/types.ts:202`) and `topic` (`isGeneral`, `visibility`, `memberIds?`, `ais?`).
- **Joined:** `isTopicJoined(topic, userId)` (`packages/chat-core/src/topics.ts:57-62`, T-1764). The caller's id is `useChatSelector((s) => s.currentUserId)` (as in `panels/topicPanelOps.ts:41`).
- **New topic:** `apps/web/src/components/NewTopicDialog.tsx:57-64` (`groupId`, `onClose`).
- **The join route:** `HttpApiEndpoint.post('join', '/topics/:id/join', …)`, which returns a `Topic` (`packages/api-contract/src/topics.ts:326-329`).
- **The web add path to mirror for join:**
  - `apps/web/src/lib/api/topics.ts:107` (`addTopicMember`), exported through `apps/web/src/lib/api.ts`;
  - the port at `apps/web/src/store/effects/portTypes.ts:103` and `ports.ts:176`;
  - the effect at `apps/web/src/store/effects/topics.ts:102-112` (`changeTopic`);
  - the action at `apps/web/src/store/effects/groupActions.ts:97`;
  - the type at `apps/web/src/store/groupStoreTypes.ts:55`;
  - the test harness stub at `apps/web/src/test/storeHarness.ts:182`.
- **The mock backend:** `packages/mock-backend/src/domains/topics/routes.ts:170-191` handles the members POST and has no join route.
- **The board** (`WebGroup.dc.html`):
  - `.sec` "Your topics" / "Other topics" (`:23`: 12px/600, `#a1a1a1`);
  - rows `.row` (`:20`: min-height 50, gap 10, 14 px);
  - `.tg` glyph tile (`:34`: 32 px, radius 10, `#171717`, holding `#` or a lock for private);
  - a two-line name and subtitle;
  - an optional muted icon (`:82`: 14 px, lucide `BellOff`, `#8a8a8a`, `aria-label="Muted"`);
  - an avatar stack (`.st` at `:24-26`: 20 px, a 2 px `#111111` ring, −6 px);
  - a "New topic" row at the end of Your topics (`:85-88`);
  - **Join**: a light key, 28 px high, radius 8, 13px/500 (`:99`).
- **Subtitles:** General is "Everyone". Other topics read "{N} people · {first AI}" (with no AI part when there are none). A private topic names up to 2 people by first name, then "· {first AI}".

### Steps
1. **The join client path** (web + mock):
   - `joinTopic(id)` in `lib/api/topics.ts`, exported from `lib/api.ts`;
   - the port in `portTypes.ts` and `ports.ts`;
   - a `joinTopic` effect in `store/effects/topics.ts` that mirrors `addTopicMember` (`changeTopic`, then refresh the row);
   - `joinTopic: (chatId: string) => Promise<void>` in `groupStoreTypes.ts` and `groupActions.ts`;
   - the harness stub;
   - a mock `POST /topics/:id/join` in `routes.ts` that adds the caller to the topic's members and returns the topic view, like `addTopicMember`.
2. **A new `apps/web/src/components/group-info/TopicsSection.tsx`,** drawn to the board, rendered in `GroupInfoRoot` under the People nav.
   - "Your topics" holds General plus the joined topics, sorted with `sortTopics`, then the "New topic" row, which opens `NewTopicDialog`.
   - "Other topics" holds the rest of the public topics, each with Join, and is hidden when empty.
   - **A row** opens the topic, the way `ChatListBody` opens one, and closes the panel.
   - **Join** shows a busy state, calls `joinTopic`, and on failure shows a muted "Couldn't join" on the row.
   - The stack shows up to 4 people (from `memberIds`, via `groupInfo` for names and pictures; seed = display name), then AIs.
3. Keep `GroupInfoRoot.tsx` and `GroupPanel.tsx` at most 400 lines. `TopicsSection` owns its own reads.
4. **A new Cosmos fixture,** `apps/web/src/components/group-info/TopicsSection.fixture.tsx`, with static rows: General, a public topic, a muted private one and two Other topics.
5. **No tests** (UI and plumbing). The server's join is already tested.

### Allowed files
- `apps/web/src/components/group-info/TopicsSection.tsx`
- `apps/web/src/components/group-info/TopicsSection.fixture.tsx`
- `apps/web/src/components/group-info/GroupInfoRoot.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `apps/web/src/lib/api/topics.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/store/effects/portTypes.ts`
- `apps/web/src/store/effects/ports.ts`
- `apps/web/src/store/effects/topics.ts`
- `apps/web/src/store/effects/groupActions.ts`
- `apps/web/src/store/groupStoreTypes.ts`
- `apps/web/src/test/storeHarness.ts`
- `packages/mock-backend/src/domains/topics/routes.ts`
- `work/T-1786-web-group-topics.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The web group screen shows Your topics and Other topics like the board, and Join works (in mock mode too).
- Muted topics show the icon.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

**1. The join client path (web + mock).**
- `apps/web/src/lib/api/topics.ts`: added `joinTopic(id)` calling `client.topics.join`, exported from `apps/web/src/lib/api.ts`.
- `apps/web/src/store/effects/portTypes.ts` + `ports.ts`: added `joinTopic` to `ApiClient` and to `realApi`.
- `apps/web/src/store/effects/topics.ts`: added the `joinTopic` effect mirroring `addTopicMember` (`changeTopic`, so the row is repainted from the server's answer).
- `apps/web/src/store/groupStoreTypes.ts`: added `joinTopic: (chatId) => Promise<void>`.
- `apps/web/src/store/effects/groupActions.ts`: added `joinTopic` to the `GroupActions` pick and the returned slice (`rt.runPromise(joinTopic(ctx, chatId))`).
- `apps/web/src/test/storeHarness.ts`: added the `joinTopic` stub.
- `packages/mock-backend/src/domains/topics/routes.ts`: `POST /topics/:id/join` → `joinTopicRoute`, which adds the caller (`data.me.id`) to `topic.memberIds` and answers the topic view, like `addTopicMember`.

**2. `apps/web/src/components/group-info/TopicsSection.tsx` (new).** It owns its reads (`s.chats`, `s.groupInfo(chat.id)`, `s.currentUserId`), filters the group's non-archived topic rows, and splits them with `isTopicJoined(topic, me)` (chat-core, T-1764):
- **Your topics** — General plus joined topics, `sortTopics`, then a **New topic** row (key-icon tile) that opens `NewTopicDialog`.
- **Other topics** — the public topics the caller has not joined, `sortTopics`, each with a **Join** key; the whole section is hidden when empty.
- **A row** opens the topic with `useNavigate('/c/<id>')` and closes the panel.
- **Join** (`JoinKey`, house `useAction`) shows a spinner/`Joining…`, calls `joinTopic`, and on failure shows a muted "Couldn't join" on the row.
- Row: flat 32 px glyph tile (`#`/glyph, or a lock for private), a two-line name + subtitle, a 14 px `BellOff` (`aria-label="Muted"`) when muted, and a 20 px overlapping avatar stack (2 px `border-surface` ring, −6 px): up to 4 people from `memberIds` (names/pictures from `groupInfo`, seed = display name), then the topic's AIs.
- Subtitles: General "Everyone"; a public topic "{N} people · {first AI}" (N = `memberIds.length`, AI part omitted when none); a private topic its first two people by first name, then "· {first AI}".
- Split into a presentational `TopicsList` (+ `TopicRow`) so the Cosmos fixture can paint static rows without a store.

**3. `GroupInfoRoot.tsx`** renders `<TopicsSection chat={chat} onClose={onClose} />` under the People nav. `GroupInfoRoot` is 297 lines; `GroupPanel.tsx` needed no change (359 lines, untouched); `TopicsSection.tsx` is 314 lines.

**4. `TopicsSection.fixture.tsx` (new).** Static rows: General, a public topic ("Financial · Deepseek"), a muted private one ("Design, lock, muted"), and two Other topics ("Marketing · Claude", "Random") with Join keys; plus a "Your topics only" case.

**5. No tests** (UI and plumbing, per the spec).

### Checks run

```
pnpm gate
gate: 13 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (1.1s)
PASS  typecheck  (4.0s)
PASS  effect  (0.8s)
SKIP tests @zilar/mock-backend (no nearby test files)
PASS  tests @zilar/web  (5.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The first run failed only on `format` for `TopicsSection.tsx` and `effects/topics.ts`; I ran `prettier --write` on those two files and re-ran, which passed. No other single test files were run (the spec says no tests). Changed files: the 11 Allowed source files plus the two new ones (`TopicsSection.tsx`, `TopicsSection.fixture.tsx`) and the task file.

### Notes for the lead

- **Other topics is empty with today's data, by design outside this task.** The web split is driven by `memberIds` (`isTopicJoined`), which is correct against the server (contract `topics.ts:234-236`: General = whole group, any other topic = its `topic_members` + role holders). But the mock's public-topic view (`view.ts` `groupMemberIds`) lists *every* group member, and the server's `PUBLIC_TOPICS_START_EMPTY` (T-1762) is still `false` on main. So no public topic currently reads as "not joined": the Your/Other split renders, but Other topics only fills once the Join UI batch (W9/W10) flips the flag, or the mock read model is aligned. The Cosmos fixture shows the Other-topics rows with Join. I did not touch `view.ts`/the flag (outside the Allowed files).
- `groupActions.ts` imports `joinTopic` straight from `./topics` because the `./groups` barrel is not in the Allowed files.
- The plan (§3.6) mentions a `Topic.joined` field; the contract has no such field, so I used `isTopicJoined` as the Spec's Facts direct (T-1764).
- A **row opens with `navigate` + `onClose`** rather than a `<Link>` (which cannot close the panel); `ChatView` also resets the panel when the chat changes.
- Only manager-archived topics (`topic.archived`) are excluded; a per-user-archived topic still shows under Your topics (the info screen lists memberships). Say the word if it should hide instead.
- TopicsSection only renders for groups (channels use `ChannelPanel`).

### Round 1 (fix round)

Findings from `PREREVIEW.md`.

**Fixed**
- **Finding 1 (should-fix).** `packages/mock-backend/src/domains/topics/routes.ts`: `joinTopicRoute` now mirrors the real route (`apps/server/src/topics/members.ts:186-193`): General answers `400 is_general` ("Everyone in the group is in General") and never writes; a private topic is a no-op answering the unchanged topic view and never writes; only a real public join adds `data.me.id`.

**Left alone**
- Findings 2 and 3 are nits and are not in lines this round changed, so I did not touch them (per the fix-round rule).

**Tests**
- No test file added. The only changed behaviour is in the mock backend, which is not crucial code (AGENTS.md "Tests" section), the task's Spec says "No tests", and a topics test file (`packages/mock-backend/src/domains/topics/routes.test.ts`) is not in this task's Allowed files, so adding one would be scope creep (AGENTS.md: "no files outside scope"). The finding names no test.

**Commands**
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot`: 2 files, 7 tests passed (1.6s).
- `pnpm gate` (from the repo root):
  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.2s)
  PASS  lint  (1.6s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/web  (7.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Round 2 (fix round)

Findings from `PREREVIEW.md` (must-fix=0, should-fix=1, nit=2).

**Fixed**
- **Finding 1 (should-fix).** The route half of this finding was already
  satisfied at HEAD, so I verified it rather than re-doing it:
  `packages/mock-backend/src/domains/topics/routes.ts:167-180`
  (`joinTopicRoute`, added in round 1, commit `c09fc12b7`) already mirrors the
  real route (`apps/server/src/topics/members.ts:188-193`) — General answers
  `400 is_general` ("Everyone in the group is in General") and never writes, and
  a private topic is a no-op that answers the unchanged topic view and never
  writes; only a real public join appends `data.me.id`.
- The remaining still-true part of finding 1 is its last sentence: the comment at
  `apps/web/src/lib/api/topics.ts:111-112` still read "The server treats a
  private or General topic as a no-op and rejects General". Reworded to
  "A private topic is a no-op (its members already see it); General is rejected
  (400 is_general)." (`apps/web/src/store/effects/topics.ts:114-116` was already
  accurate, so it is untouched.)

**Left alone**
- Findings 2 and 3 are nits. Only the comment that finding 1 itself quotes was
  changed; nothing else from the nits was touched.

**Tests**
- None added. The only behaviour fix (the mock `joinTopicRoute` guards) is
  byte-for-byte the same as round 1, in mock-backend code, which is not crucial
  code (AGENTS.md "Tests"), and the Spec says "No tests (UI and plumbing)". There
  is no Allowed test path: `packages/mock-backend/src/domains/topics/` has no
  `*.test.ts`, and a new file would fall outside the Allowed files and fail the
  gate's scope check. The finding names no test.

**Disagreements**
- None. Finding 1 is correct about the pre-round-1 state; this round only
  finished its comment half.

**Commands**
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot`: 2 files,
  7 tests passed (774ms).
- `pnpm gate` (from the repo root):
  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/web  (3.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

Note: this session found the round-1 fix already committed on the branch
(`git log main..HEAD` showed `c09fc12b7` and `b6c7e5680`), so finding 1's route
half needed no new commit; only its comment half did.

### Lead round

The lead asked for the mock join at `packages/mock-backend/src/domains/topics/routes.ts`
to match the real server (`apps/server/src/topics/members.ts:186-192`). I verified
`joinTopicRoute` already does exactly that, so no code change was needed:

- **General** → `badRequest('is_general', 'Everyone in the group is in General')`.
  `badRequest` (`packages/mock-backend/src/http/shared.ts:58-60`) renders
  `{ error: { code, message } }` with status 400, the same shape as the file's
  other 400s, and writes nothing.
- **Private** → `jsonResponse(topicView(data, topic))`: the unchanged topic view,
  no member added, no write.
- **Public, non-General** → appends `data.me.id` only when absent and answers the
  updated view.

One commit: `T-1786: mock join follows the server's guards` (it records this
verification; the guard lines were already at HEAD from the earlier fix round).

`pnpm gate` (repo root): `GATE PASS` — install/format/lint/typecheck/effect PASS,
mock tests SKIP (no nearby test files), web tests PASS (5.2s), scope clean.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `38bcd63f3`, after two autopilot rounds and one lead round.
- **Cosmos `TopicsSection` (Default) vs `WebGroup.dc.html:66-104`:** Your topics (General "Everyone", Financial "4 people · Deepseek", the private Design with a lock, the muted icon and named people), New topic, then Other topics with light Join keys and stacks. They match, with two small differences left as is:
  - the tile shows the topic's initial, like the chat list, where the board shows "#";
  - the muted icon is `BellOff`, where the board draws a speaker.
- **Join:** the client path goes API → port → effect (`changeTopic`) → action. The mock join follows the server's guards (General 400 `is_general`, private is a no-op).
- **Follow-ups:**
  - the mock's public topics list every group member, so Other topics stays empty in mock mode until the W9/W10 flip;
  - the `groups.ts` barrel lacks a `joinTopic` re-export.
