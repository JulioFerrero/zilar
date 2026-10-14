# Quiet background agent UX: audit and build plan (T-1398)

Scope: what a user sees while an AI works today, end to end (DM and group), and the
exact plan for `docs/design/agent-system.md` §4 ("Chat experience: background, no
spam") plus §2.2 ("Session log"). Phase P1 of the build plan (`agent-system.md` §6,
line 209). **Docs only: this task changes no code.**

Code read on branch `task/T-1398-agent-ux-plan-audit` (base `main` at `a3154feb0`).
Every claim below carries a `file:line`; where a claim is a reading of code rather
than something I ran, it says so.

Already covered elsewhere, not repeated: the drafts stream and its reconnect gap
(`docs/audit/ai-features-audit.md`, MP-5); approvals access rules and the rule table
(`apps/server/src/approvals/access.ts`, `apps/server/src/approvals/rules.ts`); the
sandbox and egress design (`docs/design/agent-system.md` §2.3).

## 0. Summary

The plumbing for a quiet UX is half built, and the two things the target UX forbids
already happen today:

1. **A long AI turn spams the chat list and the notifications.** The progress message
   is a *stored* message with a body (`apps/server/src/agents/gateway/live.ts:88-96`),
   so it lands in MAM and the push component resolves it as a normal message: it
   notifies and it bumps the unread count. Every stage correction is another stored
   row that notifies again. A six-round turn buzzes six times and leaves six unread.
2. **The cleanup is worse than the spam.** `clearProgress` sends an XEP-0424 retraction
   (`live.ts:118-134`), which is itself a stored row with the stock fallback body
   (`packages/xmpp-core/src/stanza/build-outgoing.ts:161-180`); the chat list preview
   then reads "This person attempted to retract a previous message…"
   (`apps/server/src/chats/unread.ts:60-79`, `240-288`). On both clients the progress
   bubble becomes a "Message deleted" tombstone
   (`apps/web/src/components/MessageBubble.tsx:174-185`,
   `apps/mobile/src/components/chat/message-bubble.tsx:168`).
3. **The status line already exists and is already silent.** The AI sends XEP-0085
   chat states today (`apps/server/src/agents/dm-turn.ts:124,144`;
   `apps/server/src/agents/group-turn.ts:195,243`) through
   `liveSendTyping` (`live.ts:143-153`). A chat-state stanza has no body and no store
   hint (`build-outgoing.ts:214-224`), so it is never archived, never pushed and never
   counted. That is the mechanism §4.1 should extend with a short text.
4. **The clients already have a dead hook for it.** `AiStatus = 'idle' | 'working'`
   (`packages/chat-core/src/types.ts:23`) is read by both headers
   (`apps/web/src/components/ChatHeader.tsx:50`,
   `apps/mobile/src/components/chat/chat-header.tsx:84`) and by the chat-list label
   (`packages/chat-core/src/chat-labels.ts:27`), but **nothing ever writes it** (no
   other match for `aiStatus` in `apps/` or `packages/`). The "AI · working…" line is
   dead code today.
5. **The session log does not exist.** No table, no route. `docs/design/agent-system.md`
   §2.2 requires it as the source for the card and "View steps" (§4.5).

## 1. Today, end to end

### 1.1 What a user sees while an AI works

| Moment | What happens | Where |
| --- | --- | --- |
| The owner's message wakes a turn | typing `composing` to the owner (DM) or the room | `dm-turn.ts:124`, `group-turn.ts:195` |
| Before every model call | `checkRoundGate` (kill switch + budget) | `dm-tool-turn.ts:99-111` |
| The first tool round of a multi-round turn | **one stored `progress` message** posted with the stage as its body: `{v:0,type:'progress',data:{ai,stage}}` | `live.ts:82-99`, `tool-exec.ts:235-241` |
| Every later round | a **XEP-0308 correction** of that message with the new stage as its body | `live.ts:98`, `build-outgoing.ts:144-158` |
| The final answer | `clearProgress` **retracts** the progress message, then the answer is sent as a normal message | `live.ts:118-134`, `dm-tool-turn.ts:354-363` |
| The turn ends | typing `paused` | `dm-turn.ts:144`, `group-turn.ts:243` |

Details that matter:

- Progress is posted **only** for multi-round turns (`maxRounds > 1`): a legacy
  single-round turn posts nothing (`dm-tool-turn.ts:92`, `177-179`). In production
  `maxRounds` is `AGENT_TOOL_MAX_ROUNDS` (1 when `TOOLS_ENABLED` is off, 6 when on:
  `apps/server/src/config.ts:441-457`), so a web-search AI turn does post a card.
- Stage text comes from a fixed table, never model or tool text
  (`apps/server/src/agents/tool-guide.ts:27-57`).
- The stage table does not cover the plan of the whole turn: it is one line per tool
  call, so there is no "planned → doing → done" checklist and no elapsed time
  (`tool-guide.ts:23-26`).
- The card renders the payload's `stage` and `percent`
  (`apps/web/src/components/ProgressCard.tsx:6-39`,
  `apps/mobile/src/components/chat/progress-card.tsx:8-27`); web shows it inside the
  bubble (`apps/web/src/components/message/AttachmentBody.tsx:245-255`), mobile
  through `PayloadCard` (`apps/mobile/src/components/chat/payload-card.tsx:22-31`).
