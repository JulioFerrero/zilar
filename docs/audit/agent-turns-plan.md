# One AI turn path: DM and group (T-2124)

Read-only plan. Baseline `3994b925b`; the nine files still measure 2,591 lines when
re-counted on 2026-10-19. No code changed.

The DM and group paths answer through two parallel pipelines in
`apps/server/src/agents`. They share `tool-rounds.ts`, `turn-send.ts`, `turn-stop.ts`
and `context.ts`, but each pipeline re-writes the same control flow around them.
This document follows one turn step by step, marks the real differences, and
proposes one turn function plus a small context, then a safe task order.

Verdict legend:

- **Same** — same behaviour, different code; the difference is data (chat key, kind, names).
- **Real** — a real difference that must stay; the reason is given.

## 1. Step table

The DM turn starts at `apps/server/src/agents/gateway.ts:299` (`handleIncoming`).
The group turn starts at `apps/server/src/agents/gateway/group-ingest.ts:124`
(`handleRoomIncoming`). Line numbers are the code that actually runs on each path.

| # | Step | DM | Group | Verdict |
| ---: | --- | --- | --- | --- |
| 1 | Ingest filter (edits, retractions, empty text) | `gateway.ts:303-305`, `321-327` | `group-ingest.ts:126-129`, `146-149` | **Same** |
| 2 | Own outgoing reflection | `gateway.ts:321` returns | `group-ingest.ts:132-145` remembers ids and rekeys cards | **Real** — the room echo is how group clients quote and tap a card; a DM echo has no such consumer |
| 3 | Who may trigger | `gateway/dm-turn.ts:187-197`: owner only; other AI senders dropped | `group-ingest.ts:161-249`: mention, reply-to-AI, typed mention, topic follower, AI handoff | **Real** — group mention and membership rules |
| 4 | AI-to-AI handoff and hop budget | none | `group-ingest.ts:220-247`; `contracts.ts:117` (`ROUND_MAX_HOPS`) | **Real** — only groups contain several AIs |
| 5 | Queue and coalescing | `gateway/dm-turn.ts:134-170`: one turn per AI; owner run merged | `group-ingest.ts:318-357`: one turn per AI and room; only the same sender merged | **Real** — a group batch names one trigger sender, so senders must not merge |
| 6 | Turn start / reload the AI | `gateway/dm-turn.ts:180` (`startTurn`) | `gateway/group-turn.ts:176` (same) | **Same** |
| 7 | Room state and membership re-check | none | `gateway/group-turn.ts:178-190` loads the gate; `191-226` filters the batch | **Real** — room membership and topic |
| 8 | Read marker | `gateway/dm-turn.ts:200-210` (`liveMarkDisplayed`) | none | **Real** — a group occupant has no owner message marker |
| 9 | Permanent daily cap | `gateway/dm-turn.ts:214-225` (`checkDailyLimit`) | `gateway/group-turn.ts:261-273` (same gate) | **Same** |
| 10 | Rate window and per-message round cap | none | `gateway/group-turn.ts:275-298`, `48-73` | **Real** — groups fan out to several AIs |
| 11 | "looking at this" wake notice | none | `gateway/group-turn.ts:300-304` | **Real** — group-only quiet-run signal |
| 12 | Resolve model target | `gateway/dm-turn.ts:233-250` | `gateway/group-turn-body.ts:208-216` | **Same** — fixed failure text, no model call |
| 13 | Resolve the AI's computer and who may use it | `gateway/dm-turn.ts:233-235` always for the owner; wiring `gateway/dm-turn-input.ts:71-77` | `gateway/group-turn-body.ts:309-315`, permission at `83-88` | **Real** — only the owner, a room owner/admin or a scheduled run may use the owner's computer |
| 14 | History | `gateway/dm-turn.ts:252-267` (`ownerJid`, `chat`) | `gateway/group-turn-body.ts:218-233` (`roomJid`, `groupchat`) | **Same** |
| 15 | Merge the fresh batch into history | `gateway/dm-turn.ts:284-299` | `gateway/group-turn-body.ts:251-266` | **Same** — history shape, different sender fields |
| 16 | Sender and owner names, time zone | `gateway/dm-turn.ts:269-271`: owner's zone | `gateway/group-turn.ts:309-333`; `gateway/group-turn-body.ts:235-239`: sender's zone | **Real** — a group turn answers a person, not the owner |
| 17 | Memory scope | `gateway/dm-turn.ts:272-283`: `{kind:'dm', peer}` | `gateway/group-turn-body.ts:240-250`: `{kind:'room', room}` | **Same** — scope is data |
| 18 | System prompt and message assembly | `gateway/dm-turn.ts:300-310`; `context.ts:137-153`, `337-349` | `gateway/group-turn-body.ts:277-292`; `context.ts:174-207`, `272-285` | **Real** — sender label, group/topic names, handoff names vs "private chat with owner" |
| 19 | Tool list | `gateway/dm-turn-input.ts:95-97`, default `dm-turn.ts:107`; `definitions.ts:280-287` | `gateway/group-turn-body.ts:294-319`; `definitions.ts:299` | **Real** — persona tools in a DM; group always gets memory tools, plus actions/delegation/question only when the trigger allows |
| 20 | Typing, status and progress | `dm-turn.ts:118`, `140`; `gateway/dm-turn-input.ts:101-112`, `123-127`; `live.ts:77-196` | `gateway/group-turn-body.ts:336-344`, `416-424`; same `live.ts:77-196` | **Real** — DM streams drafts (`onDelta`); a group edits one card |
| 21 | Model loop | `dm-tool-turn.ts:46-63` → `tool-rounds.ts:84-188` | `group-turn.ts:356-373` → same `tool-rounds.ts` | **Same** — the loop is already shared |
| 22 | Plain no-tools reply | `completeChat` in `dm-turn.ts:48-54` is used by the listener and memory (`gateway/listener.ts:170`, `gateway/memory.ts:261`), not by `runDmTurn` | `group-turn.ts:258-290`: first call, improvised tools answered `invalid`, one follow-up call | **Real today** — a second implementation; it can become the shared loop with `tools: []` |
| 23 | Tool execution / advertised filter | `gateway/dm-turn-input.ts:86-94`: no filter | `group-turn.ts:337-345`: only advertised tools plus `task_status`; `gateway/group-turn-body.ts:362-382` | **Real** — a group must never run a persona tool the model improvised |
| 24 | Approvals and action permission | `gateway/tool-exec.ts:107-117`, `382-406`: no membership re-check; DM approval goes to the owner | `gateway/tool-exec.ts:107-117`, `382-397`: re-checks the sender's membership at execution; group approval goes to an admin/owner | **Real** — who approves, and the mid-turn permission re-check |
| 25 | Stop | `gateway/dm-turn-input.ts:78`, `145`; `dm-tool-turn.ts:65-67`, `168-170` | `gateway/group-turn-body.ts:347`, `429`; `group-turn.ts:375`, `384`, `393`, `407`, `430`, `438`, `442` | **Same** |
| 26 | Failure handling | `dm-turn.ts:121-141`; `dm-tool-turn.ts:64-101`, `141-160` | `group-turn.ts:291-310`, `374-382`, `429-437`; owner DM `group-turn-body.ts:158-170`, `group-turn.ts:370` | **Real** — the room hears one fixed line; the owner hears the reason by DM. The code shape repeats five times |
| 27 | Reply shaping and send | `turn-send.ts:8-25`: plain text to `ownerJid` | `group-turn.ts:209-243` (strip mention, `replyTo`, mentions, handoff payload); `turn-send.ts:31-52`; `group-turn-body.ts:408-415` | **Real** — quote, mentions and handoff exist only in groups |
| 28 | Post-turn accounting | `gateway/dm-turn.ts:344-358`: drafts, settle, warnings, compaction | `gateway/group-turn-body.ts:430-470`: settle, delegation result, warnings, compaction | **Same**, plus group delegation |

