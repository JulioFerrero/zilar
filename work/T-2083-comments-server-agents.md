---
id: T-2083
title: "Cut comments (server agents): keep only WHY comments per docs/COMMENTS.md, delete task IDs, history and narration — code untouched"
status: merged
milestone: M5
branch: task/T-2083-comments-server-agents
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2083: Comment cut — server agents

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count on the code map (julioferrero.github.io/zilar) must really go down. Comments are 35,839 of 274k source lines (13%). This group has **2486 comment lines in 93 files**. The lead counted them on 2026-10-18 at `804b12acb`; tests, mocks and generated files are excluded.

### Rules
Read `docs/COMMENTS.md` first and follow it exactly. In short:
- **Keep only WHY comments:**
  - security, permission, money and privacy notes;
  - protocol and data invariants;
  - platform and library workarounds, with the bug they work around;
  - units and limits;
  - tool directives (`eslint-disable…`, `@ts-expect-error`, `// effect-plain:`, `/// <reference>`).
- **Delete:**
  - task IDs and history ("T-1234", "moved unchanged", "size split", "replaces the old…", "during the transition");
  - narration that restates the code or the name;
  - JSDoc that repeats the parameters;
  - references to things that no longer exist;
  - commented-out code and banners.
- **Shorten** a multi-line block with one real "why" to one or two lines.

### Steps
1. Go through EVERY file in Allowed files; each has comments. Edit comments only.
2. Change NO code, string, import, type or formatting. The only allowed changes are:
   - removed or shortened comment lines;
   - removing a blank line left doubled by a removed block.
3. The target is to remove at least **1243** lines, half of this group's comment lines. Report:
   - `git diff main...HEAD --shortstat`;
   - each comment you kept that is longer than 3 lines, as `file:line` plus a reason of a few words.
4. Commit as you go (one commit per folder is fine). No tests.

