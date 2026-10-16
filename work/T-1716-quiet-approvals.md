---
id: T-1716
title: "Quieter approvals in the chat (Julio 2026-10-16, approved routines canvas): no separate 'approved …' message after a person approves (the card already shows the result), no 'Approval needed: …' text under the card on web, host names out of the tool-hosts card title, and the routine card titled 'Prices · every 5 minutes'"
status: merged
milestone: M5
branch: task/T-1716-quiet-approvals
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1716: Quieter approval messages

## Spec (written by Claude, do not edit)

### Why
Julio's screenshot of 2026-10-16 10:38 shows three messages for one host approval:
- the card;
- the card's fallback text "Approval needed: Allow the tool "market-prices" to contact: query1.finance.yahoo.com, forex-data-feed.swissquote.com" under it;
- after he approved, a separate "approved market-prices to contact: …" message.

He wants less text and no service URLs. The approved boards (`docs/design/mockups/routines/README.md`) say:
- no "Approval needed: …" text under the card;
- no separate "approved …" message;
- hosts only behind details;
- the routine card shows the title and the schedule.

### Facts (the lead read them on 2026-10-16)
- **The outcome after an approval:** `apps/server/src/actions/queries.ts:328-336` calls `safeAnnounce(deps, { outcome: { …, status: outcome === 'ok' ? 'executed' : 'failed', summary: outcome === 'ok' ? summary : null } })` after the approved action runs. The production announcer posts it as a plain chat message (`apps/server/src/actions/production-announcer.ts:128-146`).
  - The card itself already turns into a one-line decided state (the approvals design, `docs/design/mockups/approvals/README.md`).
- **The host-approval card text:** `apps/server/src/tools/adapter-support.ts:211-217` (`toolApproveHostsAdapter.describe`):
  - `summary: \`Allow the tool "${parsed.name}" to contact: ${hostsLine(parsed.hosts)}\``;
  - `details: \`The tool ${parsed.name} may contact: ${hostsLine(parsed.hosts)}. …\``.
- **The routine card text:** `apps/server/src/tools/routine-adapters.ts:104`, `const summary = \`Schedule "${parsed.title}": ${describeSchedule(parsed.schedule)}\`;`, pinned by `apps/server/src/tools/routine-schedule-prompt.test.ts:108` (`'Schedule "Morning prices": daily at 08:00 Europe/Madrid'`).
- **Web, hiding a card's text:** `apps/web/src/components/message/QuestionCard.tsx:12-14`, `hidesBodyText(card)` returns true for `'question'` and `'progress'`. `MessageBubble.tsx:128` uses it.
  - The **phone** already shows only the card for a rendered card (`apps/mobile/src/components/chat/message-bubble-content.tsx:182-195`), so no phone change is needed.

### Steps
1. **`queries.ts:328-336`:** announce only a **failed** outcome; an `ok` outcome posts nothing, because the card shows it. Add a short comment naming this task. Leave the cancelled path (`:48`) and the auto-approve path (`apps/server/src/actions/decisions.ts:221`, which has no card) unchanged.
2. **`adapter-support.ts:215`:** set the summary to `` `Allow "${parsed.name}" to use the web` `` and keep `details` unchanged, so the hosts stay in the details only.
3. **`routine-adapters.ts:104`:** set the summary to `` `${parsed.title} · ${describeSchedule(parsed.schedule)}` ``, and update the one assertion at `routine-schedule-prompt.test.ts:108` to `'Morning prices · daily at 08:00 Europe/Madrid'`.
4. **Web `QuestionCard.tsx`:** `hidesBodyText` also returns true for `'approval.request'`. Update its doc comment.
5. **No new tests.** Run the files below.

### Allowed files
- `apps/server/src/actions/queries.ts`
- `apps/server/src/tools/adapter-support.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `apps/server/src/tools/routine-schedule-prompt.test.ts`
- `apps/web/src/components/message/QuestionCard.tsx`
- `work/T-1716-quiet-approvals.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/tools/routine-schedule-prompt.test.ts src/actions/args-example.test.ts src/actions/unattended.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **After a person approves,** no extra "approved …" message is posted; a failure still is.
- **The web bubble** shows only the approval card.
- **The host card** reads `Allow "<name>" to use the web`.
- **The routine card** reads `<title> · <schedule>`.

---

## Report (written by the worker when done)

### What I did

1. **`apps/server/src/actions/queries.ts`** — the post-approval `safeAnnounce` now runs only
   when the action failed (`outcome !== 'ok'`). On success nothing is posted, because the
   approval card already shows the decided state. Added a comment naming T-1716. The
   outcome object keeps `status: 'failed'` and `summary: null`. The cancelled path (`:48`)
   and the auto-approve path (`decisions.ts:221`) are untouched.
2. **`apps/server/src/tools/adapter-support.ts`** — `toolApproveHostsAdapter.describe`
   summary is now `Allow "${parsed.name}" to use the web`; `details` is unchanged, so the
   hosts stay in the details only.
3. **`apps/server/src/tools/routine-adapters.ts`** — the routine card summary is now
   `${parsed.title} · ${describeSchedule(parsed.schedule)}`.
4. **`apps/server/src/tools/routine-schedule-prompt.test.ts`** — updated the single
   assertion to `'Morning prices · daily at 08:00 Europe/Madrid'`.
5. **`apps/web/src/components/message/QuestionCard.tsx`** — `hidesBodyText` now also
   returns true for `'approval.request'`, and its doc comment mentions the approval card
   (T-1716).

No new tests were added (per the spec). No files outside the Allowed list were touched.

### Checks run

```bash
pnpm --filter @zilar/server exec vitest run src/tools/routine-schedule-prompt.test.ts src/actions/args-example.test.ts src/actions/unattended.test.ts --maxWorkers=2 --reporter=dot
```
→ `Test Files 3 passed (3)`, `Tests 26 passed (26)`.

```bash
pnpm gate
```
→ GATE PASS, with these summary lines:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.9s)
PASS  typecheck  (4.9s)
PASS  effect  (0.9s)
PASS  tests @zilar/server  (13.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
The 6 changed files are the 5 source files above plus this task file — all inside the
Allowed files. The `@zilar/web` tests were skipped because there are no nearby test files
for `QuestionCard.tsx` (UI gets no unit tests).

### Notes for the lead

- The acceptance criteria are implemented as specified; the visible behaviour (web shows
  only the card, host/routine card titles, no success announcement) was not exercised in a
  running app, only by the unit tests and the gate.
- `announce.ts:62` still builds `Approval needed: …` for the card-message body. The web now
  hides that body text for `approval.request` cards, which is what the spec asked for, so I
  left `announce.ts` unchanged (it is not in the Allowed files).
- `adapter-support.ts:243` still returns `approved <name> to contact: <hosts>` as the
  adapter's *result* summary. With step 1 it is no longer posted on success; it still flows
  into the persisted outcome. The spec did not ask to change it, so I left it.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 0 nits.
- **The diff is exactly the four steps:**
  - an approved action's success posts no outcome message, while a failure still does;
  - the host card reads `Allow "<name>" to use the web`;
  - the routine card reads `<title> · <schedule>`;
  - web `hidesBodyText` covers `approval.request`.
- **Left alone on purpose:** the result summary at `adapter-support.ts:243` still names the hosts, but it only reaches the stored outcome and the model, never the chat.
