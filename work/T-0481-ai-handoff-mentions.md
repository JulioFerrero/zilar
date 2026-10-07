---
id: T-0481
title: "Listener S4b (server): AI-to-AI handoff by @mention inside the round budget (max 2 hops); only to AIs that accept tasks"
status: merged
milestone: M5
branch: task/T-0481-ai-handoff-mentions
model: auto
effort: low
depends_on: [T-0479]
estimate: 0.5 day
---

# T-0481: AI-to-AI handoff by @mention

## Spec (written by Claude, do not edit)

### Why
This is the second half of plan task S4, from `docs/audit/listener-delegation-plan.md` §3.1 and §3.3, with Julio's §8 decision: any AI in the group may receive work **if its owner allowed it** (`acceptsDelegation`).

Today an AI's room reply mentions only the human it answers, and an AI sender never wakes another AI. After this task:
- an AI that writes `@<other AI's room nick>` in its reply hands that AI the question;
- the target takes a normal turn, inside the round budget: at most **2 AI-to-AI hops** per human message, on top of T-0479's 4 AI turns;
- targets that don't accept tasks are never woken.

### Verified facts (do not re-derive)
Lines are on main after T-0479. All of these are in `apps/server/src/agents/gateway.ts` unless another file is named.
- **The round budget:**
  - `ROUND_MAX_AI_TURNS = 4` is at line 187;
  - `interface RoomRound { humanMessageId; aiTurns }` is at line 218;
  - `roomRounds` is at line 537;
  - `handleRoomIncoming` opens a round per new human message id (lines 1768-1778);
  - `runGroupSessionTurn` checks and increments `aiTurns` after the rate gate.
- **`handleRoomIncoming`:**
  - for an AI sender, it returns after the mention check (lines 1792-1796, "No AI-to-AI turns in M2");
  - `mentioned` is computed from `message.mentions` against `session.aiJid` (lines 1779-1782);
  - the `RoomPendingMessage` items have `wake?: true`.
- **`runGroupSessionTurn`:** the eligible filter skips AI senders (`if (isAiSender(fromBare)) continue;`, line 1865) and keeps only resolved human members (`gate.memberJids`). The trigger is the last eligible item.
- **The group reply (`apps/server/src/agents/reply.ts:1204-1216`):** `runGroupTurn` builds `wire(text)` = `@<senderName> <text>` with `mentions: [{ jid: senderJid, begin: 0, end: name.length + 1 }]` and `replyTo` the trigger. The gateway calls it at line 2094 with `GroupTurnDeps` (`reply.ts`, around lines 1130-1190).
- **The system prompt:** `buildGroupSystemMessage` (`apps/server/src/agents/context.ts:104-127`) takes `{ aiName, persona, senderName, today, groupName?, topicName? }`. The gateway passes these through `buildGroupMessages` (gateway around line 2033).
- **Room AIs:** every AI session that joined a room has `session.rooms.get(roomJid)` with its `nick`, and `session.aiJid`. `sessions` is the gateway's map of all AI sessions. `ais.acceptsDelegation` is a column (T-0470).
- **Tests:** `apps/server/src/agents/gateway.test.ts` (the listener and round-budget describes near the end), `apps/server/src/agents/reply.test.ts` (`describe('runGroupTurn')` at line 957) and `apps/server/src/agents/context.test.ts`.

### What to build
1. **The budget.**
   - Add `export const ROUND_MAX_HOPS = 2;`.
   - `RoomRound` gets `hops: number` (starting at 0) and `handoffIds: Set<string>`, which dedupes the AI message ids already counted.
2. **Mentions in AI replies (`reply.ts`).**
   - `GroupTurnDeps` gets an optional `handoffTargets?: { nick: string; jid: string }[]`.
   - In `wire(text)`, after the sender prefix, find each `@<nick>` of a handoff target in the **reply text**: case-insensitive, whole word (followed by the end, whitespace or punctuation). Add a mention `{ jid, begin, end }` with offsets in the final wire text, at most 2 targets, and never the AI itself.
   - With no targets, the output is byte-identical to today.
