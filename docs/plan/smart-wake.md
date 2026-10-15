# Smart wake: an AI that knows a group message is for it (T-1621)

- **Written by** the worker on 2026-10-16 from the lead's task `work/T-1621-smart-wake-plan.md`.
- **Goal:** define how a group message reaches an AI when it names the AI differently ("@Deepseek" typed by hand, "Deepseek, …") or does not name it at all ("can someone check the build?"), with deterministic rules first and an optional model listener paid by each AI's own key.
- **Constraint:** docs only. Nothing here is implemented. Every claim about today's code carries a `file:line`.
- **Read alongside:** `docs/audit/listener-delegation-plan.md` (the listener design and the Rule-of-Two reasoning, §2.5), `docs/PROJECT_PLAN.md:662-704` (§9.3–§9.4), and T-1617 (running) for typed mentions.

The listener scaffolding already exists in the code; it was shelved as platform-paid (T-1399). This plan re-uses it on each AI's own key and puts cheap deterministic rules in front of it.

---

## 1. Today: how a group message does or does not wake an AI

### 1.1 The ingest path, in order

A `groupchat` stanza reaches `handleIncoming` (`apps/server/src/agents/gateway.ts:251-299`, groupchat routed at `:271-274`) and then `handleRoomIncoming` (`apps/server/src/agents/gateway/group-ingest.ts:89-199`). In order:

1. **An edit or a retraction is never a wake** — `group-ingest.ts:91-93`.
2. **The AI's own room reflection is dropped** (an `outgoing` message) — `group-ingest.ts:101-113`. Before returning it records the stanza id and origin id in `session.roomSentIds` (`:104-107`, kept by `rememberRoomSentId`, `contracts.ts:247-257`) and re-keys a question card (`:110`, `question-answer.ts:23-45`).
3. **An empty body is dropped** — `group-ingest.ts:114-117`.
4. **A room this AI did not join is ignored** — `group-ingest.ts:118-123`.
5. **History replayed on join is ignored** (stamp older than the join minus `GROUP_JOIN_SKEW_MS`, `contracts.ts:134`) — `group-ingest.ts:124-128`.
6. **A human message opens a fresh round** — `group-ingest.ts:129-144`: it answers an open question card (`:134`, `question-answer.ts:50-87`), then resets `roomRounds` for the room (`:135-143`, `RoomRound` in `contracts.ts:165-173`). AI senders never open a round (`:132`).
7. **The message is fed to the listener window** — `group-ingest.ts:154-158`, but only when `deps.listener` is set and the sender is human (`listener.ts:50-125`).
8. **The mention check** — `group-ingest.ts:145-153`: the picked mention (`message.mentions`) matches this AI's bare JID (`:146-147`), or the message quotes one of this AI's recent messages (`replyTargetsAi`, `:26-43`, using `replyTo.to` or `roomSentIds`).
9. **No mention → follow** — `group-ingest.ts:159-166` calls `followTopic` (`:207-237`): the room's topic follower, the last AI a person mentioned (`setTopicFollower`, `topic-follow.ts:171-193`), answers a plain human message with no `@`. **General is never followed** — the lookup excludes `is_general = false` rows (`topic-follow.ts:57-77`, `:69-70`); the guard is re-checked in the write (`:189-190`). A new human message that is not the follower's does nothing.
10. **Mention by a person** moves following to this AI (`group-ingest.ts:196`) and queues a turn (`:198`).
11. **Mention by another AI is a handoff**, bounded by `ROUND_MAX_HOPS = 2` (`contracts.ts:129`); the sender must be a live session joined to this room (`group-ingest.ts:169-192`, `sessionForAiJid` at `:77-84`). Handoffs queue with the `handoff` flag (`:198`).
12. **Queue and coalesce** — `queueRoomTurn` pushes per room and forks the pump (`:241-271`); `pumpRoomEffect` runs one turn at a time per `(AI, room)` (`:280-283`) and coalesces messages from the same sender, except a delegation which is always its own turn (`:297-312`).

### 1.2 Turn-time gates (before any model call)

`runGroupSessionTurn` (`apps/server/src/agents/gateway/group-turn.ts:107-330`) re-checks everything:

