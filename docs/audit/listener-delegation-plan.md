# The listener and delegation — plan on today's code (T-0468)

- **Written by** the worker on 2026-10-07 from the lead's task `work/T-0468-listener-delegation-plan.md`.
- **Goal:** turn plan §9.3–9.5 (`docs/PROJECT_PLAN.md:656-735`) into ordered tasks that fit the code as it is today.
- **Constraint:** docs only. Nothing here is implemented. Every claim about today's code carries a `file:line`.
- **Two adaptations forced by today's code:**
  1. **There are no desks yet** (`docs/FEATURES.md:96`, plan §11), so delegation cannot "start a session on the worker's desk". It wakes the worker's existing gateway session in the same room (§4).
  2. **There are no threads.** The schema has no thread table (`apps/server/src/db/schema.ts:216-1465` lists every table; none is a thread) and `replyTo` is only a quoted reply (`apps/server/src/agents/reply.ts:1212`). Delegation progress is therefore an ordinary room message, not a thread.

---

## 1. Today

### 1.1 How a room message becomes (or does not become) an AI turn

Every AI that is a member of a room joins it over XMPP (one `RoomSubscription` per joined room, `gateway.ts:188-194`, `:207`). Incoming room stanzas land in `handleRoomIncoming` (`apps/server/src/agents/gateway.ts:1469`):

1. An edit or retraction starts no turn (`:1470-1473`); the AI's own echo is dropped (`:1474-1476`); an empty body is dropped (`:1477-1480`).
2. The room must be one this AI joined, or the message is ignored (`:1481-1486`).
3. History replayed on join (its stamp older than the join minus a skew) is ignored (`:1489-1491`).
4. **The mention check:** the message must mention this AI's bare JID (`:1493-1495`). **No mention, nobody replies** — the function returns (`:1496-1499`, "M2 rule 3").
5. **No AI-to-AI turns:** a sender whose localpart starts with `ai-` (`isAiSender`, `:241-243`) never wakes the AI (`:1500-1504`). This is the ban §9.4.2 and §4.3 lift.
6. The mention is queued per room (`:1505-1514`) and one pump per `(AI, room)` is started (`:1515-1520`).

`pumpRoom` (`:1525-1542`) coalesces: one turn at a time per `(AI, room)`, and messages that arrive during a turn are batched into one more turn (`:1523-1524`, `:1531-1538`). `runGroupSessionTurn` (`:1544-1837`) then re-checks everything at turn time:

- load the AI (`loadActiveAi`, `:1551`) and the room gate (`loadRoomGateState`, `:1560`);
- keep only eligible messages — **non-AI** senders (`:1571-1575`), senders whose real JID is known (`:1576-1582`), and **current human members** of the topic (`:1583-1587`; `gate.memberJids` is built in `loadRoomGateState` at `:416-450`);
- the last eligible message becomes the trigger (`:1593`).

### 1.2 Where mentions, membership, coalescing, budgets and the kill switch are checked

| Concern | Today | Where |
| --- | --- | --- |
| Mention | Bare-JID match against `message.mentions` | `gateway.ts:1493-1495` |
| Membership | `gate.memberJids` (humans of the topic: all group members for General and public topics, `topic_members` for private) | `gateway.ts:416-450`, checked `:1583-1587` |
| Coalescing | `roomPending` batch + one pump per `(AI, room)` | `gateway.ts:1525-1542` |
| Per-room rate limit | 6 turns per 10 min, in memory | `gateway.ts:165-166`, `:1612-1625` |
| Daily spending limit | `checkDailyLimit` before the model call, at most one fixed notice per AI/chat/UTC day | `gateway.ts:573-619`, called `:1603-1610` |
| 80% warnings | after the reply, once per AI/chat/day | `gateway.ts:626-…`, called `:1807-1812` |
| Per-round gate (budget + stop) | `checkDmRoundGate` before every model call of the tool loop | `gateway.ts:914-946`, passed at `:1794` |
| Kill switch | `disconnectAi` marks `session.stopped` and removes it; every send path checks `sessionIsLive` / `liveSendMessage` | `gateway.ts:1174-1199`, `:887-912` |
| Auth to the model | the AI's own capped LiteLLM virtual key, decrypted in memory only | `gateway.ts:1659-1670` |

The hard spending caps and the daily ledger live in `ai_limits` (`schema.ts:580-587`), `llm_virtual_keys` (`:992-1002`) and `ai_daily_spend` (`:972-983`). The kill switch is a real feature (`docs/FEATURES.md:80`); costs and the daily limit too (`docs/FEATURES.md:69`).

