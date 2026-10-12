# AI features audit (2026-10-12)

Scope: an AI turn end to end (gateway, LiteLLM call, drafts, final message), the
drafts stream on web and mobile, tools and sandbox, routines, context and cost,
AI management UX and logs. Docs only. Code read on `main` at `428eba640`.

Already covered elsewhere, so not repeated here: SEC-13 (a group member spends the
owner's key and approved hosts), SEC-10 (`LITELLM_MASTER_KEY` placeholder), PERF-9
(drafts SSE open with no AI), MP-5 (no catch-up after reconnect; a draft whose final
message was missed is that gap), UI-8 / WUX-3 / MUX-4 (composer drafts).

Things that hold up: one turn at a time per AI, with messages that arrive during a
turn merged into the next one (`agents/gateway/dm-turn.ts:81-100`); only the owner
gets DM turns and AIs never answer AIs (`dm-turn.ts:123-139`); stops land between
the model call and the send through the `live*` wrappers (`gateway/live.ts:45-48`);
keys are decrypted only in memory and every error is redacted
(`tool-exec.ts:363-376`, `ai/litellm-client.ts:62-85`); sandbox fetch is GET-only
HTTPS, pinned to the resolved IP, with no redirects and blocked private ranges
(`sandbox/host-fetch.ts:98-113,150-170`); web tools add a hard overall deadline
(`web-tools/guarded-fetch.ts:200-207`); claiming a routine is a compare-and-set on
`next_run_at`, so a restart never runs it twice (`routines/scheduler.ts:162-175`);
daily schedules handle DST (`routines/schedule.ts:274-290`); the hard monthly cap
is LiteLLM's `max_budget` on the virtual key (`ais/provisioning.ts:111-116`).

## 1. Summary

Counts: P0 0, P1 8, P2 15.

| Id | Sev | Area | One line | Status |
| --- | --- | --- | --- | --- |
| AI-1 | P1 | Turn | Every deploy drops in-flight AI replies and group mentions without a word: no drain on shutdown, and the reply is paid for. | confirmed |
| AI-2 | P1 | Drafts | Web: the draft `EventSource` closes for good on an HTTP error (deploy 502, 401) and is never reopened; streaming stops until reload. | confirmed |
| AI-3 | P1 | Errors | A provider 429 (rate limit) says "I've reached my spending limit… raise it in My AIs"; nothing is retried. | confirmed |
| AI-4 | P1 | Errors | A wrong model name, a too-long context or a refused prompt all say "try again in a minute", for ever; the model name is never checked. | confirmed |
| AI-5 | P1 | Turn | Replies stop at 1024 tokens with no sign; `finish_reason` is ignored; reasoning models may answer empty. | confirmed (empty: suspected) |
| AI-6 | P1 | Context | A deleted message stays in the AI's context, and an edited one appears twice; tool progress lines become fake assistant turns. | confirmed |
| AI-7 | P1 | Groups | The 7th mention in 10 min (or a round over budget) is dropped silently; the person gets no reply and no notice. | confirmed |
| AI-8 | P1 | Groups | A reply to the AI's message without an @mention is ignored. | confirmed |
| AI-9 | P2 | Groups | Mentions from several people during one turn merge; only the last sender is answered and tagged. | confirmed |
| AI-10 | P2 | Groups | Failure texts in a room tell the asker to fix the owner's key or budget; the owner is never told. | confirmed |
| AI-11 | P2 | Drafts | No draft snapshot on (re)connect: a phone back from background shows stale text for up to 60 s. | confirmed |
| AI-12 | P2 | Drafts | A tool progress message ends the draft turn on the client, so the final round never streams. | confirmed |
| AI-13 | P2 | Drafts | If XMPP beats SSE, a late draft shows a duplicate bubble for up to 5 s. | suspected |
| AI-14 | P2 | Turn | The 120 s turn cap is checked only between rounds; a turn can hold the AI for about 5 min. | confirmed |
| AI-15 | P2 | Cost | Up to 8 LiteLLM key-info calls per turn; the soft daily limit fails open and lags spend. | confirmed (lag: suspected) |
| AI-16 | P2 | Cost | Listener scoring runs on the platform master key with no cap per group. | confirmed |
| AI-17 | P2 | Context | The AI knows only today's UTC date: no time, no user time zone; routine zones are guessed. | confirmed |
| AI-18 | P2 | Routines | 5 runs per 30 s tick with the tick blocked while they run; a missed run fires hours late; a post during a reconnect is lost. | confirmed |
| AI-19 | P2 | Drafts | The drafts SSE checks the session only at connect, so a revoked session keeps receiving drafts. | confirmed |
| AI-20 | P2 | Mgmt UX | You can't change a provider key: you need a new connection, then switch each AI to it. | confirmed |
| AI-21 | P2 | Mgmt UX | Web AI forms show the raw `error.message` ("Failed to fetch") for network errors. | confirmed |
| AI-22 | P2 | Logs | Failure logs carry the provider's free-text error and no failure class; My AIs shows no AI health. | confirmed (content: suspected) |
| AI-23 | P2 | Tools | Hosts are approved per tool, not per version: the AI can rewrite and run a tool against approved hosts with no new approval. | confirmed (by design) |

## 2. Findings by area

### A. An AI turn end to end

**AI-1 (P1, confirmed by code).** `stopEffect` disconnects every session at once
(`agents/gateway/lifecycle.ts:233-248`). There is no drain and nothing waits on
`session.busy`. A turn in flight keeps running. `liveSendMessage` then returns
`{ id: '' }` without sending (`gateway/live.ts:45-46`), so `runDmTurn` reports
"replied". The draft ends `failed` (`gateway/dm-turn.ts:303`) and the bubble
disappears. No message and no failure text arrive, and the tokens are already
spent. In rooms, any mention older than 60 s before the rejoin is skipped
(`gateway/group-ingest.ts:81`), so a deploy longer than a minute loses those
mentions too. `main` auto-deploys on every merge, so this happens several times a day.
Repro: ask the AI a tool question, merge anything, watch the draft vanish.
Fix: `gateway/lifecycle.ts`: set `draining`, refuse new turns
(`gateway.ts:262-268` checks it) and wait for the busy pumps (`session.busy`,
`session.roomBusy`) for up to 20 s before disconnecting. A turn still running
after that sends `TRANSIENT_FAILURE_REPLY` instead of nothing. Pipeline test: a
`stop()` during a turn delivers its reply.

**AI-3 (P1, confirmed by code).** `mapFailureToReply` treats every 429 as the
budget (`agents/tool-exec.ts:45-49`). Providers and LiteLLM send 429 for rate
limits, so the owner reads "I've reached my spending limit… You can raise it in
My AIs" (`tool-loop.ts:22-23`) and raises a limit that was never the problem.
`requestCompletion` makes one attempt only (`tool-loop.ts:318-342`), and
`infra/litellm/config.yaml` sets no `num_retries` (suspected: check LiteLLM's
proxy default). Repro: a free-tier key, three quick questions.
Fix: `tool-exec.ts`: budget only on `/budget/i` in the detail; 429 gets a new
`RATE_LIMITED_REPLY` ("My provider is busy; try again in a minute"). In
`tool-loop.ts`: one retry after 2 s for 429, 5xx or unreachable, only when
`onDelta` has not fired yet. Test: the mapping table in `reply.test.ts`.

**AI-4 (P1, confirmed by code).** Every status that is not 401, 403 or 429 maps
to "I couldn't reply just now. Please try again in a minute."
(`tool-exec.ts:53`, `tool-loop.ts:26`). That covers a 400 or 404 for an unknown
model, a context that is too long, and a content filter. The model field is free
text with hints (`packages/chat-core/src/ai-models.ts:1-11`), and create only
registers it with LiteLLM (`ais/provisioning.ts:102-108`), with no test call. A
typo gives an AI that answers "try again in a minute" to everything. Also
suspected: LiteLLM's hard-cap error is a 400 whose `message` reads "Budget has
been exceeded", while `errorDetail` keeps only `error.message`
(`tool-loop.ts:141-163`). The `/budget_exceeded/` test (`tool-exec.ts:47`) would
then miss it, and a capped AI says "try again". Check the real body from LiteLLM
1.102.1. Fix: `tool-exec.ts`: 400 or 404 with `model` in the detail →
"My model name isn't recognised; the owner can change it in My AIs"; `/budget/i`
→ budget reply; context length → "That conversation is too long for my model".
In `ais/provisioning.ts` and `provisioning-keys.ts`: one `max_tokens: 1` probe
after the model is registered, roll back on 400 or 404, and return a new
`model_not_found` code that `ai-errors.ts` puts into plain words.

**AI-5 (P1; truncation confirmed, empty replies suspected).** `max_tokens` is a
fixed 1024 (`tool-loop.ts:17,221`). The stream parser drops `finish_reason`
(`stream.ts:27-29`), so a reply cut by the cap arrives mid-sentence as if it were
complete. With reasoning models in the hint list (`o3`, `o4-mini`,
`deepseek-reasoner`, `ai-models.ts:5-8`), the reasoning can use up the whole cap
and leave the content empty, which then becomes the transient failure
(`dm-tool-turn.ts`, "empty reply from the model"). Check: an `o3` AI asked for a
long answer. Fix: `stream.ts`: keep the last `finish_reason`; `tool-loop.ts`: raise
the cap to 4096, and when the reason is `length`, add "(cut short; ask me to
continue)".

