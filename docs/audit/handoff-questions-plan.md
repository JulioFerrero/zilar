# Handoff lines and question reply chips: audit and step plan (T-1566)

Written 2026-10-15. This audit **changes no code**. It maps the two pieces of the
approved AI work boards that are not built yet — a **handoff line** ("Dev-1 →
QA-1 · Check it on an iPhone") and **an AI's question to people with reply
chips** — and splits them into ordered tasks.

Read with `docs/design/mockups/ai-work/README.md` (the approved model:
`README.md:11-12,31-32`) and `docs/audit/ai-work-plan.md` §2-3 (the prior
findings this task extends: handoff is "only an `@nick` mention metadata",
a question to people "does not exist"). Facts below were read on
`task/T-1566-audit-handoff-questions` on 2026-10-15; every claim carries
`file:line` or reads **not found**.

Model in one line: **a handoff today is a mention range the server already
computes but never marks; a question to people has no storage, no tool, no
card and no read — so "waiting for you" cannot include one.**

---

## 0. Summary

- **A handoff is a mention, not a marker.** The server builds the outgoing
  message in `apps/server/src/agents/group-turn.ts:144-174` (`wire()`): it
  prefixes `@<sender>` and, for up to two `handoffTargets`, appends a mention
  whose `jid`/`begin`/`end` come from `findHandoffIndex`
  (`apps/server/src/agents/handoff.ts:9-22`). The stanza carries body, mentions
  and `replyTo` only (`packages/xmpp-core/src/types.ts:195-207`); there is **no
  handoff field**: not found.
- **`group-ingest.ts` detects the reverse** — an AI sender mentioning another AI
  spends one of `ROUND_MAX_HOPS` (`apps/server/src/agents/gateway/group-ingest.ts:161-192`,
  `contracts.ts:126-128`) and queues a `handoff: true` trigger
  (`contracts.ts:155-156`). That is turn accounting, not a chat line.
- **The `delegate` tool is the durable twin** of a handoff
  (`apps/server/src/agents/delegation/service.ts:189-225` stores an
  `ai_delegations` row; `tool-exec.ts:230-269` queues a synthetic `handoff`
  trigger). The row is **never exposed to clients**: no route reads
  `ai_delegations` (**not found**), and the protocol's own `handoff` payload
  (`packages/protocol/src/handoff.ts:4-18`, wired at `payload.ts:17`) is
  **never sent and never rendered**: not found.
- **The client can only infer a handoff.** It receives `message.mentions`
  (`packages/chat-core/src/types.ts:59-66`, built at
  `packages/client-core/src/store/ledger-incoming.ts:186-188`) and can test both
  ends with `isAiJid` (`packages/protocol/src/jid.ts:35-38`, re-exported by
  `packages/chat-core/src/ai.ts:1-4`). No field marks a handoff: not found.
- **A question to people does not exist** (confirming `ai-work-plan.md:128-134`):
  no `ask_people`/`ask_user` tool, no questions table, no question card, no
  reply-chip UI — all **not found**.
- **Three payload types are defined but unused**: `handoff`
  (`packages/protocol/src/handoff.ts`), `poll`/`poll.vote`
  (`packages/protocol/src/poll.ts`) and `task`/`board.update`
  (`packages/protocol/src/task.ts`). Only `payload.test.ts` references them
  (`packages/protocol/src/payload.test.ts:83-84,118-132,166-171`). The poll
  schema is already a question with 2-10 options (`poll.ts:6-27`).
- **"Waiting for you" exists and reads approvals only.** `topicAiActivity`
  (`apps/server/src/topics/ai-activity.ts:40-128`) unions `waiting` from
  `approvals` (`:241-267`), `done` from `agent_task_events` (`:279-299`) and
  `working` from the live gateway. A question is not a source.
- **Clients refresh the topic list live** from `activity-refresh.ts`
  (`:23-41`), called at `incoming.ts:102`; a question message would **not**
  trigger it today (only `progress` and `approval.request` do).

---

## 1. Handoff data

**1a. Where a handing-off reply is built.** `wire()` in
`apps/server/src/agents/group-turn.ts:144-174` is the one place: it returns the
final text and `SendMessageOptions`. It is called on the plain reply
(`:193-198`), the tool-loop reply (`:186-188`, via `sendGroupReply`), and the
fallback (`:217`). The mention for the sender is always added (`:146-148`);
handoff mentions are appended for `deps.handoffTargets` in order, capped at
three mentions (`:149-166`).

**1b. What the stanza carries.** `SendMessageOptions` has `payload?`,
`replyTo?`, `mentions?`, `album?`, `forward?`, `id?`
(`packages/xmpp-core/src/types.ts:195-207`). `wire()` sets `replyTo` (the
trigger) and `mentions`; it sets **no payload** (`group-turn.ts:167-173`). The
progress card is a separate message with a `progress` payload
(`apps/server/src/agents/gateway/live.ts:120-131`). So a handoff is exactly "an
`@nick` inside the body with a mention range".

**1c. How `group-ingest.ts` decides an AI-to-AI handoff.** In
`handleRoomIncoming`: `mentioned` is true when a mention matches this AI's bare
JID or the message replies to it (`group-ingest.ts:140-147`); an AI sender that
passes the live-session check spends a hop unless this message id was already
counted, then sets `handoff = true` (`:161-186`); the turn is queued with that
flag (`:192`) and the flag survives into `RoomPendingMessage.handoff`
(`contracts.ts:155-156`, set at `:250`). `apps/server/src/agents/gateway/group-turn.ts:131-147` only lets an
AI-sender item through when `handoff === true`.

**1d. How `delegation/service.ts` relates.** `checkDelegation`
(`delegation/service.ts:161-186`) is the permission gate (different AIs, source
`can_delegate`, target `accepts_delegation`, both active, both in the room);
`createDelegation` (`:189-225`) stores a `working` `ai_delegations` row
(migration `apps/server/drizzle/0045_remarkable_dragon_lord.sql:1-33`). The
`delegate` tool (`apps/server/src/agents/gateway/tool-exec.ts:230-269`) then
queues a synthetic `handoff: true` trigger on the worker (`:231-241`) and bumps
the hop count (`:255-257`). So `delegate` and a plain `@nick` handoff **share
the `handoff` flag but only `delegate` has a durable row**. The row is not
readable by any client: **not found**.

**1e. Can a client tell a handoff from a normal mention?** Only by inference. It
has the sender JID (`UiMessage.senderId`, `chat-core/src/types.ts:68-73`), the
mention list with JIDs (`types.ts:59-66`) and `isAiJid`
(`protocol/src/jid.ts:35-38`). A message whose sender is an AI and whose
mentions include an AI could be a handoff — or an AI mentioning another AI in
prose. There is **no explicit marker**: not found.

---

## 2. The smallest handoff line

**Options.**

- **(a) A client-side rule** — an AI message whose mentions include another AI
  renders as a line. Needs **zero** server/contract change: the data is already
  in `UiMessage.mentions` (`chat-core/src/types.ts:59-66`) and `isAiJid`
  (`protocol/src/jid.ts:35-38`). But it is **not safe alone**: any AI mentioning
  another AI in prose becomes a line (false positives), and the "· \<task\>"
  boundary is guesswork. It also cannot show state (handed off / answered).
- **(b) A stanza marker** — a small marker on the AI's reply, either an
  extension element or a field in the existing card payload
  (`packages/protocol/src/payload.ts:15-46`; `ProgressSchema` at
  `packages/protocol/src/progress.ts:17-36`). The server already computes
  exactly when a handoff mention was appended (`group-turn.ts:149-166`), so the
  marker is **deterministic**. This is the **smallest safe** option.
- **(c) A delegation event card** — needs the `ai_delegations` row exposed to
  clients (a new route, **not found** today) and a new card; it also only
  covers `delegate`-tool handoffs, not the plain `@nick` path. **Biggest.**

**Recommendation: (b).** Attach a small handoff marker to the reply message
where `wire()` already appends the mention (`group-turn.ts:157-166`), so the
client renders a line from an explicit field instead of inference. Two shapes,
either acceptable:

- add an optional `handoff` field to `ProgressSchema` and have the client read
  it off the AI's card; or
- add a dedicated small payload (a sibling of the unused `handoff` payload,
  `packages/protocol/src/handoff.ts:4-18`) and send the reply with
  `SendMessageOptions.payload` (`xmpp-core/src/types.ts:196`).

**Where "· \<task\>" comes from.** The mention offset from `findHandoffIndex`
(`handoff.ts:9-22`) gives the position; the task text is the reply text after
the mention, i.e. `text.slice(index + nick.length + 1).trim()`
(`group-turn.ts:157-166`). When the handoff came from the `delegate` tool, the
task text is `ai_delegations.objective` (`delegation/service.ts:196-224`), which
is the same sentence the worker received (`tool-exec.ts:223`). For the plain
`@nick` path there is no separate field — the reply body is the only source:
**the delegation objective is the only structured "task" text today.**

**Exact render points (twins).**

- Web: `apps/web/src/components/message/AttachmentBody.tsx:245-255` renders
  `message.card` today (only `progress` and `approval.request`); a handoff line
  renders next to the bubble in `apps/web/src/components/MessageBubble.tsx`
  (`:296-326`, where the body/attachment swap happens) or as a sibling of the
  card in `AttachmentBody.tsx`. The bubble row is chosen in
  `apps/web/src/components/MessageListRow.tsx:81-100`.
- Phone: `apps/mobile/src/components/chat/message-bubble-content.tsx:182-191`
  dispatches `message.card` through `PayloadCard`
  (`apps/mobile/src/components/chat/payload-card.tsx:22-32`, which switches
  `progress` and `approval.request`).

Both clients already branch on `message.card` (`AttachmentBody.tsx:245`,
`message-bubble-content.tsx:182`), so a new `case` is the smallest edit.

---

## 3. Questions

**3a. How an AI tool is defined, registered and run.** Two different things
share the word "tool":

- **Model-facing built-in tools** (the ones this feature needs): definitions in
  `apps/server/src/agents/tools/definitions.ts` (`ChatToolDefinition` at
  `:16-23`; `buildTools` `:231-240`; `buildGroupTools` `:251-263`), names and
  Effect argument schemas in `apps/server/src/agents/tools/schemas.ts`
  (barrel `apps/server/src/agents/tools.ts:52-60`). A group turn offers them
  via `groupTools = buildGroupTools(...)` (`group-turn-body.ts:240-243`) and the
  loop executes them in `apps/server/src/agents/gateway/tool-exec.ts:72+`
  (`executeToolCall`), splitting each concern into a runner
  (e.g. `apps/server/src/agents/gateway/request-action.ts:27-96`).
- **User-authored tools**: a versioned code store per AI/topic in
  `apps/server/src/tools/service.ts` (`PublicTool` `:28-42`) run by a sandbox
  runner (`apps/server/src/tools/types.ts:1-24`). This is **not** where a
  built-in like `ask_people` belongs.

**3b. The approval card is the closest model.**
`buildApprovalCardPayload` (`apps/server/src/actions/announce.ts:69-97`) turns an
`approvals` row into a `{type:'approval.request'}` payload
(`packages/protocol/src/approval.ts:6-17`); it is announced best-effort from the
action path (`apps/server/src/actions/approval-path.ts:160-172` →
`createProductionAnnouncer`, `apps/server/src/actions/production-announcer.ts:48-69`).
It is decided by an API route (`apps/server/src/approvals/api.ts:142-177` →
`decideApproval`, `apps/server/src/approvals/service.ts:170,243`), and the AI
learns the outcome later via `verifyApproval` (`service.ts:322-364`, called from
`apps/server/src/actions/queries.ts`). The card is decided on a polling page
(`apps/web/src/lib/useApprovalPolling.ts:24,100-103`), **not in the chat**.

**3c. Proposed `ask_people` tool.** A group-turn built-in next to
`delegate`/`task_status` (`definitions.ts:251-263`): arguments `question`
(1-300 chars, matching `PollSchema.question`, `poll.ts:13`), `options`
(2-4 short labels, `PollOptionSchema` at `poll.ts:6-9`), and optional
`expires_in`. It is offered only in a group turn where the trigger is a person
(the approval path already restricts who may prompt, `request-action.ts:19-26`).
It returns a fixed line ("waiting for your answer; a card was posted in this
room") like `request_action` returns for a pending approval
(`request-action.ts:68-81`). A free reply is always allowed because the chip
tap is just a normal message (§3e).

**3d. Storage: a new table, not `approvals`.** Recommend a new
`ai_questions` table (expand-only). `approvals` is action-authorization: it
requires `action`, `args_hash`, `requested_by` and a `decide`/`consumed`
lifecycle (`apps/server/drizzle/0011_silky_groot.sql:1-24`;
`approvals/service.ts:322-364`), and it is surfaced in the Approvals inbox
(`docs/USER_GUIDE.md:76`). A question has free-text options, an optional answer
and a different lifecycle; reusing `approvals` would overload `action`/`summary`
and pollute the approvals inbox and the expired sweeper. Suggested columns
(mirroring the sibling shapes): `id`, `ai_id`, `group_id`, `topic_id`,
`message_id`, `question`, `options jsonb`, `status` (`open`/`answered`/
`closed`/`expired`), `answer`, `answered_by`, `expires_at`, `created_at`, with
indexes mirroring `approvals_ai_status_idx`/`approvals_group_status_idx`
(`0011_silky_groot.sql:23-24`). Migration: **yes** (one new `.sql` starting with
`SET lock_timeout = '5s';`, per `AGENTS.md`).

**3e. The answer path.** Recommend: **a chip tap sends a normal message
quoting the question** (`replyTo` = the question's `message_id`, body = the
option label, and an `@` mention of the asking AI). This reuses
`SendMessageOptions.replyTo`/`mentions` (`xmpp-core/src/types.ts:198-201`) and
the existing ingest: `handleRoomIncoming` already turns a mention/reply into a
queued turn (`group-ingest.ts:140-147,192`), so **the AI's next turn receives
the answer with no new route**. To close the question the server matches
`message.replyTo` to an open question's `message_id` in
`handleRoomIncoming` (new read). A dedicated API call would need a route, auth,
an update and a synthetic turn (`tool-exec.ts:230-254` is the pattern) — bigger
and not needed. This is a proposal; the lead may prefer the API route.

**3f. When a question is open or closed.** Open while `status = 'open'` and
`expires_at > now()` (the exact predicate `ai-activity.ts:259-261` already uses
for approvals). Closed when **any** of: a person replies to the question (the
`replyTo` match, §3e); a person taps a chip (same message path); the asking AI's
turn ends (its card reaches a terminal state, read from `agent_task_events` like
`ai-activity.ts:279-299`); or it expires. A later reply never reopens it.

---

## 4. "Waiting for you" and client refresh

**4a. Adding "has an open question".** `topicAiActivity` is the one read model
(`apps/server/src/topics/ai-activity.ts:40-128`). `waiting` is built from
`loadPendingApprovals` (`:69-76,241-267`); the change is a second batched query
`SELECT topic_id, group_id, ai_id FROM ai_questions WHERE status = 'open' AND
expires_at > now() ...` unioned into the same `waiting` map (`:69-76`), reusing
the General-topic NULL-`topic_id` mapping already coded there (`:54-62,70-75`).
`withTopicActivity` (`:148-176`) then needs no change if the question carries
`ai_id`; if the "AIs here" row must jump to the question (§5) the activity entry
should also carry the `message_id` of the question card.

**4b. How clients refresh.** T-1528's `isAiActivityMessage`
(`packages/client-core/src/store/activity-refresh.ts:23-41`) decides whether a
live group message schedules a list refresh; it is called at
`packages/client-core/src/store/incoming.ts:102`. Today it returns true only for
a new/finished `progress` card and an `approval.request` (`:31-40`). **A question
message does not trigger it today**: adding the question payload type to the
`:31-40` branch is required. The refresh itself
(`scheduleActivityRefresh`, `:48-61`) then re-fetches `/api/chats`, where the
new `waiting` state arrives through `TopicActivity`
(`packages/api-contract/src/topics.ts:183-196,226`, mapped at
`packages/client-core/src/store/topic-rows.ts:57,64-77`).

---

## 5. The "AIs here" sheet row that opens the question

The row already exists and handles `waiting`; only its target changes.

- **Web:** `AisHereKey` renders one `AisHereRow` per activity entry
  (`apps/web/src/components/topic/AisHereKey.tsx:56-64`); the `waiting` branch
  links to `/settings/approvals` (`:123-134`). For a question it should instead
  jump to the question message. The jump tool exists: `openAtMessage(chatId,
  messageId)` (`apps/web/src/store/store.ts:147`, effect at
  `apps/web/src/store/effects/history.ts:89-95`, core at
  `packages/client-core/src/store/history.ts:263`), followed by
  `scrollToMessage` (`apps/web/src/lib/scrollToMessage.ts:6`), exactly as a
  search hit does (`apps/web/src/components/MessageSearchResults.tsx:33-38`).
  The header key itself is mounted at `apps/web/src/components/ChatHeader.tsx:201`.
- **Phone:** `AisHereSheet`'s `waiting` branch calls `onOpenApprovals`
  (`apps/mobile/src/components/chat/ais-here-sheet.tsx:62-74,119-122`); it
  should instead close the sheet and land on the question message — the store
  exposes `openAtMessage` (`apps/mobile/src/store/types.ts:135`) via
  `apps/mobile/src/store/real-store.ts:353`, and the sheet is mounted at
  `apps/mobile/src/components/chat/chat-header.tsx:223`.
- **Both need a message id on the activity entry.** `TopicAiActivity` carries
  only `aiId`, `name`, `jid?`, `avatarUrl?`, `state`
  (`packages/chat-core/src/types.ts:137-144`); the question's `message_id` must
  be added (or the client resolves the question card by AI JID, cf.
  `liveStageFor` at `packages/chat-core/src/topic-activity.ts:58-75`). The
  `waiting` line text itself already reads "is waiting for you"
  (`topic-activity.ts:17-26`) and needs no change.

---

## 6. Files near 400 lines the steps would touch

Line counts read 2026-10-15 on this branch. Split first where a step would cross
400.

| File | Lines | Split before touching it |
| --- | --- | --- |
| `apps/server/src/agents/gateway/group-turn-body.ts` | 395 | Yes — this is at the cap. Move the handoff/target resolution (`:171-202`) and the tool wiring (`:230-243`) into a sibling module before adding anything. |
| `apps/server/src/approvals/service.ts` | 387 | Only if the plan reuses `approvals`; with a new `ai_questions` table it is untouched. |
| `apps/server/src/agents/group-turn.ts` | 369 | Watch — `wire()` (`:144-174`) grows; extract the marker/task-text half into `handoff.ts` (already 22 lines) if it crosses 400. |
| `apps/mobile/src/components/chat/message-bubble-content.tsx` | 330 | Watch — the question/handoff render adds cases; extract a `card-body` component if needed. |
| `apps/server/src/agents/gateway/tool-exec.ts` | 339 | Watch — `ask_people` is a new branch; follow the `request-action.ts` split precedent (`request-action.ts:1-3`). |
| `apps/server/src/agents/gateway/group-ingest.ts` | 317 | Watch — the question-close match is one small block. |
| `apps/server/src/topics/ai-activity.ts` | 299 | Watch — one extra query and map. |
| `apps/server/src/topics/views.ts` | 347 | Only if the activity entry shape changes there. |
| `apps/server/src/agents/gateway/live.ts` | 339 | Untouched unless the handoff marker rides the card send. |

`apps/server/src/agents/gateway/request-action.ts:1-3` and
`apps/server/src/agents/handoff.ts:1-3` are the project's own precedent for
splitting a gateway file at the cap.

---

## 7. Step plan (8 tasks, in order)

Each line: title — exact files — migration? — surface — estimate (worker
minutes). **Web and phone twins are in the same batch (tasks 2, 5 and 8).**

1. **Handoff marker on the AI reply.** `apps/server/src/agents/group-turn.ts`
   (`wire()`, `:144-174`: attach the marker and the task text),
   `apps/server/src/agents/gateway/group-turn-body.ts` (`:171-202,318`, pass the
   task text — split the file first), `packages/protocol/src/progress.ts` (an
   optional `handoff` field) or a new small payload + `packages/protocol/src/payload.ts`
   union, and the server test that reads it back. Migration: **no**. Surface:
   **server + contract**. Est **90**.
2. **Web + phone: render the handoff line (twin batch).**
   `apps/web/src/components/message/AttachmentBody.tsx` (`:245-255`) or a new
   `HandoffLine.tsx`, `apps/mobile/src/components/chat/payload-card.tsx`
   (`:22-32`) and `message-bubble-content.tsx` (`:182-191`), plus the shared
   line text in `packages/chat-core/src/topic-activity.ts` if reused. Arrow
   from lucide, not an emoji (D24/`AGENTS.md`), no money, no model-call row.
   Migration: **no**. Surface: **web + phone**. Est **90**.
3. **Question storage.** New `apps/server/drizzle/<n>_ai_questions.sql`
   (`SET lock_timeout = '5s';`, table + two indexes), new
   `apps/server/src/questions/service.ts` (`createQuestion`, `closeQuestion`,
   `listOpenQuestions`) and its test. Migration: **yes**. Surface: **server**.
   Est **120**.
4. **The `ask_people` tool + question card payload.**
   `apps/server/src/agents/tools/schemas.ts` (name + args schema),
   `apps/server/src/agents/tools/definitions.ts`
   (`buildGroupTools`, `:251-263`), `apps/server/src/agents/gateway/tool-exec.ts`
   (the executor branch — split if near 400), `packages/protocol/src/question.ts`
   (new) + `packages/protocol/src/payload.ts` union, `apps/server/src/agents/gateway/live.ts`
   (post the card). Migration: **no**. Surface: **server + contract**.
   Est **150**.
5. **Web + phone: the question card with reply chips (twin batch).**
   `apps/web/src/components/message/AttachmentBody.tsx` (`:245-255`) + a new
   `QuestionCard.tsx`; `apps/mobile/src/components/chat/payload-card.tsx`
   (`:22-32`) + a new `question-card.tsx`. A chip tap sends a normal message
   with `replyTo` = the question and an `@` mention of the asking AI
   (`xmpp-core/src/types.ts:198-201`); the composer send path already exists.
   Migration: **no**. Surface: **web + phone**. Est **150**.
6. **The answer path: close the question.**
   `apps/server/src/agents/gateway/group-ingest.ts` (`handleRoomIncoming`,
   `:140-147,192`: match `replyTo` to an open question and close it) and
   `apps/server/src/questions/service.ts`. Migration: **no**. Surface:
   **server**. Est **90**.
7. **"Waiting for you" includes an open question.**
   `apps/server/src/topics/ai-activity.ts` (`:69-76,241-267` add the union; carry
   the question `message_id`), `packages/api-contract/src/topics.ts`
   (`TopicActivity`, `:183-196,226`), `packages/chat-core/src/types.ts`
   (`TopicAiActivity`, `:137-144`), `packages/client-core/src/store/topic-rows.ts`
   (`:57,64-77`), `packages/api-contract`/`chat-core` mock topic seeds
   (`packages/mock-backend/src/domains/topics/*`). Migration: **no**. Surface:
   **server + contract + shared**. Est **120**.
8. **AIs here row opens the question; refresh on a question (twin batch).**
   `apps/web/src/components/topic/AisHereKey.tsx` (`:123-134`),
   `apps/web/src/components/topic/AiStatusLine.tsx`, `apps/web/src/store/effects/history.ts`
   (reuse `openAtMessage`), `apps/mobile/src/components/chat/ais-here-sheet.tsx`
   (`:62-74,119-122`), `apps/mobile/src/components/chat/ai-status-line.tsx`, and
   `packages/client-core/src/store/activity-refresh.ts` (`:31-40`, add the
   question payload) with its test. Migration: **no**. Surface:
   **web + phone + shared**. Est **120**.

Total ≈ **930** worker minutes.

---

## 8. Open questions for the lead

1. **Handoff option:** confirm **(b) a server-set marker** (this doc) over (a) a
   client-only inference rule (§2). (a) is smaller but false-positives on any AI
   mentioning another AI.
2. **Handoff scope:** does a handoff mean only the `delegate` tool
   (`ai_delegations.objective` as the task text), or also the plain `@nick`
   mention (task text = reply body)? This decides where "· \<task\>" comes from
   (§2).
3. **Storage:** confirm a new `ai_questions` table over reusing `approvals`
   (§3d). Reuse would pollute the Approvals inbox and the `decide`/`consumed`
   lifecycle.
4. **Answer path:** chip tap as a normal quoting message (this doc, §3e) or a
   new API route? The message path needs no route but closes the question from
   `replyTo` matching.
5. **Who may answer:** any group member, only the AI's owner, or group
   managers/admins (the approval card limits who decides,
   `approvals/access.ts:200-215`)? A question to "people" implies any member.
6. **Open/closed rules:** is a follow-up reply after the answer allowed, and does
   the asking AI's turn ending close the question even if nobody answered
   (§3f)?
7. **Carrying the question id:** add the question's `message_id` to
   `TopicAiActivity` (§5) or let the client resolve the latest question card by
   AI JID (like `liveStageFor`)?
8. **DM questions:** should an AI be able to ask its owner a question in a DM
   (like `request_action` does in DMs, `request-action.ts:68-81`), or only in a
   topic?

---

## 9. D24 check

- Status stays an icon/mark, never a word (`README.md:39`); the handoff arrow is
  a lucide icon, never an emoji, and the "· \<task\>" line is UI text, not a
  status word.
- No money field is proposed; the question card is text plus chips.
- No model-call rows are shown.
