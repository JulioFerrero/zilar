---
id: T-1796
title: "Blocks Wave 2 B11 (phone): draw buttons, poll, pick one, quick form and rating like PhoneChoices.dc.html, make checklist items tappable, call POST /api/blocks/respond, and send the @AI reply for decision kinds"
status: merged
milestone: M5
branch: task/T-1796-phone-interactive-cards
model: auto
effort: default
depends_on: [T-1792]
estimate: 60 min
---

# T-1796: Interactive cards on the phone

## Spec (written by Claude, do not edit)

### Why
This is Wave 2, B11 (`docs/plan/message-blocks.md` §8), the phone twin of T-1795 (web). The server route is in T-1792. On the phone, a room member can now:
- tick a checklist item;
- vote in a poll;
- pick an option;
- rate;
- press a button;
- send a quick form.

Each one is drawn exactly like the approved board, `docs/design/mockups/blocks/PhoneChoices.dc.html` (13 buttons, 14 poll, 15 pick one, 16 quick form, 17 rating). The phone keys are 40 px with a 12 px radius (`.key` at `:25`), inputs are 40 px with a 12 px radius (`:37`), and option rows are at least 44 px (`.opt` at `:39`). Board 18 (alert rule) has no protocol kind and is out of scope.

### Facts (read by the lead on 2026-10-17)
- **The protocol kinds** are in `packages/protocol/src/blocks-choices.ts`:
  - `buttons {id, text, actions[{id, label, style: light|dark}]}` (`:12-37`);
  - `poll {id, question, options[{id, label, votes?}], votes?, multiple?}` (`:41-66`);
  - `choice {id, question, options: string[], selected?: index}` (`:70-80`);
  - `form {id, title?, fields[{id, label, kind: text|number|date, value?}], submit}` (`:83-108`);
  - `rating {id, prompt, max, selected?: index}` (`:111-120`).
  - The checklist is `packages/protocol/src/blocks-progress.ts:6-26`.
