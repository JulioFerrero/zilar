---
id: T-0475
title: "Listener S3 (server): per-room listener in the agent gateway — debounce, one scoring call, wake AIs above threshold with a short 'looking at this' line"
status: todo
milestone: M5
branch: task/T-0475-listener-gateway
model: auto
effort: low
depends_on: [T-0472, T-0474]
estimate: 0.6 day
---

# T-0475: the listener in the gateway

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/listener-delegation-plan.md` §2.1, §2.4, §2.6 and §8, task S3. T-0472 built the pure scoring core (`agents/listener/score.ts`). T-0474 added `LISTENER_ENABLED` and the per-group `listenerEnabled` and `listenerEagerness`.

This task wires the listener into the agent gateway. When people talk in a group room **without mentioning an AI**, the listener checks after a pause and wakes the AIs that should answer. **The server pays** (Julio, plan §8).

**The AI-to-AI budget and hops are the next task (S4). Here a listener wake is just a normal turn.**

### Verified facts (do not re-derive)
- **Each AI has its own `AiSession`** (`apps/server/src/agents/gateway.ts:196-214`), with `rooms: Map<roomJid, RoomSubscription>`, `roomPending` and `roomBusy`. `RoomSubscription` is `{ groupId, topicId, joinedAtMs, nick }` (lines 189-194). **Several AI sessions receive the same room message,** one per AI in the room.
- **`handleRoomIncoming(session, message)`** (lines 1466-1521) does these steps in order:
  1. it skips corrections, retractions, outgoing messages and empty bodies;
  2. it gets `room` from `session.rooms` (line 1481);
  3. it runs the join skew check (line 1488);
  4. it returns when the AI is not mentioned (lines 1492-1499, "No mention, nobody replies (M2 rule 3)");
  5. it returns for AI senders (`isAiSender`, line 1502);
  6. it pushes onto `roomPending` and calls `pumpRoom`.
- **Turn-time checks:** `pumpRoom` and `runGroupSessionTurn` (from line 1525) re-check at turn time that the sender is a resolved human member (`loadRoomGateState`, around lines 1559-1590), then the daily limit, then the per-room rate limit. **They do not re-check mentions,** so a message pushed onto a session's `roomPending` becomes a normal turn for that AI.
- **Sending a plain room message:** `liveSendMessage(session, roomJid, 'groupchat', text)` is at line 901 (it is used for the daily-limit notice).
- **Cleanup points:** `disconnectAi(aiId)` is at line 1174, and leaving a room (`session.rooms.delete`) is at line 1260.
- **Deps:** `AgentGatewayDeps` is at lines 97-130, with `db`, `logger`, `litellmBaseUrl?`, `fetchImpl?`, `now?`, … The gateway is created in `apps/server/src/index.ts:349-375`, where `config.LITELLM_MASTER_KEY` is available (it is passed as `masterKeyForRedaction`).
- **The scoring core (T-0472)** is `apps/server/src/agents/listener/score.ts`:
  - `loadRoster(db, { groupId, topicId? })`, where a `topicId` means the topic's AIs and none means the group's AIs;
  - `buildListenerMessages`;
  - `scoreRoom({ complete, baseUrl, virtualKey, model, roster, window, roomSummary?, eagerness, timeoutMs? })`, which returns `{ wake: aiId[], reason, messageIds } | null` and never throws.
  
  `completeChat` is at `apps/server/src/agents/reply.ts:298`.
- **General vs. other topics:** a group's General topic room is joined by the group's AIs (`groupAis`), and other topic rooms by `topicAis` (`gateway.ts:327-385`). `topics.isGeneral` is at `apps/server/src/db/schema.ts:414`.
- **The tests** live in `apps/server/src/agents/gateway.test.ts`, with `describe('groups')` at line 2865 and `describe('topics (T-0109)')` at line 4895, using fake XMPP cores and a fake fetch for LiteLLM.

### What to build
1. **Config (`apps/server/src/config.ts`):**
   - add `LISTENER_MODEL: z.string().trim().min(1).max(256).optional()`, next to `LISTENER_ENABLED`, with a comment: the LiteLLM model name the listener calls, paid with the server's LiteLLM master key;
   - update `config.test.ts` where the full config is listed.
2. **Wiring (`apps/server/src/index.ts`):** when `LISTENER_ENABLED`, `LISTENER_MODEL` and `LITELLM_MASTER_KEY` are all set, pass `listener: { model, virtualKey: LITELLM_MASTER_KEY }` to `createAgentGateway`. If the flag is on but a value is missing, log one warning (no values) and pass nothing.
3. **The gateway** (`AgentGatewayDeps.listener?: { model: string; virtualKey: string; quietMs?: number; everyN?: number; complete?: typeof completeChat }`):
   - **Per-room state:** keep one `Map<roomJid, RoomListenerState>` at the gateway level, **not per session**. It holds the window (the last 40 messages: `{ id, sender, text }`), the ids already seen (dedupe, because every AI session gets the same message), the count since the last check, a timer, an `inFlight` flag, `groupId`, `topicId` and a `generation` counter.
   - **In `handleRoomIncoming`,** after the skew check and **before** the mention return: if `deps.listener` is set and the sender is not an AI (`isAiSender`), record the message once per message id. The sender is the `fromNick` or the bare JID; the text is the body.
     - If the message mentions **any** AI, reset the count and don't schedule, because mentions already work as today.
     - Otherwise bump the count and re-arm the quiet timer (`quietMs`, default 20 000).
     - If the count reaches `everyN` (default 12), fire now.
     
     Then continue exactly as today, so mention handling is unchanged.
   - **Fire,** once per room:
     1. If `inFlight`, skip. Otherwise set it, capture the `generation`, and load the group's `listenerEnabled` and `listenerEagerness` (`groups` by `groupId`). If disabled, stop.
     2. Load the roster with `loadRoster`: for a General topic room, pass no `topicId`; for any other topic, pass the `topicId`. Check `topics.isGeneral`.
     3. Call `scoreRoom` with `complete = deps.listener.complete ?? completeChat`, the gateway's `baseUrl`, and the listener's model and key.
     4. If a newer human message changed the `generation` while the call ran, drop the result.
     5. For each woken `aiId` that has a live session which joined this room:
        - send `<AI name> is looking at this` as that AI with `liveSendMessage(…'groupchat'…)`. This is plain text, has no mention, and doesn't count as a turn;
        - push the **latest** window message onto that session's `roomPending` (the same shape as today) and call `pumpRoom`.
        
        The normal turn-time checks still apply: human member, daily limit and rate limit.
     6. Reset the count. Clear `inFlight` in `finally`.
   - **Cleanup:** clear the room's timer and state when the last session leaves the room, and on `disconnectAi` for rooms with no remaining session. Also clear every timer on gateway stop.
   - **Logs:** ids and counts only (room, group, the woken AI ids, the count). Never message text, reasons or keys. Redact with `secretsFor(virtualKey)` on errors.
4. **Tests,** in a new `describe('listener (T-0475)')` in `agents/gateway.test.ts`, with a fake `complete` and fake timers:
   - **No listener dep:** a non-mention message wakes nobody (today's behaviour).
   - **Group switch off:** nothing fires.
   - **Switch on:**
     - after the quiet window, a score above the threshold for AI A wakes only A. A posts the "looking at this" line, then gets a turn;
     - with two AIs in the room, the same message is recorded once (the fake `complete` is called once);
     - reaching `everyN` fires without waiting.
   - **Mentions:** a message mentioning an AI doesn't fire the listener, and the mention still works.
   - **Stale result:** a new human message during the call drops the result.
   - **Failure:** `complete` throws or returns garbage, and nobody wakes.
   - **Cleanup:** after `disconnectAi`, no timer fires.
   - **Config:** `LISTENER_MODEL` parses.

### Read first
`AGENTS.md`, `docs/audit/listener-delegation-plan.md` §2 and §8, `apps/server/src/agents/gateway.ts:90-250`, `:320-390`, `:895-920`, `:1170-1270` and `:1460-1640`, `apps/server/src/agents/listener/score.ts`, `apps/server/src/agents/gateway.test.ts:426-560` and `:2865-2960` (setup and group fixtures), `apps/server/src/index.ts:340-380`, `apps/server/src/config.ts` (search `LISTENER_ENABLED`).

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/src/index.ts`, `work/T-0475-listener-gateway.md`.

You may also add a small helper file `apps/server/src/agents/listener/room-state.ts` (and its test) if it keeps `gateway.ts` simpler. If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway agents/listener config
pnpm gate
```

### Acceptance
- With `LISTENER_ENABLED`, `LISTENER_MODEL` and the master key set and a group's listener on, a pause in human talk without mentions triggers one scoring call per room. AIs above the eagerness threshold post "<name> is looking at this" and take a normal turn.
- Mentions work as before.
- Everything is off by default.
- Logs carry ids only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