**AI-14 (P2, confirmed by code).** `TOOL_TURN_WALL_CLOCK_MS` (120 s) is only
checked before each round (`dm-tool-turn.ts:88`). Each model call has its own 90 s
timeout (`tool-loop.ts:20,320`), and the closing call (`dm-tool-turn.ts:314`) adds
another 90 s. A slow provider can therefore hold the turn, and every later owner
message, for about 5 minutes. Fix: `dm-tool-turn.ts`: pass
`timeoutMs: max(5 s, remaining)` to each `requestCompletion`.

**Two messages in quick succession and edits.** Messages are merged correctly: one
pump per AI, and new messages feed the next turn (`gateway/dm-turn.ts:81-100`). An
edit or a delete of the prompt during a turn starts no turn
(`agents/gateway.ts:270`), so the AI answers the old text. That is acceptable on
its own; AI-6 is the real problem.

### B. Context, memory and cost

**AI-6 (P1, confirmed by code).** `toTurn` and `toGroupTurn`
(`agents/context.ts:171-205`) map every MAM item that has a body. A correction
keeps its new body, so an edited message shows up twice, old and new. The original
of a retracted message stays (only the retraction's fallback body is dropped by
xmpp-core). The AI's own progress messages (`gateway/live.ts:88-97`, retracted
after the turn) come back as assistant turns. The memory indexer already applies
both kinds of edit (`agents/memory/indexer.ts:231-252`); the live context does
not. Repro: in a group, paste a secret, delete it, then mention the AI. It can
quote the secret back, including to members who joined after the delete.
Fix: in `context.ts`, a pre-pass before `slice(-50)`: apply corrections to their
target by id, drop retracted targets, and drop items whose payload type is
`progress`. The file is 293 lines, so the helper goes into a new
`agents/context-edits.ts`. Pipeline test: history with a correction and a
retraction.

