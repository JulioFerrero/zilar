---
id: T-1279
title: "AI progress cards render as empty bubbles (only a time) on web and mobile: find where the progress payload is lost between the message and the card components, and fix it in the shared code"
status: merged
milestone: M5
branch: task/T-1279-progress-card-empty
model: auto
effort: default
depends_on: [T-1278]
estimate: 0.2 day
---

# T-1279: Progress cards show as empty bubbles

## Spec (written by Claude, do not edit)

### Why
What the lead saw on 2026-10-12, in the mocks:
- **Mobile, Dev AI chat:** the message `dai-2` (`packages/mock-backend/src/domains/messages/threads/dev-ai.ts:9`, `payload: progressCard({ stage: 'Reading pull requests' })`) renders as an empty bubble with only its time (15:33).
- **Web, Dev team › General:** the Dev-1 messages between "Repro steps are in the ticket." and "Found it: the sticky footer…" (and others) render as empty bubbles with only "Dev-1 #2" and a time.

**Both apps have a progress card:**
- web `apps/web/src/components/ProgressCard.tsx`, used at `apps/web/src/components/message/AttachmentBody.tsx:233` (`message.card.type === 'progress'`);
- mobile `apps/mobile/src/components/chat/progress-card.tsx`, used through `PayloadCard` (`apps/mobile/src/components/chat/payload-card.tsx:24-31`) from `apps/mobile/src/components/chat/message-bubble-content.tsx:86-88` (`message.card ? …`).

So the card is most likely lost before rendering: `message.card` is empty, or it doesn't match where the components look. The progress builder is `packages/mock-backend/src/domains/messages/builders.ts:75`.

### What to build
1. **Find the cause.** Trace the progress payload from the stanza through xmpp-core decode, chat-core/client-core `toUiMessage`, to `message.card` in each app. Cite each step with `file:line` in the Report. If the bubbles are empty on purpose (for example a finished progress card hidden once a later reply arrives), say where that's decided. In that case, hide the whole bubble rather than leaving an empty one.
2. **Fix it at the source,** in shared code if possible, so both apps show the card (stage text, spinner or progress) or show nothing, never an empty bubble.
3. **Test** (the message pipeline), 1 case at the step where it was lost: a progress payload reaches `UiMessage.card`, or is dropped by the rule you cite.
4. Keep every file at most 400 lines.

### Read first
`AGENTS.md`, the files cited above, `packages/protocol/src/payload.ts` and the `toUiMessage` implementation (find it).

### Allowed files
`packages/chat-core/src/**/*.ts`, `packages/client-core/src/**/*.ts`, `packages/xmpp-core/src/**/*.ts`, `packages/mock-backend/src/domains/messages/**/*.ts`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/ProgressCard.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/components/chat/payload-card.tsx`, `apps/mobile/src/components/chat/progress-card.tsx`, `work/T-1279-progress-card-empty.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock and the emulator:** the Dev AI and Dev team › General progress messages show their stage text (or no bubble at all), never an empty bubble.

---

## Report (written by the worker when done)

### Cause

The payload survives the whole pipeline and is dropped in `toUiMessage`: it copied
only three payload kinds onto the stored `UiMessage`, and `progress` was not one
of them, so `message.card` stayed `undefined` and both apps rendered a bubble with
no content (just sender/time).

Trace (`file:line`):

