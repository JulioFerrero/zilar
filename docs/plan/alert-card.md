# The alert card and its routine (plan)

T-1832, 2026-10-17. **Plan only: no source file changed.** Every claim cites
`file:line`. The card promises a recurring check; routines already do recurring
work. The open part is how the card and a routine stay one thing. Related:
`docs/plan/message-blocks.md` (the cards plan), `docs/plan/scheduled-ai-jobs.md`
(prompt routines) and `docs/plan/routine-live-message.md` (one live message per
routine).

## 1. What the card promises

- The board draws a header sentence, a price well, an on/off switch and the line
  `Checked every 5 min · now $82,302`
  (`docs/design/mockups/blocks/WebChoices.dc.html:150-166`,
  `docs/design/mockups/blocks/PhoneChoices.dc.html:146-163`).
- The protocol carries the title, one `field {label, value}`, `on` and an
  optional `note` — nothing else
  (`packages/protocol/src/blocks-choices.ts:147-160`).
- The cards plan says to treat it as a one-field form
  (`docs/plan/message-blocks.md:316`). That covers the tap, not the recurring
  check: the card has no data source, no schedule and no place for "now".

So the value and the frequency must live in a routine row; the card has to be a
control surface for that row.

## 2. Routines today

### 2.1 How one is created and approved

- Creation goes through the `routine.schedule` action, tier 2
  (`apps/server/src/tools/routine-adapters.ts:88-95`). Tier 2 means an approval
  card, always: the adapter sets no `allowAlways`, so a standing rule cannot
  auto-run it (`apps/server/src/actions/decisions.ts:62-80`), and an unattended
  (scheduled) turn that asks is refused with `needs_approval` instead of parking
  a card nobody sees (`decisions.ts:82-90`).
- Two forms. **Tool form:** names a saved tool; the adapter binds the tool's
  current hosts into the args before the card is described
  (`routine-adapters.ts:101-116`), the card lists them (`:132-135`), and
  `execute` fails safe if the hosts changed after approval (`:187-194`).
  **Prompt form:** no tool, no hosts; creates a `kind = 'prompt'` routine whose
  prompt the AI runs itself (`routine-adapters.ts:153-182`,
  `apps/server/src/routines/prompt-routines.ts:25-92`).
- Only that action creates routines. The REST API lists, pauses, resumes and
  deletes (`packages/api-contract/src/routines.ts:49-76`) and has no create or
  edit endpoint. There is no `updateRoutine`: the only mutations are
  `createRoutine`, `pauseRoutine`, `resumeRoutine`, `deleteRoutine`
  (`apps/server/src/routines/support.ts:35,160,213,280`).
- Pause, resume and delete require the routine's manager: the AI's owner, or a
  group owner/admin who can see the topic
  (`apps/server/src/routines/access.ts:14-17,49-74`; enforcement
  `apps/server/src/routines/api.ts:151-190`).
- Caps: 10 routines per AI per topic (`routines/schemas.ts:8`,
  `routines/queries.ts:79-99`), title 80, prompt 2000, input 2 KB
  (`schemas.ts:8-11`). The per-topic cap is a read-then-insert, not atomic
  (`queries.ts:89-99`).

### 2.2 Schedule granularity and the scheduler

- Interval routines accept **1 to 10 080 minutes**
  (`routines/schedule.ts:16-17,34-48`), so every 5 minutes is allowed today.
  Daily routines take `HH:MM`, an IANA zone and weekdays (`schedule.ts:50-68`).
- The scheduler ticks every 30 s, claims at most 5 due rows per tick and runs at
  most 2 at once (`routines/scheduler.ts:15-18,39-44,56-61`). A run more than
  1 h late is recorded `skipped` with no post (`scheduler.ts:20-23,288-315`).
- A claim advances `next_run_at` before the run, so a slot is skipped, never
  duplicated (`scheduler.ts:225-235,290-305`).

### 2.3 Daily caps and what a run costs

- **Prompt form:** 1440 runs per AI per UTC day, claimed atomically in one
  statement (`routines/execute-prompt.ts:36-62`); the slot is refunded when the
  AI was offline or not in the room (`:64-78,124-133`). Each run is one AI turn,
  so **model calls**; the per-day spend limit is checked before the model call
  (`apps/server/src/agents/gateway/budget.ts:108-121`).
