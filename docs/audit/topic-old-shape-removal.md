# Removing the old topic shape: `kind`, `status`, `owner_ai_id`

Audit for T-1828, 2026-10-17. Scope: every remaining read, write and send of
`topics.kind`, `topics.status`, `topics.owner_ai_id`, `TopicKind`, `TopicStatus`,
`TopicOwner`, `TOPIC_KINDS`, `TOPIC_STATUSES`, and the `kind`/`status`/`owner`
fields of the topic API, across `apps/server`, `packages/api-contract`,
`packages/chat-core`, `packages/client-core`, `packages/mock-backend`, `apps/web`
and `apps/mobile`. Tests are counted, not audited.

**Out of scope (Julio's 10-15 decision):** `link_url`/`link_label` and
`follow_paused_at` stay. `topics.follower_ai_id` (migration 0065) already carries
following. `owner_user_id` is not dropped by the plan; §5 notes the consequence.

## Verdict

Nothing can be dropped yet. A released phone still **requires** all three
response fields (§3), and no client can tolerate their absence until a new
release is in the field. The only safe order is: (A) clients and contract
tolerate absence, (B) ship the phone, (C) the server stops writing and sending,
(D) the drop migration. Only **D** is a DB-schema task.

## 1. Inventory

Marks: **R** = reads DB, **W** = writes DB, **S** = sends to clients,
**P** = accepts in a request body, **T** = types only, **-D** = DDL/seed.

### 1a. SQL, rows and server writes

- `apps/server/drizzle/0018_lethal_warhawk.sql:16,17,19,36` — DDL for all three
  columns and FK `topics_owner_ai_id_ais_id_fk`. **-D**
- `apps/server/drizzle/0019_general-topics.sql:9,18,19` — General backfill inserts
  `kind`,`status`. **-D**
- `apps/server/drizzle/0065_topic_follower.sql:3` — backfills `follower_ai_id`
  from `owner_ai_id`. **R** (historic)
- `apps/server/src/db/rows.ts:92,93,95` — `TopicRow.kind`, `.status`, `.ownerAiId`. **T**
- `apps/server/src/groups/service.ts:160-171` (167-168) — group creation inserts
  its General topic with `kind`,`status`. **W**
- `apps/server/src/topics/service.ts:86-102` (93-97) — create INSERT sets `kind`,
  `status`, `owner_ai_id`, and `follower_ai_id` from the owner. **W**
- `apps/server/src/topics/patch.ts:120,121` — UPDATE `kind`, `status`. **W**
- `apps/server/src/topics/patch.ts:126-137` — UPDATE `owner_user_id`/`owner_ai_id`;
  an AI owner also becomes `follower_ai_id`. **W**
- `apps/server/src/topics/members.ts:46-87` — `assertOwner` validates the owner and
  returns the two ids. **W input**
- `apps/server/src/topics/ais.ts:165-171` — clears `owner_ai_id` when an AI leaves
  a topic. **W**
- `apps/server/src/groups/ais.ts:252-253` — clears `owner_ai_id` when an AI leaves
  a group. **W**

### 1b. Server reads, views and payload mapping

- `apps/server/src/topics/service.ts:72` — reads the `assertOwner` result. **R**
- `apps/server/src/topics/schemas.ts:11-12,15,23-25` — request body types carry
  `kind`, `status`, `owner`. **T**
- `apps/server/src/topics/types.ts:11-21,56-58` — `topicKindSchema`/
  `topicStatusSchema` (no other caller) and `TopicView.kind/.status/.owner`. **T**
- `apps/server/src/topics/access.ts:241-252` — re-exports the above. **T**
- `apps/server/src/topics/views.ts:60-96` — `resolveOwnerName` reads `owner_ai_id`
  (exported, no caller). **R**
- `apps/server/src/topics/views.ts:117-119` — `buildTopicView` sends
  `kind`,`status`,`owner`. **S**
- `apps/server/src/topics/views.ts:213-217,246-249,338-346` — batch owner-AI
  lookup and `owner` build. **R**
- `apps/server/src/topics/api.ts:144,148,179-181` — create/patch payload → service. **P**
- `apps/server/src/chats/list-handler.ts:13,165` — `/api/chats` reuses
  `toTopicViews`, so it sends the same fields. **S**

### 1c. Contract

- `packages/api-contract/src/topics.ts:38,39,42-47` — `TOPIC_KINDS`,
  `TOPIC_STATUSES`, their literal schemas and `TopicKind`/`TopicStatus`. **T**
- `packages/api-contract/src/topics.ts:95-98,163-169` — `TopicOwnerRef` (request
  owner) and `TopicOwner` (response). Its `kind` is `user|ai`, not topic kind. **P/S**
- `packages/api-contract/src/topics.ts:107,111` — `CreateTopicPayload.kind` and
  `.owner`. **P**
- `packages/api-contract/src/topics.ts:119-121` — `PatchTopicPayload.kind`,
  `.status`, `.owner`. **P**
- `packages/api-contract/src/topics.ts:211-225` — `Topic.kind`/`status`/`owner`
  are **required** in the response (`kind`/`status` lenient literals, `owner`
  `NullOr`). **S**

### 1d. Shared clients (`chat-core`, `client-core`)

- `packages/chat-core/src/types.ts:128,130,134-138` — `TopicKind`, `TopicStatus`,
  `TopicOwner`. **T**
- `packages/chat-core/src/types.ts:170,171,177` — `TopicInfo.kind`, `.status`,
  `.owner`. **T**
- `packages/client-core/src/store/topic-rows.ts:48,49,54` — copies the response
  into `TopicInfo`. **R**

No shared helper reads the three fields afterwards (`sortTopics`, `inTopic` and
the row builders do not).

### 1e. Mock backend

- `packages/mock-backend/src/domains/topics/tables.ts:6-13,39-41` — table fields
  and types. **T**
- `packages/mock-backend/src/domains/topics/routes.ts:14,21-22` — imports and
  local `TOPIC_KINDS`/`TOPIC_STATUSES`. **T**
- `packages/mock-backend/src/domains/topics/routes.ts:90-92` — create writes
  `kind`,`status`,`owner`. **W**
- `packages/mock-backend/src/domains/topics/routes.ts:121-122,304-323` — patch
  writes `kind`,`status`; `readOwner` and validators. **W**
- `packages/mock-backend/src/domains/topics/view.ts:62-64`, `state.ts:8` — sends,
  and clones `owner`. **S/R**
- `packages/mock-backend/src/domains/topics/seed.ts:32-34,53-55,76-78,95-97,114-116,133-135,152-154`
  — all 7 seed topics carry the three fields. **seed**

### 1f. Web

- `apps/web/src/lib/api/topics.ts:10,12,15,38,40,42` — imports and re-exports
  `TopicKind`/`TopicOwner`/`TopicStatus`. **T**
- `apps/web/src/lib/api/topics.ts:48,52,60-62` — create/patch inputs carry
  `kind`, `status`, `owner`. **P**
- `apps/web/src/lib/api.ts:161,163,165` — re-exports them. **T**
- `apps/web/src/components/NewTopicDialog.tsx:16,19-24,68,139-141,217-219` —
  "Type" chips; sends `kind` on create. **client write**

No web component reads `topic.kind`, `topic.status` or `topic.owner`: the task
strip, `StatusMenu` and `OwnerMenu` were removed in T-1534. `TopicsSection.tsx`
uses only glyph, visibility, member ids and AIs.

### 1g. Mobile

- `apps/mobile/src/lib/topics-api.ts:11,25,43-45` — imports/re-exports; response
  `Topic.kind`, `.status`, `.owner`. **T**
- `apps/mobile/src/lib/topics-api.ts:83,87,95-97` — create/patch inputs carry
  `kind`, `status`, `owner`. **P**
- `apps/mobile/src/lib/topics-api.ts:138-149,152-163` — `parseTopicKind`/
  `parseTopicStatus` (exported, no caller). **T**
- `apps/mobile/src/components/chat/new-topic-sheet.tsx:12,15-21,25,59` — "Type"
  chips and state. **client choice**
- `apps/mobile/src/components/chat/use-group-new-topic.ts:31-36` (33) — sends
  `kind` on create. **client write**

No mobile component reads `status` or `owner`: the task strip was removed in
T-1540; `topic-row.tsx` and `topic-info-sheet.tsx` use name, activity, members.

### 1h. Tests (counted only)

3 server test files reference the symbols directly (`topics/ais.test.ts` 11 lines,
`groups/ais.test.ts` 10, `agents/gateway/topic-follow.test.ts` 17). Fixture rows
also set the fields in `test-support/seed.ts:141-142`,
`topics/{patch,one-step-add,preview,ai-activity,visible-batch}.test.ts`,
`approvals/{rules,service}.test.ts` (raw INSERTs), web
`realStore.history.test.tsx:203-215` and mobile `real-store.history.test.ts:276-278`.
About 12 server files and 2 client-store files; none asserts a UI label.

### 1i. Already migrated / not affected

- `agents/gateway/topic-follow.ts` reads and writes `follower_ai_id` only
  (`:57-77`, `:96-116`, `:139`, `:159`, `:188`); `owner_ai_id` no longer drives
  following.
- The web/mobile chat-list caches store chat `kind` (`dm`/`group`) and message
  `status`, not topic fields.
- The `kind` in `TopicOwnerRef`/`TopicOwner` is the owner discriminator
  (`user`/`ai`); it goes away with the owner shape itself.

## 2. Does any UI still show it?

- **`status`:** dead. No web or mobile view renders it.
- **`kind`:** dead as a display, but both create dialogs still show a "Type" chip
  row and send the chosen value. Nothing renders it afterwards.
- **`owner`:** dead. The owner chip and picker were removed (T-1534/T-1540);
  `TopicOwner` survives only as a response mapping, and `resolveOwnerName` has no
  caller.
- `parseTopicKind`/`parseTopicStatus` are exported but unused.

Step A therefore deletes dead mappings and two dead helpers; it does not remove a
live behaviour.

## 3. What a released phone does if a field disappears

The phone decodes with `Topic` from `packages/api-contract`, via `parseTopic`
(`apps/mobile/src/lib/topics-api.ts:182-185`), and `/api/chats` pre-filters every
topic with the same function (`apps/mobile/src/lib/chat-api-schemas.ts`).

- `kind` and `status` use `lenientLiterals`, which only tolerates a **present
  unknown value**. A missing key still fails `Schema.Struct`.
- `owner` is `Schema.NullOr(TopicOwner)`; it is required.

I checked the exact behaviour with the repo's effect 4.0.4: a struct with the
same three fields decodes normally, fails when `kind`, `status` or `owner` is
omitted (one at a time), and accepts `kind: 'weird'` as `'chat'`.

Consequences for v0.2.6/v0.2.7 if the server stops sending them:

- `/api/chats`: `parseTopic` returns `null` → `chatEntryTopics` drops the row →
  **all topics of the group disappear** (only the group's legacy row remains).
- `GET /api/topics/:id`, used by v0.2.7 to load roles: the response fails to
  decode, so the request errors and roles never load.
- Create/patch/archive responses decode the same `Topic`: those mutations report
  an error even though the server applied them.
- Request bodies use `onExcessProperty: 'error'`, and v0.2.7 still sends `kind` on
  create: removing the payload key before the new release is in the field returns
  `400 invalid_request`.

So the server must keep sending all three fields (and keep accepting the payload
keys) until the Task A release is the supported floor. `kind` and `status` are
constants, so the placeholders `'chat'` and `'open'` are correct. `owner` is not a
constant: send the real owner (the mapped `owner_user_id`/`owner_ai_id`), and
`null` only when the topic truly has none. A blanket `null` would rewrite an AI or
user owner into "no owner" for any old build that still reads the field, so the
placeholder must preserve the value until D has removed the column and the field.
`minClientProtocol` (`packages/protocol/src/version.ts:14`) only shows an
"update the app" banner (`apps/mobile/src/lib/use-client-version.ts:60`), it does
not block old builds. Old cached web bundles behave like the phone on
`/api/chats` and fail the whole `listGroupTopics` request (strict `TopicList`), so
the same floor applies to web.

## 4. Safe removal order

Only **D** changes the database schema. A, B and C are code or release steps.

### A. Clients stop reading and decoding (no DB change)

Make `Topic.kind`, `.status` and `.owner` optional in the contract while the
server keeps sending them; remove the dead reads and the create-chip writes.

Files: `packages/api-contract/src/topics.ts`, `packages/chat-core/src/types.ts`,
`packages/client-core/src/store/topic-rows.ts`,
`apps/web/src/lib/api/topics.ts`, `apps/web/src/lib/api.ts`,
`apps/web/src/components/NewTopicDialog.tsx`,
`apps/mobile/src/lib/topics-api.ts`,
`apps/mobile/src/components/chat/new-topic-sheet.tsx`,
`apps/mobile/src/components/chat/use-group-new-topic.ts`.

Acceptance: a `Topic` without the three fields decodes on both apps; no web or
mobile code reads them; create sends no `kind`; the server still sends all three;
`pnpm gate` is green.

### B. Phone release

Ship A as the next phone build (v0.2.8 or later) and bump `protocolVersion`.

Acceptance: the build is live; when store adoption allows, raise
`minClientProtocol` above v0.2.7 so old builds see the update banner. This step
is a release, not code in this task.

### C. Server stops writing, reading and sending (no DB change)

Files: `apps/server/src/topics/{service,patch,members,schemas,types,views,api,ais}.ts`,
`apps/server/src/groups/{service,ais}.ts`, `apps/server/src/db/rows.ts`,
`packages/api-contract/src/topics.ts` (payload keys, response fields,
`TopicOwner`, `TOPIC_KINDS`, `TOPIC_STATUSES`), the mock topic domain
(`tables,routes,view,state,seed`), and the shared client types that mirror them.

Behaviour change: assigning an owner no longer makes that AI the follower
(`topics/service.ts:97`, `topics/patch.ts:132-133,168-170`). Following starts
only on an `@mention`, which T-1529 already supports.

Acceptance: no `kind|status|owner_ai_id` remains under `apps/server/src/topics`,
`groups` or `db/rows.ts`; responses omit the fields; a phone on the B build still
lists topics; `pnpm gate` is green. **Merge only after B is the floor.**

### D. Drop the columns (DB-schema task)

New `apps/server/drizzle/00XX_topic-old-shape-drop.sql`:

```sql
SET lock_timeout = '5s';
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_owner_ai_id_ais_id_fk";
ALTER TABLE "topics" DROP COLUMN IF EXISTS "owner_ai_id";
ALTER TABLE "topics" DROP COLUMN IF EXISTS "kind";
ALTER TABLE "topics" DROP COLUMN IF EXISTS "status";
```

Do not edit 0018, 0019 or 0065: a fresh database replays them before this file,
and 0065 must keep reading `owner_ai_id` until the drop runs.

Acceptance: applies to a copy of production in under 5 s; a server from release C
runs unchanged against it; `pnpm gate` is green. **Merge only after C has been the
only running server release through a full deploy** (expand/contract: the old
server in a zero-downtime rollout still writes the columns).

## 5. Follow-ups and open points

- `owner_user_id` stays (the plan does not drop it) but nothing writes it once
  the `owner` payload goes. Decide later whether to drop it or reuse it.
- `follow_paused_at` stays by Julio's decision and belongs to `follower_ai_id`.
- Old cached web bundles get no help from A; `minClientProtocol` is only a banner.
  Keeping the placeholders through one phone cycle is the real protection.
- `resolveOwnerName`, `parseTopicKind`, `parseTopicStatus` and
  `topicKindSchema`/`topicStatusSchema` are dead now; delete them in A/C rather
  than keeping them as compatibility shims.

## References

- `docs/audit/ai-work-plan.md` §5a-5c and §7 step 8.
- `work/T-1529-mention-follow.md` (following moved to `follower_ai_id`).