3. **The gateway: who can be targeted.**
   - Before `runGroupTurn`, build `handoffTargets` from the other live sessions joined to this room (their room nick and `aiJid`), keeping only AIs whose `acceptsDelegation` is true. Use one DB read per turn: select `id` and `acceptsDelegation` for those ids.
   - Pass the target names to `buildGroupSystemMessage` through a new optional `handoffNames?: string[]`. When it is non-empty, append one line: "Other AIs here you can hand a question to: @A, @B. Write their @name in your reply only when they should take over." With no names, the prompt is unchanged.
4. **The gateway: accepting a handoff.**
   - In `handleRoomIncoming`, when the sender **is** an AI (`isAiSender`) and the message mentions this session's AI:
     - drop it unless the sender is another live session joined to the same room (look it up in `sessions` by `aiJid`; never trust the nick);
     - read the room's round;
     - if the message id is not yet in `handoffIds`, then: if `hops >= ROUND_MAX_HOPS`, drop it with an info log (`{ roomJid, fromAiId, toAiId }`, "AI handoff budget spent"); otherwise add the id and do `hops += 1`. The id set makes the count once per message even when several sessions see it;
     - queue a `RoomPendingMessage` with a new flag `handoff: true` and call `pumpRoom`.
   
   Human messages keep today's path.
5. **The gateway: running the handoff turn.**
   - In `runGroupSessionTurn`'s eligible filter, an AI sender passes only when `item.handoff === true` and the sender's bare JID is still a live session in this room. Human-member rules are unchanged for human senders.
   - The trigger may be the handoff item. `request_action` must stay off for it: the role lookup already gives no role for an AI JID, so check that `allowedForAction` is false.
   - The round's `aiTurns` cap (4) still applies.
   - The reply goes to the boss AI as `@<boss nick>`.
6. **Tests.**
   - **`reply.test.ts`:**
     - a target nick in the text gets a correct mention, with offsets;
     - a non-target `@word` gets none;
     - no targets gives output identical to today.
   - **`context.test.ts`:** the handoff line appears only with names.
   - **`gateway.test.ts`:**
     - a human mentions A, and A replies with `@B` where B accepts tasks: B takes a turn;
     - if B does not accept tasks, the line is not offered and no mention is added, so B is not woken;
     - a chain A→B→A→B stops after 2 hops;
     - the same AI message seen by 3 sessions counts one hop;
     - an AI message from a JID that is not a room session does not wake anyone;
     - the total turns per human message stay ≤ 4;
     - the handoff turn has no `request_action`.

### Read first
`AGENTS.md`, `docs/audit/listener-delegation-plan.md` §3 and §8, `apps/server/src/agents/gateway.ts:180-230`, `:530-540`, `:1745-1830`, `:1836-1900` and `:2020-2110`, `apps/server/src/agents/reply.ts:1120-1240`, `apps/server/src/agents/context.ts:70-130`, the round-budget tests at the end of `apps/server/src/agents/gateway.test.ts`.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `apps/server/src/agents/reply.ts`, `apps/server/src/agents/reply.test.ts`, `apps/server/src/agents/context.ts`, `apps/server/src/agents/context.test.ts`, `work/T-0481-ai-handoff-mentions.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway agents/reply agents/context
pnpm gate
```

### Acceptance
- An AI can hand a question to another AI in the room by @name, only when the target accepts tasks.
- There are at most 2 hops and 4 AI turns per human message.
- Handoff turns never offer `request_action`.
- Without handoff targets, replies and prompts are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- **`gateway.ts`**
  - Added `export const ROUND_MAX_HOPS = 2;` and extended `RoomRound` with `hops: number` and `handoffIds: Set<string>` (the new-human-message site opens both at 0 / empty).
  - `RoomPendingMessage` gained `handoff?: true`.
  - Added `sessionForAiJid(bare)`, which matches a live session by `aiJid` (the `sessions` map is keyed by AI id, so a scan is needed).
  - `handleRoomIncoming`: the "No AI-to-AI turns in M2" early return is replaced by the handoff path. An `ai-*` sender that mentions this session is dropped unless it is another live session joined to the room; the room round is read and, once per message id, `hops` is checked and incremented (`>= ROUND_MAX_HOPS` drops it with `logger.info({ roomJid, fromAiId, toAiId }, 'AI handoff budget spent')`). The item is queued with `handoff: true` and `pumpRoom` runs. Human messages keep the old path.
  - `runGroupSessionTurn` eligible filter: an AI sender passes only when `item.handoff === true` and the sender is still a live session in this room; human-member rules are unchanged.
  - Before `runGroupTurn` (and `buildGroupMessages`), `handoffTargets` is built from the other live sessions in the room, filtered by one `select id, accepts_delegation from ais where id in (...)` read. Non-empty targets are passed as `handoffNames` to the prompt and `handoffTargets` to the turn.
