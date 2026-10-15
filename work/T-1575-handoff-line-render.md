---
id: T-1575
title: "Handoff step 2 (plan docs/audit/handoff-questions-plan.md, twins): web and phone render a 'handoff.line' card as the board's small centred line (from orb → to orb · task) in place of the bubble; tapping it shows the full reply bubble; a mock example in the Dev team General thread"
status: merged
milestone: M5
branch: task/T-1575-handoff-line-render
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1575: The handoff line on web and phone

## Spec (written by Claude, do not edit)

### Why
T-1572 made AI replies that hand work to another AI carry a `handoff.line` payload `{ from, to[], task }` (`packages/protocol/src/handoff-line.ts`). The approved boards draw it as a small centred line between messages:
- `docs/design/mockups/ai-work/Main.dc.html:103-108`: 13 px, `#a1a1a1`, gap 8;
- `Phone.dc.html:53-59`: 14 px;
- each shows the sender's 16 px orb, an arrow icon, the target's 16 px orb, then the task text.

The plan is `docs/audit/handoff-questions-plan.md` §2, and the lead's answers are in `work/T-1566-audit-handoff-questions.md` › Review.

### Facts (the lead read them on main after T-1572, 2026-10-15)
- **Clients:** they store any non-voice, non-attachment payload as `message.card` (`packages/client-core/src/store/ledger-incoming.ts:191-203`).
- **Web:**
  - `apps/web/src/components/MessageListRow.tsx:81-100` renders each message with `<MessageBubble …/>`;
  - `MessageBubble.tsx` is 367 lines, so **do not grow it much**: put the line in a new file;
  - `apps/web/src/components/message/AttachmentBody.tsx:245-255` draws only `progress` and `approval.request` cards and still shows the text.
- **The phone:**
  - `apps/mobile/src/components/chat/message-bubble.tsx` (355) picks the bubble kind; a sticker renders without a bubble (`stickerOf`, `:151`, `StickerBubble`, `:219`);
  - `apps/mobile/src/components/chat/payload-card.tsx` has `isRenderedCard` (`progress`, `approval.request`) from T-1572; its comment wrongly names `attachment-body` instead of `message-bubble-content.tsx:182`.
- **Avatars:**
  - web `EntityAvatar` / phone `EntityAvatar`, kind `ai`, seeded by the AI's display name (memory: the orb is seeded by name; pass the real picture URL);
  - the names come from the chat's members or AI list for the JID.
- **The mock:** `packages/mock-backend/src/domains/messages/builders.ts` has `progressCard(...)` (`:76`) and `approvalCard()` (`:110`). The Dev team General thread is `packages/mock-backend/src/domains/messages/threads/dev-team.ts`, which seeds progress cards at `:17` and `:24`.

### Steps
1. **Mock:**
   - `builders.ts` gains `handoffLine(from, to, task)`, which returns the `handoff.line` payload;
   - `dev-team.ts` gains one Dev-1 message after its cards: text `@QA-1 check it on an iPhone` with a mention of QA-1, and payload `handoffLine(JIDS.dev1, [JIDS.qa1], 'check it on an iPhone')`. Use the real JID constant names in the mock.
2. **Web:** new `apps/web/src/components/message/HandoffLine.tsx`, the board's centred line:
   - the `from` orb (16 px), a lucide `ArrowRight` (14 px, muted), the `to` orbs (16 px each), then the task text (13 px, muted, one line, ellipsis), with `role="note"` and `aria-label` "<From> handed off to <To>: <task>";
   - in `MessageListRow.tsx`, a message whose `card.type === 'handoff.line'` renders `HandoffLine` instead of `MessageBubble`;
   - clicking the line toggles the full `MessageBubble` under it.
3. **The phone:** new `apps/mobile/src/components/chat/handoff-line.tsx` (14 px), the same line and the same toggle on press.
   - `message-bubble.tsx` renders it instead of the bubble for `handoff.line`, the same way the sticker path skips the bubble.
   - Fix the `payload-card.tsx` comment.
4. **An empty task** shows only the orbs and the arrow.
5. **Every file stays under 400 lines.**

### Not in scope
- the server;
- questions;
- `delegate`-only handoffs.

### Tests
None (UI).

### Allowed files
- `packages/mock-backend/src/domains/messages/builders.ts`
- `packages/mock-backend/src/domains/messages/threads/dev-team.ts`
- `apps/web/src/components/message/HandoffLine.tsx` (new)
- `apps/web/src/components/MessageListRow.tsx`
- `apps/mobile/src/components/chat/handoff-line.tsx` (new)
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/payload-card.tsx`
- `work/T-1575-handoff-line-render.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Web mock `/c/dev-team%40rooms.zilar.test?mock=1`:** a centred line "[Dev-1 orb] → [QA-1 orb] check it on an iPhone", and no bubble for that message.
- **The phone mock** shows the same in Dev team General.