- **Tool form:** no per-day cap. Cost per run is one sandbox execution of the
  tool version — **no model call** (`apps/server/src/tools/runner.ts:30-75`).
  Hosts are the declared set ∩ the approved set (`runner.ts:25-29,70-75`), and
  the routine's `approved_hosts` must cover the current version or the run
  pauses (`routines/execute.ts:167-177`).
- The 3rd failure in a row pauses and posts one fixed notice
  (`routines/outcomes.ts:125-170`).

### 2.4 Can a run post nothing?

**No.** A successful tool run always posts `"<title>\n<output>"`
(`routines/outcomes.ts:27-51`), even for empty output; a prompt run posts the
turn's answer. `skipped` (nothing posted) is only for "the AI, the room or the
post failed" paths (`routines/execute.ts:120-137,214-227`,
`execute-prompt.ts:116-135`). The plan already lists "run silently and post only
when something changed" as an open question, recommending "always post"
(`docs/plan/scheduled-ai-jobs.md:714-717`). **"Post only when the condition
holds" is new behaviour, not a switch we can flip.**

### 2.5 When the AI, the room or the tool goes away

- AI not `active`, or no longer in the topic room (archived topic included) →
  `skipped`, the routine stays active, nothing posted (`execute.ts:120-137`,
  `routines/preflight.ts:22-54`).
- Tool deleted → immediate pause with the fixed notice
  (`execute.ts:147-165`, `outcomes.ts:139-170`). Hosts changed →
  `needs_approval` plus one fixed notice (`execute.ts:167-177`,
  `outcomes.ts:172-192`); only a fresh `routine.schedule` approval clears it
  (`routines/support.ts:231-236`).
- AI removed from a topic or group → its routines there are soft-deleted
  (`routines/deletes.ts:9-44`, called from `topics/ais.ts:10`); deleting the tool
  soft-deletes its routines (`deletes.ts:46-63`). Group delete cascades through
  the routine FKs (`apps/server/drizzle/0023_classy_lester.sql`).

### 2.6 One live message per routine

A routine posts **one** message and every later run edits it (XEP-0308) while it
is under 24 h old, then posts a new one
(`apps/server/src/agents/gateway/routine-send.ts:1-8,20-22,139-159`). Each
send/edit carries the `routine` payload — id, title, schedule in words
(`packages/protocol/src/routine.ts:4-13`). That is already the "Checked every
5 min" half of the board's line.

## 3. The card answer path today

- `POST /api/blocks/respond` records the answer, merges the card and corrects it
  in the room as the AI (`apps/server/src/message-blocks/respond.ts:279-320`);
  it never wakes the AI (`message-blocks/api.ts:1-8`), and the decision kinds
  send a normal `@AI` reply from the client
  (`apps/web/src/components/message/blocks/BlockRespond.tsx:5-14`).
- Access: a topic member (any group member for General), or the AI's owner for a
  DM card; everything else is the same 404 as a missing card
  (`respond.ts:63-98`). Rate limit: 120 answers per user per minute
  (`message-blocks/api.ts:26-27`).
- **An alert answer is a 400 today:** `recordedResponse` has no `alert` case
  (`respond.ts:106-177`), and the answer value schema has no switch or threshold
  field (`packages/api-contract/src/message-blocks.ts:29-36`).
- `applyResponses` has no `applyAlert`, so the block is returned unchanged
  (`apps/server/src/message-blocks/apply.ts:167-184`).
- A card row only exists if `post_blocks` recorded it
  (`apps/server/src/agents/gateway/tool-exec.ts:78-80`,
  `message-blocks/cards.ts:24-59`). Routine posts build a blocks payload but do
  **not** record a card (`routines/outcomes.ts:53-85`), so an alert card posted
  by a routine's output would 404 on answer.
- Neither renderer draws `alert`: web falls through to `null`
  (`apps/web/src/components/message/blocks/BlockCard.tsx:26-64`), phone too
  (`apps/mobile/src/components/chat/blocks/block-card.tsx:77-115`), and the
  AI-facing interactive list excludes it
  (`apps/server/src/message-blocks/guide.ts:32-41`).