### 1.3 How a reply is posted

`runGroupTurn` (`apps/server/src/agents/reply.ts:1204-1273`) turns typing on (`:1224`), runs the shared tool loop when tools are offered (`runGroupToolTurn`, `:1285`; shared `runToolLoop`, `:731`), and posts the final text with an `@Name` prefix, `replyTo` and a mention of the trigger's sender (`wire`, `:1209-1215`). Every send goes through `liveSendMessage` so a stop mid-turn drops it (`gateway.ts:901-912`, `:1800`). Typing turns off in `finally` (`reply.ts:1271`). No drafts in rooms (`gateway.ts:1761`).

The room tool loop is wired at `gateway.ts:1766-1806`; tools are `buildGroupTools` (`apps/server/src/agents/tools.ts:353`) and `executeToolCall` (`gateway.ts:692`). A group turn today may only run the three memory tools and `request_action` (`gateway.ts:709-725`); `request_action` needs the trigger to be a topic member with `owner`/`admin` role, re-checked at execution time (`:1733-1735`, `:1745-1759`). The system prompt is built by `buildGroupMessages` (`apps/server/src/agents/context.ts:206`) from the same fixed persona/date prefix plus history (`buildGroupSystemMessage`, `:104-127`). **The context has no roster or agent cards today** — only the persona, the topic/group names and the recent messages.

### 1.4 What the memory compactor already produces

Memory is per `(AI, chat)`: the recent window is 50 messages / 40 000 chars (`context.ts:9-13`), and the compactor builds a rolling binary summary tree, smallest block 16 messages, one line per node (`apps/server/src/agents/memory/compactor.ts:42-64`; plan `docs/audit/ai-memory-plan.md`). The gateway fires it fire-and-forget after the reply (`gateway.ts:955-968`, `:1813`). A listener can read `ai_memory_facts`/`ai_memory_nodes` (`schema.ts:1437-1457`) and the recent mirror rows (`ai_memory_messages`, `:1392`) instead of re-summarising the room itself; the newest window comes from `session.core.loadHistory` (`gateway.ts:1674`) or the mirror.

---

## 2. Listener design on this code

### 2.1 The trigger

The listener must see **every** room message, including the ones `handleRoomIncoming` drops before queueing. The cheapest hook is inside `handleRoomIncoming` right after the join/skew checks (`gateway.ts:1491`) and **before** the mention early-return (`:1493-1499`): feed the message to a per-room debounce and return as today. Add to `AiSession` a per-room timer and message counter next to the existing maps (`gateway.ts:207-213`), started in the session literal (`:1128-1130`).

- Check after **N messages** (default 12) **or X seconds of quiet** (default 20 s), whichever comes first; reset the timer on each new message.
- On fire, run one scoring call (2.2), then wake only the AIs above threshold, subject to §3's budget.
- The timer must be cancelled when the AI leaves the room (`:1261-1264`) and on stop (`disconnectAi`, `:1174-1199`).

A new human message that arrives while a check is in flight is the reset signal for §3; the check's result is discarded if its input window is stale.

### 2.2 One scoring call

- **Call:** `completeChat` (`reply.ts:298-304`) — no tools advertised, so a hostile room can never reach a tool. It uses the same LiteLLM base URL as every turn.
- **Who pays / which key:** today keys are per AI (`gateway.ts:1659-1670`). A room has AIs owned by different people, so "the room's AI key" is ill-defined. **Recommendation:** a dedicated server-configured listener model and key (`LISTENER_ENABLED`, `LISTENER_MODEL`, `LISTENER_PROVIDER_CONNECTION`-style env, following the flag pattern at `config.ts:174-196`), so the platform pays for a platform feature. Alternative: the room creator pays through their AI's key. This is Open Question 1.
- **Input:** the recent window (`loadHistory`, `gateway.ts:1674`, or the mirror) plus a roster built fresh from `group_ais`/`topic_ais` joined to `ais` (`schema.ts:344-359`, `:516-531`, `:539-575`): each AI's **id, name, model and a short persona summary** (persona is up to 4000 chars, `schema.ts:548`; truncate to the first line or ~200 chars, the same bound as `PERSONA_SUMMARY_MAX_LENGTH`, `tools.ts:12`). This roster does not exist in the context builder today (1.3), so the listener builds it itself. The room summary from the memory store (1.4) is reused, not recomputed.
- **Output (strict JSON, zod-validated):**
  ```json
  {
    "scores": { "<aiId>": 0.0, "…": 0.0 },
    "reason": "one short line",
    "message_ids": ["m-31", "m-32"]
  }
  ```
  Key by **AI id**, never by display name or nick (noreply nicks can collide). A parse failure wakes nobody.