Reading the table: the group path adds eleven real differences (rows 2, 3, 4, 7,
8, 10, 11, 13, 19, 24, 27) and the same control flow is written two to five
times. The largest copies are the failure/stop tail
(`dm-tool-turn.ts:64-101`, `141-160` vs `group-turn.ts:374-382`, `429-437`) and
the live wiring (`gateway/dm-turn-input.ts:79-145` vs
`gateway/group-turn-body.ts:348-429`).

## 2. One path

Add one Promise-shaped turn core and one Effect-side input builder; the DM and
group adapters keep only what is genuinely theirs.

```
runTurn(ctx: TurnContext): Promise<TurnOutcome>
```

`TurnContext` carries the real differences as data or callbacks:

- `identity`: `aiId`, `target`, `secrets`, `signal`, `log`, `logger`.
- `attempt`: `messages`, `tools`, `maxRounds`, `caps`, `checkGate`, `executeTool`.
- `view`: `reportProgress`, `finishProgress`, `sendTyping`, `onModelText` (DM drafts).
- `reply`: `shape(text, fromModel) => Outgoing`; DM `{text}`, group
  `wire(...)` from `group-turn.ts:209-243`.
- `send`: `(outgoing) => Promise<{id}>`; group also remembers the sent id
  (`group-turn-body.ts:408-415`).