- **`reply.ts`**
  - `GroupTurnDeps` gained optional `handoffTargets?: { nick; jid }[]`.
  - `wire(text)` now appends a mention for each target whose `@<nick>` appears in the reply text, case-insensitively and as a whole word (end / whitespace / punctuation after it), with offsets in the final wire text. At most two targets. With no targets the output is byte-identical to before.
- **`context.ts`**
  - `GroupContextInput` / `buildGroupSystemMessage` gained optional `handoffNames?: string[]`. When non-empty it appends exactly one line: "Other AIs here you can hand a question to: @A, @B. Write their @name in your reply only when they should take over." With no names the prompt is unchanged.
- **Tests**
  - `reply.test.ts`: handoff mention offsets; case-insensitive whole-word match plus `@HelperX` not matching; at most two targets; no-targets output unchanged.
  - `context.test.ts`: the handoff line appears only with names.
  - `gateway.test.ts`: new `describe('AI handoff (T-0481)')` with 6 tests — target that accepts is woken and its handoff turn offers no `request_action`; a non-accepting target is neither offered nor mentioned and is not woken; A→B→A→B stops after 2 hops; the same AI message seen by 3 sessions counts one hop; a non-room AI JID wakes nobody; one human message stays at 4 AI turns across 2 hops. `listenerSetup` gained optional `names`, `fetch` and `actions` so the tests can route completions and name AIs.

### Files changed

`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `apps/server/src/agents/reply.ts`, `apps/server/src/agents/reply.test.ts`, `apps/server/src/agents/context.ts`, `apps/server/src/agents/context.test.ts`, `work/T-0481-ai-handoff-mentions.md`. All inside the Allowed files.

### Commands run (real results)

- `pnpm install` — exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/reply agents/context` — 2 files, 76 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway` — 1 file, 151 passed (before the new tests); then with the new tests the combined run is below.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway agents/reply agents/context` — 3 files, 233 passed.
- `pnpm gate` — after fixing format/lint it ended:
  - `PASS  install (frozen)  (1.2s)`
  - `PASS  format  (17.5s)`
  - `PASS  lint  (1.0s)`
  - `PASS  typecheck  (12.5s)`
  - `PASS  tests @zilar/server  (46.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
  - (First two gate runs failed on `format` and then on one `no-unsafe-optional-chaining` lint error in `reply.test.ts`; both fixed, no files outside scope were ever reported.)

### Notes / deviations

- `reply.ts` cannot enforce "never the AI itself" itself: `GroupTurnDeps` carries no AI JID. The gateway excludes the current session when building `handoffTargets`, so a target is never the replying AI. `reply.ts` enforces the 2-target cap and one mention per target.
- If no round exists for a room (for example right after a gateway restart) an AI handoff is dropped. The spec says to read the round but not what to do when it is missing; dropping matches the plan's "a fresh start can only wake fewer AIs".
- The handoff reply goes to the sending AI via the existing `@<senderName>` logic, no extra code.
- No new routes/DB writes were added; the only new log line carries ids only (`roomJid`, `fromAiId`, `toAiId`).

### Open questions

None.

## Review (written by Claude)

Approved (lead, 2026-10-07).
- **Handoff:** an AI reply that writes @<nick> of a same-room AI accepting tasks gets a real mention, at most 2, never itself. The prompt lists those names only when there are some.
- **Waking:** an AI sender wakes a target only when it is a live session in the same room. Hops are counted once per message id, with ROUND_MAX_HOPS=2, and the 4-turn cap still applies.
- **Safety:** handoff turns get no request_action. Output is byte-identical without targets.
Nit accepted: the word boundary does not include "/" and a few other symbols, so a rare handoff is missed, never a false wake.
