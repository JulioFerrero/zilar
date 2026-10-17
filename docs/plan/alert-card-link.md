# Alert card ↔ routine link

**Task:** T-1864 (docs only). **Decision:** option **(a)**, with one change: the AI posts the
alert card **first**, then passes its id to `routine.schedule`.

The gap is real. `routine.schedule` creates nothing when the AI calls it: the routine row
appears only when a person accepts the approval, and the AI never learns the routine's id.
The alert card's own id never reaches the AI either. So "post the card naming the routine"
(`docs/plan/alert-card.md:181-188`) cannot work as written. The fix is to name the **card**
on the schedule instead of the routine on the card, and to write both link columns in the
same `INSERT` that creates the routine.

## 1. When is the routine row created?

**Only at approval.** There is no pending routine row.

1. The AI asks for `routine.schedule`, a tier-2 adapter (`tools/routine-adapters.ts:88-96`).
   The tier-2 path stores the parsed args, their hash and an approval row in one
   transaction (`actions/approval-path.ts:60,88-148`) and returns `pending_approval`
   (`actions/approval-path.ts:199`). The adapter's `execute` has not run.
2. `createRoutine` inserts the row with `status = 'active'` directly
   (`routines/support.ts:112-136`, status at `:129`). The only caller on the AI path is the
   adapter's `execute` (`tools/routine-adapters.ts:206-221`).
3. `execute` runs after the human decision: the pending row is claimed
   (`actions/queries.ts:269-281`) and the stored args are passed to
   `adapter.execute` (`actions/queries.ts:302-313`). A denied or expired approval cancels
   the pending row and creates nothing (`actions/queries.ts:233-236`).
4. The `routines.status` values are `active | paused | needs_approval`
   (`db/rows-agents.ts:166`); `needs_approval` is a later hosts-change pause, not a
   pre-approval state. Nothing else inserts a routine.

Consequence: in the turn where the card is posted, the routine does not exist, so the model
has nothing to name. Any design that links "from the card to the routine" must either
defer the link or carry the card's identity to a later step.

## 2. What does the model get back from `routine.schedule`?

**Before approval:** one fixed sentence with no ids, no summary and no routine id —
`"waiting for an admin's approval; a card was posted in this room"` (or the DM wording),
`agents/gateway/request-action.ts:78-91`. The approval id rides in the tool result for the
session log (`agents/tool-exec.ts:190-199`) but is not in `content`.

**After approval:** nothing. `routine.*` approvals queue no follow-up turn
(`agents/gateway/approval-follow-up.ts:47-52`, covered by
`agents/gateway/approval-follow-up.test.ts:108-122`), and the success summary is not
announced either — only failures post an outcome message (`actions/queries.ts:331-343`).
The "Scheduled …" text built in `tools/routine-adapters.ts:172-175,222-225` is stored as the
pending row's `result_summary` and shown on the approval card, but never sent to the model.

**Later:** on the next human turn the model can call `tool.list`, which prints the first
8 characters of each routine id (`tools/routine-list-lines.ts:12-22`) and "waiting for
approval" for pending schedules (`:24-29,35-54`). That is the first moment it sees the id.

**The card id:** `post_blocks` knows it — `sent.id` (`agents/gateway/post-blocks.ts:57-58`)
is the `block_cards.origin_id` recorded at `:134` (`message-blocks/cards.ts:8-11,24-34`) —
but the model only receives the fixed sentence `"Your card was posted in this room…"`
(`agents/gateway/post-blocks.ts:136-140`). The block id inside the card is chosen by the
model (protocol `AlertBlockSchema`, `packages/protocol/src/blocks-choices.ts:147-158`).

## 3. What does the approval card carry, and where can a card id travel?

- The `approvals` row carries action, summary, details, args hash, AI/group/topic and
  requester (`approvals/service.ts:103-144`); the card is drawn from it and shows summary
  and details (`actions/announce.ts:62,69-80`, posted at
  `actions/production-announcer.ts:110-126`).
- The exact parsed args live in `pending_actions.args` (`actions/approval-path.ts:129-143`)
  and are what `execute` receives (`actions/queries.ts:312`). Stored args are capped at
  20 KB and hashed (`actions/approval-path.ts:17-20,60`).