- **Eligible senders**: AI senders only for a queued handoff (`:137-150`); an unknown real JID is dropped (`:151-157`); otherwise only a current human member (`:159-161`, membership from `loadRoomGateState`, `db.ts:317-371`). The last eligible message is the trigger (`:167`).
- **Daily spend limit** — `group-turn.ts:204-215`, `budget.ts:117-192`. A limited AI sends one fixed notice per room per UTC day.
- **Per-room rate limit** `6` per `10 min` (`contracts.ts:120-121`) and **round budget** `ROUND_MAX_AI_TURNS = 4` per human message (`contracts.ts:125`), both checked in `checkRoomLimits` (`room-limits.ts:31-56`; round at `:47-51`).
- **The listener wake line** `"<nick> is looking at this"` is posted only when every eligible item is a wake, never a mention — `group-turn.ts:242-249`.
- **Each AI pays its own turn** with its owner's provider connection: `loadModelTarget` (`model-target.ts:21-68`) decrypts that AI's key in memory; the desk is resolved per turn (`group-turn-body.ts:214`).

### 1.3 The listener: what exists, and what is missing to run it

The listener code is complete but unreachable in production.

**Exists today**

- The per-room debounce (after `LISTENER_EVERY_N_DEFAULT = 12` messages or `LISTENER_QUIET_MS_DEFAULT = 20 s` of quiet; `contracts.ts:136-139`): `noteListenerMessage` (`listener.ts:50-125`). A message that picks any AI resets the window (`:97-105`).
- One scoring call per room, skipped while one is in flight and dropped when a newer message replaced its window (generation guard): `fireRoomListenerEffect` (`listener.ts:140-205`).
- The pure scoring core: roster read (`listener/score.ts:54-80`), fixed prompt with the untrusted-data line (`:93-101`, `:111-130`), strict JSON parse (`:172-198`), eagerness → threshold (`:19-25`), one call (`:221-253`).
- Waking each scored AI that still holds a live session, by queueing the latest window message as a normal turn: `wakeListenerAis` (`listener.ts:211-266`, `:235-245`).
- Persistence: `groups.listener_enabled` / `listener_eagerness` (`rows.ts:40-41`), read by `loadGroupListenerSettings` (`gateway/db.ts:226-238`); the `is_general` topic read (`db.ts:240-252`).

**Missing to run it**

1. **No listener is ever injected.** `createAgentGateway` is called without a `listener` dep (`startup/components.ts:213-238`); the type is optional (`contracts.ts:33-44`) and every listener path returns early without it (`listener.ts:56-59`, `:144-147`).
2. **`LISTENER_ENABLED` is ignored on purpose** with a log line — `startup/components.ts:205-212`: "the listener is a platform-paid feature and there is no platform key in P0". `docs/SERVER_CONFIG.md:127-128` says the same.
3. **The only target is one server-wide key.** The dep is a single `ModelTarget` (`contracts.ts:39-44`); there is no per-AI path. This is exactly the T-1399 blocker: no platform key. Running it "on the AI's own key" means reshaping this to per-AI targets (option b).
4. **The room summary input is never supplied** — `buildListenerMessages` accepts `roomSummary` (`score.ts:105`, `:116-118`) but `fireRoomListenerEffect` never passes one (`listener.ts:171-179`).
5. **The "why" is parsed but not surfaced** — `scoreRoom` returns `reason` and `messageIds` (`score.ts:212-216`) and the wake logs ids/count only (`listener.ts:261-264`); the wake line has no reason affordance (`group-turn.ts:247`).

---

## 2. The options

Costs are per busy room (≈ 300 human messages/day), from `PROJECT_PLAN.md:684-691`: ≈ 100 checks/day at ≈ 5k input tokens each ≈ 15M input tokens/month; DeepSeek V4.1 Flash ≈ **$1–5/month**, and 100/300 ≈ **0.33 checks per human message**. One scoring call ≈ 5k × $0.30/M ≈ **$0.0015**, i.e. ≈ **$0.0005 per human message**.

### (a) Deterministic rules beyond T-1617

Pure string/state rules, no model. T-1617 (typed `@Name` or "Name, …") is the first; this extends it.

