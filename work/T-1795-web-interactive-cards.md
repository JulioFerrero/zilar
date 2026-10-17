---
id: T-1795
title: "Blocks Wave 2 B10 (web): draw buttons, poll, pick one, quick form and rating like WebChoices.dc.html, make checklist items tappable, call POST /api/blocks/respond, and send the @AI reply for decision kinds"
status: merged
milestone: M5
branch: task/T-1795-web-interactive-cards
model: auto
effort: default
depends_on: [T-1792, T-1794]
estimate: 60 min
---

# T-1795: Interactive cards on web

## Spec (written by Claude, do not edit)

### Why
This is Wave 2, B10 (`docs/plan/message-blocks.md` §8). The server route is live in T-1792. On web, a room member can now:
- tick a checklist item;
- vote in a poll;
- pick an option;
- rate;
- press a button;
- send a quick form.

Each one is drawn exactly like the approved board, `docs/design/mockups/blocks/WebChoices.dc.html` (13 buttons, 14 poll, 15 pick one, 16 quick form, 17 rating). Board 18 (alert rule) has no protocol kind and is out of scope.

### Facts (read by the lead on 2026-10-17)
- **The protocol kinds** are in `packages/protocol/src/blocks-choices.ts`:
  - `buttons {id, text, actions[{id, label, style: light|dark}]}` (`:12-37`);
  - `poll {id, question, options[{id, label, votes?}], votes?, multiple?}` (`:41-66`);
  - `choice {id, question, options: string[], selected?: index}` (`:70-80`);
  - `form {id, title?, fields[{id, label, kind: text|number|date, value?}], submit}` (`:83-108`);
  - `rating {id, prompt, max, selected?: index}` (`:111-120`).
  - The checklist is `packages/protocol/src/blocks-progress.ts:6-26` (`items[{id, label, done, by?}]`).
