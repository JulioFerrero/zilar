---
id: T-1764
title: "Topic people S2: Topic.memberIds (who is in each topic) and TopicAi.avatarUrl on every topic read, plus a shared isTopicJoined helper, so the group screen can draw stacks and split Your/Other topics"
status: merged
milestone: M5
branch: task/T-1764-topic-member-ids
model: auto
effort: default
depends_on: [T-1762]
estimate: 40 min
---

# T-1764: Topic member ids and AI pictures

## Spec (written by Claude, do not edit)

### Why
The approved boards (`docs/design/mockups/topic-people/PhoneGroup.dc.html`, `WebGroup.dc.html`, `PhoneHeader.dc.html`) draw each topic with:
- a stack of its people's and AIs' pictures;
- a split of the group's topics into "Your topics" and "Other topics".

Today a topic carries only `memberCount` and its AIs' `{id, name}`. This is plan task **S2** in `docs/plan/topic-people.md` §2.3 and §4, with one simplification decided by the lead:
- **`joined` is not a server field.** It is `topic.isGeneral || topic.memberIds.includes(myUserId)`, computed by one shared helper. Every client knows its own user id, and `memberIds` already follows the server's membership rule, so the server read stays caller-free and the 11 `toTopicView` call sites don't change.
- **`muted` is not added either.** Each topic is a chat, and clients already get `chat.muted` from the chat list (for example `apps/mobile/src/components/chat/channel-composer-bar.tsx:120`).

### Facts (read by the lead on 2026-10-17, main after T-1762)
- **The contract** (`packages/api-contract/src/topics.ts`, 316 lines):
  - `TopicAi = mutableStruct({ id, name })` (`:165`);
  - `Topic = mutableStruct({ …, memberCount: Schema.Number, ais: …, roles?, approverRole?, activity? })` (`:205-231`).
  - The optional fields are `Schema.optional(...)`, for older servers.
- **The server types** are `TopicView` and `TopicAiView` (`apps/server/src/topics/types.ts:49-82`; `TopicAiView` is `{ id; name }` at `:79-82`).
- **The builders** in `apps/server/src/topics/views.ts` (351 lines):
  - `buildTopicView` (`:95-128`);
  - `toTopicView` for one topic (`:130-142`), via `countTopicMembers` (`:13-56`) and `listTopicAis` (`:146-158`);
  - `loadTopicViewParts`, batched (`:179-325`). It already loads the group members (`membersByGroup`), the direct `topic_members` rows (`directByTopic`), the role holders (`holdersOf`) and `aisByTopic`, then computes `memberCounts`:
    - General: the group's members plus its AIs (`:295-296`);
    - any other topic: its direct members plus role holders, plus its `topic_ais` (`:297-305`).
  - `toTopicViews` (`:327-351`).
- **AI pictures:** `avatarIdsByOwner(db, 'ai', ids)` and `avatarUrlFor(id)` in `apps/server/src/avatars/service.ts:39-41,250-…`, used the same way by `withAvatars` in `apps/server/src/ais/api.ts:112-127`. They are omitted when the AI has no picture.
- **The phone** keeps its own `Topic` and `TopicAi` interfaces (`apps/mobile/src/lib/topics-api.ts:26-52`) and maps the contract with `toTopic` (`:160-166`).
- **chat-core** has `packages/chat-core/src/topics.ts` (50 lines, `sortTopics`).
- **The size:** a group holds at most 50 people (`GROUP_MEMBERS_MAX = 50`, `packages/api-contract/src/groups.ts:18`), so General's `memberIds` is at most 50 ids.

### Steps
1. **The contract:**
   - `TopicAi` gains `avatarUrl: Schema.optional(Schema.String)`;
   - `Topic` gains `memberIds: Schema.optional(Schema.mutable(Schema.Array(Schema.String)))`, with a doc comment: "T-1764: the people in this topic (General: the whole group; any other topic: its `topic_members` plus role holders). Absent on older servers."
2. **The server types:** `TopicView.memberIds?: string[]` and `TopicAiView.avatarUrl?: string`.
   - `buildTopicView` always sets `memberIds`. It is optional in the type only so the hand-built fixtures in existing tests still typecheck, the same pattern `doneAt?` uses (`types.ts:63-66`). Say so in its comment.