- **A correction does not carry the payload** (`build-outgoing.ts:144-158` builds only
  `<body>` + `<replace/>`), and the clients do not update `message.card` on a
  correction (`packages/client-core/src/store/ledger-edits.ts:116-169`). So after the
  first correction the bubble shows the *new* stage as body text while the card above
  keeps the *first* stage: two stages in one bubble.
- The progress payload is at `ProgressSchema` (`packages/protocol/src/progress.ts:4-14`,
  in the union at `packages/protocol/src/payload.ts:28`): `ai`, optional `task_id`,
  `stage` (1-100 chars), optional `detail` (≤500), optional `percent`. No title, no
  checklist, no elapsed time, no Stop.
- No "View steps": there is nowhere per-task to look at what the AI did (see §1.5).

### 1.2 Whether the card notifies (push, unread, preview, "last message")

A progress message and its corrections **do** notify today, on web and mobile, and
they **do** count as unread. The chain:

- **It is stored.** The progress send passes a non-empty body (the stage) and the
  payload, so `buildMessage` adds `<store/>` and MAM archives it
  (`build-outgoing.ts:85-140`, esp. `109-111`). The server itself relies on that: the
  AI's own progress lines are read back out of the archive and dropped from context
  (`apps/server/src/agents/context-edits.ts:66-89`, esp. `75`; test at
  `apps/server/src/agents/context-edits.test.ts:60-65`).
- **ejabberd publishes a push IQ per archived message.** `mod_push` is configured with
  `notify_on: messages` (`infra/ejabberd/ejabberd.yml:212-229`; same in
  `deploy/baremetal/ejabberd.yml:221-237`). Our component then resolves *what* to show
  from the archive (`apps/server/src/push/archive-scan.ts:55-160`).
- **The resolution does not skip progress rows.** `resolveCandidate` skips only: an
  empty origin id, a retraction row, a body-less reaction row
  (`apps/server/src/push/candidates.ts:28-43`). A progress row has an origin id (set by
  `buildMessage`, `build-outgoing.ts:137`), a body and no retract marker, so it
  resolves `ok` and pushes (`candidates.ts:98-131`). The preview is the stage text
  (`apps/server/src/push/payload.ts:118-130`). The same holds for a correction row.
  The 10-minute freshness window (`archive-scan.ts:15-18`) does not help: a turn posts
  and corrects *within* the window.
- **Group and topic rooms** go through the same resolver in the polling notifier
  (`apps/server/src/push/group-notifier.ts:119-185`, esp. `144`), so a card in a group
  notifies every offline member too.
- **Unread counts and the chat-list preview** come from the server
  (`apps/server/src/chats/unread.ts`, served by `apps/server/src/chats/api.ts`):
  `summarizeUnread` counts every non-own row after the read mark and takes the newest
  row as the preview (`unread.ts:240-288`, esp. `256-285`). It has **no** skip for
  progress rows, corrections or retraction rows, so:
  - the AI's stage lines each add to the unread badge, and
  - the preview (the "last message" line) becomes the stage text, and
  - after `clearProgress` the preview becomes the retraction fallback sentence
    (`unread.ts:60-79` labels a row from its raw text; the fallback text is
    `build-outgoing.ts:161-162`).
  `isOwnRow` cannot rescue this: a progress row's `from` is the AI JID, not the owner
  (`unread.ts:84-95`).
- **Clients.** Web and mobile render what the API returns and mirror a local unread
  bump on an incoming message (`packages/client-core/src/store/ledger-incoming.ts:212-225`);
  the retraction is applied as a tombstone (§1.4). The web in-tab notifier shows a
  native notification for an unmuted incoming message (`apps/web/src/lib/push/inTab.ts`);
  it too is fed by the incoming stream, not by a payload filter.

**Conclusion: only a server-side rule can stop card edits notifying.** Both transports
and the unread/preview path are server-side; a client change cannot fix push or the
badge count.

### 1.3 XMPP chat states (typing) for AIs

Yes, already sent, and already silent:

- DM: `composing` before the turn, `paused` in a `finally` (`dm-turn.ts:124`, `144`).
- Group/topic: `composing` / `paused` around the reply (`group-turn.ts:195`, `243`).
- The stanza is `<message type=… ><composing|paused xmlns="…#chatstates"/></message>`
  with **no body and no store hint** (`build-outgoing.ts:214-224`), so MAM does not
  archive it; with no origin id it would also be skipped by `candidates.ts:28-30` even
  if it were archived.
- Clients already show it: the typing decode path is
  `packages/xmpp-core/src/stanza/decode.ts:139-140,179` → event `typing`
  (`packages/xmpp-core/src/types.ts:151`, `events.ts:33`) → `handleTyping`
  (`packages/client-core/src/store/lifecycle.ts:315`) → the typing line
  (web `ChatHeader.tsx:137`, mobile `chat-header.tsx:84-90`).
- Rendered as dots with no text today (`apps/web/src/components/TypingDots.tsx`,
  `apps/mobile/src/components/chat/typing-dots.tsx`).

This is the cheapest place to put a **status line with text**: extend the position
where the AI already speaks silently.

### 1.4 What a retraction looks like on each client

- The AI's retraction is a real message with `<retract/>`, a `<fallback/>` and a
  `<body>` (the stock sentence) plus `<store/>` (`build-outgoing.ts:161-180`).
