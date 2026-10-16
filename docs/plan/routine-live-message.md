# A routine's single live message (plan)

T-1711, 2026-10-16. **Plan only: no source file changed.** Every claim cites
`file:line`. Julio's call: a routine posts **one** message and every later run
**edits** it ("edited 10:45") instead of a new one. This maps the code and lists
the build tasks. Related: `docs/plan/scheduled-ai-jobs.md` (the prompt-routine plan).

## 1. The map

### (a) Where a scheduled run's reply is sent, and the message id it gets

- The scheduler never sends. It queues a synthetic trigger on the AI's own
  queue — DM `routine-run.ts:101-106`, room `routine-run.ts:117-127` — and the
  normal turn answers.
- **DM:** `runDmTurn` → `runToolTurn` → `sendReply` →
  `deps.sendMessage(deps.ownerJid, 'chat', text)` (`turn-send.ts:19`). The
  result is **discarded**; the deps type is `Promise<unknown>` (`dm-turn.ts:69`).
- **Room:** `runGroupTurn` → `sendGroupReply` →
  `deps.sendMessage(deps.roomJid, 'groupchat', text, opts)` (`turn-send.ts:44`),
  also discarded (`group-turn-deps.ts:29-34`).
- The send returns the **origin id** (the sender-generated `id`):
  `sendMessageEffect` (`operations.ts:146-167`) returns `{ id }` from
  `sendStanzaEffect` (`operations.ts:136-144`); `buildMessage` writes it as the
  stanza id and the `origin-id` element (`build-outgoing.ts:145,147`).
- The id exists at every send and is dropped one frame up. Nothing persists it
  (no `last_message_id` anywhere in the tree).

### (b) How a correction is built and sent, and whether the reply can use it

- Progress today: `liveProgressReporter` (`live.ts:80-198`). First stage is a
  normal send (`live.ts:128-131`); each later stage is a correction to that id
  (`live.ts:133-135`); the final card is a correction too (`live.ts:178-179`).
- `session.core.sendCorrection(...)` → `xmpp-core/client.ts:29-30` →
  `sendCorrectionEffect` (`operations.ts:178-196`) → `buildCorrection`
  (`build-outgoing.ts:150-166`): `<body>` plus
  `<replace xmlns="urn:xmpp:message-correct:0" id="originalId"/>` (`:161-162`).
  It returns `{ id }` and takes only text/payload/mentions (`types.ts:209-216`)
  — no `replyTo`.
- The reply can use the same path: `sendReply`/`sendGroupReply` differ only in
  calling `sendCorrection(to, kind, targetId, text, opts)` instead of
  `sendMessage`. The stored id must be the **origin id** (the value
  `sendMessage` already returns), which is exactly what a correction names
  (`operations.ts:145,162`; client `ledger-ids.ts:235-240`).

### (c) Does the scheduled turn know its `routineId` at send time

- The trigger carries it: `scheduled: { routineId, onOutcome, onStart }` —
  `pending.ts:23-29` (DM), `pending.ts:50-56` (room) — pushed at
  `routine-run.ts:105` and `:125`.
- **DM:** `trigger.scheduled?.routineId` is in scope in the DM body
  (`dm-turn.ts:172`), but only the boolean `trigger.scheduled !== undefined` is
  forwarded (`dm-turn.ts:329`; `DmTurnInput.scheduled` `dm-turn-input.ts:36`).
- **Room:** `trigger.scheduled` is in scope in the group body (destructured
  `group-turn-body.ts:93`, used `:249`), and `groupTurnAccess` only reduces it to
  `scheduledTrigger: boolean` (`group-turn-access.ts:44`).
- So the id is known in both bodies and simply is not plumbed to the send path.

### (d) Where a routine's last message id could be stored

- A routine is one row (`routines`, `0023_classy_lester.sql:1-22`), loaded whole
  on every run (`scheduler.ts:250-254`; `RoutineRow` `rows-agents.ts:152-176`).
- **Recommended: two nullable columns on `routines`** — `last_message_id text`
  and `last_message_at timestamptz`. One message per routine, so a separate
  table adds a second key and an upsert for no gain. The SQL client camelCases
  result names (`effect/sql.ts:39-41,82`), so `RoutineRow` gains
  `lastMessageId: string | null` and `lastMessageAt: Date | null`, and
  `SELECT *` / `RETURNING *` map them with no query change.