So a card reference can travel **inside the `routine.schedule` args**: no new column on
`approvals` or `pending_actions`, the hash already binds it, and `describe` can tell the
approver which card is being linked (`tools/routine-adapters.ts:117-136`).

## 4. The options

### (a) Recommended — `routine.schedule` takes an optional `alert_card`

`{"card":"<origin id>","block":"<alert block id>"}`, validated when the request is made and
written into the existing link columns in the same `INSERT` that creates the routine.
`post_blocks` must return the card id so the model can reuse it; the order becomes
**post the card, then schedule it** (inside one turn).

Files: `apps/server/src/agents/gateway/post-blocks.ts`,
`apps/server/src/tools/tool-arg-schemas.ts`, `apps/server/src/tools/routine-adapters.ts`,
`apps/server/src/routines/schemas.ts`, `apps/server/src/routines/support.ts`,
`apps/server/src/message-blocks/guide.ts`.

Why: ids are exact, one human approval covers both the routine and the link, one atomic
`INSERT` enforces one-card-one-routine (index already in `drizzle/0074_alert-card-link.sql`),
and no new table or column is needed. The card exists before the approval, which is also
the order people see today ("the alert, then the routine card", `alert-card.md:168`).

Costs: the order in `alert-card.md:181-188` is reversed; the card is live and answerable
(unlinked, so answers change nothing) for up to the 30-minute approval TTL
(`actions/approval-path.ts:12-15`); an answer given in that window is recorded but not
applied when the routine is created (see §5). Do not backfill it in v1: before the link,
any topic member may answer the card (`message-blocks/respond.ts:327-354`), so a backfill
would let a non-manager set the routine's first threshold.

### (b) `post_blocks` takes `routine` (8-char prefix or title)

Cannot work in the same turn: the routine row is created only at approval (§1) and no
follow-up turn follows a `routine.schedule` approval (§2). The model could post the card on
a later human turn, but that is unreliable. Keep this as a manual "repair the link" path
for a later task, not for v1. Files: `agents/gateway/post-blocks.ts`,
`message-blocks/cards.ts`, `routines/alert-link.ts`.

### (c) Post the card at approval from a spec carried in `routine.schedule`

No ids to exchange and no inert card, but the approvals path has no card poster (the
announcer only posts approval cards, `actions/production-announcer.ts:110-126`), so
`execute` would need a second message, a `block_cards` write and the same validation that
`post_blocks` already does. More code, and the AI cannot show the card before approval.
Not simpler.

**Recommendation: (a).**

## 5. Security and abuse

- **Who may link:** only the AI can request it (tier 2, `tools/routine-adapters.ts:93`); a
  person must approve. Approvers are the AI owner, a group owner/admin, or a topic
  approver-role holder (`approvals/access.ts:17-70`). The link sits in the hashed args
  (`actions/approval-path.ts:60`), so the card shown and the action executed cannot
  disagree.
- **Scope:** validate at request time that the card row belongs to the same AI and the same
  group/topic as the action context, and that the block id exists in the card's data. A
  card of another AI or topic fails the request
  (`actions/approval-path.ts:45-53`). Cards record their owner AI, group and topic at post
  time (`message-blocks/cards.ts:24-49`).
- **One card ↔ one routine:** the partial unique index on
  `(alert_card_id, alert_block_id)` where the card is set and the routine is not deleted
  (`apps/server/drizzle/0074_alert-card-link.sql:3`) allows one live routine per card
  **block**, and a routine row holds one pair. A deleted routine frees the block. A card
  with two alert blocks could link two routines, so the guide teaches one alert block per
  card, and the index is the atomic guard (an `INSERT` that violates it creates no row).
- **Declined or expired:** nothing is created (`actions/queries.ts:233-236`); the card stays
  inert — `requireAlertManager` returns early when unlinked (`message-blocks/alert-routine.ts:41-44`)
  and `applyAlertToRoutine` does nothing (`:67-70`). The answer is still recorded on the
  card (`message-blocks/respond.ts:344-354`), so the card draws it, but the routine is not
  touched.
