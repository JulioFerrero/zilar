# Message blocks: native UI blocks that AIs and saved tools put in messages

T-1747, 2026-10-16. **Plan only: no source file changed.** Every claim cites
`file:line`. Julio approved the canvas of 25 native blocks on 2026-10-16
(`docs/design/mockups/blocks/README.md:5`); the boards are the copy workers read
(`README.md:7`). This maps the code and lists the build tasks. Related:
`docs/plan/routine-live-message.md` (a routine edits its one message) and
`docs/TOOL_SANDBOX.md` (what a saved tool returns).

The rule from the canvas: the AI or a saved tool sends a small JSON layout, and
web and phone draw it with Zilar's own components. No HTML mini-apps, no
Markdown-only (`README.md:3`). The 25 boards, numbered 01–25, are the block
kinds (`README.md:15-18`).

## 1. The schema

### Where it plugs in

A message already carries one typed payload. The union is `PayloadSchema`
(`packages/protocol/src/payload.ts:18-56`), and each kind builds its struct with
the `struct` helper (`packages/protocol/src/common.ts:15-23`) and caps its
fields with `Schema.check` (`packages/protocol/src/poll.ts:6-27`). The payload
is JSON text inside `<agent xmlns='urn:zilar:agent:0'>`
(`packages/xmpp-core/src/namespaces.ts:1`), decoded by `decodePayload`
(`packages/xmpp-core/src/stanza/decode.ts:84-91`) on the client and by
`decodeAgentPayload` (`apps/server/src/notify/ai-cards.ts:37-44`) on the server.
The whole payload is capped at 64 KiB (`payload.ts:16`, enforced
`payload.ts:90-98`).

Add one kind, `blocks` (v0), in a new `packages/protocol/src/blocks.ts`, and one
member to the union:

```ts
Schema.Struct({ v: Schema.Literal(0), type: Schema.Literal('blocks'), data: BlocksDataSchema }),
```

`struct` makes every field mutable (`common.ts:11-23`), matching the other
kinds. `decodePayload` already rejects an unknown `type` and a non-zero `v`
(`payload.ts:111-119`), so an old client that has not shipped the kind shows the
message's body text (see §4).

### The data shape

`data` is an optional header row, a required plain `fallback`, and an ordered
list of typed blocks:

```ts
export const MAX_BLOCKS = 12;
export const MAX_BLOCK_BYTES = 16 * 1024; // under the 64 KiB payload cap
export const MAX_TEXT = 120;              // a title, a row label, a heading
export const MAX_SHORT = 40;              // a value, a unit, a meta cell
export const MAX_ROWS = 24;               // items in a list-like block
export const MAX_SERIES = 30;             // points in a chart

const Text = Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_TEXT)));
const ShortText = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SHORT)),
);
const NumberText = Schema.String.pipe(Schema.check(Schema.isMaxLength(MAX_SHORT)));

// A pre-formatted value and its direction. The client never formats money or
// dates: the AI or the tool sends the exact string ("$82,302", "Fri 17 Oct").
export const ChangeSchema = struct({
  direction: Schema.Literals(['up', 'down', 'flat']),
  text: ShortText,
});

export const BlockIconSchema = Schema.Literals([
  'activity', 'bell', 'calendar', 'chart', 'check', 'clock', 'cloud-sun',
  'file', 'gauge', 'images', 'info', 'link', 'list-checks', 'loader', 'map-pin',
  'mouse-pointer-click', 'route', 'sliders', 'star', 'table', 'timer',
  'trending-up', 'vote', 'warning',
]);

export const BlocksDataSchema = struct({
  title: Schema.optional(Text),
  icon: Schema.optional(BlockIconSchema),
  meta: Schema.optional(ShortText),
  // Required and plain: push, previews, the chat list, search, the memory
  // indexer and old clients all read the message body, never the blocks.
  fallback: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1000))),
  blocks: Schema.mutable(Schema.Array(BlockSchema)).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_BLOCKS)),
  ),
});
```