- **The route** (`packages/api-contract/src/message-blocks.ts`): the group is `MessageBlocksGroup`, named `'message-blocks'`, with the endpoint `respond`.
  - The payload is `{ messageId, blockId, itemId?, value: { done?, optionIds?, selected?, rating?, actionId?, fields? } }`.
  - The success is `{ data: Unknown }`; decode it with `BlocksDataSchema` from `@zilar/protocol` and treat a failed decode as an error.
  - The server checks a rating as 1..max and a choice as a 0-based index. A form value is at most `BLOCKS_RESPOND_FORM_VALUE_MAX` (120) characters.
  - Errors: 404 `card_not_found` (also when the card isn't interactive, such as tool and routine cards), 400 `invalid_response`, and 429.
- **The web API call pattern:** `apps/web/src/lib/api/topics.ts:113-115` (`callApi((client) => client.topics.join({ params: { id } }))`), with `callApi` from `apps/web/src/lib/effect/api-client.ts:48`.
- **The card's mount point:** `apps/web/src/components/message/AttachmentBody.tsx:257-262` passes only `data` and `footer` to `BlockCard`. In scope there:
  - `message.id` (the stanza id clients know);
  - `message.senderName`;
  - `message.senderId` (the sender's JID; `packages/client-core/src/store/ledger-incoming.ts:131` sets it from `fromJid`);
  - `chat.id`;
  - `own`.
- **The @AI reply pattern:** `apps/web/src/components/message/QuestionCard.tsx:44-52`: `storeApi.getState().sendText(chatId, \`@${aiName} ${option}\`, { replyTo: { id: messageId, senderName: aiName }, mentions: [{ jid, name: aiName, begin: 0, end: aiName.length + 1 }] })`.
- **The checklist** is read-only today: `apps/web/src/components/message/blocks/ChecklistBlock.tsx:19-60`, with a `readOnly` checkbox and `tabIndex={-1}`.
- **The router:** `apps/web/src/components/message/blocks/BlockCard.tsx` `renderBlock`. T-1794 adds a `showHeading` argument; keep it. The group renderers live beside it (`DataBlocks.tsx`, `ChartBlocks.tsx`, …), each with a `.fixture.tsx`.

### Steps
1. **`apps/web/src/lib/api/blocks.ts`:** `respondToBlock(payload): Promise<BlocksData>`. Call `respond` through `callApi`, then decode `data` with `BlocksDataSchema`; a decode failure rejects.
2. **A `BlockRespond` context**, `{ messageId, chatId, aiName, aiJid }` (a React context in the blocks folder), provided by `BlockCard` from a new optional `respond` prop.
   - `AttachmentBody.tsx` passes `{ messageId: message.id, chatId: chat.id, aiName: message.senderName, aiJid: message.senderId }`, only when `!own`.
   - With no context (fixtures, own cards), every control is drawn but disabled.
3. **Local state in `BlockCard`:** keep `data` in state, take the route's returned data at once, and reset it to the prop whenever the prop changes (the room correction arrived). A failed call puts the previous data back.
4. **A new `ChoiceBlocks.tsx`, routed from `renderBlock`, with one file per kind:**
   - **`ButtonsBlock.tsx` (board 13):** the text, then the keys (light/dark per `style`, 36 px, 10 px radius, wrapping, 8 px gap). After a press, the keys turn into the answered row: green check, "You chose **{label}**" and the time, kept in local state.
   - **`PollBlock.tsx` (board 14):** a header with the bar-chart icon, the question and "{votes} votes". Then one row per option: the label, the count and a 6 px track.
     - The viewer's option uses the light fill and a check; the others use the dim fill.
     - The width is `votes / max(total, 1)`.
     - A tap votes with `optionIds: [id]`; `multiple` toggles within the set; tapping the same single option again sends `[]` to unvote.
     - The viewer's own choice is kept in local state.
   - **`ChoiceBlock.tsx` (board 15):** the question and the segmented control. The `selected` option is "on".
   - **`FormBlock.tsx` (board 16):**
     - an optional header with the calendar icon and the title;
     - fields in well inputs, two per row when they fit;
     - a `number` field gets −/+ dark icon keys around a centered mono value;
     - the light `submit` key. Each value is capped at 120 characters.
   - **`RatingBlock.tsx` (board 17):** the prompt, then `max` dark square star keys. Stars up to the chosen one are filled `#ededed`; the rest are outlined `#5a5a5a`.
   - **`ChecklistBlock.tsx`:** an item becomes a button that toggles `done`. Keep the look, add a focus ring, and keep the `by` name.
5. **The calls:**
   - checklist: `{ blockId, itemId, value: { done } }`;
   - poll: `{ blockId, value: { optionIds } }`;
   - choice: `{ blockId, value: { selected: index } }`;
   - rating: `{ blockId, value: { rating: n } }`, where n is 1..max;
   - buttons: `{ blockId, value: { actionId } }`;
   - form: `{ blockId, value: { fields } }`.
6. **Decision kinds** (buttons, choice, rating, form): after the route succeeds, send the @AI reply exactly as in `QuestionCard.tsx:44-52`, with `jid: aiJid`. The text is the button label, the chosen option, "{n}/{max}", or the form as `Label: value` pairs joined with ", ". Checklist and poll send nothing.
7. **`ChoiceBlocks.fixture.tsx`** with every kind (open, and answered or selected), drawn without the context, for the lead's Cosmos check against the board.
8. **No tests** (UI). Keep every file at most 400 lines.

### Allowed files
- `apps/web/src/lib/api/blocks.ts`
- `apps/web/src/components/message/AttachmentBody.tsx`
- `apps/web/src/components/message/blocks/BlockCard.tsx`
- `apps/web/src/components/message/blocks/BlockRespond.tsx`
- `apps/web/src/components/message/blocks/ChoiceBlocks.tsx`
- `apps/web/src/components/message/blocks/ChoiceBlocks.fixture.tsx`
- `apps/web/src/components/message/blocks/ButtonsBlock.tsx`
- `apps/web/src/components/message/blocks/PollBlock.tsx`
- `apps/web/src/components/message/blocks/ChoiceBlock.tsx`
- `apps/web/src/components/message/blocks/FormBlock.tsx`
- `apps/web/src/components/message/blocks/RatingBlock.tsx`
- `apps/web/src/components/message/blocks/ChecklistBlock.tsx`
- `work/T-1795-web-interactive-cards.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On web, every interactive kind is drawn like `WebChoices.dc.html` and answers through the route.
- The card updates at once, and again when the room correction arrives.
- Decision kinds send the @AI reply; checklist and poll don't.
- Fixtures and own cards are read-only.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/web/src/lib/api/blocks.ts`: `respondToBlock(payload)` posts through
  `callApi` to `message-blocks.respond`, decodes `data` with `BlocksDataSchema`
  and rejects with `ApiError(200, 'invalid_response', …)` when the decode fails.
- `blocks/BlockRespond.tsx`: the `BlockRespond` context (message, chat, AI name
  and JID), `answer` (posts one block response and returns the merged card) and
  `useBlockReply` (the `QuestionCard.tsx:44-52` @AI reply call). `AttachmentBody`
  builds the target only for `!own`; a missing provider means fixtures and own
  cards draw disabled controls.
- `blocks/BlockCard.tsx`: keeps the card in state, takes the route's merged card
  at once, resets it whenever the `data` prop changes (the room correction) and
  puts the previous card back when a call fails. Routes the five choice kinds to
  `renderChoiceBlock`; `showHeading` stays.
- `blocks/ChoiceBlocks.tsx` + `ButtonsBlock`, `PollBlock`, `ChoiceBlock`,
  `FormBlock`, `RatingBlock`: board 13-17 drawn from `WebChoices.dc.html`:
  - buttons: wrapping 36 px light/dark keys, then the green-tick answered row
    with the label and time;
  - poll: bar-chart header with the vote total, tappable option rows with a 6 px
    track, light fill + check for the viewer's options, `multiple` toggling and
    a single option's second tap unvoting with `[]`;
  - choice: the segmented control with the selected option on;
  - form: optional calendar header, two-column wells, −/+ dark keys around the
    mono number value, light submit key, every value capped at 120 characters;
  - rating: `max` dark square star keys, filled up to the choice and outlined
    after it.
- `blocks/ChecklistBlock.tsx`: each item is now a button that toggles `done`
  (optimistic, reverted on failure), with a focus ring and the `by` name kept.
- Decision kinds (buttons, choice, rating, form) send the @AI reply only after
  the route succeeds (button label, chosen option, `n/max`, `Label: value`
  pairs). Checklist and poll send nothing.
- `blocks/ChoiceBlocks.fixture.tsx`: every kind open and answered/selected (two
  button cards, a voted poll, a selected choice, filled and open forms, selected
  and open ratings, the tappable checklist), drawn without the provider.

### Checks run

- `pnpm install --frozen-lockfile`: done.
- `pnpm gate` (from the repo root), final run:

```text
gate: 13 changed file(s) against main
PASS  install (frozen)  (2.8s)
PASS  format  (2.9s)
PASS  lint  (2.4s)
PASS  typecheck  (1.6s)
PASS  effect  (1.7s)
PASS  tests @zilar/web  (11.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No single test files were run: this is UI code and the task says no tests. The
  gate ran the `@zilar/web` tests.

### Notes for the lead

- Deviations from the spec's exact context shape:
  - The context target also carries `reply`, and `BlockCard` adds `answer`. The
    @AI reply needs `sendText`, which lives in the chat store; reading it inside
    a block would make every fixture crash without `ChatStoreProvider`, so
    `AttachmentBody` (already inside the provider) builds the reply closure and
    the fixture's blocks get a no-op.
  - `ButtonsBlock` and `PollBlock` take an optional initial answered/selected
    state, used only by the fixture: the protocol has no "viewer picked" field
    for either kind, so a live card can only reach those states by tapping.
- Rating: the protocol comment calls `selected` an index, but the server merges
  the 1..max rating into `selected` (`apps/server/src/message-blocks/apply.ts:108-111`)
  and the board fills four stars for the fourth, so I draw `selected` as the
  number of filled stars (1..max).
- The poll header pluralises "1 vote"; every other total reads "N votes".
- A failed call reverts the control silently (previous card data and previous
  local pick); no new error sentence is shown.

### Fix round

1. Tapping the current choice or rating is now a no-op: no route call and no
   second @AI reply (`ChoiceBlock`, `RatingBlock` compare `selected` first).
2. `AttachmentBody` memoises the `blockRespond` target on `own`, `message.id`,
   `message.senderId`, `message.senderName` and `chat.id`, so a bubble re-render
   keeps the card context identity.
3. Quick form: fields are laid out in two-per-row flex rows with `items-end`;
   the light Send key shares the last number field's row, right-aligned, and the
   stepper is a 36 px icon key, a 32 px centered 15 px mono value and a 36 px
   icon key with 6 px gaps. Without a number field Send keeps its own
   right-aligned row.
4. Disabled controls keep their full look: the light keys stay white and no
   disabled opacity remains. `disabled` and `aria-disabled` are both set on
   every control, which is disabled when there is no context or a call is in
   flight; nothing is dimmed.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `b797e86c6`, after one lead round.
- **Cosmos `ChoiceBlocks` (All examples) vs `WebChoices.dc.html`:**
  - buttons (open and "You chose"), poll (counts, tracks, your-vote check), pick one (segmented), quick form (Send on the stepper row, compact stepper) and rating (filled and empty stars) all match;
  - the checklist is tappable.
- **Behaviour:**
  - route calls through `respondToBlock` (decoded with `BlocksDataSchema`), with local state and a reset on correction;
  - a re-tap of the same rating or option is a no-op;
  - the respond target is memoized;
  - decision kinds send the @AI reply with mention and quote, as question chips do.
- **Nit left:** a correction that lands mid-call and then a failed call can restore a pre-correction state for a moment; the next correction fixes it.
- **The live test** comes after B11 and B12 deploy (in "cards test").

