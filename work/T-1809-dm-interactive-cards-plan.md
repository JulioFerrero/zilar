---
id: T-1809
title: "Plan only: interactive cards in an AI's DM with its owner — how a DM card gets recorded, found by the id the owner's client sends, answered and corrected; write docs/plan/dm-interactive-cards.md with ordered tasks"
status: merged
milestone: M5
branch: task/T-1809-dm-interactive-cards-plan
model: auto
effort: default
depends_on: [T-1800, T-1803]
estimate: 40 min
---

# T-1809: Plan for interactive cards in DMs

## Spec (written by Claude, do not edit)

### Why
An AI can post a card in its owner's DM (T-1800), but it stays read-only. T-1803 refuses interactive kinds there because three things are missing:
- the DM card isn't recorded;
- the id the owner's client sends may not match any stored key;
- the correction path is groupchat-only.

The owner talks to their AI mostly in the DM, so a checklist or choice there is useful. This task only writes the plan; no code changes.

### Facts (read by the lead on 2026-10-17)
- **The group path:**
  - `apps/server/src/agents/gateway/post-blocks.ts` sends the card (`:56-57`) and records it only for `groupchat` (`:133-140`) via `recordPosted` (`:66-84`), keyed by the gateway's origin id.
  - `apps/server/src/agents/gateway/card-rekey.ts` (49 lines) re-keys the row to the room's archive stanza id when the room reflects the AI's own message (`group-ingest.ts:118`), because group clients quote the stanza id.
- **Answering:**
  - `apps/server/src/message-blocks/respond.ts` (280 lines), `requireCardAccess` `:64-88`, allows topic or group cards only, and anything else is 404.
  - The answer is applied, saved and corrected through `correctInRoom` (`apps/server/src/agents/gateway/live.ts:339-372`), which needs `session.rooms.has(roomJid)` and sends `groupchat`.
- **Storage:** `apps/server/src/message-blocks/cards.ts` (210 lines), the `block_cards` and `block_responses` tables.
- **A DM has no room reflection:** the AI's outgoing chat message isn't echoed back with a stanza id the way MUC does. The owner's client gets the message with the id that its own server archive assigns.
- **Question cards** (`apps/server/src/questions/service.ts`, `agents/gateway/question-answer.ts`) solved a similar re-key for rooms. Check whether they work in DMs and how.

### Steps
1. **Read** the code paths above and the client side:
   - which id web and phone send to the respond route for a message (`apps/web/src/components/message/blocks/BlockCard.tsx`, `apps/mobile/src/components/chat/blocks/block-card.tsx`), and which id a DM message carries on each client (MAM stanza id, origin id or message id, in `packages/xmpp-core`);
   - write down, with `file:line`, which id the server can match for a DM card.
2. **Write `docs/plan/dm-interactive-cards.md`:**
   - **The id problem and the options:** record under the origin id and have clients send `originId` for DM cards; or have the gateway read the owner's archive id back; or something else. Recommend one, with the reason.
   - **Access:** only the DM's two parties may answer, the owner and that AI. Where the check lives.
   - **The correction:** a `chat`-type correction to the owner (does `sendCorrection` work for `chat`, and does each client apply a DM correction to a card?).
   - **The answer path:** decision kinds already send an @AI reply from the client. In a DM that's a plain message, with no mention needed. What changes.
   - **Ordered tasks** (server, web, phone; one schema task at most), each with its files and a one-line acceptance.
   - **Open questions** for Julio, if any.
3. **No code changes.** Keep the doc to about 250 lines.