`icon` is a fixed, named set backed by lucide (the project rule is lucide,
never emoji, in app chrome — `AGENTS.md:69`); an unknown name fails the decode,
so a renderer never has to guess. The 16 KiB block cap is a `Schema.check` on
the serialized `blocks` array (a `makeFilter` over `JSON.stringify(blocks).length`,
the same style as the unique-id filters at `poll.ts:18-23`), on top of the
64 KiB whole-payload cap.

`fallback` is the message body. This is not a new mechanism: the `ask_people`
card already posts a plain fallback text as the body next to the payload
(`apps/server/src/agents/gateway/ask-people.ts:36-38`, sent `:89-95`). Because
every reader works from `body` — the AI context (`apps/server/src/agents/context.ts:177-206`),
the unread/preview path and search — the blocks need no change there.

### Six kinds in full

The first-wave six (01, 02, 08, 12, 19, 25), written out. All use the helpers
above and `struct`.

```ts
// 01 · FIGURES: label / value rows, an optional change per row.
export const FigureBlockSchema = struct({
  kind: Schema.Literal('figure'),
  rows: Schema.mutable(Schema.Array(struct({
    label: Text,
    value: NumberText,
    change: Schema.optional(ChangeSchema),
  }))).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ROWS))),
});

// 02 · BIG NUMBER: one large value, an optional change and sparkline.
export const NumberBlockSchema = struct({
  kind: Schema.Literal('number'),
  label: Text,
  value: NumberText,
  code: Schema.optional(ShortText),          // "BTC"
  change: Schema.optional(ChangeSchema),
  points: Schema.optional(Schema.mutable(Schema.Array(Schema.Number)).pipe(
    Schema.check(Schema.isMinLength(2), Schema.isMaxLength(MAX_SERIES)),
  )),
});

// 08 · CHECKLIST: the ticks everyone sees. `id` keys the per-item state.
export const ChecklistBlockSchema = struct({
  kind: Schema.Literal('checklist'),
  id: IdSchema,                              // the block's id, for state rows
  title: Text,
  items: Schema.mutable(Schema.Array(struct({
    id: IdSchema,
    label: Text,
    done: Schema.Boolean,
    by: Schema.optional(Text),               // who ticked it ("Ana", "you")
  }))).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MAX_ROWS),
      Schema.makeFilter((items) =>
        new Set(items.map((item) => item.id)).size === items.length
          ? undefined
          : 'checklist item ids must be unique',
      ),
    ),
  ),
});

// 12 · STATUS LIST: a dot plus a short value per row, never a word.
export const StatusBlockSchema = struct({
  kind: Schema.Literal('status'),
  title: Text,
  rows: Schema.mutable(Schema.Array(struct({
    label: Text,
    status: Schema.Literals(['ok', 'warn', 'bad']),
    value: Schema.optional(ShortText),
  }))).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ROWS))),
});

// 19 · LINK CARD: one https link, no images and no HTML.
export const LinkBlockSchema = struct({
  kind: Schema.Literal('link'),
  url: HttpsUrlSchema,                       // see §5
  site: Schema.optional(ShortText),          // "github.com"
  title: Text,
  description: Schema.optional(Schema.String.pipe(
    Schema.check(Schema.isMaxLength(300)),
  )),
});

// 25 · CALLOUT: one tone, one line, an optional time.
export const CalloutBlockSchema = struct({
  kind: Schema.Literal('callout'),
  tone: Schema.Literals(['success', 'warning', 'error', 'info']),
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
});
```

`BlockIconSchema` lives in `blocks.ts`; the renderers map each name to a lucide
component. The union `BlockSchema` is a `Schema.Union([...])` of all 25 members,
like `PayloadSchema` (`payload.ts:18-56`).

### The other 19 kinds

