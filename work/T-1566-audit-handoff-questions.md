---
id: T-1566
title: "Audit + step plan: handoff lines and question reply chips (approved AI work boards): how a handoff from one AI to another can render as a small 'Dev-1 → QA-1 · <task>' line, and how an AI can ask people a question with reply chips that marks it 'waiting for you'; write docs/audit/handoff-questions-plan.md (no code)"
status: merged
milestone: M5
branch: task/T-1566-audit-handoff-questions
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1566: Audit — handoff lines and question chips

## Spec (written by Claude, do not edit)

### Why
Julio approved the AI work boards on 2026-10-15 (`docs/design/mockups/ai-work/README.md`, `Main.dc.html`, `Phone.dc.html`, `PhoneSheet.dc.html`). Two pieces are not built yet:
- a **handoff line**, "Dev-1 → QA-1 · Check it on an iPhone", when one AI hands work to another;
- **QA-1's question with reply chips.** An open question also makes the AI "waiting for you" (amber dot), like a pending approval, and the "AIs here" sheet has a row that opens it.

`docs/audit/ai-work-plan.md` §2 and §3 found:
- a handoff today is only an `@nick` with mention metadata in the AI's reply (`group-turn.ts` `wire()`, `group-ingest.ts` hop budget);
- **a question to people does not exist.**

This task writes the plan. **No code.**

### What to find (cite `file:line` for every claim; write "not found" when absent)
1. **Handoff data:**
   - where an AI's reply that hands off is built (`apps/server/src/agents/gateway/group-turn.ts`, `apps/server/src/agents/handoff.ts`);
   - what the stanza carries (body, mentions, any marker);
   - how `group-ingest.ts` decides an AI-to-AI handoff;
   - how `apps/server/src/agents/delegation/service.ts` (`createDelegation`, the `delegate` tool) relates;
   - whether a client can tell a handoff from a normal mention today.
2. **The smallest handoff line:**
   - which option is smallest and safe:
     - (a) a client-side rule (an AI message whose mentions include another AI in the room renders as a line);
     - (b) a stanza marker (an extension element or a field in the existing AI card payload);
     - (c) a delegation event card;
   - where the "· <task>" text would come from;
   - name the exact web and phone render points (`apps/web/src/components/MessageBubble.tsx` or `message/*`, `apps/mobile/src/components/chat/*`).
3. **Questions:**
   - how an AI tool is defined, registered and run (the tool registry, `apps/server/src/tools/*`, `apps/server/src/agents/*`), and how the approval card (`approval.request`) is sent and decided, as the closest model;
   - propose an `ask_people` tool: question text, 2–4 short options, and a free reply still allowed.
   - **Storage:** a new table or reuse of `approvals`; say which and why.
   - **The answer path:** a chip tap sends a normal message (quoting the question) or an API call, and how the AI's next turn receives it.
   - **When it is open or closed:** answered, a person replied in the topic, it expired, or the turn ended.
4. **"Waiting for you":** how `apps/server/src/topics/ai-activity.ts` would add "has an open question" next to the pending approval, and how clients refresh. T-1528 refreshes the topic list when an AI card starts, ends or asks: `packages/client-core/src/store/activity-refresh.ts`, called from `incoming.ts`. Say whether a question message triggers it.
5. **The "AIs here" sheet row that opens the question:** web `apps/web/src/components/topic/*` and phone, using the existing jump-to-message (`openAtMessage`).
6. **Files near 400 lines** that the steps would touch, each with its line count and a split to do first.

### Output
`docs/audit/handoff-questions-plan.md`:
- the sections above with citations;
- a **step plan of at most 8 tasks** in order, each with: its title, the exact files, migration yes/no, the surface (server, contract, web, phone), and an estimate in worker minutes;
- **web and phone twins in the same batch;**
- an "Open questions for the lead" list.

**D24 rules:** a status is an icon, never a word; no money; no model-call rows.