- `onFailure?`: `(reason) => Promise<void>`; the group owner DM
  (`group-turn.ts:370`).
- `onTurnEnd?`: usage, standings, delegation settle and compaction
  (`gateway/dm-turn.ts:344-358`, `gateway/group-turn-body.ts:430-470`).

The core does, once: typing on → loop (`tool-rounds.ts`) → stop check → finish
the card → shape and send → map the failure → typing off. It absorbs
`dm-tool-turn.ts` and the tool half of `group-turn.ts`.

New files:

| New file | Lines (est.) | What it owns |
| --- | ---: | --- |
| `apps/server/src/agents/turn.ts` | 300 | `runTurn`, failure tail, final send |
| `apps/server/src/agents/gateway/turn-prompt.ts` | 150 | history load, fresh merge, names/time zone, memory, `buildDmMessages` / `buildGroupMessages` |
| `apps/server/src/agents/gateway/turn-input.ts` | 250 | Effect wiring: target, desk, abort, usage, progress, drafts, live send |

Fate of the nine files:

| File | Now | After | Fate |
| --- | ---: | ---: | --- |
| `apps/server/src/agents/gateway/group-turn-body.ts` | 472 | 120 | keeps `groupTurnAccess` (`63-108`) and `notifyOwnerOfFailure` (`158-170`) |
| `apps/server/src/agents/group-turn.ts` | 445 | 140 | keeps handoff/wire (`34-92`, `209-243`) and the call to `runTurn` |
| `apps/server/src/agents/gateway/group-turn.ts` | 419 | 250 | keeps admission, queue, limits, delegation |
| `apps/server/src/agents/gateway/dm-turn.ts` | 378 | 230 | keeps admission, queue, limits, drafts |
| `apps/server/src/agents/dm-tool-turn.ts` | 173 | 0 | moves into `turn.ts` |
| `apps/server/src/agents/dm-turn.ts` | 142 | 80 | types, notices, `completeChat` (used by listener/memory) |
| `apps/server/src/agents/gateway/dm-turn-input.ts` | 148 | 0 | moves into `turn-input.ts` |
| `apps/server/src/agents/gateway/group-ingest.ts` | 364 | 364 | unchanged: group mention rules |
| `apps/server/src/agents/gateway/group-turn-roster.ts` | 50 | 50 | unchanged: group roster |

Expected total: about 1,920 lines across these files, against 2,591 today
(about −670, −26%). The three new files replace the deleted parts, so the table
above and the task estimates below measure net change, not raw movement.

## 3. Tasks

Run in order. Tasks that share a file are serial, never parallel. Each task is
behaviour-preserving; the expected net line change includes the new shared file
it adds. Run the listed tests with
`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot <path>`.

### T1 — One failure and stop tail (−120)

- **Allowed files:**
  - `apps/server/src/agents/turn.ts` (new)
  - `apps/server/src/agents/dm-tool-turn.ts`
  - `apps/server/src/agents/group-turn.ts`
