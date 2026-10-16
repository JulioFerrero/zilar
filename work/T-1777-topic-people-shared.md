---
id: T-1777
title: "Topic people shared client data: TopicInfo carries memberIds and the topic's AIs (with avatarUrl); chat-core gains writingLabel and inTopic; the mock backend fills memberIds — the base for the W1–W4 web/phone tasks"
status: merged
milestone: M5
branch: task/T-1777-topic-people-shared
model: auto
effort: default
depends_on: [T-1764]
estimate: 30 min
---

# T-1777: Shared client data for topic people

## Spec (written by Claude, do not edit)

### Why
Julio approved the topic-people flow (`docs/design/mockups/topic-people/`, plan `docs/plan/topic-people.md` §3.1–§3.3). The web and phone tasks W1–W4 need three things that don't exist yet, and they belong in shared packages so the two apps can't drift:
1. **The member data:** each topic chat row's `TopicInfo` must know its people (`memberIds`) and its AIs with pictures. The server sends `Topic.memberIds` and `TopicAi.avatarUrl` since T-1764, but `topicInfoOf` drops them.
2. **`writingLabel`:** the header's "… writing" wording from `PhoneHeader.dc.html`.
3. **`inTopic`:** one check for "is this person or AI in this topic", which the @ list (W3/W4) uses.

### Facts (read by the lead on 2026-10-17)
- **`TopicInfo`** (`packages/chat-core/src/types.ts:158-174`, 287 lines) has `id`, `glyph`, `kind`, `status`, `visibility`, `isGeneral`, `archived`, `doneAt`, `owner`, `linkUrl`, `linkLabel` and `activity`. It has no members and no AIs.
- **The mapper** `topicInfoOf(topic: Topic)` (`packages/client-core/src/store/topic-rows.ts:44-59`, 146 lines) maps the contract `Topic` to `TopicInfo` for both apps. The contract `Topic` has `memberIds?: string[]` and `ais: { id, name, avatarUrl? }[]` (`packages/api-contract/src/topics.ts`, T-1764).
- **`isTopicJoined(topic, userId)`** is in `packages/chat-core/src/topics.ts` (T-1764).
- **`typingLabel`** (`packages/chat-core/src/chat-labels.ts:53-69`, 79 lines) is used by the chat list (`apps/web/src/components/ChatListItem.tsx:87`) and the headers. It stays unchanged.
- **The writing wording** (`docs/design/mockups/topic-people/PhoneHeader.dc.html` and `README.md:20`):
  - one writer: `Deepseek is writing…`;
  - two: `JULITO, Deepseek writing…`;
  - three or more: `3 writing…`.
- **The mock backend** builds topics in `packages/mock-backend/src/domains/topics/view.ts` (110 lines). Its `memberCount` (`:33-41`) uses a private topic's members plus role holders, and the whole group for a public topic. It sends no `memberIds` and no AI `avatarUrl`.