| # | `kind` | Fields (all strings capped as above unless noted) |
|---|---|---|
| 03 | `stats` | `title?`; `tiles[]` 1–6 × `{ label, value, ratio? }` (`ratio` 0–1) |
| 04 | `table` | `title?`; `columns[]` 1–5; `rows[][]` 1–24 (each row same length); `total?` boolean |
| 05 | `bars` | `title?`; `value?`; `series[]` 1–30 × `{ label, value: number, current? }` |
| 06 | `line` | `title?`; `value?`; `points[]` 2–30 numbers; `min?`, `max?`; `labels[]?` ≤ 6 |
| 07 | `gauge` | `label`; `ratio` 0–1; `value`; `caption?`, `detail?` |
| 09 | `progress` | `label`; `ratio` 0–1; `detail?`, `note?` |
| 10 | `timeline` | `title`; `steps[]` 1–12 × `{ label, at?, detail?, state: 'done'\|'current'\|'todo' }` |
| 11 | `countdown` | `label`; `targetAt` (ISO with offset); `note?` |
| 13 | `buttons` | `text`; `actions[]` 1–4 × `{ id, label, style: 'light'\|'dark' }` |
| 14 | `poll` | `id`; `question`; `options[]` 1–8 × `{ id, label }`; `votes?` number; `multiple?` |
| 15 | `choice` | `question`; `options[]` 2–5 `Text`; `selected?` index |
| 16 | `form` | `title?`; `fields[]` 1–4 × `{ id, label, kind: 'text'\|'number'\|'date', value? }`; `submit` |
| 17 | `rating` | `prompt`; `max` 1–5; `selected?` |
| 18 | `alert` | `title`; `field { label, value }`; `on` boolean; `note?` |
| 20 | `images` | `items[]` 1–4 × `IdSchema` (uploaded media ids); `extra?` number |
| 21 | `place` | `title`; `subtitle?`; `map` IdSchema (a rendered map image); `directionsUrl?` |
| 22 | `weather` | `place`; `condition`; `high`, `low`, `temp`; `hourly[]` ≤ 6 × `{ at, condition, temp }` |
| 23 | `event` | `title`; `startAt`, `endAt` (ISO); `detail?`; `calendar?: boolean`; `map?: IdSchema` |
| 24 | `file` | `media` IdSchema; `name`; `size`, `kind`, `rows?` |

`IdSchema` (`common.ts:66-72`) keys uploaded media, never a URL: images and
files always point at media the upload path already accepted (see §5). Blocks
20 and 21 carry media ids, so a renderer resolves them to the API origin on the
phone exactly like an avatar reference (`AGENTS.md:67`).

## 2. Where blocks come from

Three sources, each with a path. All three end at the same place: the server
builds a `blocks` payload, validates it, and sends it as a normal message (or a
correction of one — see §2c).

### (a) An AI turn — recommendation: a new model tool

The model already chooses tools and gets the arguments validated, and the
missing-file cost of a new tool is documented (`AGENTS.md` pitfall; the lead's
memory of T-1576). A new tool `post_blocks` is the recommended path, because it
is the only one that gives the model field names and caps up front and returns a
result the turn can react to. A new model tool touches the tool files **and**
the gateway that offers and runs it: the `ask_people` precedent spans all of
them, and the spec names `group-turn.ts` for exactly this reason
(`work/T-1747-message-blocks-plan.md:33`).

- the definition, `apps/server/src/agents/tools/definitions.ts:309-346`
  (`buildTools` / `buildGroupTools` append it like `ask_people` at `:251-280`);
- the argument schema and name, `apps/server/src/agents/tools/schemas.ts:6-17,
  195-231`;
- the parse branch, `apps/server/src/agents/tools/parse.ts`;
- the validated-call branch, `apps/server/src/agents/tool-calls.ts:219-220`;
- the offer gate, `apps/server/src/agents/gateway/group-turn-access.ts:61-64`
  (the `askPeople` flag: a scheduled trigger or an AI handoff never sets it);
- the turn context, `apps/server/src/agents/gateway/group-turn.ts:47-65`
  (`RequestActionContext.askPeople`);
- the offer itself, `apps/server/src/agents/gateway/group-turn-body.ts:200-228`
  (`buildGroupTools(..., { askPeople })`); and
- the executor, `apps/server/src/agents/gateway/tool-exec.ts:148-153` (refuse
  the call when the turn did not offer it) and `:196-207` (dispatch it).