- **What:** move `dm-tool-turn.ts:64-101` and `141-160` into `turn.ts` as
  `finishTurnFailure(ctx, error)`; replace the copies at `group-turn.ts:374-382`
  and `429-437`, and route the outer catch `291-310` through it. The group
  callbacks keep `reportFailure` and the fixed `GROUP_FAILURE_REPLY`.
- **What must not change:** `turnStopped` is checked first; `failureLogFields`
  stays ids only; progress finishes before the send; notices are appended to
  the text; a failed send returns `{kind:'failed', text:''}`.
- **Tests:** `apps/server/src/agents/reply.test.ts`,
  `apps/server/src/agents/turn-stop-gate.test.ts`,
  `apps/server/src/agents/group-turn-card.test.ts`,
  `apps/server/src/agents/gateway-stop.test.ts`,
  `apps/server/src/agents/gateway-group.test.ts`.
- **Parallel with:** none.

### T2 — One reply send (−20)

- **Allowed files:**
  - `apps/server/src/agents/turn-send.ts`
  - `apps/server/src/agents/turn.ts`
  - `apps/server/src/agents/dm-tool-turn.ts`
  - `apps/server/src/agents/group-turn.ts`
- **What:** replace `sendReply` (`turn-send.ts:8-25`) and `sendGroupReply`
  (`31-52`) with `sendTurnReply(ctx, outgoing, {failure})`; the group passes
  shaped output, the DM passes `{text}`. Keep the `answer` log row and the
  `beforeFinalSend` draft flush.
- **Tests:** `apps/server/src/agents/group-turn-card.test.ts`,
  `apps/server/src/agents/reply.test.ts`,
  `apps/server/src/agents/dm-turn.fake-provider.test.ts`,
  `apps/server/src/agents/reply-mention.test.ts`.
- **Parallel with:** none (shares files with T1).

### T3 — One loop, no second plain path (−55)

- **Allowed files:**
  - `apps/server/src/agents/turn.ts`
  - `apps/server/src/agents/group-turn.ts`
  - `apps/server/src/agents/dm-tool-turn.ts`
  - `apps/server/src/agents/tool-rounds.ts`
- **What:** delete `runGroupTurn`'s plain branch (`group-turn.ts:258-290`).
  Run the shared loop with `tools: []` and no executor at
  `tool-rounds.ts:112-145`; an improvised call already answers
  `invalid: unknown tool` at `tool-calls.ts:70-88`, and the caller's last
  text-only call at `group-turn.ts:414-428` becomes the loop's single-round
  follow-up (`tool-rounds.ts:105-117`). Keep the DM route unchanged.
- **What must not change:** a group with no tools still gets exactly one
  follow-up model call; a plain member still cannot reach the action gateway.
- **Tests:** `apps/server/src/agents/group-turn-card.test.ts`,
  `apps/server/src/agents/gateway-group.test.ts`,
  `apps/server/src/agents/handoff.test.ts`,
  `apps/server/src/agents/reply.test.ts`.
- **Parallel with:** none (depends on T2).

### T4 — One prompt assembly (−80)

- **Allowed files:**
  - `apps/server/src/agents/gateway/turn-prompt.ts` (new)
  - `apps/server/src/agents/gateway/dm-turn.ts`
  - `apps/server/src/agents/gateway/group-turn-body.ts`
- **What:** move history load, fresh-batch merge, owner/sender name, time zone,
  memory read and the `buildDmMessages` / `buildGroupMessages` call out of
  `gateway/dm-turn.ts:252-316` and `gateway/group-turn-body.ts:218-292` into
  `loadTurnPrompt(input)`. The input has the chat key/kind, trigger sender and
  memory scope; the two builders stay in `context.ts`.
- **What must not change:** message arrays stay byte for byte (same order,
  same memory block). Do not touch `context.ts`.
- **Tests:** `apps/server/src/agents/context.test.ts`,
  `apps/server/src/agents/context-edits.test.ts`,
  `apps/server/src/agents/prompt-time.test.ts`,
  `apps/server/src/agents/gateway-group.test.ts`,
  `apps/server/src/agents/dm-turn.fake-provider.test.ts`.
- **Parallel with:** T1–T3 if the lead runs separate worktrees, because the
  file sets are disjoint; otherwise keep the order.

### T5 — One Effect input, DM first (−20)