- **Web:** the target keeps its place as a slim tombstone
  (`apps/web/src/components/MessageBubble.tsx:174-185`,
  `apps/web/src/components/message/MessageTombstone.tsx`).
- **Mobile:** the same tombstone (`apps/mobile/src/components/chat/message-bubble.tsx:168`).
- **State:** a retraction drops the card and every other payload field from the
  message (`packages/client-core/src/store/ledger-edits.ts:138-169`, esp. `156-169`).
- **Chat list:** the server preview for that chat becomes the fallback sentence
  (§1.2), so a finished AI turn leaves "This person attempted to retract a previous
  message…" as the chat's last-message line until the next message.
- Push is *not* sent for a retraction (`candidates.ts:31-35`), so this one is a preview
  bug, not a buzz.

### 1.5 Other places the live card leaks

These are not user-visible in the chat, but they are where a "quiet" UX still leaves
traces, and the plan must cover them:

- **AI memory:** the indexer stores one row per archive row, using the body text
  (`apps/server/src/agents/memory/indexer.ts:105-115`). A progress row's body is its
  stage, so the AI remembers "AI: Running tests" as a fact from the conversation. No
  payload filter exists (the module only special-cases stickers,
  `indexer.ts:53-59,76,111-113`).
- **Media index:** `extractMediaItems` reads links out of every body
  (`apps/server/src/media/extract.ts:117-157`), so a URL a stage text never contains is
  fine, but a tool-driven stage could later inject one.
- **Archive search:** no reference to `urn:zilar:agent:0` under
  `apps/server/src/search/`, so a card's body is searchable like any message.
- **Context:** already handled — progress rows are dropped
  (`context-edits.ts:75`).

## 2. The design for §4

### 2.1 The status line (§4.1)

**Decision: extend the existing chat-state stanza with a short status text; do not
invent a new ephemeral channel.** A body-less, non-stored message leaves no trace in
history by construction (`build-outgoing.ts:214-224`), goes to DMs and group rooms with
one code path, and the clients already render it.

- `buildTyping` gains an optional `status` and emits
  `<stage xmlns="urn:zilar:agent:0">Running tests (2/3)…</stage>` next to the chat
  state (`packages/xmpp-core/src/stanza/build-outgoing.ts:214-224`).
- `TypingEvent` gains optional `status` (`packages/xmpp-core/src/types.ts:151`) and
  `parseTyping` reads it (`packages/xmpp-core/src/stanza/decode.ts:139-140,179`). An
  old client ignores the unknown child (it is simply not read), so this is backward
  compatible.
- Old servers keep sending the bare chat state; new clients then show the existing
  dots with no text. Both directions are safe.
- Text is always one of the fixed `TOOL_STAGE_*` lines (`tool-guide.ts:27-57`), ≤80
  chars; never model or tool text.
- Clients: the typing line shows the text when present
  (`apps/web/src/components/ChatHeader.tsx:137`,
  `apps/mobile/src/components/chat/chat-header.tsx:84-90`), i.e. "Zilar · Running
  tests (2/3)…". The chat **list** preview keeps showing the last *message*, not the
  status: a status must never change the chat-list line (that is the whole point of
  §4.1).
- Wire it from the same place as the card (`live.ts`), not from the tool loop, so both
  stay in one place.
- Rejected alternative: a non-stored message with only a custom element and no chat
  state. It needs a second client code path for no benefit, since chat states already
  prove the "no trace" property here. Rejected alternative: the drafts SSE stream
  (`apps/server/src/drafts/api.ts:44`) — it is DM-only (`group-turn-body.ts:256`).
- The dead `aiStatus` field (`packages/chat-core/src/types.ts:212`) should be either
  wired to the status or deleted; see §3, task B.

### 2.2 The task card (§4.3)

One `progress` message per task, edited in place, collapsed by default.

**Protocol (`packages/protocol/src/progress.ts:4-14`), backward compatible: every new
field is optional and `stage` stays required and unchanged.**

```ts
export const ProgressStepSchema = struct({
  id: Schema.String.pipe(Schema.check(Schema.isMaxLength(64))),
  label: Schema.String.pipe(Schema.isMinLength(1), Schema.isMaxLength(80)),
  state: Schema.Literals(['planned', 'doing', 'done', 'failed']),
});

export const ProgressSchema = struct({
  ai: JidSchema,                       // unchanged
  task_id: Schema.optional(IdSchema),  // unchanged
  stage: Schema.String.pipe(..., isMaxLength(100)), // unchanged, required
  detail: …,                           // unchanged
  percent: …,                          // unchanged
  title: Schema.optional(String≤100),
  steps: Schema.optional(Schema.Array(ProgressStepSchema)≤20),
  started_at: Schema.optional(IsoDateTimeSchema),
  elapsed_ms: Schema.optional(Int ≥ 0),
  summary: Schema.optional(String≤200),   // "Done in 2m 14s · 12 steps · $0.03"
  state: Schema.optional(Schema.Literals(['working', 'done', 'failed', 'stopped'])),
  can_stop: Schema.optional(Schema.Boolean),
});
```