Then a runner posts the card, mirroring
`apps/server/src/agents/gateway/ask-people.ts` (create the row first, post the
card, stamp the id, refund on failure — `:72-106`).

The two rejected options:

- **A `request_action` adapter.** The platform's action registry already builds
  a card and asks the owner for approval (`definitions.ts:162-211`), and the
  adapters live in `apps/server/src/tools/*-adapters.ts`. But a block card is
  not an approval: it would put a needless "Allow?" step in front of every
  figure, and the tool description is a long sorted list
  (`definitions.ts:169-188`) the model reads badly. Keep adapters for actions
  with side effects, not for drawing.
- **A fenced block in the reply.** Cheapest to ship (no new tool, just parse
  ```` ```blocks ```` out of the text), but it is unreliable: a model drops a
  fence, emits almost-JSON, or wraps it in prose, and the reply text then needs
  two renderers. The canvas is explicitly not Markdown-only (`README.md:3`).
  Reject it.

Token cost: the tool definition is one object in the tools array
(`definitions.ts:256-280` is the shape), ~200–400 tokens once per turn, against
re-sending a full JSON example every message if blocks were fenced. The model
follows a JSON-schema tool far more reliably than a fence it must invent.

### (b) Saved-tool output

A saved tool returns `{ text, data? }` (`docs/TOOL_SANDBOX.md:13-14`), typed and
capped by `parseToolOutput` (`apps/server/src/sandbox/types.ts:47-64`). Add an
optional `blocks?`: `parseToolOutput` validates the array through
`BlockSchema` and drops it (keeping `text`) when invalid, so a broken tool never
breaks the run. The tool's `text` becomes `data.fallback`.

### (c) Tool routines

A routine posts `"<title>\n<output.text>"` through `post`
(`apps/server/src/routines/execute.ts:16-18`). With (b) the output already
carries blocks, so the routine post builds the payload from them and
`data.fallback` from the same text. Later runs edit in place
(`docs/plan/routine-live-message.md`): a correction carries the payload too
(`live.ts` corrections, `routine-live-message.md:28-43`), so a routine's one
live message updates its blocks on each run exactly as it updates its text. No
new mechanism — just keep sending the payload on the correction.

## 3. Interactive blocks

The interactive seven: 08 checklist, 13 buttons, 14 poll, 15 pick one, 16 quick
form, 17 rating, 18 alert rule.

### How a tap travels

Reuse the `question` card path, which already works end to end. A chip is a
button that, on tap, sends a **normal message** that `@`mentions the asking AI
and quotes the card (`apps/web/src/components/message/QuestionCard.tsx:40-49`;
`apps/mobile/src/components/chat/question-card.tsx:32-42`). The mention starts a
normal group turn, so the AI wakes and replies. The server closes the question
row on that reply (`apps/server/src/agents/gateway/question-answer.ts:51-88`).

For the block kinds, the same channel carries the answer, but a small
`block.response` payload rides with the reply (instead of / next to the mention)
so the server can update shared state without parsing prose:

- **13 buttons, 15 pick one, 16 form, 17 rating:** the tap sends the mention
  reply plus `{ block_id, action_id, value }`. This is the `question` path with
  a structured value.
- **08 checklist, 14 poll:** the tap must update a shared card, not send a chat
  bubble. The client sends a `block.response` (a `poll.vote`-shaped payload;
  `PollVoteSchema` at `packages/protocol/src/poll.ts:29-41` is the precedent,
  and neither `poll` nor `poll.vote` has a server handler yet — they are
  protocol-only today, so the first block task owns the handler).
- **18 alert rule:** the switch and the input only matter on submit; treat it
  as a one-field form.

### Who may act

Any member of the room may act, as with a `question` chip; a card is visible
only in rooms the client may read (`activity-refresh.ts:6-7`). The acting
person's bare JID is the actor, taken server-side from the session, never from
the payload (`ask-people.ts:3-5`). One answer per person per block: enforced by
a unique index, not a read-then-write.

### Where shared state lives

Blocks live inside the message payload, so they cannot be mutated in place
without editing the message. Put per-person and per-item state in a new table,
keyed by the card's message id:

```
block_responses (
  message_id  text,          -- the card message
  block_id    text,          -- the block's `id`
  item_id     text,          -- the option / item id, '' for a single answer
  actor_id    text,          -- the acting person's bare JID
  value       jsonb,         -- { text } or { option_id } or { rating }
  created_at  timestamptz,
  PRIMARY KEY (message_id, block_id, item_id, actor_id)
)
```

The primary key makes a second tap idempotent (`ON CONFLICT DO NOTHING`). A
checklist renders its ticks from this table merged over the payload's `items`;
a poll renders `votes` as the count of rows per option. This is the shared state
"everyone sees": the server, not the client, is the source of truth, and clients
converge by reloading the card.

The AI's own card is posted by the AI's session; the counter-reset and re-key
mechanics that `question` needed because the card is an outgoing reflection
(`question-answer.ts:20-46`, `rekeyQuestionMessage`) apply to blocks the same
way and are reused unchanged.

### Does it wake a turn?

Only the mention does. A `question` chip wakes a turn because it is a normal
@mention reply. A checklist tick or a poll vote should **not** wake a turn on
every tap (that would bill a model call per item). So:

- **08 checklist, 14 poll:** record the row, update the card (a correction
  carrying the same `blocks` payload with the new counts), and post **no**
  mention. Batch: the AI learns the state when it next runs, and may be woken
  once on a submit/close action.
- **13/15/16/17/18:** these are decisions the AI is waiting on, so the reply
  mentions the AI and wakes a turn, exactly like `question`.

The AI reads the answers two ways: the reply text enters its context as a normal
message (`apps/server/src/agents/context.ts:177-206`), and the server can surface
`block_responses` as labelled, untrusted data in the turn (see §5).

### Idempotency and old clients

- **Idempotency:** the `block_responses` primary key, written in the same
  transaction that updates the card. The `question` precedent already does the
  atomic conditional close (`apps/server/src/questions/service.ts:236-256`,
  `answerQuestion`).
- **Old clients:** they never see the kind (`payload.ts:111-119` rejects an
  unknown `type`; the mobile set `RENDERED_CARD_TYPES`
  `apps/mobile/src/components/chat/payload-card.tsx:56-63` and the web switch
  `apps/web/src/components/message/AttachmentBody.tsx:246-266` only draw known
  kinds). They fall through to the message body, which is `fallback`. So
  `fallback` must stand alone for every interactive block: a checklist lists its
  items and tick state as text, a poll lists its options. An answered card also
  appends the answer to the body on the server, so an old client still reads the
  outcome.

## 4. Rendering

### One shared model

`packages/chat-core/src/blocks.ts` holds the source-agnostic view: the
`Block` union re-exported from `@zilar/protocol`, plus a `normalizeBlocks(data)`
that drops a block whose kind the running build does not know and returns the
fallback text when nothing is left. Web and phone both import it, so a drifted
payload degrades identically on both. It has no React and no tests (UI gets no
tests, `AGENTS.md:83`).

### Web

New folder `apps/web/src/components/message/blocks/`, one file per block kind
plus a shell. `BlockCard.tsx` draws the card chrome (`#141414`, 1 px `#232323`,
16 px radius, `README.md:22-24`), the header row and the `BlockRenderer` switch.
Then `FigureBlock.tsx`, `NumberBlock.tsx`, `ChecklistBlock.tsx`,
`StatusBlock.tsx`, `LinkBlock.tsx`, `CalloutBlock.tsx`, and so on — each well
under the 400-line cap (`packages/devtools/src/gate/size.ts:10`). Two existing
hooks change: add the type to the `AttachmentBody` switch
(`apps/web/src/components/message/AttachmentBody.tsx:246-266`) and to
`hidesBodyText` (`apps/web/src/components/message/QuestionCard.tsx:12-16`, read
at `apps/web/src/components/MessageBubble.tsx:129`) so the bubble hides the
fallback text but keeps it on the message for copy, replies and search.