### 2.3 Threshold and eagerness per room, and who changes them

- Store on the `groups` row (`schema.ts:216-269`) next to `membersCanCreateTopics` (`:227`): `listenerEnabled` boolean default `false` and `listenerEagerness` enum (`quiet` | `normal` | `eager`) default `normal`. A channel/topic inherits the group's setting.
- Threshold maps to eagerness server-side (e.g. `eager` 0.4, `normal` 0.6, `quiet` 0.8); a numeric `listenerThreshold` is an alternative but an enum is easier for admins and safer.
- **Who changes them:** group owners/admins — the same actor that already toggles group settings (`groups/routes.ts:74-94`, `:305-356`; `groups/service.ts:227-262`, "group owner/admin toggles"). The web switch lives with the existing ones in `GroupPanel.tsx` (`:555`).

### 2.4 Silent wake

- Default: the woken AI gets a normal turn, so people already see `composing` (`reply.ts:1224`, `:1271`). Add one short, non-tool line from the woken AI, e.g. "Dev is looking at this", posted as the AI, and let the reason be shown by the client (it needs the wake metadata; see §5). The line must **not** count toward the AI-message budget and must not mention anyone.
- Alternative considered: a purely ephemeral typing state with no message. It is cheaper but invisible in history; the spec asks for a "Dev is looking at this" line (`PROJECT_PLAN.md:668-669`), so the line is the recommendation.
- False wakes are recorded (ids only: room, ai id, score, message ids) so eagerness can be tuned; people can correct a wake, which feeds the same signal.

### 2.5 Security: the listener is the Rule-of-Two reader

- It has **no tools**: every call is `completeChat` (`reply.ts:298`), which ignores improvised tool calls and returns text only. It can tag and suggest, never act.
- Its output is parsed as JSON with zod and used only to decide wakes; the room text is data ("notes, not instructions"), like the memory block (`context.ts:146-154`).
- No prompt or response text in logs — ids and counts only, the same discipline as the compactor (`compactor.ts:1-5`) and the gateway (`gateway.ts:156-161`).
- Redaction: reuse `redactSecrets` and the `looksLikeSecret` check (`agents/memory/secrets.ts`) on suggestions before anything is stored; never let a listener string reach an audit detail (Agents.md: audit entries carry ids only).

### 2.6 Off by default

- Server flag `LISTENER_ENABLED` (env, default `false`), mirroring `ROUTINES_ENABLED`/`TOOLS_ENABLED` (`config.ts:174-196`).
- Per-room switch `listenerEnabled` default `false` on the `groups` row. With the server flag off, the switch is inert and the UI shows it disabled.

### 2.7 Cost estimate