Backward compatibility, both directions, is structural: `PayloadSchema` decoding treats
a struct as open, so unknown keys are ignored — the precedent comment is at
`apps/server/src/agents/tool-loop.ts:100-102` and the union member is
`packages/protocol/src/payload.ts:28`. A rolling deploy therefore never breaks:
new server → old client ignores the new fields and still renders `stage`; old server →
new client sees them absent. The payload stays far under `MAX_PAYLOAD_BYTES`
(`payload.ts:13`); caps above (20 steps, 80-char labels) keep it so.

**Edits carry the payload.** A correction today cannot update a card
(`build-outgoing.ts:144-158`, `ledger-edits.ts:116-169`). Add an optional `payload` to
`buildCorrection` and have the clients apply it to `message.card` on a correction
(`packages/client-core/src/store/ledger-edits.ts`, mobile's `chat-rows.ts` twin). Cost:
about 15 lines in `build-outgoing.ts` and one branch in the ledger per client. This is
what makes "edited in place" real instead of a frozen card.

**One message per task, throttled.** The reporter keys on `task_id`, holds the message
id in the session (`live.ts:68-141` already does this for one turn), and only corrects
when the stage changes or 1 s has passed, so a fast turn does not write a MAM row per
step.

**No retraction.** `clearProgress` is deleted: the card is left in place and its last
correction sets `state: 'done'` and `summary`. That removes the tombstone and the
fallback preview of §1.4. The old server's retraction behaviour simply stops applying
after the deploy (best effort, no migration).

**Checklist source.** The brain builds the step list from the tool calls of the turn:
`runLoopRound` already knows the tool name and action (`tool-exec.ts:197-289`,
`actionOfCall` at `294-310`) and the fixed stage table gives the label
(`tool-guide.ts:52-57`). Steps are appended as they are planned; the first is marked
`doing`, and the previous is marked `done` when the next starts.

**Collapsed by default:** the bubble renders one line (title + spinner + elapsed) and
expands on tap; web and mobile twins in one task (§3, task D).

### 2.3 Never notify on card edits (§4.3, §4.4)

One rule, one module, three readers — so push, unread and preview cannot drift.

New `apps/server/src/notify/ai-cards.ts`:

```ts
/** True when an archive row is live AI UI (a task card or its edit), never a message. */
export function isLiveAiUiRow(xml: string): boolean
```

It decodes the `<agent>` payload the way `media/extract.ts:8-34` and
`agents/memory/indexer.ts:55-68` already do (the regex lives in one place now) and
returns true for `type: 'progress'`, and for a `<replace/>`/`<retract/>` row whose
target resolves to such a row in the same batch (a correction target is already read
defensively by `apps/server/src/search/snippet.ts:81` `correctionTarget`).

Readers:

1. **Push:** `resolveCandidate` returns `skip` for a live-UI row, next to the existing
   retraction skip (`push/candidates.ts:28-43`). This covers both the per-device scan
   (`push/archive-scan.ts`) and the group notifier (`push/group-notifier.ts:144`).
2. **Unread:** `summarizeUnread` ignores live-UI rows when counting and when choosing
   the preview, and keeps walking to the newest row that is not live UI or a
   retraction (`chats/unread.ts:240-288`). A turn that only ever posted a card
   therefore leaves the chat's preview and badge untouched until the answer arrives.
3. **Preview:** the same skip inside `labelForRow`'s caller, so the fallback sentence
   of a legacy retraction row never becomes a preview either
   (`chats/unread.ts:60-79`).

Also applies the rule to the two non-chat readers of §1.5: the memory indexer
(`agents/memory/indexer.ts:105-115`) and the media extractor
(`media/extract.ts:117-157`) skip live-UI rows. Archive search is left as is (a card
is no longer a chat message, but hiding it from search is a separate decision).

Tests (message pipeline, so they are required): a progress row and a progress
correction do not push; a progress row does not count as unread and does not become the
preview; the newest real message still does. Extend
`apps/server/src/push/candidates.test.ts` and `apps/server/src/chats/unread.test.ts`
(they already have the fixtures for both).

### 2.4 Stop (§4.3, §3.6)

**Today there is no per-turn stop.** `POST /api/ais/:id/stop` is the owner's kill
switch: it flips `ais.status` (`apps/server/src/ais/status.ts:17-60`, route at
`packages/api-contract/src/ais.ts:163-166`, handler `apps/server/src/ais/api.ts:297-318`)
and the gateway disconnects the AI (`apps/server/src/agents/gateway/lifecycle.ts:161-168`,
`apps/server/src/agents/gateway/sessions.ts:193-207`). The in-flight turn keeps
running; only its *sends* are dropped (`gateway/live.ts:24-49`), and the running
`runDmTurn` promise is not cancelled (`gateway/dm-turn.ts:81-100`).

**Decision: a new authenticated HTTP route, not an XMPP payload.**
`POST /api/ais/:id/tasks/:taskId/stop`. Reasons: an XMPP control message would be
archived, counted and pushed (exactly what §4.3 forbids); owner decisions already travel
over HTTP (`POST /api/approvals/:id/decision`,
`packages/api-contract/src/approvals.ts:93-97`); and a route is covered by the 401
sweep and can be rate-limited like every other write.

Cancellation points, all existing, cited so the implementation is exact:

| Point | File | Today |
| --- | --- | --- |
| Before each round (kill switch + budget) | `dm-tool-turn.ts:99-111` | `checkRoundGate` already stops the loop between rounds |
| Wall-clock cap | `dm-tool-turn.ts:96-98` | breaks the loop |
| Every send during a turn | `gateway/live.ts:30-32,38-49` | drops the reply and drafts when stopped |
| The in-flight model request | `tool-loop.ts:235-313` | an `AbortController` per call, aborted on release |
| The last tool-free call | `dm-tool-turn.ts:305-323` | gate runs before it |

Plan: the session stores one `AbortController` per running turn
(`apps/server/src/agents/gateway/contracts.ts` `AiSession`, written in
`gateway/dm-turn.ts` / `group-turn.ts` next to the `pumpSession` loop). The route looks
up the AI (owner-scoped, 404 for a foreign or missing id, the same answer as
`stopAi` at `ais/status.ts:22-25`) and calls a gateway hook that (a) marks the task
stopped so `checkRoundGate` trips on the next round, and (b) aborts the controller, so
the model call and any tool call end immediately. `threadCompletion`/`fetch` already
honour the signal (`tool-loop.ts:241-249`). The turn then exits through the existing
paths and the card gets one last correction with `state: 'stopped'`.

The gateway hook is the same shape as `onApprovalDecided`
(`apps/server/src/main.ts:369`, `apps/server/src/actions/gateway.ts:54-87`), so the
route never reaches into the agent internals and works when the gateway is not running
(it then answers 404 like the AI is unknown).

### 2.5 "View steps" — the session log (§2.2, §4.5)

New append-only table `agent_task_events` (new migration, expand-only, `SET lock_timeout
= '5s';`, no change to any existing column — `AGENTS.md` "Migrations").

```sql
CREATE TABLE agent_task_events (
  id          text PRIMARY KEY,
  task_id     text NOT NULL,
  ai_id       text NOT NULL,
  chat_jid    text NOT NULL,          -- DM peer or room bare JID
  seq         integer NOT NULL,       -- per task, ascending
  kind        text NOT NULL,          -- status|model_call|tool_call|tool_result|approval|answer|error
  at          timestamptz NOT NULL,
  duration_ms integer,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- ids, counts, hosts, sizes
  CONSTRAINT agent_task_events_seq_unique UNIQUE (task_id, seq)
);
CREATE INDEX agent_task_events_task_idx ON agent_task_events (task_id, seq);
```

- **Writer:** the same places that emit the card. `runLoopRound` for `tool_call` /
  `tool_result` (`tool-exec.ts:197-289` covers both the execute and the truncate step),
  the completion wrapper for `model_call` (`tool-loop.ts:218-314` for tokens, duration
  and the redacted error class), the progress reporter for `status`, the approval path
  for `approval` (`actions/production-announcer.ts:50-111`), and the answer send for
  `answer`. One `appendEvent` helper, best effort: a log failure never fails a turn
  (the same contract as the progress sends, `live.ts:100-110`).
- **Redaction, non-negotiable:** `AGENTS.md` "Audit entries carry ids only, never
  message text, code or output". So `data` holds the tool name, the action, the
  contacted hosts, byte counts, token counts, cost estimate, the outcome and the
  duration — **not** the arguments, not the output, not the message text. Errors are
  stored as the fixed failure class (`agents/failure-class.ts` via
  `mapFailureToReply`, `tool-exec.ts:43-58`), never the provider body. Every write
  passes `redactSecrets` (`ai/litellm-client.ts`) as a backstop. If Julio wants raw
  (redacted) output for "commands, outputs, files changed" (§4.5), that is a decision
  to confirm — see §4.
- **Retention:** 30 days, deleted by a leader-only sweeper modelled on the approvals
  sweeper (tick every 60 s, `approvals/sweeper.ts:16-47`), plus `ON DELETE CASCADE`
  from the AI and group delete paths (`groups/delete-group.ts:59` names the tables that
  must be cleaned; add this one to the same list). A task older than the window shows
  "Steps are no longer available".
- **Route:** `GET /api/agents/tasks/:taskId/events` (new
  `packages/api-contract/src/agent-tasks.ts` group, prefix `/api` like the others,
  `.middleware(Session)`, covered by the 401 sweep). Visibility is re-checked at read
  time with the same rule the card obeys: owner for a DM, a current group member for a
  room (`groups/members.ts` / `topics/access.ts:canSeeTopic`). An unknown task and a
  task the caller may not see answer the same 404 (`AGENTS.md` security checklist).
  Pagination with `seq` (`?after=<seq>&limit=50`), matching the archive paging style.
- **Screens:** web, a "View steps" panel opened from the card
  (`apps/web/src/components/` next to `ApprovalCard.tsx`); mobile, a bottom sheet
  (`apps/mobile/src/components/chat/` next to `approval-card.tsx`). Both render the
  same neutral list: icon, kind, label, duration; a tap on a tool row shows the
  metadata. No raw output in the chat, ever (§4.5).

### 2.6 Approvals (§4.6)

Approvals already exist end to end and are the closest to the target:

- Schema: `ApprovalRequestSchema` (`packages/protocol/src/approval.ts:6-17`) with
  `expires_at`, `args_hash`, `worst_case_cost`; card payload built at
  `apps/server/src/actions/announce.ts:33-96`.
- One card per request today (`actions/production-announcer.ts:50-111`), decided over
  `POST /api/approvals/:id/decision` (`packages/api-contract/src/approvals.ts:86-106`),
  listed by `GET /api/approvals` for the pending view
  (`apps/server/src/approvals/queries.ts:100+`), access-checked by
  `apps/server/src/approvals/access.ts:17-76`.
- Timeout: `expires_at` must be in the future and within 24 h
  (`apps/server/src/approvals/schemas.ts:14`, `approvals/service.ts:26-62`), and a
  leader sweeper expires stale rows (`approvals/sweeper.ts:16-47`,
  `approvals/service.ts` `expireStale`), audited as `approval.expired`
  (`approvals/sweeper.ts:50-60`).

Plan: **batch by task.** Add a nullable `task_id` to `approvals` (expand-only), tag
each request at creation, and have the announcer send **one card per task** carrying up
to N requests (`actions/announce.ts` builds a `progress`-shaped card list) instead of
one card each. Decision stays per request (the route is unchanged); the card's
Approve/Deny applies to the selected subset. The card shows the earliest `expires_at`
as its countdown, so the batch expires with its first member, and the sweeper needs no
change. This is the smallest change that satisfies "Several requests in one task are
batched into one card" (§4.3, §4.6) without touching who may decide.

### 2.7 Groups (§4.7)

Already correct today, and the audit found nothing to change in the rule:

- A room message starts a turn for an AI **only** when the AI is mentioned, or when the
  message is a reply to one of its own messages: `apps/server/src/agents/gateway/group-ingest.ts:84-155`,
  esp. the mention check at `139-146` and the early return at `152-155` ("No mention,
  nobody replies").
- An edit or a retraction in a room is never a mention and starts no turn
  (`group-ingest.ts:88-91`).
- A room message from a stranger's room is never answered (`group-ingest.ts:115-118`),
  and AI-to-AI hand-offs are bounded (`group-ingest.ts:156-160`, T-0481).
- The group turn path has no drafts (`group-turn-body.ts:256`) and posts the card
  through the same reporter (`group-turn-body.ts:266-298`), so §2.2's card and §2.3's
  skip cover groups once they land.

Gap to name honestly: **"or assigned" does not exist yet.** There is no task-assignment
concept in the room ingest; a routine or a delegated objective is the closest thing
(`packages/protocol/src/task.ts`, `BoardUpdateSchema`). Adding "assigned" is new scope;
see §4.

### 2.8 Queue and failure (§4.8)

- **Queue:** the sandbox concurrency cap is P2 (`agent-system.md` §2.3, line 71). The
  card needs one extra state text ("Queued (2 ahead)") plus a `state: 'working'` value
  and a `detail` line; the protocol in §2.2 already allows it without a new field.
- **Failure:** the card's last correction sets `state: 'failed'` and a one-sentence
  `summary`; the fixed sentences already exist (`apps/server/src/agents/replies.ts`,
  mapped by `tool-exec.ts:43-58`) and the retry affordance is a new client button that
  re-sends the trigger (no new server path).
- The session log holds the detail (§2.5), so the failure text in chat stays one line.

## 3. Task split

Ordered, each at most ~600 changed lines and each new/edited file at most 400 lines.
Web and mobile twins are one task (parity rule). Tests only for the message pipeline
(the push/unread resolvers and the protocol/XML round-trips); no UI tests
(`AGENTS.md` "Tests").

### Task A — Never notify on live AI UI (do this first; benefits today's AIs)

- Files: new `apps/server/src/notify/ai-cards.ts` (~120 lines); edit
  `apps/server/src/push/candidates.ts:22-56` (skip branch);
  `apps/server/src/chats/unread.ts:240-288` (count + preview skip);
  `apps/server/src/agents/memory/indexer.ts:105-115` and
  `apps/server/src/media/extract.ts:117-157` (skip live-UI rows, reuse the shared
  decoder).
- Deletes: the two duplicated `<agent>` regexes
  (`media/extract.ts:8-12`, `agents/memory/indexer.ts:55-59`) move into the new module.
- Tests: `apps/server/src/push/candidates.test.ts`,
  `apps/server/src/chats/unread.test.ts`, new
  `apps/server/src/notify/ai-cards.test.ts` (progress row, progress correction,
  legacy retraction, a normal message, a body-less reaction).
- Lead's check: web `?mock=1` → the "Dev AI" thread
  (`packages/mock-backend/src/domains/messages/threads/dev-team.ts`) posts progress
  cards; the chat must show no unread badge and its preview must not change. Mobile,
  same scenario on the emulator mock build (`EXPO_PUBLIC_ZILAR_MOCK=1`). Live: trigger
  a web-search turn and watch the badge and the chat-list line stay put.

### Task B — Status line (both clients, one batch)

- Files: `packages/xmpp-core/src/stanza/build-outgoing.ts:214-224` (optional `status`),
  `types.ts:151` (+`status?`), `stanza/decode.ts:139-140,179` (parse it),
  `stanza.test.ts` (round-trip, old stanza still parses); server
  `apps/server/src/agents/gateway/live.ts:143-153` (+`liveSendStatus`),
  `agents/dm-turn.ts:124,144`, `agents/group-turn.ts:195,243`,
  `agents/dm-tool-turn.ts` (status per round), `agents/gateway/dm-turn.ts` and
  `group-turn-body.ts` (wiring); web `ChatHeader.tsx:137` + `TypingDots.tsx`; mobile
  `chat-header.tsx:84-90` + typing-dots.
- Deletes: the dead `aiStatus` field and its three readers
  (`packages/chat-core/src/types.ts:212` and `23`,
  `chat-labels.ts:27`, both headers) — wire it to the status instead, or drop it.
  Keeping both would be two sources of truth.
- Tests: `packages/xmpp-core/src/stanza.test.ts` only (XML round-trip).
- Lead's check: web `?mock=1`, trigger a turn, watch the text next to the dots change
  and then vanish; reload the chat — nothing in history. Mobile emulator, same.

### Task C — Task card protocol + server (one card, edited in place)

- Files: `packages/protocol/src/progress.ts:4-14` (new optional fields + `ProgressStep`),
  `packages/protocol/src/payload.test.ts` (old payload still valid; new payload valid;
  step cap enforced); `packages/xmpp-core/src/stanza/build-outgoing.ts:144-158`
  (`buildCorrection` takes an optional payload) + `stanza.test.ts`; new
  `apps/server/src/agents/task-card.ts` (build + throttle + step list from the tool
  calls, ~180 lines); `apps/server/src/agents/gateway/live.ts:61-141` (reporter: one
  message per `task_id`, no retraction, correction carries the payload);
  `apps/server/src/agents/tool-exec.ts:197-289` (feed the step), `dm-tool-turn.ts`
  (drop `clearProgress` calls at `269-372`), `agents/dm-turn.ts` and
  `agents/group-turn.ts` (remove the `clearProgress` dep).
- Deletes: `clearProgress`, `clearProgressQuietly` (`dm-tool-turn.ts:366-380`), the
  retraction branch in `live.ts:113-134`, and the `clearProgress` field on
  `DmTurnDeps`/`GroupTurnDeps` (`dm-turn.ts:94-96`, `group-turn.ts:81-83`). Net: fewer
  lines than today.
- Tests: the protocol test above, plus `apps/server/src/agents/reply.test.ts` and
  `gateway.test-harness.ts` expectations that currently assert a retraction (search
  `clearProgress` in `apps/server/src/agents/*.test.ts`).
- Lead's check: web `?mock=1` with a multi-step scenario; the bubble must update in
  place, must not become a tombstone, and must end with the summary line. Mobile
  emulator, same. Live: a real turn with tools on.

### Task D — Card UI (web + mobile) with Stop

- Files: web `apps/web/src/components/ProgressCard.tsx:6-39` (title, checklist,
  elapsed, collapsed, summary, state) and `AttachmentBody.tsx:245-255` (expand
  handler); mobile `apps/mobile/src/components/chat/progress-card.tsx:8-27` and
  `payload-card.tsx:22-31`; the Stop tap calls the Task-F route; clients apply a
  correction's payload to `card` (`packages/client-core/src/store/ledger-edits.ts:116-169`
  and mobile `apps/mobile/src/store/effects/chat-rows.ts:8-20`).
- Deletes: the frozen-card workaround is nothing to delete, but the `percent` bar in
  both cards goes (progress is a checklist now); keep `stage` rendering for an old
  server.
- Tests: none (UI).
- Lead's check: web `?mock=1` (a card with 3 steps in each state, one `failed`), then
  the emulator mock; live after Task C ships.

### Task E — Stop a running turn

- Files: `packages/api-contract/src/ais.ts:163-170` (new
  `POST /ais/:id/tasks/:taskId/stop`); `apps/server/src/agents/gateway/stop.ts` (new,
  ~90 lines: owner-scoped lookup, hook call, 404 rules); the `AiSession` controller
  field in `agents/gateway/contracts.ts` + `gateway/dm-turn.ts` /
  `gateway/group-turn.ts`; `apps/server/src/main.ts` (hook wiring, next to
  `onApprovalDecided` at `369`); `apps/server/src/agents/tool-loop.ts:218-314` (take an
  optional external `signal`).
- Deletes: nothing. The kill switch route (`ais/api.ts:297-318`) stays.
- Tests: `apps/server/src/agents/*` (a stop mid-turn drops the reply and the card ends
  `stopped`) — the message pipeline, so required; plus a 404/owner test for the route.
- Lead's check: web `?mock=1`, tap Stop on a card, the card stops updating and shows
  "Stopped"; live against a slow real turn.

### Task F — Session log + View steps route

- Files: new `apps/server/drizzle/0055_agent_task_events.sql` (with
  `SET lock_timeout = '5s';`); new `apps/server/src/agents/log/` (`events.ts`,
  `append.ts`, `read.ts`, `retention.ts`, ~300 lines total); new
  `packages/api-contract/src/agent-tasks.ts` + `apps/server/src/agents/log/api.ts`
  (route, `Session` middleware, `/api` prefix); the writers at
  `tool-exec.ts:197-289`, `tool-loop.ts:218-314` (model call),
  `gateway/live.ts` (status), `actions/production-announcer.ts:50-111` (approval);
  `apps/server/src/leader/start.ts:197` (register the retention sweeper).
- Deletes: nothing.
- Tests: `apps/server/src/agents/log/` (append + read + access: owner sees, a stranger
  and a non-member get 404, retention deletes only old rows).
- Lead's check: live only (the mock needs a scenario, which is part of Task G).

### Task G — View steps UI (web + mobile)

- Files: new `apps/web/src/components/ViewStepsPanel.tsx` + a "View steps" button on
  the card (Task D); new `apps/mobile/src/components/chat/view-steps-sheet.tsx` + the
  same button; a mock scenario in
  `packages/mock-backend/src/domains/messages/threads/` using the `progressCard`
  builder (`packages/mock-backend/src/domains/messages/builders.ts`).
- Deletes: nothing.
- Tests: none (UI).
- Lead's check: web `?mock=1` (open the panel, see the step list), emulator mock, then
  live.

### Task H — Approvals batching

- Files: `apps/server/drizzle/0056_approvals_task_id.sql` (expand-only); the approval
  row shape (`apps/server/src/db/rows-agents.ts:1-60`), `approvals/service.ts:34-147`
  and `approvals/queries.ts:100+` (`task_id` column + grouping),
  `actions/announce.ts:33-96` (a multi-request card), `actions/production-announcer.ts:50-111`
  (one card per task); web `ApprovalCard.tsx` and mobile `approval-card.tsx` (a list of
  requests, one countdown); `packages/protocol/src/approval.ts` stays as is.
- Deletes: nothing.
- Tests: `apps/server/src/approvals/service.test.ts`, `rules.test.ts` (one card per
  task, per-request decisions, an expired member does not block the rest).
- Lead's check: web `?mock=1` (the "Dev team" thread already has an approval card,
  `packages/mock-backend/src/domains/messages/threads/dev-team.ts`), emulator mock,
  live.