1. Seed: `packages/mock-backend/src/domains/messages/threads/dev-ai.ts:9` — `payload: progressCard({ stage: 'Reading pull requests' })`.
2. Builder: `packages/mock-backend/src/domains/messages/builders.ts:75-92` — returns `{ v: 0, type: 'progress', data: { ai, stage } }`.
3. Seed → `ChatMessage`: `packages/mock-backend/src/domains/messages/seed.ts:32` copies `seed.payload` into the message.
4. Mock history: `packages/mock-backend/src/xmpp/core.ts:224-227` (`loadHistory` → `historyPage`) returns those `ChatMessage`s with `payload` intact.
5. Real stanzas (not the mock) take the wire path instead: `packages/xmpp-core/src/stanza/decode.ts:83-90` decodes the `<agent>` child with `decodePayload` and sets `message.payload` at `:118`; `decodePayload` is `packages/protocol/src/payload.ts:80-118`.
6. Client ingest calls `toUiMessage` in both paths: `packages/client-core/src/store/history.ts:151` (also `:198`, `:275`) and `packages/client-core/src/store/incoming.ts:118`.
7. **Bug (found here):** `packages/client-core/src/store/ledger-incoming.ts:139-152` (before the fix) set `ui.voice` for `voice`, `ui.attachment` for `attachment`, and `ui.card` **only for `sticker`**. A `progress` (or `approval.request`) payload matched no branch, so `ui.card` was never set.
8. Web: `apps/web/src/components/message/AttachmentBody.tsx:231-241` renders a card only when `message.card !== undefined`; with it undefined the meta block at `:243-252` (`!hasText && (voice || card || attachmentFile)`) is skipped too, leaving an empty bubble.
9. Mobile: `apps/mobile/src/components/chat/message-bubble-content.tsx:86-95` renders `PayloadCard` only when `message.card` is truthy; otherwise it falls to `PlainBubbleBody` with no text → the empty bubble (sender header + time only).

The empty bubbles are **not** intentional. There is no rule that hides a finished
progress card once a later reply arrives. The only nearby `progress` check is
`packages/client-core/src/store/incoming.ts:166-168`, which only decides whether
an AI message ends the live draft (`finishesDraft`); it never drops the payload.

### Fix (shared code, `packages/client-core`)

`toUiMessage` now maps the payload the same way the optimistic send/forward path
already does in `packages/chat-core/src/store/ledger.ts:27-37`
(`forwardedUiFieldsFor`): `voice` → `ui.voice`, `attachment` → `ui.attachment`,
**every other payload → `ui.card`**. So a received `progress`/`approval.request`
card now lands on `message.card`, which is exactly where both renderers look
(web `AttachmentBody.tsx:233-234`, mobile `payload-card.tsx:24-28`), and its own
echo lands on the same field. Sticker behaviour is unchanged.

### Test

Added one pipeline case to `packages/client-core/src/store/ledger.test.ts`:
"keeps a received progress payload on UiMessage.card" — feeds a `progress`
stanza through the ledger's `receive`/`toUiMessage` and asserts
`message.card` equals the payload and `text` is undefined. This is the step where
the payload was lost.

### Files changed

- `packages/client-core/src/store/ledger-incoming.ts` — the fix (185 lines).
- `packages/client-core/src/store/ledger.test.ts` — the test.
- `work/T-1279-progress-card-empty.md` — this task file.

### Commands and results

- `pnpm install` — done in 10.7s (pre-existing peer warning: `@types/react-dom 19.3.0` wants `@types/react ^19.3.0`, found 19.2.18; unrelated to this task).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/ledger.test.ts` → `1 passed (1)`, `Tests 15 passed (15)` (14 before, +1 new).
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.4s)
  PASS  typecheck  (2.8s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/client-core  (4.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Notes / deviations

- None from the spec. The test file `ledger.test.ts` is over 400 lines, but its
  line count predates this task (453 before) and the repo lint config turns
  `max-lines` off for `**/*.test.ts` (`.oxlintrc.json:22-37`); the non-test file I
  touched is 185 lines.
- Following `forwardedUiFieldsFor`, payload types neither app renders
  (`task`, `poll`, `cost`, …) would now also become `message.card`; none of those
  exist in the seed, and the outgoing/forwarded path already behaves this way. No
  open question.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (0 nits).**
- **The cause:** `toUiMessage` (`packages/client-core/src/store/ledger-incoming.ts:139-152`) copied a card only for stickers, so `progress` and `approval.request` payloads from history and live stanzas never reached `message.card`. The fix maps them like the send path does, with 1 test.
- **Lead's check on the web mock:** Dev team › General now shows "Cloning repository" (with its detail line) and "Running tests" (with its bar) where empty bubbles were.
- Mobile reads the same `message.card` through `PayloadCard`; it wasn't rechecked on the emulator.
- **Lead's checks after the rebase:** client-core 136 passed; tsc on web and mobile: 0 errors.
- **Note:** approval cards from history also render again now. That's worth a look on Julio's real AI chats.