**History size.** 50 messages capped at 40 000 characters
(`context.ts:12,16,250-257`), plus memory. In a tool turn this is resent on every
round, with up to 8 KiB per tool result (`tool-loop.ts:376`), so a 6-round turn
costs roughly 6× the input tokens. That's acceptable for now, and AI-15 covers
the gate.

**AI-15 (P2; confirmed, lag suspected).** `checkDailyLimit` runs once per turn and
`checkDmRoundGate` runs before every round (`gateway/budget.ts:81,178-195`). Each
call is a LiteLLM `getKeyInfo` (`ais/usage.ts:62`), so a 6-round turn makes about
8 admin calls. When the call fails, the gate lets the turn through
(`budget.ts:86`). LiteLLM writes spend in batches, so a fast tool loop can pass
the soft daily limit before the gate sees it (check the proxy's batch-write
interval). The hard monthly cap still holds. Fix: `budget.ts`: cache `AiUsage` per
AI for 30 s and drop the cache after each turn.

**AI-16 (P2, confirmed by code).** The listener (`LISTENER_ENABLED`, off by
default, `config.ts:256`) scores room windows on `LITELLM_MASTER_KEY`
(`main.ts:567`, `gateway/listener.ts:170-178`). The platform pays for it, with
no count and no cap per group or per day. Fix: `gateway/listener.ts`: a daily
counter per group in memory (for example 200 scorings), logged with ids only.

**Who pays in a group:** the AI owner (SEC-13). The provider key is stored
encrypted and handed to LiteLLM as a private model (`provisioning.ts:99-108`).
There is no key-rotation path (AI-20).