### Task I — Groups follow-up (cards + "assigned")

- Files: verify the card in a room (`group-turn-body.ts:266-298`), add the "assigned"
  trigger if Julio wants it: new `apps/server/src/agents/gateway/group-assign.ts` +
  the ingest branch at `group-ingest.ts:139-155`, and the card's `detail` line.
- Deletes: nothing.
- Tests: `apps/server/src/agents/gateway/*` (a plain room message still starts no
  turn; an assignment does).
- Lead's check: emulator mock group scenario + live with two AIs in a room.

Dependency order: **A → B → C → D → E → F → G → H → I**. A ships alone (it fixes the
spam for today's AIs). B, C and E are independent of each other after A. F must land
before G. H and I are last.

## 4. Risks and open questions

**Risks**

1. **Card edits grow MAM.** One message + N corrections = N+1 archived rows per turn.
   Mitigated by the 1 s / stage-change throttle (§2.2) and by Task A making them
   invisible. If a turn still writes many rows, the next step is to keep only the final
   card in MAM and stream the live state over SSE (the drafts pattern,
   `apps/server/src/drafts/api.ts:44`).
2. **Backward compatibility of the protocol.** New fields are optional and structs are
   open (precedent: `tool-loop.ts:100-102`), so a rolling deploy is safe in both
   directions. The one real compatibility break is `buildCorrection` gaining a payload:
   an old client ignores the child, so it shows the new text without the new card
   fields — degraded, never broken.
3. **Dropping the retraction leaves an old card** on a client that was offline during
   the last correction: it shows "working" forever. Mitigation: the client treats a
   card whose `elapsed_ms` is older than a threshold (say 30 min) and whose chat has
   newer messages as stale and renders the last summary it has. Or accept it until the
   next live-check shows it matters.
4. **Cost on the card needs per-task accounting.** Cost is counted per AI
   (`apps/server/src/ais/usage.ts`), not per task; §4.3's "$0.03" needs a per-task
   accumulator in the session log (P0 work, `agent-system.md` §6 line 208). Until then
   the summary omits the amount.
5. **`pnpm gate` sees only docs.** Nothing in this task is code, so the gate's
   format/lint/typecheck/test steps have nothing to run; `docs/` and `work/` are
   prettier-ignored (`.prettierignore`), which makes the Spec's
   `prettier --check docs/audit/agent-ux-plan.md` a likely no-op. See the Report for the
   real result.

**Open questions (need Julio or the lead)**

1. **Session log content.** §4.5 promises "commands, outputs, files changed", but the
   security checklist in `AGENTS.md` says "audit entries carry ids only, never message
   text, code or output". Task F as specified stores ids, counts and metadata only.
   Confirm before the task is written: (a) ids/metadata only, or (b) redacted and
   truncated (≤2 KiB) tool output, owner-only, 30-day retention? (b) needs a second
   look at the secrets rule (a command's output can echo a token that was never in our
   logs).
2. **Retention window** for the session log: 30 days assumed; longer means more disk.
3. **Where "View steps" opens.** Web: right-hand panel (like the member/info panels) or
   a modal? Mobile: bottom sheet (like approvals) or a full screen? I assumed
   panel/sheet for both.
4. **"Assigned" in groups.** §4.7 says "mentioned or assigned"; only "mentioned"
   exists. Is "assigned" a task/board concept (`packages/protocol/src/task.ts`) or a
   per-AI toggle? Task I is a guess until it is defined.
5. **Stop semantics.** Should Stop also end the *task* (so a later message starts a new
   card, a new `task_id`) or only the turn? I assumed the task, so the card settles at
   `state: 'stopped'` and a new message starts a new card.
6. **Stale card rendering** (risk 3): is a client-side staleness rule wanted, or is an
   old "working" card acceptable?