### Phone

The twin: `apps/mobile/src/components/chat/blocks/`, the same file split, drawn
with React Native views. Add `'blocks'` to `RENDERED_CARD_TYPES` and the
`PayloadCard` switch (`apps/mobile/src/components/chat/payload-card.tsx:39-63`;
consumed at `apps/mobile/src/components/chat/message-bubble-content.tsx:188`).
The card surface uses `bubbleStyle('incoming', false)` like the progress card
(`payload-card.tsx:30-36`). `README.md:24` gives the phone text size (15/21) and
the phone key size (40 px); resolve any media id against the API origin
(`AGENTS.md:67`).

### Unknown kind and accessibility

- **Unknown kind:** `normalizeBlocks` drops it; if all are unknown,
  `BlockCard` renders the `fallback` as plain text. A block the running build
  does not know never leaves an empty bubble.
- **Accessibility:** status dots are `role="img"` with a label
  (`docs/design/mockups/blocks/WebProgress.dc.html:140-143`); charts carry an
  `aria-label` (`WebNumbers.dc.html:73`); each interactive control is a real
  `<button>`/`Pressable` with an `accessibilityLabel`
  (`WebChoices.dc.html:94`, `WebProgress.dc.html:52`). Numbers use tabular
  figures right-aligned (`README.md:29`). Colour is never the only signal: a
  change keeps its ▲/▼ and its sign, a status keeps its value.