## 4. The options

### (A) The answer is a decision reply; the AI owns the routine

The switch and the field answer as a decision (record the row + send the `@AI`
reply, `FormBlock.tsx:99`, `BlockRespond.tsx:5-14`). The AI wakes, calls
`routine.schedule` with the threshold in its tool input or prompt, and the person
approves the routine card.

### (B) The server owns the link: the card drives one routine row

The answer updates a routine the server already owns: `on` pauses/resumes it,
`field.value` rewrites its threshold, and each run writes the current value into
the card's `note` and corrects the card message.

### (C) The alert card is the routine's live message

Skip the second message: the routine's own edited message carries the alert
block, so "every 5 min", the value and the switch are one row and one message
(`routine-send.ts:139-159`).

| | (A) decision reply | (B) server link | (C) one message |
|---|---|---|---|
| Approvals | two cards: the alert, then `routine.schedule` | one, the routine card; the alert answer only edits an approved routine | one, but the card exists only after the first run, so the threshold cannot be set before switching on |
| Cost per check | the routine's cost; plus one model turn per toggle/edit | the routine's cost; nothing per toggle | same as B |
| "Now $82,302" | only if the AI also edits the card, which nothing does today; the routine's own message gets the value instead | the run writes `note` and calls `saveCardData` + `correctInRoom` (`cards.ts:194-210`, `respond.ts:217-247`, `agents/gateway/live.ts:337-379`) | free: it is the run's output |
| AI or room gone | routine skips or pauses (§2.5); toggling later wakes an AI that may not be there | the routine skips; the note stops advancing; the switch still works because pause/resume is a DB write (`support.ts:160,213`); deleting the AI cascades the card (`drizzle/0071_block-cards.sql`) | same as B |
| Security | the model picks tool and prompt from a prose reply, so the answer is untrusted input to an action request; hosts are re-checked at approval and at run time (`runner.ts:25-29`, `execute.ts:167-177`); a scheduled run may use tier 0/1 actions and the desk (`agents/gateway/group-turn-access.ts:41-60`); any room member can spend model calls (`respond.ts:63-98`) | the answer is a write that spends runner capacity, so manager-only (`access.ts:14-17`) instead of any member (`respond.ts:63-98`); the threshold is validated at the boundary; a unique link stops a double tap creating two routines; the tool form keeps host pinning; no model reads the threshold | same as B, but routine output would have to record a card row (`outcomes.ts:53-85` does not) and the block has to be rebuilt server-side every run, or a model could rewrite the switch |

## 5. Recommendation: (B), tool form first

Deterministic (no model call per check or per toggle), the card and the routine
are joined by a row instead of by the model's memory, "now" is written by the
run that measured it, and every existing mechanism is reused — the tier-2
routine approval, host pinning, pause/resume and the one-message edit.

1. The AI schedules the check first with `routine.schedule` (tool form, e.g. a
   `market-prices` tool), so the hosts are on a card and approved. The routine's
   `input` carries the threshold (`{"threshold": 90000}`; input is free JSON,
   `support.ts:52-58`).
2. In the same turn the AI posts the alert card with `post_blocks`, naming the
   routine it just scheduled (a new optional `routine` arg). The server stores
   `alert_card_id` / `alert_block_id` on the routine (expand migration) with a
   partial unique index, so one routine owns one card and one card one routine.
3. A person edits the well and/or flips the switch. `POST /blocks/respond`
   records the answer and, for an `alert`, updates the linked routine in the
   same transaction: `field.value` → `input.threshold`; `on` → pause/resume
   (`support.ts:160,213`). Manager-only, audited with ids only.
4. Each run reads the tool's structured value (`output.data.value`, already part
   of the runner result: `apps/server/src/tools/types.ts:13`), compares it with
   the threshold, writes `note` = `Checked every ${schedule} · now ${value}`,
   corrects the card, and **posts the routine message only when the condition
   flips** (a new `alert` mode in `execute`/`outcomes`). Below the threshold the
   run is `ok` with no message.