- **A separate table** (`routine_messages` keyed by routine) is worth it only if
  a routine later needs per-room messages or a post history; not today.
- Precedent for stamping a posted id on a row and reading it back:
  `ai_questions.message_id` (`questions/service.ts:132-148`, `:199-213`).
  Unlike T-1579 (`rekeyQuestionMessage` `:156-175`) we never rekey — a
  correction names the **origin id**, which is what `sendMessage` returns.
- SQL/rows that change: the new expand migration
  (`apps/server/drizzle/0068_routine_last_message.sql`, first line
  `SET lock_timeout = '5s';`), `RoutineRow`, and two statements —
  `UPDATE routines SET last_message_id = $1, last_message_at = now(),
  updated_at = now() WHERE id = $2` and `... SET last_message_id = NULL ...`.
  Inserts and existing reads need no change.

### (e) How web and phone render a correction; in place or moved

- Both apps share one ledger. A correction is never a chat bubble
  (`ledger-signatures.ts:42-45`); it only updates edit state
  (`ledger-edits.ts:112-128`, `applyTextEdits` `:181-260`). **It changes the
  target in place; it does not move it.** The list order stays the original
  message's `createdAt`.
- The marker: web renders `{edited && <span>edited</span>}` before the
  **original** send time (`web MessageMeta.tsx:31-32`); phone renders `'edited '`
  before the original time (`mobile plain-bubble-body.tsx:85`,
  `message-bubble-decor.tsx:157-158`). Neither shows the correction's own time.
- Activity: a text correction never bumps unread or the chat-list preview
  (`ledger-edits.ts:112-114`); only a **room** card correction counts as AI
  activity (`activity-refresh.ts:23-44`).
- The AI's own context folds corrections/retractions before it reads history
  (`context-edits.ts:66-90`), so an edited routine message reads as the newest
  text.

### (f) Deleted or too-old target: fall back to a new message

- **Deleted:** a retraction wins over every later correction, for good
  (`chat-core edits.ts:97`, `:168-172`). A correction to a retracted target is
  silently dropped and the run's output never appears, so the server must detect
  it and post a new message. Today nothing retracts an AI's routine message: the
  app lets a person delete only **their own** message (`edits.ts:29-32`) and the
  reply/card is never retracted (`live.ts:75`). Quirk: a group retraction names
  the **stanza-id**, not the origin id (`ledger-ids.ts:242-251`), while a
  correction names the origin id.
- **Too old / pruned:** a client keeps only its newest `KEEP_INACTIVE = 300`
  messages per inactive chat (`prune.ts:10,20-36`); the AI reads only the last
  `DM_HISTORY_MESSAGE_LIMIT = 50` (`context.ts:13,223,269`). If the stored target
  fell out of those windows, a correction becomes a pending edit that renders
  nowhere (`chat-core edits.ts:99,208-222`). The 48 h edit window
  (`chat-core edits.ts:11,17-27`) is UI-only — it gates a person editing their own
  bubble, not an incoming correction — so it does not limit the AI's
  server-side `sendCorrection`.
- **Cheap guard (recommended):** keep `last_message_at`; at run time use the
  stored id only while it is younger than a fixed age (e.g. 24 h), else send a
  new message and overwrite. Clear the stored id when a retraction naming it
  arrives (the gateway drops retractions at `gateway.ts:256-262` today).
  A stricter option is to verify the target against the read-only archive at run
  time, the way `search/routes.ts:137-163` resolves edits/retractions; it needs
  the archive pool in the send path, so treat it as a follow-up.

## 2. Build plan

Each task is one worker; 400-line caps respected. Dependencies:
1 → 2 → 5; 3 → 4 → 5; 2 → 7; 8 independent.

1. **[server, DB]** New `apps/server/drizzle/0068_routine_last_message.sql`
   (`SET lock_timeout = '5s';` then add the two nullable columns) and
   `apps/server/src/db/rows-agents.ts:152-176` (`lastMessageId`,
   `lastMessageAt`). Expand-only; old code ignores the columns. (~20 min)
2. **[server]** New `apps/server/src/routines/message-store.ts` (keep it out of
   the near-cap `routines/service.ts`): `loadRoutineMessage(db, routineId)`,
   `recordRoutineMessage(db, routineId, messageId, at)`,
   `clearRoutineMessage(db, routineId)` and
   `clearRoutineMessageByTarget(db, messageId)`. Every `WHERE` is scoped by the
   `routines` PK `id` (or `last_message_id`). (~30 min)