- **The route** (`packages/api-contract/src/message-blocks.ts`): the group is `MessageBlocksGroup`, named `'message-blocks'`, with the endpoint `respond`.
  - The payload is `{ messageId, blockId, itemId?, value: { done?, optionIds?, selected?, rating?, actionId?, fields? } }`.
  - The success is `{ data: Unknown }`; decode it with `BlocksDataSchema` from `@zilar/protocol`, and treat a failed decode as an error.
  - The server checks a rating as 1..max and a choice as a 0-based index. A form value is at most 120 characters.
  - Errors: 404 `card_not_found` (also for tool and routine cards, which aren't interactive), 400 `invalid_response`, and 429.
- **The phone API pattern:** `apps/mobile/src/lib/topics-api.ts` builds a client with `createApiClient` (`:12`) and calls `runApi(client.topics.join({ params: { id } }))` (`:233`). `apps/mobile/src/lib/gifs-api.ts:1-25` is a small standalone example.
- **The mount point:** `apps/mobile/src/components/chat/message-bubble-content.tsx:188-197` renders `<PayloadCard card={message.card} footer={…} />`, with `message` and `outgoing` in scope. `apps/mobile/src/components/chat/payload-card.tsx:41` passes only `data` and `footer` to `BlockCard` (`:50`).
- **The @AI reply pattern:** `apps/mobile/src/components/chat/question-card.tsx:16-41`: `useChatStore((state) => state.sendText)`, then `sendText(message.chatId, \`@${aiName} ${option}\`, { replyTo: { id: message.id, senderName: aiName }, mentions: [{ jid, name: aiName, begin: 0, end: aiName.length + 1 }] })`. A message's `senderId` is the sender's JID (`packages/client-core/src/store/ledger-incoming.ts:131`).
- **The router:** `apps/mobile/src/components/chat/blocks/block-card.tsx` (144 lines). `BlockBody({ block, showHeading })` is at `:65-97`, and the `RENDERED` set filters kinds. The checklist is `checklist-block.tsx` (read-only today).
- **The dev catalog:** `apps/mobile/src/mock/dev-blocks-screen.tsx` is 408 lines. Don't grow it past a two-line import-and-render; put the new examples in a new file.

### Steps
1. **`apps/mobile/src/lib/blocks-api.ts`:** `respondToBlock(payload): Promise<BlocksData>`. Call `respond`, then decode `data` with `BlocksDataSchema`; a decode failure rejects.
2. **A `BlockRespond` context**, `{ messageId, chatId, aiName, aiJid }`, in `apps/mobile/src/components/chat/blocks/block-respond.tsx`, provided by `BlockCard` from a new optional `respond` prop.
   - `payload-card.tsx` takes an optional `respond` and passes it to `BlockCard`.
   - `message-bubble-content.tsx` passes `{ messageId: message.id, chatId: message.chatId, aiName: message.senderName, aiJid: message.senderId }`, only when `!outgoing`.
   - With no context (the catalog, own cards), controls are drawn but disabled.
3. **Local state in `BlockCard`:** keep `data` in state, take the route's returned data at once, and reset it to the prop whenever the prop changes (the room correction). A failed call puts the previous data back.
4. **New renderers, routed from `BlockBody` and added to `RENDERED`, each drawn to the phone board:**
   - **`buttons-block.tsx`:** the text, then the keys (light/dark per `style`). After a press, the answered row: green check, "You chose **{label}**" and the time, kept in local state.
   - **`poll-block.tsx`:** the header with the bar-chart icon, the question and "{votes} votes". Then option rows (min 44 px) with the label, the count and a 6 px track.
     - The viewer's option uses the light fill and a check; the others use the dim fill.
     - A tap votes with `optionIds: [id]`; `multiple` toggles; a second tap on the same single option sends `[]`.
   - **`choice-block.tsx`:** the question and the segmented control.
   - **`form-block.tsx`:**
     - an optional header;
     - well inputs, where `number` uses −/+ keys around a centered mono value and `date` is a text input;
     - the light submit key. Each value is capped at 120 characters.
   - **`rating-block.tsx`:** the prompt, then `max` dark square star keys, filled up to the choice.
   - **`checklist-block.tsx`:** each item becomes a `Pressable` that toggles `done`, with `accessibilityRole="checkbox"` and `accessibilityState`. Keep the look and the `by` name.
5. **The calls:**
   - checklist: `{ blockId, itemId, value: { done } }`;
   - poll: `{ blockId, value: { optionIds } }`;
   - choice: `{ blockId, value: { selected } }`;
   - rating: `{ blockId, value: { rating: n } }`, where n is 1..max;
   - buttons: `{ blockId, value: { actionId } }`;
   - form: `{ blockId, value: { fields } }`.
6. **Decision kinds** (buttons, choice, rating, form): after the route succeeds, send the @AI reply as in `question-card.tsx:31-41`, with `jid: aiJid`. The text is the label, the option, "{n}/{max}", or `Label: value` pairs joined with ", ". Checklist and poll send nothing.
7. **The catalog:** a new `apps/mobile/src/mock/dev-choice-blocks.tsx` with every kind (open, and answered or selected), rendered from `dev-blocks-screen.tsx` with one import and one element.
8. **No tests** (UI). Keep every non-mock file at most 400 lines.

### Allowed files
- `apps/mobile/src/lib/blocks-api.ts`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx`
- `apps/mobile/src/components/chat/blocks/block-card.tsx`
- `apps/mobile/src/components/chat/blocks/block-respond.tsx`
- `apps/mobile/src/components/chat/blocks/choice-blocks.tsx`
- `apps/mobile/src/components/chat/blocks/buttons-block.tsx`
- `apps/mobile/src/components/chat/blocks/poll-block.tsx`
- `apps/mobile/src/components/chat/blocks/choice-block.tsx`
- `apps/mobile/src/components/chat/blocks/form-block.tsx`
- `apps/mobile/src/components/chat/blocks/rating-block.tsx`
- `apps/mobile/src/components/chat/blocks/checklist-block.tsx`
- `apps/mobile/src/mock/dev-choice-blocks.tsx`
- `apps/mobile/src/mock/dev-blocks-screen.tsx`
- `work/T-1796-phone-interactive-cards.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- On the phone, every interactive kind is drawn like `PhoneChoices.dc.html` and answers through the route.
- The card updates at once, and again on the room correction.
- Decision kinds send the @AI reply; checklist and poll don't.
- Catalog and own cards are read-only.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/lib/blocks-api.ts`: `respondToBlock` posts the answer through the derived client and decodes `data` with `BlocksDataSchema`; a failed decode rejects as `invalid_response`.
- Added `block-respond.tsx`: the `BlockRespond` context (`messageId`, `chatId`, `aiName`, `aiJid`, plus `submit`/`pending`), the submit types, and the board's key/well/track recipes shared by the five renderers.
- `block-card.tsx`: new optional `respond` prop; `data` is kept in local state, replaced at once by the route's merged card, and reset to the prop whenever the prop changes (the room correction). A failed call restores the previous data. The route call and the @AI reply run through the repo's Effect idiom (`fromApi` + `Effect.runFork`). Interactive kinds are routed from `BlockBody` and added to `RENDERED`.
- New renderers, each drawn to `PhoneChoices.dc.html`: `buttons-block.tsx` (light/dark 40 px keys, answered row with green check and time), `poll-block.tsx` (bar-chart header, question, total, 44 px option rows with counts and 6 px tracks), `choice-block.tsx` (segmented control), `form-block.tsx` (optional header, wells, number −/+, light submit, 120-character cap), `rating-block.tsx` (40 px dark star keys, filled up to the choice). `choice-blocks.tsx` is the group's dispatch point.
- `checklist-block.tsx`: each item is now a `Pressable` with `accessibilityRole="checkbox"` and `accessibilityState`, sending `{ itemId, done }`; the board's look and the `by` name are kept.
- `payload-card.tsx` takes an optional `respond`; `message-bubble-content.tsx` passes `{ messageId, chatId, aiName, aiJid }` only when `!outgoing`, so own cards and the catalog draw the controls disabled.
- `dev-choice-blocks.tsx`: catalog examples for all five kinds (choice and rating in both selected and open states, poll with counts); `dev-blocks-screen.tsx` only gained one import and one element.
- Decision kinds (buttons, choice, rating, form) send the @AI reply after the route succeeds — the label, the option, `n/max`, or `Label: value` pairs joined with ", ". Checklist and poll send no reply.

### Checks run

`pnpm gate` from the repo root (final run):

```
gate: 15 changed file(s) against main
PASS  install (frozen)  (2.1s)
PASS  format  (1.0s)
PASS  lint  (1.1s)
PASS  typecheck  (4.5s)
PASS  effect  (1.2s)
PASS  tests @zilar/mobile  (3.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs to be copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The mobile unit tests ran as part of the gate (`PASS tests @zilar/mobile`). No single test files were run because the spec asks for no tests on this UI work. Earlier gate runs failed on format, then on `react(set-state-in-effect)`, then on a `ViewStyle`/`TextStyle` mismatch and the Effect ratchet; all were fixed before the run above.

### Notes for the lead

- `BlockRespond` carries `submit` and `pending` on top of the four identity fields: the card shell has to own the route call so it can replace `data` with the merged card and roll it back on failure.
- `BlockCard` reads `sendText` from the chat store for the @AI reply. Every card mount is inside `ChatStoreProvider` (the dev catalog sits under the same root layout), so this is safe today; if `BlockCard` is ever rendered standalone it will need a prop instead.
- `PollBlockSchema` has no per-user field, so the viewer's light fill/check in a poll and the buttons answered row are local UI state. A room correction updates the counts but cannot tell the client which option this user picked; the answered row survives corrections but not a remount.
- Components use `fromApi` + `Effect.runFork` instead of async/await to satisfy the Effect ratchet; `blocks-api.ts` still exposes the Promise `respondToBlock` the spec asked for.
- Catalog: buttons and form are shown open (their answered state is local-only), the poll shows its counts, and choice/rating show both selected and open states.
- No tests and no dependencies were added.

### Round (fix round for PREREVIEW)

**Findings fixed**

- **Finding 1 (should-fix):** adopted the server semantics instead of changing the server. The merged `selected` is the raw 1-based `value.rating` (`apps/server/src/message-blocks/apply.ts`, `applyRating`), so `rating-block.tsx` now keeps the tapped rating in local state (`setSelected(rating)`) and fills `rating <= selected`. The optimistic path and the room correction/remount now agree (tap 4 of 5 → 4 stars before and after the correction), and a 5-star rating no longer merges to an out-of-range 0-based index. `blocks-choices.ts` and `apply.ts` are untouched; follow-up F1 is not needed.
- **Finding 2 (nit, same root cause):** `dev-choice-blocks.tsx` "RATING (SELECTED)" now uses `selected: 4` with `max: 5`, so under the adopted 1-based semantics it still shows 4 of 5 and matches its `4 of 5` fallback.
- Findings 3–5 (nits) were left as they are: their lines are not otherwise changed, and each is either a missing affordance or a deliberate serialize-not-queue choice rather than a wrong result.

**Tests added:** none. The finding names no test, and both the spec (step 8, "No tests (UI)") and `AGENTS.md` say UI code gets no tests here. No test files were run on their own for the same reason; the mobile suite ran inside the gate.

**Gate (from the repo root, after the fix):**

```
gate: 15 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.4s)
PASS  lint  (0.8s)
PASS  typecheck  (2.8s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (1.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No disagreements with the findings.

### Round 2 (lead fix round)

- **Re-tap is a no-op:** `rating-block.tsx` and `choice-block.tsx` now return before `respond.submit` when the tapped star or option is already selected, matching the web `RatingBlock` behaviour, so no second @AI reply is posted.
- **The form handles a failed send:** `form-block.tsx` no longer discards the `submit` call; it passes `onSettled`, and on failure shows the fixed line "Could not send. Try again." (the app's existing send-failure sentence). The typed values are kept, and the line clears on the next edit, submit or room correction.
- No tests added: both are UI touches, and the spec's step 8 still says no tests for this work.

`pnpm gate` from the repo root after both fixes:

```
gate: 15 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.5s)
PASS  lint  (0.8s)
PASS  typecheck  (3.1s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (2.3s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs to be copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

## Review (written by Claude)

Merged on code review. Checked on 2026-10-17:
- The packet matches HEAD `1f52f3cfe`, after 2 autopilot rounds and one lead round.
- **Behaviour:**
  - the rating uses the server's 1..max `selected`;
  - a re-tap of the selected rating or option is a no-op, so there's no second @AI reply;
  - a failed form send shows "Could not send. Try again.";
  - `BlockCard` keeps local data and resets on correction;
  - decision kinds send the @AI reply.
- **The branch's mock build predates T-1805,** so `/dev/blocks` couldn't open there. The emulator comparison with `PhoneChoices.dc.html` runs on main right after this merge, and any visual gap becomes a follow-up. Phone code ships only in the next APK.
- **Nits left:**
  - each star reports `checked` up to the choice;
  - other kinds revert silently on failure, unlike the form.