**Precise patterns** (the AI's display name `N`, matched case-insensitively, whole word, only for names of ≥ 4 characters so short names that collide with common words are skipped):

- **V1 — address at the start:** body, after leading whitespace, starts with `N` or `@N` followed by `,`, `:`, or whitespace. `^@?N[,:\s]`.
- **V2 — `@N` anywhere:** a hand-typed `@N` (T-1617's core) at any position.
- **V3 — mid-sentence vocative:** `N,` or `N:` anywhere. Rare, and low harm when wrong.

**Rule S — a room with exactly one AI:** if exactly one live AI session is joined to the room (`sessions.values()` filtered by `rooms.has(roomJid)`, the same filter as `group-turn-roster.ts:27-29`), a human message that is a question wakes it. A question ends with `?` or starts with a question word (what/where/when/who/why/how/when/can/could/does/is/are/should). Only `?` alone if the wording is ambiguous; the list is kept short and documented.

**Rule R — a question right after this AI's own reply:** this AI replied in the room within the last 2 minutes, no other AI replied since, and the new human message is a question (rule S's detector): wake this AI.

**Accepted false positives:** a message that *starts* with the AI's name but is about it rather than to it ("Deepseek should probably not run that"); a colloquial "Name," at sentence start; a two-AI room where a one-AI rule is skipped anyway; a question addressed to people with no `?` (missed, not mis-fired). We accept V3's rare mid-sentence hit and rule R's two-minute staleness because both are cheap and Stop is one tap away; we do **not** match a bare occurrence of the name anywhere, which is where most noise would come from.

- **Pros:** free, instant, deterministic, no key, explainable, no untrusted-model exposure, works offline.
- **Cons:** brittle to nicknames and typos; the AI's display name can collide with a person's; multi-AI rooms are ambiguous (rules S and R are the only cross-AI-safe parts); every miss ("@Deeepseek") still needs the model layer.
- **Cost per human message:** **$0** model; one regex over the body and a small in-memory lookup.
- **Code:** a new pure module `apps/server/src/agents/gateway/addressing.ts` wired into the mention check (`group-ingest.ts:145-153`); the AI's name must reach the ingest path — it is not on `AiSession` today (`contracts.ts:209-239`, session built at `sessions.ts:126-143`), so add it at connect or read it with a short cache. Rule S/R need the room's live-AI count and a last-AI-reply stamp per room.

### (b) The listener on each AI's own key

Each AI that could answer runs one small yes/no scoring call with **its own** model and connection.

- **How:** reuse the listener core (`listener/score.ts`) and `loadModelTarget` (`model-target.ts:21-68`) per AI; replace the single `deps.listener.target` (`contracts.ts:39-44`) with a per-AI target resolved at check time. Debounce as today (`contracts.ts:136-139`), add a **cap per room per minute**, and run the **budget gate before the call** (`budget.ts:117-192`, `:255-288`).
- **Pros:** no platform key, so T-1399's blocker disappears; each owner pays only their own AI; no cross-owner key sharing; exact "smart" behaviour for the remaining cases.
- **Cons:** N calls per check for N AIs in the room (up to `6` AIs wake under the rate cap but a room can hold more); N× tokens; the per-AI prompt differs so results can disagree; wake storms unless the room round caps it; owners who never asked get a small bill.
- **Cost per human message:** **≈ $0.0005 × N** (N = AIs in the room); ≈ **$1–5/month × N** for a busy room, each on its own key. The AI turn a wake starts is the same cost as a mention today, on the same key.
- **Code:** `gateway/listener.ts` (per-AI loop instead of `wakeListenerAis`'s single result), `agents/listener/score.ts` (already per-roster-call), `gateway/model-target.ts` (reuse), `gateway/contracts.ts` (drop the single-target dep or keep it as the test seam), `startup/components.ts` (the flag), `budget.ts` (a gate callable from the listener).

### (c) One owner-paid listener per room

The room owner's chosen AI scores once for every AI in the room.

- **Pros:** one call per check, the cheapest "smart" layer; one place to configure; the closest to today's code — only a target resolver is new.
- **Cons:** one owner pays for wakes of AIs they do not own; "the room's AI key" is ill-defined in a mixed-owner room (the old plan's Open Question 1); the room's smartness stops when that AI goes offline; it re-creates the platform-pays problem in miniature.
- **Cost per human message:** **≈ $0.0005** (one call), ≈ **$1–5/month** per busy room.
- **Code:** today's listener path plus a per-room choice of the scoring AI and a target resolver from that AI's connection (`model-target.ts:21-68`); `startup/components.ts` and the room settings route.

### (d) General follows too, for a short window

General is never followed today (`topic-follow.ts:8-9`, `:69-70`). Allow it only for a short window after a person mentioned an AI there.

- **How:** after a person's mention in General, that AI follows General for `10 minutes` **or** the next `20` human messages, whichever comes first, then stops; a fresh mention re-arms it; Stop pauses immediately. This is `followTopic` (`group-ingest.ts:207-237`) with a window instead of the `is_general = false` exclusion (`topic-follow.ts:69-70`).
- **Pros:** deterministic, near-free, turns a mention in the noisy room into a short conversation; no model.
- **Cons:** General is the noisiest room, so a stale follower can still grab unrelated chatter inside the window; needs a small `topics` column and a per-message counter.
- **Cost per human message:** **$0** for the decision; each follow wake is a normal turn on the AI's own key, bounded by the round budget (`contracts.ts:125`, `room-limits.ts:47-51`) and the rate limit (`room-limits.ts:36-39`).
- **Code:** `topic-follow.ts` (`followingAiFor` `:57-77`, `setTopicFollower` `:171-193`), a `topics` migration (expand-only: add a window/since column), `group-ingest.ts`.

---

## 3. Recommendation

Adopt a **layered** design, cheapest and most precise first:

1. **T-1617 first** (already running): typed `@Name` and "Name, …" count as a mention. It is deterministic and fixes the reported case.
2. **Adopt (a) fully, always on.** Free, precise, no key, and its **rule S already fixes the motivating "BTC price in a one-AI room" case**. Keep the patterns exactly as in §2(a) and the short name floor.
3. **Adopt (d)** with a **10-minute / 20-message window** in General, because it is free and deterministic; Stop still pauses it.
4. **Adopt (b) as the optional smart layer**, only reached when (a) and (d) found nothing, and only when **both** the room switch is on and the AI's owner opted in (see Open Question 2). Gate it hard: the existing debounce, a per-room-per-minute cap, and the AI's own budget gate before the call. **Reject (c) for v1** — it makes one owner pay for other owners' wakes and stops working when that AI is offline; note that in a one-AI room (b) and (c) are identical, and rule S already covers that room for free.

**Default per room:** deterministic rules (a) + (d) **on**; the model listener (b) **off** by default. Rationale: (b) spends owners' money on a guess, and When2Speak found models over-interrupt (`PROJECT_PLAN.md:677`).

**Who changes it:** the group owner/admin, the same actor that already edits group settings (the existing `listener_enabled` / `listener_eagerness` columns, `rows.ts:40-41`).

**Where it shows in the UI (describe, don't draw):** the room/group settings panel — one "When should the AI answer?" control with three states:

- **Mentions only** — (a) off, listener off.
- **Smart rules (default)** — (a) + (d) on, listener off.
- **Smart rules + listener** — adds (b), with an **eagerness** select (quiet / normal / eager) that maps to the existing `listener_eagerness` (`score.ts:19-25`, product default `normal`).

Under it, one line of fixed help text (never raw server text): "Smart rules let an AI answer when it is clearly addressed. The listener also reads the room to guess; each AI pays for its own check." When (b) is on, each AI's panel gets its own **"Answer unaddressed messages"** switch (the owner opt-in from Open Question 2). The woken AI's line "<nick> is looking at this" gets a tap that shows the listener's `reason` (`score.ts:212-216`) and lets a person mark it wrong; that needs a small wake payload and a feedback event (ids only).

---

## 4. Safety

The listener reads untrusted room text; keep **Rule of Two** from the old listener plan §2.5 (`docs/audit/listener-delegation-plan.md:98-103`): it can only tag and suggest, never act.

- **No tools, ever.** `scoreRoom` takes an injected `complete` that never advertises tools (`score.ts:200-253`); room text is framed as untrusted data in the fixed system line (`score.ts:93-101`) and the roster/window prompt (`:111-130`).
- **No prompt or response text in logs** — ids and counts only, like today's listener log (`listener.ts:186-197`, `:261-264`) and the compactor. Secrets are redacted before anything is stored (`agents/memory/secrets.ts`, per §2.5); no listener string reaches an audit detail (audit entries carry ids only, `AGENTS.md`).
- **No AI-to-AI wake loops.** Today AI senders never trigger a follow (`group-ingest.ts:213`) and an AI's mention is a bounded handoff (`contracts.ts:129`; `group-ingest.ts:181-191`); only human messages feed the listener (`group-ingest.ts:154-158`). Carry this forward: **a deterministic rule must never fire on an AI message**, and the listener window must only ever hold human messages. A wake is queued as a normal turn (`listener.ts:235-245`) and is **not** a new human message, so it never resets the round (`listener.ts:203-205`).
- **A cap on turns per human message.** `ROUND_MAX_AI_TURNS = 4` and `ROUND_MAX_HOPS = 2` (`contracts.ts:125-129`) are enforced in `checkRoomLimits` (`room-limits.ts:47-51`) and the rate limit is `6` per `10 min` (`contracts.ts:120-121`). Deterministic wakes and listener wakes must count against the **same round**, exactly as a mention does (they queue normal turns). Extend the round so a rule-based wake cannot bypass it.
- **Stop.** `pauseFollow` / `isFollowPaused` (`topic-follow.ts:128-143`, `:226-228`) pause following, and `stopTurn` (`gateway.ts:67`) is the session kill switch. A Stop must also suppress deterministic rules and the listener in that room; `isFollowPaused` is the natural hook, or add a per-room mute that all three honour.
- **Budget gate before every model call** (b): `checkDailyLimit` (`budget.ts:117-192`) and `checkDmRoundGate` (`:255-288`) fail closed for an AI with a limit; a missing or unreadable bound never lets a limited AI run past its cap.

---

## 5. Task split

Ordered, one PR each; new logic goes in **new files** where the current file is near the 400-line cap (`apps/server/src/agents/group-turn.ts` is at 399, `gateway/group-turn.ts` at 338, `gateway/group-ingest.ts` at 323). The message pipeline needs tests (`AGENTS.md` Tests).

1. **T-1617 (running) — typed mentions.** Goal: a typed `@Name` or "Name, …" counts as a mention. Files: the mention parse (`packages/xmpp-core/src/stanza/parse-fields.ts:107-134`) and/or the check (`group-ingest.ts:145-153`). Base for everything below; not part of this plan's estimate.
2. **Deterministic addressing core (pure).** Goal: one pure module that turns (body, AI name, room AI count, last-reply state) into a wake decision (rules V1–V3, S, R). Files: new `apps/server/src/agents/gateway/addressing.ts`. **Tests:** `addressing.test.ts` (patterns, false-positive cases, question detector). Est. **60 min**.
3. **Wire deterministic rules into ingest.** Goal: call the core from the mention check, no new dependencies; carry the AI name and the per-room reply state. Files: `group-ingest.ts:89-199` (thin hook), `contracts.ts:209-239` (`AiSession`), `sessions.ts:126-143` (session literal), `group-ingest.ts` (room AI count / last-AI-reply stamp). **Tests:** the gateway room tests (wake / no-wake per rule). Est. **90 min**.
4. **General follow window.** Goal: let a mentioned AI follow General for 10 min or 20 messages. Files: a new `apps/server/drizzle/` migration (expand-only, `SET lock_timeout = '5s';`), `topic-follow.ts:57-77` and `:171-193`, `group-ingest.ts`. **Tests:** `topic-follow.test.ts` + gateway tests. Est. **90 min**.
5. **Per-AI listener on the AI's own key.** Goal: score each live AI in the room with its own `ModelTarget`, debounced, capped per room per minute, gated by the AI's budget. Files: `gateway/listener.ts`, `agents/listener/score.ts` (reuse), `gateway/model-target.ts` (reuse), `gateway/contracts.ts` (`listener` dep shape), `budget.ts` (a gate callable here). **Tests:** the listener/gateway tests + `listener/score.test.ts`. Est. **120 min**.
6. **Room switch, owner opt-in, and the wake payload.** Goal: honour the per-room flag and the per-AI opt-in, add the "why"/"wrong" wake affordance. Files: `startup/components.ts:205-212` (stop ignoring the flag), `groups/api.ts` + `groups/service.ts` (settings), the web room settings panel and `lib/api.ts` + mock, the wake payload type. **Tests:** `groups/*.test.ts`, the route 401 sweep; UI gets no tests. Est. **120 min**.
7. **Safety nets for rules and wakes.** Goal: make deterministic and listener wakes count in the same round budget and honour Stop, with a per-room mute. Files: `room-limits.ts`, `gateway/contracts.ts`, `topic-follow.ts`, `gateway/group-turn.ts`. **Tests:** gateway tests (cap holds, Stop suppresses every path). Est. **60 min**.

Dependencies: 1 → 2 → 3; 2 → 7; 3 → 4; 5 → 6; 5 and 7 are independent of 4.

---

## 6. Open questions for Julio

1. **Does the model listener (b) default on or off per room?** **Recommended: off.** Deterministic rules (a) + (d) already fix the motivating cases for free; (b) spends owners' money on a guess and should be a deliberate per-room choice.
2. **Who may turn on (b) for an AI — should each owner opt in?** **Recommended: yes**, a per-AI "Answer unaddressed messages" switch, so no owner pays for a wake they did not choose. If owners find it too many switches, fall back to the group owner's single room switch with (b) on the AIs' keys.
3. **General follow window: time or message count?** **Recommended: both** — 10 minutes **or** 20 human messages, whichever comes first, re-armed by each new mention.
4. **What counts as a "question" for rules S and R?** **Recommended:** the first line only, ending in `?` or starting with a short question word, and for rule R only within 2 minutes of this AI's reply with no other AI reply since.