---

## Report (written by the worker when done)

### What I did
- **Mock** (`packages/mock-backend/src/domains/messages/`):
  - `builders.ts`: added `handoffLine(from, to, task)` returning the `handoff.line` payload.
  - `threads/dev-team.ts`: imported `handoffLine`; added one Dev-1 message (`dev-33`, at `ago(3, 9, 15)`, between the two progress cards and `dev-7`) with body `@QA-1 check it on an iPhone`, a QA-1 mention (`begin: 0, end: 5`), and `payload: handoffLine(JIDS.dev1, [JIDS.qa1], 'check it on an iPhone')`.
- **Web:**
  - New `apps/web/src/components/message/HandoffLine.tsx`: the centred line — the `from` 16 px `EntityAvatar` (`ai`), a muted lucide `ArrowRight` (14 px), each `to` 16 px orb, then the 13 px one-line ellipsised task. `role="note"` and `aria-label` `<From> handed off to <To>: <task>` (the `: <task>` is dropped when the task is empty, so an empty task shows only the orbs and the arrow). Names resolve from the chat's members, then contacts/AI list, then AI chat rows, then the JID localpart; `avatarUrl` comes from the contact or chat row.
  - `MessageListRow.tsx`: a message whose `card.type === 'handoff.line'` renders `HandoffLine` instead of `MessageBubble`; clicking it toggles the full `MessageBubble` under it. The bubble element was hoisted to a `const bubble` so the props are not duplicated.
- **Phone:**
  - New `apps/mobile/src/components/chat/handoff-line.tsx`: the same line at 14 px with a `Pressable` toggle; names resolve from `groupMembers(chatId)`, the contacts list and the AI chat rows, resubscribing via `groupDetailsRevision` so a late group-detail load updates the names.
  - `message-bubble.tsx`: hoisted the bubble column into `const bubbleColumn`; a `handoff.line` card renders the centred `HandoffLine` (skipping the big avatar slot) with the same toggle, and the bubble renders below it when open. Added `handoff` detection and a `handoffOpen` state.
  - `payload-card.tsx`: fixed the stale comment to name `message-bubble-content.tsx:182` instead of `attachment-body`.
- Every touched file is under 400 lines (`message-bubble.tsx` is 377).

### Checks run
- `pnpm install` — ok.
- `pnpm exec prettier --write` on the seven changed source files (my files only), so the gate's format check would pass; two were reformatted, the rest unchanged.
- `pnpm gate` (first run) — `FAIL lint`: `apps/mobile/src/components/chat/handoff-line.tsx:4:21 eslint(no-unused-vars): Identifier 'View' is imported but never used`. Removed the unused import.
- `pnpm gate` (after the fix): **GATE PASS**. Summary lines:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (6.3s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/mobile  (2.0s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No separate single test files were run: the spec says "Tests: None (UI)", and the gate found no nearby test files for the two changed apps/packages.

### Notes for the lead
- The spec asked for `role="note"` on the web line; I put it on a `<button type="button">` so the line is still keyboard-focusable and clickable while carrying the requested role/label.
- The board mockups only show one target orb; the code renders `card.to` generically (the schema allows up to two) and joins two target names with `, ` in the aria-label.
- I did not add tests (UI, per spec) and did not touch the server, questions or `delegate` handoffs (out of scope).
- The acceptance is visual against the mocks (`/c/dev-team%40rooms.zilar.test?mock=1` and the phone Dev team General); I could not run those here, so the lead's smoke / Julio's live check still has to confirm the rendered line.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 2 nits.
- **Web, headless** (`/c/dev-team%40rooms.zilar.test?mock=1`, at 1280 and 390 px):
  - one centred line "[Dev-1 orb] → [QA-1 orb] check it on an iPhone", with no bubble for that message;
  - its label is "Dev-1 handed off to QA-1: check it on an iPhone";
  - a click shows the full "@QA-1 check it on an iPhone" bubble under it;
  - no sideways scroll, and 0 page errors.
  - At rest it matches the board: muted text, no background.
- **Phone smoke** (`/chat/dev-team@rooms.zilar.test`): PASS. The handoff message (02:10) sits above the first screen, which the smoke can't scroll to, so the lead read the phone line in code: a button role with the same label, 16 px orbs, `ArrowRight`, the task in 14 px muted text on one line, and a press that toggles the full bubble.
- **Nits:**
  - **Nit 1 (web):** `role="note"` on the `<button>` hides that it is pressable. It goes into the step-5 web task (drop the role and add `aria-expanded`).
  - **Nit 2:** keys on duplicate JIDs; the schema makes it unlikely.