## 5. Safety

- **The server validates before relaying.** A saved tool's blocks pass
  `BlockSchema` inside `parseToolOutput` (`apps/server/src/sandbox/types.ts:47-64`);
  an AI turn's blocks pass the argument schema in `parse.ts` and are re-validated
  when the payload is built, then `decodePayload` runs again on the client
  (`decode.ts:84-91`). The send path never trusts the model's JSON: it builds
  the payload from validated fields, the way `ask-people.ts:82-95` does.
- **Only https links.** `LinkBlockSchema.url` and every directions URL use a new
  `HttpsUrlSchema`: `common.ts:144-149` today accepts `http:` too (it mirrors
  zod's `http(s)`), so add an https-only schema next to it and use it only for
  blocks. The renderer opens links with `rel="noopener noreferrer"`.
- **Images only from uploaded media.** Blocks 20, 21, 23, 24 reference an
  `IdSchema` media id, never a URL. The upload path already validates and stores
  media; a block can only point at something the server accepted. No remote
  image fetch, so a card cannot be a tracker.
- **No HTML.** Every text field is a plain string; renderers draw it as text
  and never as markup. No `dangerouslySetInnerHTML`, and the phone never renders
  a WebView. This is the canvas's rule (`README.md:3`).
- **Block text is untrusted data, never instructions.** The message body (the
  `fallback`) already enters the model context as history
  (`context.ts:177-206`). When `block_responses` are fed back, wrap them in the
  existing `<untrusted-tool-output>` marker (`apps/server/src/agents/tool-exec.ts:74-83`,
  rule stated at `apps/server/src/agents/tool-guide.ts:24`) so a block that says
  "ignore your owner" is data, not an order. The system prompt keeps the rule.
- **The live-UI rule is untouched.** Blocks are real messages, not the
  progress card, so `isLiveAiUiRow` (`ai-cards.ts:46-50`) must **not** match
  them: a block message is unread, indexed and previewed like any other.

## 6. Task breakdown

Ordered waves. Each task is one worker, ≤ 400 lines per file, and at most **two**
tests, only in the message pipeline (`packages/protocol/src/payload.test.ts` and
`packages/client-core/src/store/ledger.test.ts`). Estimates are 20–45 min. The
lead assigns the real ids; the letters are for ordering.

### Wave 1 — schema, validation, six blocks, both apps, AI and tool paths

1. **B1 [protocol] the blocks schema.** New `packages/protocol/src/blocks.ts`
   (all 25 kinds, `BlocksDataSchema`, `BlockIconSchema`, `HttpsUrlSchema`), one
   union member in `packages/protocol/src/payload.ts:18-56`, export from
   `packages/protocol/src/index.ts`. Test: `payload.test.ts` (a valid `blocks`
   payload decodes; an over-cap array and an unknown icon reject). ~45 min.
2. **B2 [server] build and validate.** New
   `apps/server/src/blocks/build.ts`: `buildBlocksPayload(fields)` (validates,
   sets `fallback`, enforces the 16 KiB cap) and the `block.response` decode
   helper. Wire the server `decodeAgentPayload` path only if needed
   (`ai-cards.ts:37-44` ignores other kinds already). Test one in the message
   pipeline. ~40 min.
3. **B3 [chat-core] the shared model.** New `packages/chat-core/src/blocks.ts`:
   re-export `Block`, `normalizeBlocks`, `blocksFallback`. Export from
   `packages/chat-core/src/index.ts`. No test (shared view, no logic worth a
   pipeline test). ~30 min.
4. **B4 [web] shell + 6 blocks.** New
   `apps/web/src/components/message/blocks/{BlockCard,FigureBlock,NumberBlock,ChecklistBlock(read-only),StatusBlock,LinkBlock,CalloutBlock}.tsx`;
   add the type to the `AttachmentBody.tsx:246-266` switch and `hidesBodyText`
   (`QuestionCard.tsx:12-16`). No test (UI). ~45 min.
5. **B5 [phone] twin of B4.** New
   `apps/mobile/src/components/chat/blocks/…` with the same six; add
   `'blocks'` to `RENDERED_CARD_TYPES` and the switch in
   `payload-card.tsx:39-63`. No test (UI). ~45 min.
6. **B6 [server] the AI path.** `post_blocks` definition in
   `definitions.ts:309-346`, args in `schemas.ts:6-17,195-231`, the parse
   branch in `parse.ts`, the validated call in `tool-calls.ts:219-220`, the
   offer gate in `gateway/group-turn-access.ts:61-64`, the context flag in
   `gateway/group-turn.ts:47-65`, the `buildGroupTools` call in
   `gateway/group-turn-body.ts:200-228`, the guard and dispatch in
   `gateway/tool-exec.ts:148-153,196-207`, and a `gateway/blocks-post.ts`
   runner modeled on `gateway/ask-people.ts`. Test one in the message pipeline.
   ~45 min.
7. **B7 [server] the saved-tool and routine path.** `blocks?` in
   `apps/server/src/sandbox/types.ts:47-64`; carry blocks in the routine post
   (`apps/server/src/routines/execute.ts:16-18`) and on its corrections
   (`docs/plan/routine-live-message.md`). Test one. ~40 min.

**Wave 1 ships:** 01, 02, 08 (read-only), 12, 19, 25 on web and phone, plus all
three sources.

### Wave 2 — the interactive core

8. **B8 [server+DB] `block_responses`.** Expand migration
   (`SET lock_timeout = '5s';`), `apps/server/src/db/rows-agents.ts`, a
   `blocks/service.ts` (record + read + conditional close, the
   `questions/service.ts:69-114,236-256` shape). Test one. ~45 min.
9. **B9 [server] the response path.** Handle `block.response` on the room
   message path (`question-answer.ts` as the model), update the card with a
   correction, wake a turn only for the decision kinds. Test one. ~45 min.
10. **B10 [web] interactive.** Checklist (live), buttons, poll, choice, form,
    rating, alert in `blocks/…`; each ≤ 400 lines. No test. ~45 min.
11. **B11 [phone] twin of B10.** No test. ~45 min.

### Wave 3 — the rest

12. **B12–B17 [web+phone]** the remaining kinds, grouped so each file stays
    small: charts (05, 06, 07), stats/table (03, 04), progress group (09, 10,
    11), content group (20, 21, 22, 23, 24), each task one app or one pair.
    No tests. ~30–45 min each.

### Cross-cutting rules for every task

- Every user-facing change ships on web **and** phone in the same wave
  (`work/T-1747-message-blocks-plan.md:34`).
- Registry files get **one** added entry, never a reorder (`AGENTS.md:64`).
- D24 style only (`docs/design/ui-style.md:3`), exact values from the boards.

## 7. Open questions for Julio

1. **How much may a block card show without a tap?** Recommended: the AI may
   post any of the 25; a checklist or poll the AI posts is live, but a person
   cannot edit a card the AI owns except through the defined interactions.
2. **Do checklist and poll taps wake the AI?** Recommended: no — record and
   update the card; wake on an explicit submit/close only, so a tap never bills
   a model call.
3. **One card or several per message?** Recommended: one `blocks` payload per
   message (the boards show several blocks in one card, separated by a rule —
   `README.md:40`), capped at 12 blocks and 16 KiB.
4. **May a saved tool post blocks, or only the AI?** Recommended: both, but a
   tool's blocks pass the same validation, and media always by uploaded id.

## 8. Wave 2 decisions (lead, 2026-10-17 night)

Julio was asleep and said to keep working ("find more things to work"). The lead took the recommended answers above and settled the open mechanics below. Each one is easy to change before the clients ship.

1. **How a card is identified.**
   - `post_blocks` records every card it posts in a new table, `block_cards`. Its key is the origin id `sendMessage` returns (`agents/gateway/post-blocks.ts:47-50`). The row also holds the room JID, the AI, the group and topic, and the card's current `BlocksData`.
   - The room reflection re-keys the row with the stanza id, the way `rekeyOnReflection` does for questions (`agents/gateway/question-answer.ts:24-46`). A card is then found by either id.
   - Only cards posted with `post_blocks` are interactive in Wave 2. Tool and routine cards stay read-only.
2. **How a tap reaches the server.**
   - Not over XMPP. It goes through an authenticated HTTP route, `POST /api/blocks/respond`, with `{ messageId, blockId, itemId?, value }`.
   - The actor is the session user, never a payload field.
   - The route answers 404 when the caller can't read the card's room, or when the card or block is unknown.
   - A per-user limiter applies.
3. **Shared state.**
   - `block_responses` (§3) holds one row per actor per item.
   - The server merges the rows into the card's `BlocksData`:
     - **checklist:** `done` and `by` per item, from the latest row;
     - **poll:** the per-option counts. **Protocol change:** the poll option gains `votes?: number`, and the block's `votes` stays the total of distinct voters;
     - **choice and rating:** `selected` comes from the latest row;
     - **buttons and form:** nothing is drawn, the row is only recorded.
   - The server then **corrects the card as the AI** (`session.core.sendCorrection`, as `agents/gateway/routine-send.ts:146-151` does), so every client redraws.
   - If the AI's session is offline, the state is still saved and the route returns it. Only the live update is skipped.
   - The route returns the new `BlocksData`, so the tapping client updates at once.
4. **Waking the AI.**
   - The route never wakes a turn.
   - For the decision kinds (buttons, choice, form, rating), the client also sends the normal `@AI` reply text, as question chips do (`apps/web/src/components/message/QuestionCard.tsx`, `apps/mobile/src/components/chat/question-card.tsx:38`). That reply wakes the AI and carries the answer into its context.
   - Checklist ticks and poll votes never wake it (§7.2).
5. **Tasks:**
   - **B8a [server+DB]:** migration `0071` (`block_cards`, `block_responses`), the rows in `db/rows-agents.ts`, `blocks/cards.ts` (record, re-key, find, record a response), and the pure `applyResponses(data, rows)`. Tests: 2 (idempotent second tap; the poll counts).
   - **B8b [server]:** `post_blocks` records the card, and the reflection re-keys it.
   - **B9 [server+contract+protocol]:** the route, the correction, the limiter and the poll option `votes?`. Test: 1 (a non-member gets 404).
   - **B10 [web] and B11 [phone]:** draw buttons, poll, choice, form and rating to `WebChoices.dc.html` / `PhoneChoices.dc.html`; make checklist items tappable; call the route; send the `@AI` reply for decision kinds.
   - **B12 [server]:** the card guide (`message-blocks/guide.ts`) offers the interactive kinds once B10 and B11 are live.