3. **`views.ts`, the batched path:**
   - replace `memberCounts: Map<string, number>` in `TopicViewParts` with `memberIds: Map<string, string[]>`, sorted for a stable order:
     - General gets `[...groupMembers]`;
     - any other topic gets `[...ids]` (the set it already builds);
   - `memberCount` becomes `memberIds.length` plus, for General, the group's AI count and, otherwise, the topic's AI count. The count must be unchanged.
   - In the same pass, collect every AI id in `aisByTopic`, call `avatarIdsByOwner(db, 'ai', ids)` once, and set `avatarUrl` on each AI that has a picture.
4. **`views.ts`, one topic:** make `toTopicView` return `(await toTopicViews(db, [topic], mucDomain))[0]!`, so both paths share one rule.
   - `countTopicMembers` and `listTopicAis` stay exported only if other code imports them (check with `git grep`). Delete what becomes unused.
   - Keep the file at most 400 lines. If it would grow past that, move the avatar step into a new `apps/server/src/topics/view-avatars.ts`.
5. **The phone mirror:** `apps/mobile/src/lib/topics-api.ts`. Its `TopicAi` gains `avatarUrl?: string`, and its `Topic` gains `memberIds?: string[]`. That is optional for the same fixture reason (the mobile store tests build topics by hand), and `isTopicJoined` handles a missing list.
6. **The shared helper:** in `packages/chat-core/src/topics.ts`, add `export function isTopicJoined(topic: { isGeneral: boolean; memberIds?: readonly string[] }, userId: string): boolean`, which returns `topic.isGeneral || (topic.memberIds ?? []).includes(userId)`. `packages/chat-core/src/index.ts:47` already re-exports `./topics`.
7. **Tests (the membership rule, 2):** add them to `apps/server/src/topics/public-reads.test.ts`.
   - `toTopicViews` gives a public non-General topic `memberIds` equal to exactly its `topic_members` people plus a role holder, and gives General every group member.
   - `isTopicJoined` is true for General and for a listed member, and false for a group member who isn't listed. This can be a plain unit check in the same file.

### Allowed files
- `packages/api-contract/src/topics.ts`
- `apps/server/src/topics/types.ts`
- `apps/server/src/topics/views.ts`
- `apps/server/src/topics/view-avatars.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/topics/public-reads.test.ts`
- `apps/mobile/src/lib/topics-api.ts`
- `packages/chat-core/src/topics.ts`
- `work/T-1764-topic-member-ids.md`

`access.ts` is allowed only for its re-export of the view types (`:243-249`). If the typecheck fails in a file outside this list because a fixture builds a `TopicView` or `Topic` by hand, stop and list those files in the Report.

