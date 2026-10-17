---
id: T-1832
title: "Plan only: the 18 · ALERT RULE card end to end — how its threshold and switch become (and stay in sync with) a routine that checks on a schedule and posts only when the condition holds; write docs/plan/alert-card.md with options, a recommendation, ordered tasks and open questions for Julio"
status: merged
milestone: M5
branch: task/T-1832-alert-card-plan
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1832: Plan for the alert card

## Spec (written by Claude, do not edit)

### Why
`alert` is the last interactive block kind nobody draws.
- **What the boards show:** a price well, an on/off switch and "Checked every 5 min · now $82,302" (`docs/design/mockups/blocks/WebChoices.dc.html:150-166`, `PhoneChoices.dc.html`).
- **What the protocol has:** `AlertBlockSchema` (`packages/protocol/src/blocks-choices.ts:147-160`: `id`, `title`, `field {label, value}`, `on`, `note?`).
- **What the cards plan says:** "treat it as a one-field form" (`docs/plan/message-blocks.md:316`).

**Why a plan first:** the card promises a recurring check. That means routines, which already exist:
- prompt and tool forms;
- unattended tier-0/1 actions on a scheduled trigger since T-1655 (`apps/server/src/agents/gateway/group-turn-access.ts:41-50`).

The open part is how the card and a routine stay one thing.

### What to find out (read the code; cite `file:line`)
1. **Routines today:**
   - how one is created and approved (the `routine.schedule` card), its schedule granularity (is every 5 minutes allowed?) and the daily caps;
   - the tool form versus the prompt form;
   - whether a run can **post nothing** when a condition is false. Start at `apps/server/src/routines/` (`schedule.ts`, `execute.ts`, `execute-prompt.ts`, `prompt-routines.ts`, `preflight.ts`, `blocks-post.test.ts`) and `docs/plan/scheduled-ai-jobs.md`, `docs/plan/routine-live-message.md`.
2. **The card answer path today:** `POST /api/blocks/respond` (`apps/server/src/message-blocks/respond.ts`, `apply.ts`) and its decision-kind reply.
3. **Options for "the switch and threshold drive a routine", at least:**
   - **(A)** the card's answer is a decision reply, and the AI creates or updates a routine through its normal tools (approval card included);
   - **(B)** the server ties the card to a routine row it owns, and toggling or editing updates that routine directly;
   - **(C)** any simpler shape you find.

   For each: approvals, cost (model calls per check), how "now $82,302" stays current, what happens when the AI or the room goes away, and the security limits (hosts, tiers).
4. **Recommend one,** with ordered tasks (files, one acceptance line each; the server, then web and phone renderers to the boards, then the guide), and **open questions for Julio** (the default interval, a cap, who may toggle).

### Steps
- Write `docs/plan/alert-card.md` (about 200 lines). **Change no code.**

### Allowed files
- `docs/plan/alert-card.md`
- `work/T-1832-alert-card-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The doc answers 1–4 with `file:line` citations.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/plan/alert-card.md` (239 lines, plan only, no source file changed):

1. Routines today, with `file:line`: creation and approval through the tier-2
   `routine.schedule` action and its tool vs prompt forms; no create/edit REST
   endpoint; manager-only pause/resume/delete; interval granularity (1–10 080
   minutes, so every 5 minutes is allowed); daily caps (1440 prompt runs per AI
   per UTC day, none for tool routines); the scheduler's 30 s tick, 5 rows per
   tick, 2 concurrent runs and 1 h missed threshold; what a run costs (tool form
   = one sandbox execution, no model call; prompt form = one AI turn).
2. The card answer path: `POST /api/blocks/respond` records, merges and
   corrects; an `alert` answer is a 400 today (no `alert` case in
   `recordedResponse`, no switch/threshold in `BlocksRespondValue`, no
   `applyAlert`); cards exist only when `post_blocks` recorded them, and routine
   posts do not; neither renderer draws `alert` and it is not in
   `INTERACTIVE_KINDS`.
3. Three options — (A) decision reply + AI-owned routine, (B) server-owned link,
   (C) the alert card is the routine's live message — compared on approvals,
   cost per check, how "now $82,302" stays current, what happens when the AI or
   the room goes away, and security limits (hosts, tiers, who may spend).
4. A recommendation (B, tool form first) with a 5-step shape and a 7-task
   ordered build list (server, then web, then phone, then the guide), each with
   one acceptance line, plus 6 open questions for Julio (default interval, caps,
   who may toggle, tool-form-only v1, one-sided vs band, failure noise).

The central finding: **no routine can post nothing when a condition is false
today** — a successful run always posts (`routines/outcomes.ts:27-51`); "post
only when it holds" is new behaviour. Also, routine posts do not record a
`block_cards` row, so an alert card posted as routine output would 404 on
answer.

### Checks run

- `pnpm install` — done (14.1 s).
- Single test files: none. The change is docs only; no package source changed,
  so there was no test near it to run.
- `pnpm gate` (repo root) — ended with `GATE PASS`:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.1s)
  PASS  lint  (1.3s)
  PASS  typecheck  (1.5s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

  No file outside the Allowed files (`docs/plan/alert-card.md`,
  `work/T-1832-alert-card-plan.md`).

### Notes for the lead

- Recommendation is (B): the AI schedules the check first through the existing
  tier-2 `routine.schedule` card, posts the alert card with a link to that
  routine, and the answer edits the routine (`on` → pause/resume,
  `field.value` → threshold). Each run compares the tool's `output.data.value`,
  writes the card's `note` and corrects the card, and only posts when the
  condition flips. Tool form only in v1; a prompt-form alert is listed as a
  follow-up.
- Two design consequences worth a decision before task 2 of the plan: the answer
  route must become manager-only for alerts (today any room member may answer),
  and the routine→card link needs a partial unique index (the per-topic routine
  cap is a read-then-insert, `routines/queries.ts:89-99`).
- I did not add or change any code, tests, protocol or migration.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `1c31bab7d`.
- **Read in full.** The plan's central facts are cited and match the pre-review's spot checks:
  - a run always posts;
  - routine posts record no card row;
  - an `alert` answer is a 400 today.
- **Recommendation (B):** the server links one routine to one card. No model call per check or toggle, and it reuses the tier-2 approval and host pinning.
- **The open questions in §7 go to Julio** in `work/NOW.md`. No build task starts until he answers. The `topics/ais.ts:10` citation nit (the call is at `:182`) stays as is.