3. **[server]** Carry the routine id to the send path. `dm-turn.ts:329` passes
   `scheduledRoutineId: trigger.scheduled?.routineId`; add it to `DmTurnInput`
   (`dm-turn-input.ts:21-37`); read `trigger.scheduled?.routineId` in
   `group-turn-body.ts` (in scope, `:93`). Add optional
   `replaceTargetId?: string`, `sendCorrection?` and
   `onFinalMessageId?: (id: string) => void` to `DmTurnDeps` (`dm-turn.ts:49-119`)
   and `GroupTurnDeps` (`group-turn-deps.ts:10-89`). (~45 min)
4. **[server]** `turn-send.ts`: in `sendReply` (`:12-31`) and `sendGroupReply`
   (`:37-58`), when `deps.replaceTargetId` is set call
   `deps.sendCorrection(to, kind, replaceTargetId, text, opts)`; on a successful
   **normal** send call `deps.onFinalMessageId?.(sent.id)`. Type the send result
   as `{ id: string }` (`dm-turn.ts:69`, `group-turn-deps.ts:29-34`). (~45 min;
   see risk 4 for the room mention.)
5. **[server]** Wire it in the two bodies. In `dm-turn-input.ts` and
   `group-turn-body.ts`: for a scheduled trigger, `loadRoutineMessage(...)` and
   set `replaceTargetId` only when the stored id is present and young enough;
   wire `sendCorrection` to `session.core.sendCorrection` (as `live.ts:133-135`
   does) and `onFinalMessageId` to `recordRoutineMessage` (best effort, ids only
   on failure). Uses `deps.db`. (~60 min)
6. **[server]** Suppress the per-run card for a scheduled run: do not pass
   `reportProgress`/`finishProgress` when the trigger is a scheduled routine
   (`dm-turn-input.ts:97-98`, `group-turn-body.ts:282-283`), so a run adds
   exactly one message. `live.ts` unchanged. (Decision, §3 Q3.) (~20 min)
7. **[server]** Retraction fallback: in `gateway.ts:256-262`, when a
   `message.retraction` arrives, call `clearRoutineMessageByTarget(db,
   message.retraction.targetId)` before returning (best effort). The age bound
   from task 5 covers the pruned/old case. (~30 min)
8. **[web, mobile]** Show the correction's time ("edited 10:45"): the marker must
   render the edit time, not `createdAt` (`web MessageMeta.tsx:31-32`; `mobile
   plain-bubble-body.tsx:85`, `message-bubble-decor.tsx:157-158`). The edit
   `order` (the correction's stanza time) already reaches `editsFor`
   (`chat-core edits.ts:225-242`), so carry it on the rendered message as
   `editedAt` and format it like the existing time. (~60 min; optional — confirm
   §3 Q1.)

## 3. Risks and open questions

1. **"edited 10:45" vs today's "edited".** Today the time shown is the original
   send time (`MessageMeta.tsx:32`, `plain-bubble-body.tsx:85`). Confirm we want
   the correction time, and that both apps change.
2. **Invisible runs.** An edit does not bump unread or the chat-list preview
   (`ledger-edits.ts:112-114`), and a plain-text correction is not topic
   activity (`activity-refresh.ts:23-44`). Each run may be missed in the list.
   Keep (the canvas's point) or add a lightweight signal?
3. **The progress card is a second message.** A tool/desk turn already posts a
   card (`live.ts:80-198`). Task 6 suppresses it for scheduled runs so a run is
   exactly one message. Confirm.
4. **Room correction loses `replyTo` and the `@Name` mention.** `sendCorrection`
   carries only text/payload/mentions (`types.ts:209-216`), so `wire()`'s
   `replyTo` (`group-turn.ts:116`) is dropped. Recommend dropping the mention
   text too, or every run re-pings the owner.
5. **Group retraction names the stanza-id** (`ledger-ids.ts:242-251`) while the
   stored id is the origin id, so task 7 misses a group retraction unless we also
   store the stanza id. Low risk today (nothing retracts the AI's message).
6. **Write-after-send can fail:** if the DB write fails after a successful first
   send, the next run posts a second message. Best-effort write, ids only.
7. **Concurrency is safe:** a routine's runs are serialized
   (`scheduler.ts:72-76,162-171`), so two runs never race the same id.
8. **Rolling deploy:** the columns are additive and nullable; an old leader never
   writes them and a new leader only reads/writes after the migration ships.
