---
id: T-1621
title: "Plan (docs only): an AI that knows a group message is for it without a picked @mention — revive the listener on the AI's own model and key (T-1399 shelved it as platform-paid), with cheap deterministic rules first; options, cost per message, safety, task split"
status: merged
milestone: M5
branch: task/T-1621-smart-wake-plan
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1621: Plan for an AI that knows when to answer

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 a group message in "ai test › General" asked @Deepseek to do a job, but with the name typed, not picked. The AI never woke.
- **Julio:** "the ai needs to be also smart enough to understand that needs to answer and do the job".
- **T-1617** (running) adds the deterministic part: a typed `@Name` or "Name, …" counts as a mention.
- **This plan covers the rest:** messages clearly meant for an AI that name it differently, or don't name it at all ("can someone check the build?", "what's the BTC price?" in a room where one AI is the obvious helper).

**Docs only. No code.**

### Facts (the lead read them on 2026-10-16)
- **How a room message wakes an AI:** `apps/server/src/agents/gateway/group-ingest.ts` (323 lines).
  - `:145-152`: a picked mention or a reply to the AI;
  - `:154-158`: every human message also feeds `noteListenerMessage`;
  - `:159-165`: otherwise `followTopic`.
  - `apps/server/src/agents/gateway/topic-follow.ts:1-9`: the last @mentioned AI follows a topic, except General, which is never followed (T-1529).
- **The listener exists but is off:** `apps/server/src/agents/gateway/listener.ts` (292 lines), with the plan in `docs/audit/listener-delegation-plan.md` (§2 the design, §2.2 one scoring call and who pays, §2.7 the cost).
  - `apps/server/src/startup/components.ts:204-211` always ignores `LISTENER_ENABLED`: "the listener is a platform-paid feature and there is no platform key in P0".
  - `docs/SERVER_CONFIG.md:127-128` describes `LISTENER_ENABLED` and `LISTENER_MODEL`.
- **Each AI already pays for its own turns** with its owner's provider connection (`resolveTurnDesk`, `model-target.ts`, the budget gate `apps/server/src/agents/gateway/budget.ts`).

### What the plan (`docs/plan/smart-wake.md`) must answer
1. **Today:** in one page, every path by which a group message does or doesn't start an AI turn, with `file:line`, including follow, handoff, question replies and coalescing. Also what the listener code does today, and what is missing to run it.
2. **The options, each with pros, cons, the cost per human message and the code it touches:**
   - **(a) Deterministic rules beyond T-1617:**
     - the AI's name anywhere as the addressee (vocative) — define the patterns precisely and say which false positives you accept;
     - a room with exactly one AI;
     - a question right after the AI's own reply;
   - **(b) The listener on the AI's own key:** each AI that could answer runs one small yes/no scoring call with its own model and connection. Debounce, cap per room per minute, and a budget gate before the call.
   - **(c) One owner-paid listener per room:** the room owner's chosen AI scores for all AIs in the room.
   - **(d) General follows too,** for a short window after a person's mention (for example 10 minutes or the next N messages), instead of never.
3. **The recommendation:** the mix you recommend and why. Include the default per room (on or off), who can change it, and where it shows in the UI. Describe the UI; the lead draws the canvas.
4. **Safety:** the listener reads untrusted room text, so keep the Rule-of-Two guidance from the old plan §2.5. Also cover no AI-to-AI wake loops, a cap on turns per human message, and Stop.
5. **The task split:** ordered tasks with exact files, a one-line goal and an estimate in minutes each, respecting the 400-line limit (`apps/server/src/agents/group-turn.ts` is at 399). Mark which need tests: the message pipeline does.
6. **Open questions for Julio,** at most 4, each with a recommended answer.

