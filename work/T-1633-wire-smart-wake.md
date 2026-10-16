---
id: T-1633
title: "Smart wake step 3 (plan docs/plan/smart-wake.md §5.3): group ingest wakes an AI when a person addresses it by name, asks a question in a one-AI room, or asks a follow-up right after its reply — using decideWake from T-1631"
status: merged
milestone: M5
branch: task/T-1633-wire-smart-wake
model: auto
effort: default
depends_on: [T-1631]
estimate: 40 min
---

# T-1633: Wire the addressing rules into group ingest

## Spec (written by Claude, do not edit)

### Why
Julio (2026-10-16): the AI must understand when a message is for it. T-1631 added the pure `decideWake` (`apps/server/src/agents/gateway/addressing.ts`). This task calls it from group ingest.

The plan (`docs/plan/smart-wake.md` §3) recommends rules V1-V3, S and R always on. A per-room switch comes later (plan §5.6).

### Facts (the lead read them on 2026-10-16, main after T-1627)
- **`apps/server/src/agents/gateway/group-ingest.ts`** (328 lines):
  - **The outgoing reflection branch** (`:102-114`, `if (message.outgoing) { … }`) is where the AI's own room message comes back.
  - **The round-opening block** (`:130-145`) runs for every person's message (`!isAiSender(normBareJid(message.fromJid))`).
  - **`mentioned`** (`:151-159`) is a picked mention, or a reply to the AI, or (person only) `bodyAddressesAi(body, [room.nick, aiBare.split('@')[0] ?? ''])` (T-1617).
  - **If not `mentioned`,** ingest returns `followTopic(...)` (`:165-172`). Otherwise a person's message calls `setTopicFollower(roomJid, session.aiId)` (`:197-199`) and then `queueRoomTurn(...)`.
  - **`sessions: Map<string, AiSession>`** is in the context (`:54`, `:69`).
- **`apps/server/src/agents/gateway/contracts.ts:175-181`:** `interface RoomSubscription { groupId; topicId; joinedAtMs; nick }`.
- **Live AIs in a room:** `[...sessions.values()].filter((s) => s.rooms.has(roomJid)).length`, the same filter as `apps/server/src/agents/gateway/group-turn-roster.ts:27-29`.

### Steps
1. **`contracts.ts`:** add two optional fields to `RoomSubscription`, with one comment line each:
   - `lastOwnReplyAtMs?: number`, set when the AI's own room message reflects back;
   - `lastOtherAiAtMs?: number`, set when another AI's message arrives in the room.
2. **`group-ingest.ts`:**
   - **(a)** In the outgoing branch, inside `if (session.rooms.has(ownRoomJid))`, set `room.lastOwnReplyAtMs = Date.now()`. Use the `RoomSubscription` from `session.rooms.get(ownRoomJid)`.
   - **(b)** After `room` is resolved: if the sender is an AI (`isAiSender(fromBare)`) and isn't this AI, set `room.lastOtherAiAtMs = Date.now()`.
   - **(c)** Replace the T-1617 `bodyAddressesAi(...)` clause in `mentioned` with a call to `decideWake` (from `./addressing`), for person senders only:
     ```ts
     decideWake({
       body,
       names: [room.nick, aiBare.split('@')[0] ?? ''],
       liveAisInRoom,
       lastOwnReplyAtMs: room.lastOwnReplyAtMs ?? null,
       otherAiRepliedSince: (room.lastOtherAiAtMs ?? 0) > (room.lastOwnReplyAtMs ?? 0),
       nowMs: Date.now(),
       rules: { oneAiQuestion: true, followUpQuestion: true },
     }) !== null
     ```
     Compute `liveAisInRoom` only when needed (after the cheaper checks fail). Keep the T-1617 comment, extended by one line for T-1633.
   - **(d)** Log one `logger.debug` line with the `WakeReason` when a rule (not a picked mention or reply) woke the AI: `{ roomJid, aiId, reason }`, never the body.