### Allowed files
- `docs/audit/handoff-questions-plan.md` (new)
- `work/T-1566-audit-handoff-questions.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan exists. Every claim has a `file:line` or "not found", and the step plan is at most 8 tasks.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/handoff-questions-plan.md` (new, no code). It audits the two
unbuilt pieces of the approved AI work boards and plans them:

- **Handoff data** (§1): traced the reply builder `wire()`
  (`apps/server/src/agents/group-turn.ts:144-174`), `findHandoffIndex`
  (`apps/server/src/agents/handoff.ts:9-22`), the sending options
  (`packages/xmpp-core/src/types.ts:195-207`, no payload set), the reverse
  detection and hop budget in `group-ingest.ts:161-192` /
  `contracts.ts:126-128`, and `delegation/service.ts:161-225` +
  `tool-exec.ts:230-269`. Confirmed the protocol's `handoff` payload
  (`packages/protocol/src/handoff.ts:4-18`, `payload.ts:17`) is never sent or
  rendered, and that a client can only infer a handoff (no marker) — both
  "not found".
- **Smallest handoff line** (§2): compared (a) a client-only rule, (b) a stanza
  marker and (c) a delegation event card; recommend **(b)**, with the exact web
  and phone render points (`AttachmentBody.tsx:245-255`,
  `message-bubble-content.tsx:182-191`, `payload-card.tsx:22-32`) and the
  "· \<task\>" source (reply text after the mention, or
  `ai_delegations.objective`).
- **Questions** (§3): mapped the model-facing tool path
  (`agents/tools/*`, `gateway/tool-exec.ts`, `gateway/request-action.ts`) versus
  the user-authored `apps/server/src/tools/*` store; used `approval.request` as
  the closest model (`announce.ts:69-97`, `approval-path.ts:160-172`,
  `approvals/api.ts:142-177`, `service.ts:170-364`); proposed an `ask_people`
  tool; recommend a **new `ai_questions` table** (not `approvals`) with a
  migration; the answer path is a **normal quoting message**; gave the
  open/closed rules.
- **"Waiting for you"** (§4): how `ai-activity.ts` (`:69-76,241-267`) would add
  a second `waiting` source, and that a question message **does not** trigger
  `isAiActivityMessage` today (`activity-refresh.ts:31-40`, `incoming.ts:102`).
- **"AIs here" row** (§5): web `AisHereKey.tsx:123-134` and phone
  `ais-here-sheet.tsx:62-74,119-122` today open `/settings/approvals`; both
  should use `openAtMessage` (`store.ts:147`, `history.ts:89-95`), and the
  activity entry needs the question's message id.
- **Near-400 files** (§6) with line counts and split advice (top:
  `group-turn-body.ts` 395 — split first).
- **Step plan** (§7): 8 tasks in order, web+phone twins in the same batch
  (tasks 2, 5, 8), each with files, migration yes/no, surface and estimate.
- Open questions for the lead (§8) and a D24 check (§9).

Every claim in the doc carries a `file:line` or "not found". I changed only the
two Allowed files.

### Checks run

- `pnpm install`: done (14.4s, 1137 packages; one pre-existing peer warning
  `@types/react` in `apps/mobile`).
- `pnpm gate` (from repo root), real output:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.5s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- The 2 changed files are `docs/audit/handoff-questions-plan.md` (new) and
  `work/T-1566-audit-handoff-questions.md` (report/front matter) — both Allowed.
- No package tests were run: this task touches no source, so `pnpm gate` had no
  nearest tests to run.

### Notes for the lead

- This is a docs-only task; no code, no migration, no test was needed.
- The plan is written against the current tree (T-1505/T-1514/T-1528/T-1532/
  T-1539 are already landed), so it cites the built read model
  (`ai-activity.ts`) rather than the older `ai-work-plan.md` proposal. Line
  counts differ from that plan (e.g. `chats/api.ts` is 102 lines now, not 391).