From plan §9.3 (`PROJECT_PLAN.md:678-686`): a busy room ≈ 300 messages/day → ≈ 100 checks/day at ≈ 5k input tokens each ≈ 15M input tokens/month; with provider caching of the fixed prefix (the listener's prompt is append-only, like the AI context, `context.ts:56-57`) that is ≈ $0.50/month on a weak model and ≈ $1–5/month on DeepSeek V4.1 Flash. Add the roster (small) and the reused summary (already paid by the compactor).

---

## 3. Limits (§9.4) on this code

### 3.1 A per-human-message budget, and where it lives

Budget: **4 AI messages** and **2 AI-to-AI hops** per human message (`PROJECT_PLAN.md:692-695`). It must be **per room**, not per AI, because the AIs have separate gateway sessions (`AiSession`, `gateway.ts:196-214`) and the budget carries across handoffs. **Recommendation:** a gateway-level `Map<roomJid, RoundBudget>` in the gateway closure, keyed by the trigger human message id, holding `{ humanMessageId, aiMessages, hops }`. In memory is right today: one gateway process, and a restart safely resets to zero (a fresh start can only wake fewer AIs). Persisting it in the DB would be needed once the gateway is multi-process; note it, don't build it now.

### 3.2 New human message resets (and should interrupt)

- A new human room message replaces the current `RoundBudget` for that room (in `handleRoomIncoming`, `:1491` area), so a fresh human turn always starts with the full budget.
- **Interrupt in-flight turns:** today the gateway coalesces, it does not cancel (`pumpRoom`, `:1531-1538`), and the model call has no external abort — only a timeout (`requestCompletion` uses `AbortSignal.timeout`, `reply.ts:214`). Full §9.5-style interruption needs an abort handle threaded through the turn. **Recommendation for v1:** reset the budget and let the current turn finish (it cannot loop, the budget is already spent); add real cancellation in a later task, flagged in §7.

### 3.3 AI @mentions an AI is a handoff

Lift today's ban **inside this budget**:
- In `handleRoomIncoming`, do not return for `ai-` senders when the message mentions an AI in the room (replace `gateway.ts:1500-1504`); instead count one hop and enqueue if hops ≤ 2.
- In `runGroupSessionTurn`, allow `ai-` senders through the eligible filter (replace the skip at `:1571-1575`) only while a hop remains.
- Keep the DM ban (`gateway.ts:1874-1876`): delegation is a room feature.
- A hop where the target is unknown or the budget is spent is simply not queued ("the gateway enforces by not waking", `PROJECT_PLAN.md:697`).

### 3.4 Stuck detection (simple first version)

V1 reuses what the gateway already counts rather than a new model call:
- If the `RoundBudget` hits 0 AI messages or 0 hops, stop waking (already the cap).
- Track a small ring of the last few AI reply bodies per room (hashes, not text) and if the same AI would be woken twice with no new human message and no new artifacts, mark the round stuck.
- On stuck, post **one** fixed line mentioning the human who started the round ("looks like we're going in circles — <name>?"), then stop waking until a new human message resets the budget. This is the Magentic-ledger idea (`PROJECT_PLAN.md:696`) reduced to the state the gateway already holds.

### 3.5 Everything enforced by the gateway

All of the above live in the gateway before a model call, exactly like the daily limit (`gateway.ts:573-619`) and the per-room rate limit (`:1612-1625`). The AI prompt may say "stay quiet"; only not waking is a guarantee.

---

## 4. Delegation without desks

### 4.1 The `delegate(ai, task)` tool and its permission

- Add `delegate` to an AI's tools only when the AI may delegate. **Storage:** `ais.canDelegate` boolean default `false` (`schema.ts:539-575`). **Who sets it:** the AI's **owner**, in the AI panel (`UpdateAiSchema`, `apps/server/src/ais/routes.ts:91-102`; `PATCH /api/ais/:id`, `:216-235`; `updateAi`, `apps/server/src/ais/service.ts:342`; UI `apps/web/src/components/ais/AiPanel.tsx:629-636`). Default off, consistent with the rest of the product.
- The target must be a real AI the caller can see: a member of the **same group** (`group_ais`, `schema.ts:344-359`) and, for a non-General topic, the same topic (`topic_ais`, `:516-531`). The target is named by **AI id from the roster**, never by a name from model output. Whether an AI may target an AI owned by someone else is Open Question 4.
- Add the three tools named in §9.5's list at the same time or in order: `delegate`, `task_status`, and (optional) `post_to_room`. `request_human` and `board_*` are out of scope until the board (§9.6) exists.

### 4.2 The worker turn runs with its own model, key and budget

Without desks there is no new session to start: the worker already holds a live gateway session and is in the room (`AiSession`, `gateway.ts:196-214`). So `delegate` **injects a synthetic trigger into the worker's room queue** and lets the normal `runGroupSessionTurn` run:

- The worker's own model and capped virtual key are already used (`gateway.ts:1659-1670`, `modelNameForAi`, `:1784`), and its own daily/monthly limits already apply (`checkDailyLimit`, `:573-619`; `checkDmRoundGate`, `:914-946`). Nothing is shared with the boss.
- Room: the same room/topic. **There are no threads** (header), so progress is a normal room message with `replyTo` pointing at the boss's trigger message (`reply.ts:1209-1215`), not a thread.
- The injected trigger carries the handoff objective and `context_summary` as its body; the worker sees it as a normal turn from the boss AI.

### 4.3 The progress line and the result

- **Progress:** the worker's normal reply is the progress update; a live `reportProgress` already exists (`gateway.ts:1772`, `reply.ts:1181-1186`) and can be reused for "working on <task>" if the delegation is visible (Open Question 3).
- **Result to the boss — adapted:** §9.5 says the result is returned "as the tool result" (`PROJECT_PLAN.md:710`), which assumes a desk session the boss waits on. Here the boss's turn has a 120 s wall clock (`TOOL_TURN_WALL_CLOCK_MS`, `reply.ts:394`) and a 90 s model timeout (`LITELLM_CHAT_TIMEOUT_MS`, `:25`), so blocking the boss on a whole worker turn is unsafe. **Recommendation:** `delegate` returns `{ "task_id": "…", "status": "working" }` immediately; when the worker finishes it @mentions the boss (a normal AI-to-AI handoff inside the budget, §3.3), or the boss learns the result on its next turn via `task_status`. **This is a deliberate deviation from §9.5** and is flagged as a deviation in the Report.
- **`task_status(id)`** reads the delegation row and returns state, artifacts and the (≤ ~2k token) result summary, §9.5 (`PROJECT_PLAN.md:733`).

### 4.4 Handoff JSON → what is stored

One table `ai_delegations`, columns mirroring the handoff (`PROJECT_PLAN.md:715-731`):

| JSON field | Column |
| --- | --- |
| `task_id` | `id` (server-generated) |
| `from`, `to` | `from_ai_id`, `to_ai_id` (FK `ais`) |
| `objective` | `objective` |
| `context_summary` | `context_summary` (≤ ~300 tokens, cut server-side) |
| `acceptance`, `constraints`, `artifacts` | `jsonb` arrays |
| `budget` | `budget_currency`, `budget_max` |
| `return_format` | `return_format` |
| `reply_to` | `reply_to` (message id) |
| — | `group_id`, `topic_id` (scope), `status`, `result_summary`, `created_at`, `updated_at` |

`status` follows the A2A states (§9.6, `PROJECT_PLAN.md:741`) or the smaller set the plan needs (`working`, `completed`, `failed`, `canceled`) — pick the plan's set and document it. Billing is the worker's key already; the `budget` field is a hint/limit on the worker's own cap, not a second charge.

### 4.5 What changes once desks exist

When the runner hosts desks (`docs/FEATURES.md:96`), the worker turn moves to a session on the worker's own desk (plan §11), progress can stream to a real thread, and `delegate` can return the result synchronously as §9.5 describes. The `ai_delegations` table, the tool and the permission do not change; only the execution target (desk session vs. gateway session) and the progress channel (thread vs. room) do. Keep those two behind one `DelegationRunner` seam so the later swap is small.

---

## 5. Data and API changes

### 5.1 Schema (one migration, one task)

- `groups` (`schema.ts:216-269`): add `listenerEnabled` boolean default `false`, `listenerEagerness` enum `('quiet','normal','eager')` default `'normal'`, with a check constraint like the existing ones.
- `ais` (`schema.ts:539-575`): add `canDelegate` boolean default `false`.
- New `ai_delegations` table (§4.4) with FKs to `ais` and `groups`/`topics`, an index on `(to_ai_id, status)` and `(group_id, created_at)`.
- **At most one schema task in flight.** Server tasks that only need new columns wait for this task.

### 5.2 Routes

- `PATCH /api/groups/:id` — accept `listenerEnabled`, `listenerEagerness` in `patchGroupSchema` (`groups/routes.ts:74-94`) and apply in `patchGroup` (`groups/service.ts:227-262`). Group owner/admin only, same as today.
- `PATCH /api/ais/:id` — accept `canDelegate` in `UpdateAiSchema` (`ais/routes.ts:91-102`) and `updateAi` (`ais/service.ts:342`). Owner only.
- `GET /api/ais/:id/delegations` (owner) and `GET /api/delegations/:id` (`task_status` for the AIs; membership-scoped like search routes, `apps/server/src/search/service.ts` `allowedArchives`), plus a `POST /api/delegations/:id/cancel` if cancellation is wanted. All covered by the 401 sweep (`docs/FEATURES.md:87`).
- New route boundaries validate with zod and are rate-limited/capped per the security checklist.

### 5.3 Web UI

- **Room settings** (`GroupPanel.tsx`, the existing switch at `:555`): listener on/off + eagerness (owner/admin).
- **AI settings** (`AiPanel.tsx`, near Usage `:629` / Limits `:636`): a "Can delegate" switch (owner).
- **Chat:** the silent-wake line and its "why" affordance (§2.4); delegation progress as a room message; a small "working on <task>" marker on the delegation message. Wake/delegation metadata needs a payload the client understands — define it in the API task.
- **Mobile items wait:** the mobile room and AI settings screens and the wake/delegation rendering come after web (mark as later).

---

## 6. Task split

One PR each, ordered. Schema first and alone; then server, then web; mobile last. Exact files and tests.

1. **S1, server — schema (one migration).** `apps/server/src/db/schema.ts` + `drizzle/` migration: `groups.listenerEnabled`, `groups.listenerEagerness`, `ais.canDelegate`, `ai_delegations`. Tests: `db/migrate.test.ts` (migration applies, defaults hold).
2. **S2, server — the listener core (pure, no gateway yet).** New `apps/server/src/agents/listener/score.ts`: build the roster query (`group_ais`+`topic_ais`+`ais`), build the prompt, parse the strict JSON with zod, map eagerness → threshold. Tests: `listener/score.test.ts` (valid/invalid JSON, threshold mapping, roster shape, no tool calls). No DB-writing.
3. **S3, server — the listener in the gateway.** `gateway.ts`: the per-room debounce/counter on `AiSession` (`:196-214`, `:1128-1130`), the hook in `handleRoomIncoming` before the mention return (`:1491-1499`), the server key/model wiring via `config.ts:174-196`, the silent-wake line, and the audit line (ids only). Tests: `agents/gateway.test.ts` (fires after N/quiet, no wake offline/threshold, reset on new human message).
4. **S4, server — the round budget and AI-to-AI hops.** `gateway.ts`: the gateway-level `Map<roomJid, RoundBudget>`, the hop-aware changes at `:1500-1504` and `:1571-1575`, reset at `:1491`, stuck detection (§3.4). Tests: `agents/gateway.test.ts` (4/2 caps, reset, no loop past the cap, stuck line once).
5. **S5, server — `delegate` / `task_status`.** `tools.ts` (definitions + `ai_delegations` access), `executeToolCall` branch (`gateway.ts:692-725`), the synthetic trigger into the worker's room queue, `task_status`, and the handoff mapping. Tests: `agents/gateway.test.ts` + `tools` unit (permission off = unknown tool, cross-room target refused, budget clamped).
6. **S6, server — routes + UI payloads.** Group listener fields, AI `canDelegate`, delegation read/cancel routes, and the wake/delegation message payload. Tests: `groups/*.test.ts`, `ais/routes.test.ts`, route 401 sweep.
7. **W1, web — room and AI settings.** `GroupPanel.tsx` (listener controls), `AiPanel.tsx` (can-delegate), `lib/api.ts` + mock (`apps/web/src/mock/api.ts`). Tests: `GroupPanel.test.tsx`, `AiPanel.test.tsx`, `api.*.test.ts`.
8. **W2, web — chat rendering.** Silent-wake line with reason, delegation progress/result. Tests: message-list/component tests.
9. **M1, mobile (later).** Room settings, AI settings, wake/delegation rendering. Waits for W1/W2.

Dependencies: S1 blocks S2–S4, S6; S2 blocks S3; S3 blocks S4; S3/S4 block S5; S5 blocks S6; S6 blocks W1/W2; W1/W2 block M1.

---

## 7. Open questions for Julio (each with a recommendation)

1. **Who pays for listener calls?** Recommendation: the server pays, with a dedicated listener model/key behind `LISTENER_ENABLED` — the listener is platform infrastructure and a room's AIs can have different owners. Fallback: the group creator pays. (If the answer is "the AIs' owners split", the design gets a per-AI scoring call instead of one, which §9.3 explicitly avoids.)
2. **Default eagerness?** Recommendation: **normal** (threshold ≈ 0.6), with `quiet` the option for busy rooms; the May 2026 When2Speak finding says models over-interrupt (`PROJECT_PLAN.md:671`), so never default to `eager`.
3. **Is delegation visible to people in the room?** Recommendation: **yes** — show the progress message and the "working on <task>" state; hidden delegation is how AI-to-AI loops become invisible. The handoff's `objective` is already room content, so nothing new leaks.
4. **May an AI delegate to an AI owned by someone else?** Recommendation: **yes, only within the same group and only when the target's owner has enabled `canDelegate`-style opt-in for receiving** (i.e. the target must already be a room member added by its owner). Default: same-owner only in v1, widen after the first version.

Also worth a decision, not asked in the spec but blocking:
5. **Wake line wording** — "Dev is looking at this" (plan §9.3) vs. a purely ephemeral typing state. Recommendation: the line, non-counted, no mention.
6. **Interrupting in-flight turns** (§3.2) — v1 reset-only (recommended) vs. adding cancellation now.