3. **Change nothing else:** following, handoff, rounds and rate limits stay as they are.
4. **Tests** in `apps/server/src/agents/gateway-group.test.ts`, following its existing harness:
   - in a room with one AI, a person's `what is BTC at?` with no mention starts a turn;
   - in a room with two AIs, the same message starts no turn for either;
   - a person's `thanks!` starts no turn;
   - after the AI's reply reflects back, a person's `and gold?` within 2 minutes starts a turn (two-AI room, so it's rule R and not S).

### Allowed files
- `apps/server/src/agents/gateway/group-ingest.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/gateway-group.test.ts`
- `work/T-1633-wire-smart-wake.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway-group.test.ts src/agents/gateway/addressing.test.ts src/agents/gateway/typed-mention.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The four test cases pass.**
- **The existing group tests pass.**
- **`group-ingest.ts` stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

- **`contracts.ts`**: added the two optional `RoomSubscription` fields (`lastOwnReplyAtMs`,
  `lastOtherAiAtMs`), each with the one-line comment the spec asked for.
- **`group-ingest.ts`**:
  - (a) The outgoing-reflection branch now gets the `RoomSubscription` from
    `session.rooms.get(ownRoomJid)` and stamps `lastOwnReplyAtMs = Date.now()`.
  - (b) After `room`/`fromBare` are known, an AI sender that is not this AI stamps
    `room.lastOtherAiAtMs = Date.now()`.
  - (c) The picked-mention and reply checks are now named `pickedMention`/`replied`;
    the old T-1617 `bodyAddressesAi(...)` clause is replaced by a `decideWake` call for
    person senders only, guarded behind the two cheaper checks so `liveAisInRoom` is
    computed only when needed. `mentioned = pickedMention || replied || wakeReason !== null`.
    The T-1617 comment is kept and extended with a T-1633 line.
  - (d) A `logger.debug?.({ roomJid, aiId, reason }, …)` line fires when only a rule woke
    the AI; nothing about the body is logged.
- **`gateway-group.test.ts`**: four tests in a new `smart wake rules (T-1633)` block,
  using the existing harness: one-AI room `what is BTC at?` starts a turn; two-AI room
  same message starts none; `thanks!` starts none; two-AI room follow-up `and gold?`
  after the AI's own reflection starts a turn for that AI only.
- Set `status: review`.

### Checks run

Single test files (from the Checks section, with the worker cap):

- `pnpm --filter @zilar/server exec vitest run src/agents/gateway-group.test.ts --reporter=dot --maxWorkers=2`
  → `1 passed`, `17 passed (17)`.
- `pnpm --filter @zilar/server exec vitest run src/agents/gateway-group.test.ts src/agents/gateway/addressing.test.ts src/agents/gateway/typed-mention.test.ts --reporter=dot --maxWorkers=2`
  → `3 passed`, `36 passed (36)`.

`pnpm gate` (repo root) summary lines:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (0.6s)
PASS  lint  (1.2s)
PASS  typecheck  (4.1s)
PASS  effect  (0.6s)
PASS  tests @zilar/server  (41.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The first gate run failed only on Prettier formatting of my added test lines; I fixed it
with `prettier --write apps/server/src/agents/gateway-group.test.ts` (additions only, no
pre-existing lines touched) and the second run is the `GATE PASS` above.

`group-ingest.ts` is 359 lines (≤ 400).

### Notes for the lead

- **One deviation from the spec's Step 1**: `GatewayLogger` only declared `info` and
  `warn`, so `logger.debug` did not typecheck. Step 2(d) asks for `logger.debug`, so I
  added an **optional** `debug?` method to `GatewayLogger` in `contracts.ts` (an allowed
  file) and call `logger.debug?.(…)`. Optional keeps the pure `captureLogger` test
  harness (a file outside this task's Allowed files) compiling. Production passes a pino
  logger, which has `debug`, so the line is emitted there; tests only implement
  `info`/`warn`, so they do not observe it.
- Rule timing uses `Date.now()` exactly as the spec's snippet says, while the harness
  fixes `deps.now` at `ROOM_DAY`; `joinedAtMs` is `ROOM_DAY` and the message stamps equal
  it, so the history-replay guard still passes.
- No new dependencies. No files outside the Allowed list were changed.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **How a wake is decided:** a picked mention or a reply still wins. Otherwise, for a person's message only, `decideWake` runs (address V1-V3, S in a one-AI room, R a follow-up within 2 minutes of this AI's own reply with no other AI since). The live-AI count is read only then. A rule wake logs `{ roomJid, aiId, reason }` at debug level, never the body.
- **The tests:** the lead ran `gateway-group`, `addressing`, `typed-mention` and `topic-follow`: 54 passed. `group-ingest.ts` is 359 lines.
- **Live check after the deploy:** in "ai test › General" (one AI), a question with no `@` should get an answer from @Deepseek.
- **Accepted edge:** in a topic, R can wake the AI that just replied while a different follower AI also follows. Rare, because a person's mention moves the follower to the AI that then replies.