### Allowed files
- `apps/server/src/agents/context-edits.ts`
- `apps/server/src/agents/context.ts`
- `apps/server/src/agents/delegation/service.ts`
- `apps/server/src/agents/dm-tool-turn.ts`
- `apps/server/src/agents/dm-turn.ts`
- `apps/server/src/agents/failure-class.ts`
- `apps/server/src/agents/gateway.test-harness.ts`
- `apps/server/src/agents/gateway.ts`
- `apps/server/src/agents/gateway/addressing.ts`
- `apps/server/src/agents/gateway/approval-follow-up.ts`
- `apps/server/src/agents/gateway/approval-on-decided.ts`
- `apps/server/src/agents/gateway/ask-people.ts`
- `apps/server/src/agents/gateway/budget.ts`
- `apps/server/src/agents/gateway/card-rekey.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/gateway/db.ts`
- `apps/server/src/agents/gateway/delegate-run.ts`
- `apps/server/src/agents/gateway/desk-exec.ts`
- `apps/server/src/agents/gateway/dm-turn-input.ts`
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/fetch-media.ts`
- `apps/server/src/agents/gateway/group-ingest.ts`
- `apps/server/src/agents/gateway/group-turn-access.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `apps/server/src/agents/gateway/group-turn-roster.ts`
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/agents/gateway/lifecycle.ts`
- `apps/server/src/agents/gateway/listener.ts`
- `apps/server/src/agents/gateway/live.ts`
- `apps/server/src/agents/gateway/memory.ts`
- `apps/server/src/agents/gateway/model-target.ts`
- `apps/server/src/agents/gateway/pending.ts`
- `apps/server/src/agents/gateway/post-blocks.ts`
- `apps/server/src/agents/gateway/question-answer.ts`
- `apps/server/src/agents/gateway/request-action.ts`
- `apps/server/src/agents/gateway/room-limits.ts`
- `apps/server/src/agents/gateway/routine-run.ts`
- `apps/server/src/agents/gateway/routine-send.ts`
- `apps/server/src/agents/gateway/save-text-media.ts`
- `apps/server/src/agents/gateway/scheduled-settle.ts`
- `apps/server/src/agents/gateway/sessions.ts`
- `apps/server/src/agents/gateway/stop-types.ts`
- `apps/server/src/agents/gateway/stop.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/gateway/topic-follow.ts`
- `apps/server/src/agents/gateway/turn-defect.ts`
- `apps/server/src/agents/gateway/turn-rounds.ts`
- `apps/server/src/agents/gateway/turn-start.ts`
- `apps/server/src/agents/gateway/typed-mention.ts`
- `apps/server/src/agents/group-turn-deps.ts`
- `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/handoff.ts`
- `apps/server/src/agents/listener/score.ts`
- `apps/server/src/agents/log/api.ts`
- `apps/server/src/agents/log/append.ts`
- `apps/server/src/agents/log/read.ts`
- `apps/server/src/agents/log/retention.ts`
- `apps/server/src/agents/log/steps.ts`
- `apps/server/src/agents/memory/api.ts`
- `apps/server/src/agents/memory/compaction.ts`
- `apps/server/src/agents/memory/compactor.ts`
- `apps/server/src/agents/memory/facts.ts`
- `apps/server/src/agents/memory/indexer.ts`
- `apps/server/src/agents/memory/mirror.ts`
- `apps/server/src/agents/memory/recall.ts`
- `apps/server/src/agents/memory/render.ts`
- `apps/server/src/agents/memory/secrets.ts`
- `apps/server/src/agents/memory/state.ts`
- `apps/server/src/agents/memory/store.ts`
- `apps/server/src/agents/memory/tree.ts`
- `apps/server/src/agents/prompt-time.ts`
- `apps/server/src/agents/redact-error.ts`
- `apps/server/src/agents/replies.ts`
- `apps/server/src/agents/reply-mention.ts`
- `apps/server/src/agents/reply.ts`
- `apps/server/src/agents/task-card.ts`
- `apps/server/src/agents/tool-arg-issues.ts`
- `apps/server/src/agents/tool-calls.ts`
- `apps/server/src/agents/tool-exec.ts`
- `apps/server/src/agents/tool-guide.ts`
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/agents/tool-rounds.ts`
- `apps/server/src/agents/tools.ts`
- `apps/server/src/agents/tools/blocks-tool.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/tools/desk-definitions.ts`
- `apps/server/src/agents/tools/media-tool.ts`
- `apps/server/src/agents/tools/parse.ts`
- `apps/server/src/agents/tools/reply-lines.ts`
- `apps/server/src/agents/tools/schemas.ts`
- `apps/server/src/agents/turn-budget.ts`
- `apps/server/src/agents/turn-send.ts`
- `apps/server/src/agents/turn-stop.ts`
- `work/T-2083-comments-server-agents.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `git diff main...HEAD` changes only comment lines. The lead checks this mechanically, and any code change sends the task back.
- At least 1243 lines are removed.

---

## Report (written by the worker when done)

### What I did

Cut comments only in the 92 source files under `apps/server/src/agents` listed in Allowed files, following `docs/COMMENTS.md`: removed task IDs and history, move/size-split notes, narration, parameter-restating JSDoc, references to removed things, commented-out text and banners. Kept and, where needed, shortened the WHY comments: permissions and owner scoping, privacy (ids only, no message text/keys), spend and rate limits with their units, protocol/XEP and data invariants, concurrency/atomicity notes, platform/library workarounds, and tool directives (`effect-plain:`, `eslint-disable`, `@ts-expect-error`, references).

Mechanical result in the source folder:
- comment lines (lines starting with `//`, `/*`, `*`): 2486 before, 1227 after, **1259 removed**;
- `git diff --shortstat -- apps/server/src/agents`: **93 files changed, 443 insertions(+), 1719 deletions(-)** (net −1276);
- `git diff main...HEAD --shortstat`: **94 files changed, 709 insertions(+), 1719 deletions(-)**; the 709 additions include this task file (spec + report), so the source-only net is −1276;
- no task ID (`T-<digits>`) remains in a non-test Allowed file;
- a line-by-line check of the diff (`git diff --unified=0 main -- apps/server/src/agents`) reports every removed and added line as a comment or blank line: **no code, string, import, type or formatting change**.

### Checks run

- `pnpm install --frozen-lockfile` — Done in 42.9s.
- `pnpm gate` (final run):
  - `PASS install (frozen) (2.0s)`
  - `PASS format (2.4s)`
  - `PASS lint (1.4s)`
  - `PASS typecheck (5.8s)`
  - `PASS effect (5.2s)`
  - `PASS build @zilar/server (1.4s)`
  - `FAIL tests @zilar/server (45.7s)` — `Test Files 1 failed | 31 passed (32)`, `Tests 2 failed | 206 passed (208)`; both failures are in `src/agents/gateway-group.test.ts` (`does not answer an unaddressed question in a two-AI room`, `answers a follow-up question right after its own reply (rule R)`) and time out in `openRoom`/`waitFor` (5 s) before any assertion about the changed code.
  - `scope: every changed file is inside the Allowed files`
  - `GATE FAIL`.