- **Allowed files:**
  - `apps/server/src/agents/gateway/turn-input.ts` (new)
  - `apps/server/src/agents/gateway/dm-turn-input.ts`
  - `apps/server/src/agents/gateway/dm-turn.ts`
  - `apps/server/src/agents/gateway/turn-prompt.ts`
- **What:** move `runDmTurnInput` (`dm-turn-input.ts:32-148`) into
  `runTurnInput`, with a `kind: 'dm'` branch. It keeps desk resolution, abort,
  usage, drafts, progress and the live send wrappers. `dm-turn-input.ts`
  becomes a thin re-export until T6 deletes it.
- **What must not change:** `registerTurnAbort` / `clearTurnAbort` pairing
  (`78`, `145`), the draft flush before the final send (`123-127`), and the
  `recordUsage` callback.
- **Tests:** `apps/server/src/agents/dm-turn.fake-provider.test.ts`,
  `apps/server/src/agents/gateway-stop.test.ts`,
  `apps/server/src/agents/gateway-desk.test.ts`,
  `apps/server/src/agents/gateway-drain.test.ts`.
- **Parallel with:** none (depends on T4).

### T6 — Group on the shared input (−160)

- **Allowed files:**
  - `apps/server/src/agents/gateway/turn-input.ts`
  - `apps/server/src/agents/gateway/group-turn-body.ts`
  - `apps/server/src/agents/gateway/group-turn.ts`
  - `apps/server/src/agents/gateway/dm-turn-input.ts` (delete)
- **What:** move `group-turn-body.ts:348-429` into `runTurnInput`'s
  `kind: 'group'` branch: roster, `groupTurnAccess` results, desk permission,
  `isStillAllowed`, routine send, progress, `rememberRoomSentId`. Leave
  `group-turn-body.ts` with access (`63-108`), `notifyOwnerOfFailure`
  (`158-170`) and delegation settle (`430-470`).
- **What must not change:** the advertised-tool filter stays applied in
  `group-turn.ts:337-345`; `rememberRoomSentId` still runs after every send;
  the settlement and delegation rows keep their order.
- **Tests:** `apps/server/src/agents/gateway-group.test.ts`,
  `apps/server/src/agents/group-turn-card.test.ts`,
  `apps/server/src/agents/gateway/group-turn-access.test.ts`,
  `apps/server/src/agents/gateway-stop.test.ts`,
  `apps/server/src/agents/gateway-desk.test.ts`.
- **Parallel with:** none (depends on T5).

### T7 — Delete the old adapters and thin the DM module (−150)

- **Allowed files:**
  - `apps/server/src/agents/dm-tool-turn.ts` (delete)
  - `apps/server/src/agents/dm-turn.ts`
  - `apps/server/src/agents/turn.ts`
  - `apps/server/src/agents/gateway/dm-turn.ts`
- **What:** move the remaining loop entry from `dm-tool-turn.ts:18-173` into
  `turn.ts`; keep `dm-turn.ts` for `DmTurnDeps`, the notices and `completeChat`
  (still used by `gateway/listener.ts:170` and `gateway/memory.ts:261`). Remove
  the now-unused imports and the `runDmTurn` wrapper (`dm-turn.ts:105-142`) in
  favour of `runTurn`.
- **Tests:** `apps/server/src/agents/dm-turn.fake-provider.test.ts`,
  `apps/server/src/agents/reply.test.ts`,
  `apps/server/src/agents/gateway-stop.test.ts`,
  `apps/server/src/agents/gateway-group.test.ts`,
  `apps/server/src/agents/gateway-drain.test.ts`.
- **Parallel with:** none (depends on T6).

### T8 — One typing/progress/usage helper (−65)

- **Allowed files:**
  - `apps/server/src/agents/turn-send.ts`
  - `apps/server/src/agents/turn.ts`
  - `apps/server/src/agents/gateway/turn-input.ts`
- **What:** collapse the typing on/paused pairs (`dm-turn.ts:118`, `140`;
  `group-turn-body.ts:416-424`) and the progress/draft wiring into one
  `turnView(ctx)` helper used by both branches. Keep `live.ts` untouched.