### Allowed files
- `docs/plan/smart-wake.md`
- `work/T-1621-smart-wake-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Every claim about today's code cites `file:line`.**
- **No source files change.**

---

## Report (written by the worker when done)

### What I did

Wrote `docs/plan/smart-wake.md`, docs only (no source file changed). It covers every "must answer" item
in the Spec, each with today's-code citations:

- **§1 Today** — the full ingest path (`group-ingest.ts:89-199`), the mention check (`:145-153`),
  follow (`:159-166`, `:207-237`), handoff (`:169-192`), question replies (`:134`,
  `question-answer.ts:50-87`), coalescing (`:241-316`), the turn-time gates (`gateway/group-turn.ts:107-330`,
  `room-limits.ts:31-56`, `budget.ts:117-192`), and what the listener does today (`listener.ts`,
  `listener/score.ts`). §1.3 lists the five concrete things missing to run the listener (no injected
  dep at `startup/components.ts:213-238`, `LISTENER_ENABLED` ignored at `:205-212`, a single server
  target at `contracts.ts:39-44`, no `roomSummary` supplied, the reason not surfaced).
- **§2 Options (a)–(d)** — each with precise patterns (the vocative rules V1–V3, the one-AI room rule,
  the post-reply question rule), pros, cons, cost per human message and the code each touches. Costs
  are derived from `PROJECT_PLAN.md:684-691` and shown per human message and per month.
- **§3 Recommendation** — a layered mix: T-1617, then (a) + (d) always on, (b) optional per room and
  gated, (c) rejected for v1; default per room, who changes it, and the three-state UI control.
- **§4 Safety** — Rule of Two from the old plan §2.5 (`docs/audit/listener-delegation-plan.md:98-103`),
  no AI-to-AI loops, the 4-turn/2-hop cap, the budget gate and Stop.
- **§5 Task split** — 7 ordered tasks with exact files, a one-line goal, minutes and which need tests,
  keeping new code in new files because `apps/server/src/agents/group-turn.ts` is at 399 lines.
- **§6 Open questions** — 4, each with a recommended answer.

### Checks run

- `pnpm install` (repo root): `Done in 16.3s`. One pre-existing peer warning:
  `apps/mobile` `@types/react-dom 19.3.0` wants `@types/react@^19.3.0`, found `19.2.18`.
- `pnpm gate` (repo root): **GATE PASS**, summary:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (2.0s)`
  - `PASS  format  (0.7s)`
  - `PASS  lint  (1.2s)`
  - `PASS  typecheck  (1.3s)`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: … ` and `size: every changed source file is within 400 lines`

No unit test was run on its own: the change is documentation only, so no package was touched and
`pnpm gate` skipped tests (nothing to run). I did not run any source test file.

### Notes for the lead

- The plan cites the current file layout, not the old `gateway.ts` numbers in
  `docs/audit/listener-delegation-plan.md` (the gateway has since been split into
  `gateway/group-ingest.ts`, `gateway/group-turn.ts`, `gateway/topic-follow.ts`, etc.). Anyone
  reading both should use the citations here for today's code.
- T-1617 is referenced as the base but its file is not in this worktree yet (it runs in parallel);
  task 1 in §5 is marked as already running and outside this plan's estimate.
- The one architectural decision the plan leans on is (b) vs (c): I recommend (b) per-AI on the AI's
  own key and reject (c). That is Open Question 2's subject; if the lead prefers (c), §2(c) and §5
  task 5 change shape (no per-AI loop, one target resolver instead).
- Allowed files: only `docs/plan/smart-wake.md` (new) and this task file changed; no source file
  touched, which matches the Acceptance "No source files change".

### Round (fix round, docs-only)

- **Findings fixed:** 1. Finding 1 (should-fix): §5 task 6 named `groups/routes.ts`, which does not
  exist; changed it to `groups/api.ts` (the settings route in `apps/server/src/groups/`). Commit
  `T-1621: fix finding 1 - point task 6 at groups/api.ts, not groups/routes.ts`.
- **Nits not fixed:** findings 2, 3 and 4 are nits in lines this round does not touch
  (`docs/plan/smart-wake.md:16-27`, `:77`), so per the round rules they are left as they are.
- **Disagreements:** none.
- **Tests added:** none. The change is a doc pointer fix in a docs-only plan; no source file, no
  behaviour and no test file is involved (the finding names no test).
- **Gate:** see the run below.

### Round gate result

- `pnpm gate` (repo root): **GATE PASS**, summary:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
- No single test was run: the change is documentation only, so no package was touched.

## Review (written by Claude)

**Approved and merged** (docs only).

- **Pre-review:** clean after one auto round, 5 nits.
- **The plan:** `docs/plan/smart-wake.md` (176 lines) proposes layers:
  - deterministic rules (V1-V3 addressing, S for a one-AI room, R for a question right after this AI's reply), free and always on;
  - a General follow window (10 minutes or 20 messages);
  - the model listener on each AI's own key, off by default and opt-in per owner.
- **The lead's call for the night:** Julio asked for an AI "smart enough to understand that needs to answer". The deterministic steps (plan §5 steps 2 and 3) are free, precise and reversible, so they start now.
  - The General window (a migration) and the listener (b) wait for Julio's answers to §6 Q1-Q4, recorded in `work/NOW.md`.