### Allowed files
- `docs/plan/dm-interactive-cards.md`
- `work/T-1809-dm-interactive-cards-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan cites `file:line` for every claim and recommends one id approach.
- It lists ordered tasks with their files.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Read the full task and `AGENTS.md`, then the group-card path
  (`post-blocks.ts`, `card-rekey.ts`, `group-ingest.ts`), the answer path
  (`respond.ts`, `cards.ts`, `live.ts`), the question-card path
  (`questions/service.ts`, `question-answer.ts`, `ask-people.ts`) and the two
  clients (`BlockCard.tsx`, `block-card.tsx`, the `client-core` ledger).
- Wrote `docs/plan/dm-interactive-cards.md` (297 lines). It contains:
  - the map with `file:line` for posting, the id each side holds, the current
    answer and correction paths, and why question cards give no DM precedent;
  - the id options (origin id, archive id read-back, sender/time match) with
    **one recommendation**: record the DM card under the origin id and have
    both clients send that id for a DM card; no schema and no contract change;
  - the owner-only access check, the `chat` correction (including the
    `blocks` correction gap in `client-core`), and the plain-reply answer path;
  - seven ordered tasks (server, shared/`client-core`, web, phone), each with
    its files and a one-line acceptance, plus one open question for Julio
    (phone scope).
- No source file changed; the only edits are the two Allowed files.

### Checks run

- `pnpm install` — completed (silent, no errors).
- `pnpm exec prettier --check docs/plan/dm-interactive-cards.md work/T-1809-dm-interactive-cards-plan.md` — `All matched files use Prettier code style!` (re-run after the Report edit, same result).
- `pnpm gate` — ended with `GATE PASS`:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.0s)
PASS  lint  (1.1s)
PASS  typecheck  (1.4s)
SKIP  effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No tests were run: this task changes docs only, so there is no nearest test.

### Notes for the lead

- The plan is 297 lines, slightly over the "about 250" guidance. The extra
  lines are the cited option comparison (archive read-back) and the per-task
  file lists; I kept them because the acceptance asks for `file:line` claims
  and ordered tasks.
- Main recommendation to review: Option A (`origin_id`) with the client sending
  the origin id for DM cards. It needs no migration, no route/contract change
  and no ejabberd archive read; the client already keeps that id for DM
  corrections (`client-core/src/store/ledger-ids.ts:237-251`).
- Two claims worth a second look in review: (1) a DM has no reflection, so the
  server never learns the owner's archive id (no `stanza-id by=<owner>` in any
  server read path); (2) `cardEditFor` in `client-core` only accepts `progress`
  payloads today, so a `blocks` correction needs that one-line widening.

### Round 2 (fix round)

- **Finding 1 (should-fix) fixed.** All three citations in
  `docs/plan/dm-interactive-cards.md` (`:100`, `:155`, `:224`) now point to
  `apps/server/drizzle/0071_block-cards.sql`, the real path (verified: the file
  exists and its `:1-12`, `:6-7` and `:13-22` ranges match the claims).
  Commit `T-1809: fix finding 1 - correct migration path`.
- **Nits left alone, as instructed.** Nit 2 (297 lines vs "about 250") is the
  length already disclosed above and was not in a line I changed. Nit 3 (new
  private `loadAiOwnerId` in `respond.ts` vs the existing export in
  `agents/gateway/db.ts:184`) is a design preference for the lead; the plan
  keeps its stated layering rationale.
- **Tests added:** none. This is a docs-only task and the fix changes only a
  path in prose; there is no behaviour or nearest test.
- **Gate:** `pnpm gate` ended with `GATE PASS`:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (0.9s)
PASS  lint  (1.2s)
PASS  typecheck  (1.0s)
SKIP  effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Disagreements

None. Both nits are acknowledged above and left unchanged on purpose.

## Review (written by Claude)

Merged on 2026-10-17. The packet matches HEAD `6f3039c59`, and the migration path fix is in.

**Option A is accepted:** record a DM card under the origin id it was sent with, and DM clients send that id.

**The lead's corrections to §7, as of main `f380f4762`:**
- **Task 5 is done:** T-1810 widened `cardEditFor` to `progress | blocks`.
- **Task 7 is mostly done:** T-1796 shipped the phone interactive kinds, and T-1822 changed `apps/mobile/src/lib/blocks-api.ts`. What remains on the phone is the DM half of task 6: send `originId` and a plain reply in a DM.
- **Task 2:** reuse the exported `loadAiOwnerId` (`apps/server/src/agents/gateway/db.ts:184`) only if the import doesn't cross a layer the gate forbids; otherwise keep the private copy, as the plan says.
- **A missing last task:** lift T-1803's DM refusal once tasks 1–4 and 6 are live. That is the `post-blocks.ts` guard "interactive cards work only in a group or topic", plus the `INTERACTIVE_RULES` line "Interactive kinds work only in a group or topic, never in a direct chat."
- **§8 (phone scope)** is moot: every kind already exists on the phone.