- **Tests:** `apps/server/src/agents/task-card.test.ts`,
  `apps/server/src/agents/gateway-stop.test.ts`,
  `apps/server/src/agents/gateway-group.test.ts`,
  `apps/server/src/agents/turn-stop-gate.test.ts`.
- **Parallel with:** none.

## 4. Risks and what to check

| Risk | Where it could change | Tests that must pass | Live check in "ai test › General" as `@claude_test` |
| --- | --- | --- | --- |
| What the AI says | prompt order, history cap, memory scope, tool guide | `context.test.ts`, `context-edits.test.ts`, `prompt-time.test.ts`, `dm-turn.fake-provider.test.ts` | DM "hello"; @mention in the topic; ask it to remember one fact, then ask for it |
| Who gets answered | mention, reply-to-AI, typed mention, follower, membership | `gateway-group.test.ts`, `addressing.test.ts`, `typed-mention.test.ts`, `topic-follow.test.ts`, `group-turn-access.test.ts` | @mention the AI; reply to its message; post a plain question in a one-AI room; post a plain remark and confirm silence |
| When it answers | daily cap, rate window, round cap, stop | `budget.test.ts`, `gateway-stop.test.ts`, `gateway-group.test.ts` | press Stop mid-answer; send several mentions quickly in one room |
| Who sees it | reply shape, quote, mentions, handoff, owner failure DM | `group-turn-card.test.ts`, `handoff.test.ts`, `reply-mention.test.ts`, `gateway-group.test.ts` | check the reply quotes the trigger and has no stray `@`; with a second AI in the room, check only the mentioned AI answers |
| Approvals | action permission, mid-turn membership re-check | `approval-follow-up.test.ts`, `ask-people.test.ts`, `post-blocks.test.ts`, `group-turn-access.test.ts` | ask for a tier-2 action as the owner and as a plain member; approve once, deny once |
| Quiet runs | scheduled routine, unattended action, no room echo | `gateway-stop.test.ts`, `gateway-group.test.ts`, `routine-send.test.ts` | trigger a routine and check one edited message and no duplicate reply |
| Tool loop | caps, repeated call, truncated result, redaction | `reply.test.ts`, `turn-rounds.test.ts`, `handoff.test.ts` | ask a task that needs two tool rounds; ask the same tool call twice |

After every task the lead runs that task's tests and `pnpm gate`. After T3 and
T6 also re-run the whole `apps/server/src/agents` suite once, because those
tasks change the shared loop and the group wiring. After T7 run `wc -l` on the
nine original files and compare with the table in §2.

Live checks are manual and one at a time; do not script them. The important
ones after each wave: T1–T3 — stop and failure text; T4–T6 — same answer text
and the quote/mention shape; T7–T8 — typing clears, cards close, and no reply
is duplicated.

## 5. Total

| Task | Net lines |
| --- | ---: |
| T1 failure/stop tail | −120 |
| T2 one reply send | −20 |
| T3 one loop | −55 |
| T4 prompt assembly | −80 |
| T5 DM input | −20 |
| T6 group input | −160 |
| T7 delete adapters | −150 |
| T8 view helper | −65 |
| **Total** | **−670** |

The nine files go from 2,591 to about 1,920 lines (about −26%). The three new
files add about 700 lines while the nine lose about 1,360, so the net is the
−670 above. Measure with `wc -l` after T8; if the result is above 2,050, stop and
review before proposing another cut.

**Measured so far (2026-10-19):**
- **T1 (T-2128): −127.** The estimate held.
- **T2: dropped, it grew the code.** One `sendTurnReply` needed a wrapper in each caller, so DM and group each kept a send function and the pair went +16. The two send functions stay in `agents/turn-send.ts`.
- **T4 (T-2144): −3, not −80.** `gateway/turn-prompt.ts` (`loadTurnPrompt`) is one path for DM and group. The two prompt loaders differ in history kind, names, memory scope and the fresh-message shape, so the shared version needs a `dm ?` branch at each of those points. That costs about as much as the two blocks it replaced.
- **For T3 and T5–T8:** expect well under the estimates. Spec each with a line target measured over all files, new ones included, and stop any step that does not go down.
