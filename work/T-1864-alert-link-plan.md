---
id: T-1864
title: "Plan (docs only): how an AI's alert card gets linked to its routine when routine.schedule needs an approval first — read the schedule/approval flow and pick the simplest safe way (e.g. link on approval, or link from the routine's first run); write docs/plan/alert-card-link.md"
status: merged
milestone: M5
branch: task/T-1864-alert-link-plan
model: auto
effort: default
depends_on: [T-1860]
estimate: 30 min
---

# T-1864: Plan the alert card ↔ routine link (docs only)

## Spec (written by Claude, do not edit)

### Why
**The alert card plan** (`docs/plan/alert-card.md:181-188`) says:
1. the AI schedules the check with `routine.schedule`;
2. in the same turn it posts the alert card with `post_blocks`, naming the routine;
3. the server stores the link.

**T-1856 and T-1860 built** the link columns, the answer effect and the manager-only check (`apps/server/src/routines/alert-link.ts`, `apps/server/src/message-blocks/alert-routine.ts`).

**The lead found a gap.** `routine.schedule` is an action that needs a person's approval. The routine row seems to be created only when the approval is accepted (`createRoutine` inserts with `status 'active'`, `apps/server/src/routines/support.ts:35-130`). So it may not exist yet in the turn that posts the card, and the model only ever sees 8-character routine id prefixes (`apps/server/src/tools/routine-list-lines.ts:12-21`).

**This task reads the real flow and writes a short plan.** No code.

### What to read and answer (cite `file:line` for every claim)
1. **When is the routine row created?** At the `routine.schedule` call, at approval, or both (a pending row)? Read the action adapter (`apps/server/src/tools/adapter-support.ts` around `:205-240`), the approval execution path, and `createRoutine`.
2. **What does the model get back** from `routine.schedule` before and after approval? Does it see the id?
3. **What does the approval card carry,** and where could a card id travel with it?
4. **The options.** List 2–3 ways to link, with the files each touches, and recommend one:
   - **(a)** `routine.schedule` takes an optional `alert_card` (the origin id plus block id of a card the AI posted first), stored on the pending approval and applied by `createRoutine` on approval;
   - **(b)** `post_blocks` takes `routine` as an 8-char prefix, resolved among this AI's routines in the same topic, and works only once the routine exists;
   - **(c)** anything simpler you find.
5. **Security and abuse:**
   - who may link;
   - one card ↔ one routine (the partial unique index, `apps/server/drizzle/0074_alert-card-link.sql`);
   - what happens if the approval is declined, or the card's message is deleted.
6. **An ordered task list** (each ≤ 45 worker minutes, with the files each touches), ending with the routine run that writes the card's note (the plan's task 3, `docs/plan/alert-card.md:213`).

### Steps
1. Write `docs/plan/alert-card-link.md` with the answers above. Keep it under 200 lines.
2. Don't change any code.

### Allowed files
- `docs/plan/alert-card-link.md`
- `work/T-1864-alert-link-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The plan answers 1–6** with `file:line` citations.
- **It recommends one option,** with an ordered task list.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Read the real schedule/approval flow: `tools/routine-adapters.ts` (the task's
  `tools/adapter-support.ts:205-240` now holds shared lookups; the adapter moved),
  `actions/approval-path.ts`, `actions/queries.ts` (`runOnApprovalDecided`),
  `routines/support.ts` (`createRoutine`), `agents/gateway/request-action.ts`,
  `agents/gateway/approval-follow-up.ts`, `agents/gateway/post-blocks.ts`,
  `message-blocks/cards.ts`, `message-blocks/respond.ts`,
  `message-blocks/alert-routine.ts`, `routines/alert-link.ts`,
  `approvals/service.ts`, `approvals/access.ts`, `routines/access.ts`,
  `drizzle/0074_alert-card-link.sql`, `drizzle/0071_block-cards.sql`.
- Wrote `docs/plan/alert-card-link.md` (180 lines, under the 200 limit). It answers
  items 1-6 with `file:line` citations, lists options (a), (b), (c) with their files,
  recommends **(a)** with one change — post the alert card **first**, then call
  `routine.schedule` with `alert_card: {card, block}` — and gives a 6-task ordered list
  ending with the run that writes the card's note.
- Key findings: the routine row exists only after approval (`routines/support.ts:112-136`,
  run from `actions/queries.ts:302-313`); the model sees no id before approval
  (`agents/gateway/request-action.ts:78-91`) and gets **no follow-up turn** after a
  `routine.*` approval (`agents/gateway/approval-follow-up.ts:47-52`), so option (b) cannot
  work in the same turn; `post_blocks` knows the card id but does not tell the model
  (`agents/gateway/post-blocks.ts:57-58,134,136-140`), which is the one-line change that
  makes option (a) work.
- No code changed. Only the two Allowed files were touched.

### Checks run

- `pnpm install --frozen-lockfile`: done in 14s, no lockfile change.
- `pnpm gate` from the repo root: **GATE PASS**. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.6s)`
  - `PASS  format  (0.7s)`
  - `PASS  lint  (1.4s)`
  - `PASS  typecheck  (1.4s)`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
- No package tests were run: this task changes documentation only.

### Notes for the lead

- Option (a) needs the order flipped relative to `docs/plan/alert-card.md:181-188`:
  the card must exist before its id can travel in the schedule's args, and no follow-up
  turn follows the approval. `alert-card.md` is not mine to edit; the plan records the
  deviation and the reason.
- I recommend **not** backfilling the card's pre-approval answers at link time: until the
  link exists, any topic member may answer the card (`message-blocks/respond.ts:327-354`),
  so a backfill would let a non-manager set the routine's first threshold. The plan says
  to set the threshold after approval.
- Security checklist: no secrets added; no new route, delete or update statement; the link
  is validated against the card's AI and topic, then enforced by the existing partial unique
  index; audits keep ids only; the answer stays manager-only (`alert-routine.ts:35-49`).
- The `needs_approval` routine status is a hosts-change pause, not a pre-approval row; the
  plan states this so nobody expects a pending routine to exist.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `e395a480e`.
- **The plan answers all six questions,** citing `file:line`. It confirms the gap I suspected:
  - no routine row exists before approval;
  - the model never sees the routine id or the card id.
- **I accept option (a):** post the card first, then `routine.schedule` carries `alert_card` in its hashed args, and the same `INSERT` writes the link.
- **Next:** I'll spec its tasks 1 and 3 now, then 2 (it needs 3's input type), then 4–6.