- **Card message deleted:** nothing in the app deletes `block_cards` rows; only deleting
  the AI cascades them (`drizzle/0071_block-cards.sql:5`). The link survives, the routine
  keeps running, and a correction to a vanished message is best-effort (the run's note
  task, §6). Nothing crashes and no permission changes. A later task may clear the link
  when a card row is deleted; no such path exists today.
- **Answers:** once linked, only the routine's manager may answer (AI owner, or group
  owner/admin who can see the topic); anyone else gets the same 404 as a missing card
  (`message-blocks/alert-routine.ts:35-49`; `routines/access.ts:14-17,49-60`).
- **No re-link tool:** `createRoutine` always inserts a new row
  (`routines/support.ts:112-136`); no adapter updates the link. The same block cannot be
  claimed twice (index above). Caps are unchanged: 10 routines per AI/topic
  (`routines/support.ts:110`), 50 pending approvals per AI (`approvals/service.ts:92-101`),
  30-minute TTL. No new route, so the 401 sweep and rate limits are unchanged. Audits keep
  ids only (`routines/support.ts:140-153`).

## 6. Ordered tasks (each ≤ 45 worker minutes)

| # | Area | Files | Acceptance |
|---|---|---|---|
| 1 | `post_blocks` tells the AI the card id | `apps/server/src/agents/gateway/post-blocks.ts`, `apps/server/src/agents/tools/blocks-tool.ts` | The tool result names the posted card's id next to the existing "posted" sentence; no other result wording changes; a DM card behaves the same. |
| 2 | `routine.schedule` accepts `alert_card` | `apps/server/src/tools/tool-arg-schemas.ts`, `apps/server/src/tools/routine-adapters.ts` | The tool form decodes `{card,block}` (strict union unchanged otherwise); `prepareArgs` rejects a missing card, another AI's card, a different topic/group or a block that is not in the card; `describe` says the schedule links the alert card, without printing the raw ids. |
| 3 | The link is written when the routine is created | `apps/server/src/routines/schemas.ts`, `apps/server/src/routines/support.ts` | `CreateRoutineInput` carries the pair; the existing `INSERT` writes `alert_card_id`/`alert_block_id`; a second routine on the same block creates no row and answers a short summary; a declined approval still creates nothing. |
| 4 | Teach the order | `apps/server/src/message-blocks/guide.ts`, `docs/USER_GUIDE.md` | The guide says: post the alert card, then schedule with its id; one alert block per card; answers before approval do not reach the routine. |
| 5 | The quiet run: post only at the crossing | `apps/server/src/routines/execute.ts`, `apps/server/src/routines/outcomes.ts`, `apps/server/src/routines/schemas.ts` | An alert run reads `output.data.value` (`tools/types.ts:13`); below the threshold it is `ok` and posts nothing; at or above it posts once, then edits; a non-numeric value records `error` (and feeds the 3-failure pause, `routines/outcomes.ts:128-170`). |
| 6 | The quiet run: the card's note | `apps/server/src/routines/execute.ts`, `apps/server/src/routines/outcomes.ts`, `apps/server/src/message-blocks/cards.ts` | The same run writes `note` = `Checked every <schedule> · now <value>`, saves the card and corrects the message in the room (`saveCardData` + `correctCard`/`correctInRoom`, as used by `message-blocks/respond.ts:356-360`); a missing card or a failed correction leaves the run `ok`. |

Task 6 is the plan's task 3 (`docs/plan/alert-card.md:213`), narrowed to the note; the
existing tasks 1, 2, 4, 5, 6, 7 of that plan (answer, link columns, manager-only, web,
phone, guide) are already built or unaffected.

## 7. Edges this plan accepts

- A person can answer the alert card during the approval window; the answer is drawn on
  the card but not applied (see §5). The guide says to set the threshold after approval.
- The card shows the model's initial `field.value`/`on` while the routine's own
  `input.threshold` comes from the schedule args (`routines/support.ts:52-60`); the first
  manager answer aligns them.
- A model that forgets the card id before calling `routine.schedule` still gets a routine,
  just without a link; the answer card remains inert and the guide tells it to post and
  schedule in that order.