- The main decision left to you is §8: handoff option (a) vs (b), and the
  answer path (message vs API route). I recommend (b) and the message path.
- Verified absences: no `ask_people`/`ask_user`/question table/elicitation
  anywhere; `handoff`, `poll`/`poll.vote` and `task`/`board.update` payloads are
  defined in `packages/protocol` but never sent or rendered (only
  `payload.test.ts` references them).

### Round (pre-review fixes)

Findings from `PREREVIEW.md`: must-fix=0, should-fix=2, nit=1.

Fixed, one commit each, both in `docs/audit/handoff-questions-plan.md`:

- **Finding 1 (should-fix)** — §1c cited `group-turn.ts:133-145`, which is a
  prose comment block in `apps/server/src/agents/group-turn.ts`. Corrected to
  `apps/server/src/agents/gateway/group-turn.ts:131-147`, where the AI-sender
  handoff gate actually lives (verified: the `for` loop starts at :131 and the
  `item.handoff !== true` check is at :137). Commit `6ed77d56`.
- **Finding 2 (should-fix)** — §5 cited the `openAtMessage` core at
  `packages/client-core/src/store/history-core.ts:263`; that file is 119 lines.
  Corrected to its sibling `packages/client-core/src/store/history.ts:263`
  (verified: `export const openAtMessage = (` is on that line). Commit
  `6b237fd5`.

Not touched: **finding 3 (nit)** — the §0 "Only `payload.test.ts` references
them" wording. It is not on a line either other fix changes, so per instructions
it was left as is. (The nit does not change the "never sent or rendered"
conclusion.)

Tests added: none. This is a docs-only task; both findings are wrong-file
citation fixes with no code change and no test named, so no test applies.

`pnpm gate` (from repo root), real output:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (1.4s)
PASS  lint  (1.1s)
PASS  typecheck  (1.0s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Disagreements

None.

## Review (written by Claude)

**Approved and merged.** The plan is `docs/audit/handoff-questions-plan.md`.

- **Pre-review:** clean after one autopilot round (two citation fixes), with 2 nits.
- **The lead's own check:** `wire()` at `apps/server/src/agents/group-turn.ts:144-174` appends up to two handoff mentions found by `findHandoffIndex`, and nothing marks them. `group-turn-body.ts` is 395 lines. `packages/protocol/src/handoff.ts` and `poll.ts` exist and are unused.

**The lead's answers to §8.** These are technical, or follow from the approved boards; Julio can override any of them.
1. **A server-set marker (b),** not a client rule. A client rule would turn every AI-to-AI mention into a handoff.
2. **Both sources are handoffs:**
   - **a `delegate` call:** the task text is `ai_delegations.objective`;
   - **a reply where `wire()` attached a handoff mention:** the task text is the reply text without the leading `@sender`, cut to one line.
   - The line takes the place of the bubble: the AI's picture, its name, a lucide arrow, the target's name, then "· <task>" (`Main.dc.html`). The full text stays readable on tap.
3. **A new `ai_questions` table.** Do not reuse `approvals`.
4. **A chip tap sends a normal message:** `replyTo` is the question, with an `@` mention of the asking AI. No new route.
5. **Who may answer:** anyone who can post in the topic. A question to people is not a permission.
6. **When a question closes:** the first message that replies to it (chip or typed), or after 24 h. The asking AI's turn ending does **not** close it, because the AI is waiting. Later replies are ordinary messages.
7. **`TopicAiActivity` carries the question's `messageId`,** so the "AIs here" row can open it with `openAtMessage`.
8. **Topics only for now** (`buildGroupTools`). DMs come later, if Julio wants them.

**Order:**
- `group-turn-body.ts` is split first, then step 1 → step 2.
- Step 3 (the migration) can run beside step 1 (it is the only schema task);
- then 4 → 5 → 6, then 7 → 8.
- Web and phone twins go in the same batch.