5. A prompt-form alert is a follow-up: it costs a model call per check and the
   value would have to come from the model, so it needs its own output contract.

Edges this plan does not hide: a run whose AI session is offline cannot correct
the card, so the note waits for the next live run; and an alert whose tool stops
returning `data.value` must record `error` (then the 3-failure pause,
`outcomes.ts:139-170`) rather than compare against nothing.

## 6. Ordered tasks

| # | Area | Files | Acceptance |
|---|---|---|---|
| 1 | server: accept the answer | `apps/server/src/message-blocks/respond.ts`, `apply.ts` | An `alert` answer (`done` for the switch, `fields.value` for the threshold) records and merges into `on` / `field.value`; a threshold that is not a number answers 400. |
| 2 | server: the link and the edit | `apps/server/drizzle/0072_alert_card.sql` (new, `SET lock_timeout = '5s';`), `apps/server/src/db/rows-agents.ts`, `apps/server/src/routines/support.ts`, `routines/queries.ts` | In one transaction, an answer sets the linked routine's threshold and status; a second routine cannot claim the same card block (partial unique index); a second tap updates the same row. |
| 3 | server: the quiet run | `apps/server/src/routines/execute.ts`, `outcomes.ts`, `schemas.ts` | An alert run takes `output.data.value`, writes the card note and corrects the card, posts nothing below the threshold, and posts once (then edits) at or above it; a run with no numeric value records `error`. |
| 4 | server: who may act | `apps/server/src/message-blocks/respond.ts`, `message-blocks/api.ts`, `routines/api.ts` | Only the routine's manager may answer an alert (a stranger gets the same 404); the answer audits `routine.paused`/`routine.resumed` with ids only; a routine paused for `failures` is not silently resumed. |
| 5 | web: draw it | `apps/web/src/components/message/blocks/AlertBlock.tsx` (new), `ChoiceBlocks.tsx`, `BlockCard.tsx` | The card matches `WebChoices.dc.html:150-166` at 1440 and 390; the switch is disabled without a responder; the field caps at 120 characters (`respond.ts:24`). |
| 6 | phone: draw it | `apps/mobile/src/components/chat/blocks/alert-block.tsx` (new), `block-card.tsx`, `block-icons.ts` | The card matches `PhoneChoices.dc.html:146-163`; lucide icons, no emoji (`AGENTS.md:69`); if the switch swaps its look, the element gets a `key` that changes with it (`AGENTS.md:65`). |
| 7 | guide: teach it | `apps/server/src/message-blocks/guide.ts`, `docs/USER_GUIDE.md` (§ Tools and routines) | `alert` is in `INTERACTIVE_KINDS`; the guide says when to use an alert and that it needs a saved tool; the user guide describes the switch and the "checked every N min" line. |

## 7. Open questions for Julio

1. **Default interval.** The board says 5 minutes; a tool alert at 5 minutes is
   288 sandbox runs per AI per day. Recommend 5 minutes as the default and a
   minimum of 5 for alerts (the scheduler already allows 1).
2. **Caps.** Recommend **3 alert routines per topic** (inside the existing 10)
   and a per-AI per-day alert-run cap of 288. Today only the prompt form has a
   daily cap (`execute-prompt.ts:36-38`); tool routines have none.
3. **Who may toggle.** Today any member of the room may answer a card
   (`respond.ts:63-98`). Recommend the routine's manager only — the AI owner or
   a group owner/admin (`access.ts:14-17`) — because the switch spends runner
   capacity and can wake the desk.
4. **Tool form only in v1?** Recommend yes: 0 model calls per check and the hosts
   sit on an approved card. A prompt-form alert needs a model-output contract for
   the value and costs a model call every check.
5. **What counts as crossed?** Above the threshold only, or a two-sided band
   ("above $90,000 or below $70,000")? The protocol has one `field`, so a band
   needs a second value or two cards. Recommend above-only for v1.
6. **Failure noise.** Today the 3-failure pause posts a fixed notice
   (`outcomes.ts:139-170`). Keep it for alerts, or stay silent because the card
   already shows the last successful check? Recommend keep.