- Pre-existing check: I stashed all my `apps/server/src/agents` changes (`git stash push -- apps/server/src/agents`) and ran `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/gateway-group.test.ts -t 'rule R'` on the untouched tree: **1 failed, 20 skipped** with the same `timed out waiting for the condition` in `openRoom`. So the failure is on the base, not caused by this comment-only diff. Re-running the file with `--maxWorkers=1` and the full gate also failed, with a varying second test in the same `openRoom` setup.
- Single test runs used while working: the three `gateway-group.test.ts` runs above; no other package tests were run separately.

### Notes for the lead

**Gate status: red only on the pre-existing `gateway-group.test.ts` timeouts** (2 of 208 tests). Everything else passes and the scope/size/migration checks are clean. I could not fix the test within this task's Allowed files (tests are not in scope) and it fails identically on the base with my changes stashed. Please confirm whether the base flake is known or needs its own task before merging.

Longer kept comments (more than 3 lines), with the reason each stays:

- `apps/server/src/agents/delegation/service.ts:100` — both AIs must be room members; cross-group topic miss.
- `apps/server/src/agents/dm-tool-turn.ts:104` — caps then a text-only last call.
- `apps/server/src/agents/dm-turn.ts:99` — reply/failure text and send ordering.
- `apps/server/src/agents/gateway.ts:225` — shutting-down gate against mid-drain turns.
- `apps/server/src/agents/gateway/addressing.ts:57` — question detection rule.
- `apps/server/src/agents/gateway/addressing.ts:104` — address/rule S/rule R priority.
- `apps/server/src/agents/gateway/ask-people.ts:65` — failed post refunds the question slot.
- `apps/server/src/agents/gateway/budget.ts:36` — spend bounds, null vs missing row, money first.
- `apps/server/src/agents/gateway/budget.ts:120` — fail-closed limit gate, unreadable bound counts as set.
- `apps/server/src/agents/gateway/budget.ts:202` — 80% notice ordering; logs ids only.
- `apps/server/src/agents/gateway/budget.ts:255` — per-round kill-switch and budget gate.
- `apps/server/src/agents/gateway/budget.ts:294` — owner failure DM once a day; room gets fixed text.
- `apps/server/src/agents/gateway/card-rekey.ts:1` — reflection stanza-id vs origin-id re-key with retry.
- `apps/server/src/agents/gateway/db.ts:138` — owner membership is a live derived rule.
- `apps/server/src/agents/gateway/db.ts:301` — permission gate and role read per turn.
- `apps/server/src/agents/gateway/desk-exec.ts:22` — idempotent provision and host-side ceilings.
- `apps/server/src/agents/gateway/desk-exec.ts:86` — one runner per turn; failures stay in model context.
- `apps/server/src/agents/gateway/dm-turn.ts:150` — displayed-marker id rule and stop gating.
- `apps/server/src/agents/gateway/dm-turn.ts:268` — `end` ordering and stop-gated sends.
- `apps/server/src/agents/gateway/group-turn-access.ts:31` — who may ask for an action, scheduled runs.
- `apps/server/src/agents/gateway/group-turn-access.ts:45` — owner/admin-only computer use.
- `apps/server/src/agents/gateway/group-turn-access.ts:76` — re-check membership at tool time.
- `apps/server/src/agents/gateway/group-turn.ts:35` — request_action context and allowActions guard.
- `apps/server/src/agents/gateway/group-turn.ts:143` — unknown real JID is never a turn.
- `apps/server/src/agents/gateway/lifecycle.ts:154` — stopped/deleted session teardown.
- `apps/server/src/agents/gateway/lifecycle.ts:256` — drain before disconnect; stop racing sends.
- `apps/server/src/agents/gateway/listener.ts:44` — per-room debounce dedupe; never logs room text.
- `apps/server/src/agents/gateway/listener.ts:204` — wake gating and turn-time checks.
- `apps/server/src/agents/gateway/live.ts:34` — stop race guard on every send path.
- `apps/server/src/agents/gateway/live.ts:44` — stopped send resolves empty, no wire text.
- `apps/server/src/agents/gateway/live.ts:71` — task-card cap, fixed texts, best effort.
- `apps/server/src/agents/gateway/live.ts:260` — postToChat live/member guards.
- `apps/server/src/agents/gateway/memory.ts:94` — compaction gate and no prompt/summary logs.
- `apps/server/src/agents/gateway/model-target.ts:15` — key owner-scoped, never stored/logged.
- `apps/server/src/agents/gateway/post-blocks.ts:84` — card media must belong to this AI and chat.
- `apps/server/src/agents/gateway/question-answer.ts:88` — typed answer closes open questions.
- `apps/server/src/agents/gateway/request-action.ts:16` — ids from session, adapter text never reaches the model.
- `apps/server/src/agents/gateway/room-limits.ts:37` — round cap and refunded rate stamp.
- `apps/server/src/agents/gateway/routine-send.ts:1` — one message per routine, edit under max age.
- `apps/server/src/agents/gateway/sessions.ts:214` — room-join reconciliation, ids-only failures.
- `apps/server/src/agents/gateway/sessions.ts:323` — replaced session stands down.
- `apps/server/src/agents/gateway/stop-types.ts:1` — import-free type, runner tsconfig workaround.
- `apps/server/src/agents/gateway/stop.ts:5` — stop helper guards and owner scoping.
- `apps/server/src/agents/gateway/tool-exec.ts:122` — group tool offer and per-tool guards.
- `apps/server/src/agents/gateway/tool-exec.ts:132` — delegation availability and task_status exception.
- `apps/server/src/agents/gateway/tool-exec.ts:265` — membership re-check before the action gateway.
- `apps/server/src/agents/gateway/topic-follow.ts:23` — in-memory pause copy over the durable row.
- `apps/server/src/agents/gateway/topic-follow.ts:73` — follower lookup and cache TTL.
- `apps/server/src/agents/gateway/topic-follow.ts:145` — moving the follower; General never followed.
- `apps/server/src/agents/gateway/topic-follow.ts:159` — drop cache before the fire-and-forget write.
- `apps/server/src/agents/gateway/topic-follow.ts:174` — pause/resume persistence contract.
- `apps/server/src/agents/gateway/turn-rounds.ts:1` — computer-turn caps rationale.
- `apps/server/src/agents/gateway/typed-mention.ts:14` — word-boundary rule for typed mentions.
- `apps/server/src/agents/group-turn-deps.ts:39` — group tool offer rules.
- `apps/server/src/agents/group-turn.ts:135` — plain path never reaches the action gateway.
- `apps/server/src/agents/group-turn.ts:198` — advertised-tool-only execution.
- `apps/server/src/agents/group-turn.ts:264` — caps then text-only last call.
- `apps/server/src/agents/listener/score.ts:155` — strict score JSON parse caps.
- `apps/server/src/agents/log/append.ts:1` — redaction and 2 KiB cap; no human text.
- `apps/server/src/agents/log/append.ts:115` — fresh task id and positional form.
- `apps/server/src/agents/memory/api.ts:63` — unknown/unreadable chat answers the same 404.
- `apps/server/src/agents/memory/compactor.ts:33` — secret-looking summary is withheld.
- `apps/server/src/agents/memory/facts.ts:35` — duplicate and cap under one advisory lock.
- `apps/server/src/agents/memory/indexer.ts:85` — stored sender is the archived bare JID, not a nick.
- `apps/server/src/agents/memory/recall.ts:23` — recall caps and no regex from input.
- `apps/server/src/agents/memory/secrets.ts:1` — broad detection, never logs the match.
- `apps/server/src/agents/memory/state.ts:6` — room-scoped memory delete.
- `apps/server/src/agents/memory/tree.ts:19` — block split rule.
- `apps/server/src/agents/memory/tree.ts:75` — tiling budget and over-budget fallback.
- `apps/server/src/agents/prompt-time.ts:1` — IANA zone fallback to UTC.
- `apps/server/src/agents/replies.ts:1` — fixed user-facing failure texts.
- `apps/server/src/agents/tool-arg-issues.ts:5` — reasons never include values.
- `apps/server/src/agents/tool-exec.ts:191` — unmatched tool call would 400 the follow-up.
- `apps/server/src/agents/tool-guide.ts:32` — fixed stage texts, never model output.
- `apps/server/src/agents/tool-rounds.ts:20` — shared loop rules and gate order.
- `apps/server/src/agents/tool-rounds.ts:106` — round-1 tools and text-only last call.
- `apps/server/src/agents/tools/definitions.ts:152` — request_action description is generated and sorted.
- `apps/server/src/agents/tools/parse.ts:92` — invalid calls never run and carry no values.
- `apps/server/src/agents/tools/schemas.ts:186` — action name pattern blocks smuggling.
- `apps/server/src/agents/turn-send.ts:27` — send failure is logged, never thrown.

## Review (written by Claude)

Approved; the pre-review was clean.
- **Comment-only check** (`tmp/cc/onlycomments.py`, lead): +443 -1719 net -1276; non-comment changed lines: 0. Every changed line in `apps/` and `packages/` is a comment or a blank line.
- **Spot check:** the security, privacy and platform "why" notes were kept, shortened to one line each.