### Checks
```bash
cd apps/server && pnpm exec vitest run src/topics/public-reads.test.ts src/topics/visible-batch.test.ts src/topics/public-members.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- Every topic read (the group list, the chat list and the single-topic routes) carries `memberIds`, and `avatarUrl` for each AI that has a picture.
- `memberCount` is unchanged.
- `isTopicJoined` is exported from chat-core.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

- **Contract** (`packages/api-contract/src/topics.ts`): `TopicAi` gains optional `avatarUrl`; `Topic` gains optional `memberIds` (doc comment as specified).
- **Server types** (`apps/server/src/topics/types.ts`): `TopicView.memberIds?: string[]` and `TopicAiView.avatarUrl?: string`, with the "always set by `buildTopicView`, optional only for hand-built fixtures" comment mirroring `doneAt?`.
- **`views.ts` batched path**: `TopicViewParts.memberCounts` replaced by `memberIds` (new `groupAiCounts` map kept for General's count). General gets `[...groupMembers].sort()`, other topics `[...ids].sort()`. `memberCount` is now `memberIds.length` + the AI count (General: the group's, otherwise the topic's), so it is unchanged. All `aisByTopic` AI ids are looked up once through `avatarIdsByOwner(db, 'ai', …)` + `avatarUrlFor`, and each AI with a picture gets `avatarUrl` (via the new `aiAvatarUrls` / `withAiAvatars` helpers in the same file).
- **`views.ts` single topic**: `toTopicView` now returns `(await toTopicViews(db, [topic], mucDomain))[0]!`, so both paths share one rule. `listTopicAis` also attaches `avatarUrl` (it backs the `listAis` route) so every topic read carries pictures.
- **Phone mirror** (`apps/mobile/src/lib/topics-api.ts`): `TopicAi.avatarUrl?` and `Topic.memberIds?`; the existing spread in `toTopic` passes both through.
- **Shared helper** (`packages/chat-core/src/topics.ts`): `isTopicJoined(topic, userId) = topic.isGeneral || (topic.memberIds ?? []).includes(userId)`, already re-exported by `index.ts:47`.
- **Tests** (`apps/server/src/topics/public-reads.test.ts`): a topic's `memberIds` is exactly its direct members plus a role holder, General's is every group member, and `memberCount` still equals `countTopicMembers`; plus the `isTopicJoined` unit check (General, listed member, unlisted group member, missing list). The fixture now also returns `other`.

### Checks run

- `pnpm install` — Done in 15.2s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/public-reads.test.ts` — 4 passed.
- Spec check: `cd apps/server && pnpm exec vitest run src/topics/public-reads.test.ts src/topics/visible-batch.test.ts src/topics/public-members.test.ts --reporter=dot --maxWorkers=2` — 3 files, 10 tests passed.
- `pnpm gate` — first run failed only `format` on 2 files; fixed with `pnpm exec prettier --write` on them; second run:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (0.5s)
PASS  lint  (1.1s)
PASS  typecheck  (10.1s)
PASS  effect  (0.5s)
SKIP tests @zilar/api-contract (no nearby test files)
PASS  tests @zilar/chat-core  (0.8s)
PASS  tests @zilar/mobile  (1.6s)
PASS  tests @zilar/server  (10.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- **Deviation: the `isTopicJoined` unit check cannot import `@zilar/chat-core`.** `apps/server` does not depend on `@zilar/chat-core` (it is absent from `apps/server/package.json` and `apps/server/node_modules/@zilar`), and adding a workspace dependency is outside the Allowed files. To keep the check inside the Allowed test file I import the helper's source by relative path (`../../../../packages/chat-core/src/topics`). It typechecks, lints and passes, but it is unusual: if you prefer, add the dependency or move this check to `packages/chat-core/src/topics.test.ts` in a follow-up. This is the only item where the spec's assumptions did not hold.
- **`view-avatars.ts` not created:** the spec allows it only if `views.ts` would exceed 400 lines; the final file is 385 lines, so the avatar step stays in `views.ts`.
- **`listTopicAis` also carries `avatarUrl`.** The spec's step 3 sets pictures in the batched pass; I extended the same helper to `listTopicAis` because the `listAis` route is a topic read and the acceptance/title require `avatarUrl` on every topic read.
- **`resolveOwnerName` is now uncalled** (it is still exported and re-exported from `access.ts`). The spec only asked about `countTopicMembers` (kept: used by the test) and `listTopicAis` (kept: used by `api.ts`), so I left `resolveOwnerName` in place rather than delete a public export; say the word if you want it removed.
- No files outside the Allowed files were touched. No secrets, no new dependencies.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `1d5328b89`.
- `TopicViewParts.memberIds` (sorted) replaces `memberCounts`:
  - General gets the whole group;
  - any other topic gets its `topic_members` plus role holders.
- `memberCount` is unchanged: the people plus the group's AIs (General) or the topic's AIs.
- `toTopicView` goes through `toTopicViews`, so there is one rule.
- AI pictures come from one `avatarIdsByOwner` call per read. `listTopicAis` (used by the `listAis` route, `api.ts:267`) carries them too.
- `isTopicJoined` is in `packages/chat-core/src/topics.ts`.
- The contract, server and phone fields are optional for older servers and fixtures.
- `views.ts` is 391 lines.
- I ran `src/topics`: 30 passed.
- **Follow-up:** `resolveOwnerName` is now uncalled (`views.ts` plus its re-export in `access.ts`). Remove it in the next task that touches `views.ts`; that file has 9 lines of headroom.