### Steps
1. **`TopicInfo`** gains `memberIds?: string[]` (doc: the people in the topic; General is the whole group) and `ais?: TopicInfoAi[]`, where `TopicInfoAi` = `{ id: string; name: string; avatarUrl?: string }` (doc: the topic's AIs). They're optional, so older payloads and fixtures still typecheck.
2. **`topicInfoOf`** copies `memberIds` (when present) and `ais` (with `avatarUrl` when present).
3. **chat-core:**
   - in `chat-labels.ts`, `writingLabel(names: readonly string[]): string | undefined` follows the board's wording. Use first names the way `typingLabel` does, and `…` is the single ellipsis character;
   - in `topics.ts`, `inTopic(topic: { isGeneral: boolean; memberIds?: readonly string[]; ais?: readonly { id: string }[] }, entity: { kind: 'person' | 'ai'; id: string }): boolean`. General is always true; a person is in when listed in `memberIds`, and an AI when listed in `ais`.
4. **Mock backend:** `view.ts` sends `memberIds`, using the same sets its `memberCount` uses (a private topic's members plus role holders; a public topic's group members). It also sends `avatarUrl` on each AI when the source has one.
   - The source interface `TopicViewSource` (`view.ts:16-24`) and its only implementation `viewSourceFromData` (`view.ts:78-…`) are both in this file. Add a `groupMemberIds(groupId)` accessor (and an AI avatar accessor if the data has one) there.
   - Keep the file at most 400 lines.
5. **Tests (2, the message pipeline / rule):** in `packages/chat-core/src/topics.test.ts`:
   - `inTopic` is true for General, true for a listed person or AI, and false for a group member or group AI who isn't listed;
   - `writingLabel` covers 1, 2 and 3 writers.

### Allowed files
- `packages/chat-core/src/types.ts`
- `packages/chat-core/src/chat-labels.ts`
- `packages/chat-core/src/topics.ts`
- `packages/chat-core/src/topics.test.ts`
- `packages/client-core/src/store/topic-rows.ts`
- `packages/mock-backend/src/domains/topics/view.ts`
- `work/T-1777-topic-people-shared.md`

### Checks
```bash
cd packages/chat-core && pnpm exec vitest run src/topics.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- Every topic chat row on web and phone carries `memberIds` and its AIs with pictures.
- `writingLabel` and `inTopic` are exported from chat-core.
- Mock mode fills the same fields.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

- **`packages/chat-core/src/types.ts`:** added `TopicInfoAi` (`{ id, name, avatarUrl? }`) and two optional `TopicInfo` fields: `memberIds?: string[]` and `ais?: TopicInfoAi[]`, both documented (General is the whole group; absent on old payloads/fixtures).
- **`packages/chat-core/src/chat-labels.ts`:** added `writingLabel(names: readonly string[])` with the board wording: one → `X is writing…`, two → `A, B writing…`, three or more → `N writing…`; `undefined` with no writers. First names via `firstName` (like `typingLabel`), single `…` (U+2026).
- **`packages/chat-core/src/topics.ts`:** added `inTopic(topic, { kind, id })` next to `isTopicJoined`: General is always true; a person is in when listed in `memberIds`; an AI when listed in `ais`; older servers omit the lists, which reads as "not in".
- **`packages/client-core/src/store/topic-rows.ts`:** `topicInfoOf` now copies `memberIds` when present and always maps `ais`, keeping `avatarUrl` only when present.
- **`packages/mock-backend/src/domains/topics/view.ts`:** added `groupMemberIds` and `aiAvatarUrl` to `TopicViewSource` and `viewSourceFromData`; `buildTopicView` now sends `memberIds` (private: `memberIds` + role holders deduped; public/General: the group's people — the same sets `memberCount` uses, people only) and `avatarUrl` on each AI when the source has one. File is 135 lines (limit 400).
- **`packages/chat-core/src/topics.test.ts`:** tests for `inTopic` (General true; listed person/AI true; unlisted group person/AI false) and `writingLabel` (1, 2, 3+ writers, and none).

All exports flow through `chat-core`'s barrel (`export *` of `./types`, `./chat-labels`, `./topics`).

### Checks run

- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/topics.test.ts` → `1 passed (1)` files, `6 passed (6)` tests.
- `pnpm gate` (first run) → `GATE FAIL`, only `format` failed (`[warn] packages/mock-backend/src/domains/topics/view.ts`). Fixed with `pnpm exec prettier --write packages/mock-backend/src/domains/topics/view.ts` (my long line was rewrapped; no other change).
- `pnpm gate` (second run):
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/chat-core  (1.4s)
  PASS  tests @zilar/client-core  (4.8s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  `git status` shows exactly the 7 Allowed files (6 sources + this task file); nothing outside scope.

### Notes for the lead

- Wording follows the spec signature `writingLabel(names)`, not the earlier `docs/plan/topic-people.md` sketch `writingLabel(chat, names)`; the chat arg is unused by the board's wording.
- Mock AI pictures come from the source's `PublicAi.avatarUrl` (as the spec says, "an AI avatar accessor if the data has one"). The mock's separate `avatarUrls` map (written by `PUT /avatars/ai/:id`) is not consulted, matching existing mock behavior where an uploaded AI avatar is not surfaced anywhere yet; seeded AIs carry no picture.
- Mock `memberIds` follows the spec: it uses the mock's own `memberCount` sets. Note the real server's non-General `memberIds` is `topic_members` + role holders even for public topics, while the mock's public/General topics list the whole group; the mock intentionally keeps its simpler public model.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `bb862594a`. The review that stalled at 23:24 was rerun on paid Muse (see T-1778).
- `TopicInfo.memberIds?` and `ais?` (with `avatarUrl?`) are added, and `topicInfoOf` copies them.
- `writingLabel` follows `PhoneHeader.dc.html` (1 named, 2 named, otherwise a count, with first names).
- `inTopic` returns true for General; otherwise a person must be listed in `memberIds`, and an AI in `ais`.
- The mock sends `memberIds` with its own sets. While `PUBLIC_TOPICS_START_EMPTY` is false, prod also gives public topics everyone (T-1762), so mock and prod agree for now.
- I ran `topics.test.ts`: 6 passed.

