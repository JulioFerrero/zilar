---
id: T-0479
title: "Listener S4a (server): per-human-message AI turn budget per room (max 4); the 'looking at this' line only after the turn passes every gate"
status: todo
milestone: M5
branch: task/T-0479-listener-round-budget
model: auto
effort: low
depends_on: [T-0475]
estimate: 0.35 day
---

# T-0479: the round budget, and the wake line after the gates

## Spec (written by Claude, do not edit)

### Why
This is the first half of plan task S4, from `docs/audit/listener-delegation-plan.md` §3.1, §3.2 and §3.5. Each human room message opens a "round". AIs may take at most **4 turns per round in that room**, whether woken by a mention or by the listener. A new human message starts a fresh round. The gateway enforces this by not running the turn.

This task also fixes the T-0475 review nit. Today the listener posts "<name> is looking at this" **before** the turn's checks, so a turn the rate limit or the daily limit then drops leaves a line that no answer follows. The line must go out only once the turn has passed every gate.

AI-to-AI handoffs (hops) are **not** in this task (S4b, later).

### Verified facts (do not re-derive)
Line numbers are on main after the T-0475 merge, all in `apps/server/src/agents/gateway.ts`.
- **`RoomPendingMessage`** (lines 201-208) holds `{ id, body, fromJid, fromResolved, fromNick?, timestamp }`.
- **`wakeListenerAis(roomJid, state, wakeIds)`** (from about line 1667) posts the line with `liveSendMessage(session, roomJid, 'groupchat', \`${room.nick} is looking at this\`)` (line 1685), then pushes the latest window message onto `session.roomPending` and calls `pumpRoom`.
- **`handleRoomIncoming`** (line 1731):
  - it calls `noteListenerMessage` for every non-AI message when `deps.listener` is set (line 1760);
  - it returns when there is no mention;
  - it returns for AI senders;
  - it then queues a mention turn.
  
  Every AI session in the room receives the same message, so anything per room must dedupe by message id.
- **`runGroupSessionTurn`** (line 1811) runs these gates in order:
  1. the active AI;
  2. room membership (`loadRoomGateState`), which picks `eligible` items (resolved human members only) and sets `trigger` = the last eligible item (line 1859);
  3. the daily limit (`checkDailyLimit`, around line 1870);
  4. the per-room rate limit (lines 1879-1892), which pushes `atMs` into `roomTurns` when the turn passes.
  
  After that, the model call.
- **Cleanup:** `dropRoomListenerIfUnused(roomJid)` (line 1715) drops gateway-level room state once no session holds the room. It is called from `leaveRoomQuietly` (line 1317) and the disconnect path.
- **Tests:** `apps/server/src/agents/gateway.test.ts` has `describe('listener (T-0475)')` at line 5423, with its fake `complete` and fake timers, and group fixtures under `describe('groups')`.

### What to build
1. **The round budget.**
   - Add `export const ROUND_MAX_AI_TURNS = 4;` next to `GROUP_TURNS_PER_WINDOW` (line 182).
   - Add a gateway-level `roomRounds: Map<roomJid, { humanMessageId: string; aiTurns: number }>`.
   - **Opening a round:** in `handleRoomIncoming`, for every message from a non-AI sender (after the skew check, mention or not, listener or not), set the room's round to `{ humanMessageId: message.id, aiTurns: 0 }` **only if** `humanMessageId !== message.id`. That dedupes across sessions.
   - **Using a turn:** in `runGroupSessionTurn`, **after** the rate-limit gate passes and before the model call:
     - read the room's round;
     - if `aiTurns >= ROUND_MAX_AI_TURNS`, log `{ aiId, groupId, messageId: trigger.id }` with "AI round budget spent; dropping the turn" and return. Also remove the `atMs` stamp just pushed, so a dropped turn does not use rate budget;
     - otherwise increment `aiTurns`.
     
     A missing round (for example right after a restart) counts as a fresh one.
   - **Cleanup:** clear `roomRounds` for the room in `dropRoomListenerIfUnused`, renamed or not, your call.
2. **The wake line after the gates.**
   - Add `wake?: true` to `RoomPendingMessage`. `wakeListenerAis` no longer posts the line; it pushes the item with `wake: true`.
   - In `runGroupSessionTurn`, after **all** gates pass (member, daily limit, rate limit and the round budget), when **every** eligible item has `wake === true` (a pure listener wake, with no mention in the batch), post `${room.nick} is looking at this` with `liveSendMessage(…'groupchat'…)` (catch and ignore errors), then continue to the model call.
   - A mention turn never posts the line.
3. **Tests** (in the listener describe, or a new `describe('round budget (T-0479)')`):
   - **Budget:**
     - with 5 AIs mentioned by one human message, only 4 take turns (the fake `complete` or the reply count is 4);
     - a new human message afterwards lets turns run again;
     - the same message seen by 2 sessions opens one round (the count is not reset by the second session).
   - **Wake line:**
     - a listener wake whose turn passes posts the line and then a reply;
     - a listener wake for an AI at its room rate limit posts **no** line;
     - a listener wake for an AI over the daily limit posts no wake line;
     - a mention turn posts no wake line.
   - Existing listener and group tests pass. Adjust any that asserted the line is sent before the turn, in the listener describe only.

### Read first
`AGENTS.md`, `docs/audit/listener-delegation-plan.md` §3, `apps/server/src/agents/gateway.ts:175-260`, `:1600-1800` and `:1811-1900`, `apps/server/src/agents/gateway.test.ts:5423` to the end of that describe.

### Allowed files
`apps/server/src/agents/gateway.ts`, `apps/server/src/agents/gateway.test.ts`, `work/T-0479-listener-round-budget.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway
pnpm gate
```

### Acceptance
- AIs take at most 4 turns per human message per room, and a new human message resets the count.
- The "looking at this" line appears only when the woken AI's turn really runs.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