**AI-17 (P2, confirmed by code).** The prompt prefix says only "Today is
YYYY-MM-DD", the UTC date (`context.ts:69,137`; `gateway/dm-turn.ts:206-207`;
`gateway/group-turn.ts:329`). No user time zone is stored (`db/rows.ts` has
none). "Remind me at 9 every morning" gets a zone the model guesses. The approval
card does show it (`tools/routine-adapters.ts:50`), so it can be caught. Late in
the UTC day the AI may also give the wrong date. Fix: clients send their IANA
zone in `PATCH /api/me`, stored in a new nullable `user.time_zone` column
(hand-written migration). The prefix then becomes "Now: 2026-10-12 14:03
Europe/Madrid".

### C. Groups and mentions

**AI-7 (P1, confirmed by code).** Six turns per AI per room per 10 min
(`gateway/contracts.ts:98-99`) and four AI turns per human message
(`contracts.ts:103`). Past either limit the turn is dropped with only a log line
(`gateway/group-turn.ts:239-265`). The person who asked sees nothing. Fix:
`group-turn.ts`: one short reply per window ("@name I've answered a lot here;
try again in a few minutes"), sent through `liveSendMessage` and tracked in
`session.roomTurns`.

**AI-8 (P1, confirmed by code).** Only an XEP-0372 mention of the AI wakes it
(`gateway/group-ingest.ts:99-110`). `ChatMessage.replyTo` carries `to`, the
original sender (`packages/xmpp-core/src/types.ts:68`), but it is never checked.
A Telegram user's habit of replying to the bot's message gets no answer. Fix:
`group-ingest.ts`: `mentioned ||= normBareJid(message.replyTo?.to ?? '') === aiBare`.

**AI-9 (P2, confirmed by code).** Mentions merge into one turn whose trigger is
the last item (`gateway/group-turn.ts:185`). The reply tags only that sender
(`agents/group-turn.ts:130-154`), and the earlier asker gets an answer addressed
to someone else. Fix: `group-ingest.ts:164-190`: don't merge items from
different senders.

**AI-10 (P2, confirmed by code).** A failed room turn sends
`@asker <mapFailureToReply>` (`gateway/group-turn.ts:546-552`). The asker can't
act on "Check it under Connections → Test" or "raise it in My AIs"
(`tool-loop.ts:22-25`), and the owner never hears of it. Fix: in rooms, send
"I can't answer right now; my owner has been told". DM the owner the real reason
once per day per room, using the `dailyLimitNotices` pattern in `budget.ts`.

### D. Draft stream ("writing…")

**AI-2 (P1, confirmed by code).** Web opens a plain `EventSource` with no
`error` handler (`apps/web/src/lib/drafts.ts:67-92`). By the spec, an
`EventSource` that gets a non-200 or a non-`text/event-stream` response stops for
good; it reconnects only after a dropped connection. During a deploy the proxy
answers 502, and the stream dies. `startDraftStream` opens it once per session
(`packages/client-core/src/store/polling.ts:214`). After a deploy, web shows no
streaming until reload; the final messages still arrive. Mobile already
reconnects with backoff (`apps/mobile/src/lib/drafts.ts:155-157,219-246`). Fix:
`web/src/lib/drafts.ts`: on `error` with `readyState === CLOSED`, reopen with a
1 s to 30 s jittered backoff.

**AI-11 (P2, confirmed by code).** The hub sends only live events
(`apps/server/src/drafts/hub.ts:39-43`), and a new subscriber gets nothing until
the next frame (`drafts/api.ts:72-99`). Mobile closes the stream in the
background (`mobile/src/lib/drafts.ts:155`). Back in the foreground mid-turn,
it shows the old text, or nothing. If the turn ended while away, the bubble stays
until `DRAFT_IDLE_MS` (60 s, `polling.ts:25`) unless the final message arrives.
Fix: `hub.ts`: keep the latest frame per (owner, chat) while a turn is open and
replay it in `subscribe`.

**AI-12 (P2, confirmed by code).** Any DM message from the AI ends the shown draft
turn (`client-core/src/store/incoming.ts:137-141`). That includes the progress
message (`gateway/live.ts:88-97`). When round 1 streamed text before calling a
tool ("let me check…"), the progress message marks the turn finished. Drafts from
later rounds are then ignored (`polling.ts:199-204`), and the answer appears all
at once. Fix: `incoming.ts`: don't finish the draft when the message payload type
is `progress`.

**AI-13 (P2, suspected; check: two channels arriving out of order).**
`incoming.ts:139` finishes a turn only when a draft is shown. If the final XMPP
message arrives before the first SSE frame, that frame still renders below the
final message. `end` then removes it only after `DRAFT_END_FALLBACK_MS` (5 s,
`polling.ts:21,189`). Fix: `polling.ts` `handleDraftEvent`: drop a draft whose
text equals the chat's newest AI message body.

**AI-19 (P2, confirmed by code).** `Session` is checked when the request opens
(`drafts/api.ts:36-39`), and the stream "never ends on its own" (`api.ts:58-63`).
A signed-out or revoked session keeps getting the owner's drafts until the socket
drops. Fix: end the stream after 10 min. Both clients reconnect, and that
re-runs auth.

Draft details that are fine: the final text is flushed before the XMPP send
(`dm-tool-turn.ts:371`); the final message replaces the draft in one update
(`incoming.ts:155-157`); drafts over 8000 characters freeze while the final
message still lands (`hub.ts:84-86`); groups have no drafts by design
(`gateway/group-turn.ts:449`).

### E. Tools and sandbox

Permissions: in a room, only an owner or admin trigger gets `request_action`, and
this is re-checked when the tool runs (`gateway/group-turn.ts:413-445`). Tier 2
actions (`routine.schedule`, `tool.approve_hosts`) wait for approval
(`actions/policy.ts:51-54`). Deciding is open to the AI owner, group managers and
the topic approver role (`approvals/access.ts:17-70`). Limits: 10 s wall, 2 s CPU
and 32 MB by default; hard caps 30 s and 64 MB; 16 KiB of output
(`sandbox/limits.ts`); 8 KiB per result back to the model; 12 calls per turn
(`tool-loop.ts:365-376`). While a tool runs, a multi-round turn shows a fixed
progress line (`gateway/live.ts:61-97`). A failure reaches the model as
`failed: …`, and stuck actions are failed after 10 min (`actions/recovery.ts:9-17`).

**AI-23 (P2, confirmed by code, by design).** `tool.save` and `tool.run` are
tier 1 (`tools/tool-adapters.ts:110-116,205-212`). New code runs on the hosts the
tool already has approved (`tools/runner.ts:70-74`); only new hosts need a card
(`tool-adapters.ts:164`). Text the AI has just fetched could steer it to rewrite a
tool so that it sends chat content to an approved host in a query string.
Fix when it matters: make `tool.save` tier 2 when the tool has approved hosts and
the source changed, or reset `approved_hosts` on a new version.

### F. Routines

Duplicates after a restart: none; the claim is a compare-and-set
(`routines/scheduler.ts:162-175`), so a crash mid-run skips that run rather than
repeating it. Time zones and DST are handled (`schedule.ts:157-180,274-290`); the
minimum interval is 60 min (`schedule.ts:16`).

**AI-18 (P2, confirmed by code).** A tick claims at most 5 routines
(`scheduler.ts:51`), runs them 2 at a time (`scheduler.ts:214`), and skips the
next tick while busy (`scheduler.ts:60`). Fifty routines due at 09:00 finish
around 09:10. After an outage, an overdue routine runs once on start
(`nextRunAfter(now)`, `scheduler.ts:162`), even when it is 8 hours late. If the
AI's session is reconnecting, the post returns false, the run is `skipped`, and
the output is lost (`execute.ts:172-174`). Fix: `scheduler.ts`: claim again until
nothing is due; a daily run more than 2 h late is recorded `missed` and does not
post. `execute.ts`: on a post failure, leave `next_run_at` for one retry on the
next tick.

### G. AI management UX

**AI-20 (P2, confirmed by code).** Connections can be listed, created, tested and
deleted, but not edited (`packages/api-contract` `ConnectionsGroup`; no update in
`connections/service.ts`). A key-rejected reply sends the owner to "Connections →
Test" (`tool-loop.ts:24-25`), but replacing the key takes a new connection, then
switching every AI to it (`web/src/components/ais/AiPanel.tsx:133-140`), then
deleting the old one. Fix: `PATCH /connections/:id` with a new key. It clears
`litellm_model_id` for the AIs that use it, so `ensureAiModel` registers the
model again on their next turn (`ais/provisioning-keys.ts:79-140`).

**AI-21 (P2, confirmed by code).** `describeAiError` returns `error.message` for
anything that is not an `ApiError` (`apps/web/src/components/ais/errors.ts:7-11`),
so a network failure reads "Failed to fetch". The shared table's default case
also passes server text through (`packages/chat-core/src/ai-errors.ts:37-38`).
Fix: use the given `fallback` for non-API errors.

Create, edit, delete, picture and limits are on both clients
(`web/src/components/ais/*`, `mobile/src/components/ais/*`). A failed create
rolls back (`ais/provisioning.ts:135-147`).

### H. Observability

**AI-22 (P2; confirmed, content suspected).** Failure logs carry
`toRedactedError(err)` (`gateway/dm-turn.ts:322-325`, `dm-turn.ts:131`). Its
message holds the provider's error text (`tool-loop.ts:255-260`). Secrets are
redacted, but some provider errors quote parts of the request (check: content
filter and validation errors). There is no `status` or `kind` field to count
failures by. The counts line is good, with ids and counts only
(`dm-tool-turn.ts`, 'AI tool turn finished'). Group drops log ids only
(`group-turn.ts:241-262`). Nothing in My AIs shows "last failure: key rejected".
Fix: log `{ aiId, status, kind }` plus the detail cut to 200 characters. Keep the
last failure kind per AI in memory and expose it on `GET /api/ais` as
`lastFailure`.

## 3. Fix plan (impact, then size)

1. **Deploy-safe turns (AI-1).** `apps/server/src/agents/gateway/lifecycle.ts`,
   `apps/server/src/agents/gateway.ts`: a draining flag; `stop()` waits up to 20 s
   for busy DM and room pumps, then sends the transient reply. One pipeline test.
   Size S.
2. **Honest failure texts (AI-3, AI-4 mapping, AI-10).**
   `apps/server/src/agents/tool-exec.ts`, `apps/server/src/agents/tool-loop.ts`
   (new constants, one retry before the first delta),
   `apps/server/src/agents/gateway/group-turn.ts` (neutral room text, owner DM via
   the budget-gate notice map). Extend the mapping test in
   `apps/server/src/agents/reply.test.ts`. Size M.
3. **Clean context (AI-6).** New `apps/server/src/agents/context-edits.ts`, used
   by `buildDmMessages` and `buildGroupMessages` in
   `apps/server/src/agents/context.ts`. One pipeline test. Size S.
4. **Web drafts reconnect and draft fixes (AI-2, AI-12, AI-13).**
   `apps/web/src/lib/drafts.ts` (backoff reopen),
   `packages/client-core/src/store/incoming.ts` (skip `progress`),
   `packages/client-core/src/store/polling.ts` (drop a draft that equals the
   final body). No tests. Size S.
5. **Group triggers and limits (AI-7, AI-8, AI-9).**
   `apps/server/src/agents/gateway/group-ingest.ts` (reply-to counts as a mention;
   no merging across senders), `apps/server/src/agents/gateway/group-turn.ts`
   (one limit notice per window). Size S.
6. **Replies and turn time (AI-5, AI-14, model probe from AI-4).**
   `apps/server/src/agents/stream.ts` (`finish_reason`),
   `apps/server/src/agents/tool-loop.ts` (cap 4096, "cut short" line),
   `apps/server/src/agents/dm-tool-turn.ts` (time left per call),
   `apps/server/src/ais/provisioning.ts` and
   `apps/server/src/ais/provisioning-keys.ts` (1-token probe, `model_not_found`),
   `packages/chat-core/src/ai-errors.ts`. Size M.
7. **Draft snapshot and SSE expiry (AI-11, AI-19).**
   `apps/server/src/drafts/hub.ts` (last frame per open turn, replay on
   subscribe), `apps/server/src/drafts/api.ts` (end after 10 min). Size S.
8. **Cost and routines hygiene (AI-15, AI-16, AI-18).**
   `apps/server/src/agents/gateway/budget.ts` (30 s usage cache),
   `apps/server/src/agents/gateway/listener.ts` (daily cap per group),
   `apps/server/src/routines/scheduler.ts` and
   `apps/server/src/routines/execute.ts` (drain the backlog, `missed`, retry a
   failed post). A money test for the cache in `ais/usage.test.ts`. Size M.

Later, separate specs: AI-17 (time zone column and migration), AI-20 (connection
key update), AI-22 (`lastFailure`), AI-23 (re-approval on a new tool version),
AI-21 (one-line fallback).
