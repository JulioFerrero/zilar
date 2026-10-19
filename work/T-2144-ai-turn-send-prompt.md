---
id: T-2144
title: "AI turns steps T2 + T4 (docs/audit/agent-turns-plan.md): one reply send for DM and group, and one prompt assembly (history, fresh batch, names, time zone, memory) for both — the model sees byte-identical messages"
status: merged
milestone: M5
branch: task/T-2144-ai-turn-send-prompt
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2144: One reply send and one prompt assembly for AI turns

## Spec (written by Claude, do not edit)

### Why
`docs/audit/agent-turns-plan.md` §3 T2 (−20) and T4 (−80). T1 is merged (T-2128). The lead re-read the cited code at `d2ebd6afd`; the line numbers below are current.

Read the plan's T2 and T4 sections and its §4 risk table before you start.

### Step A — one reply send (plan T2)
`apps/server/src/agents/turn-send.ts` has two senders:
- `sendReply(deps, text)` (lines 8-25): DM. Calls `deps.beforeFinalSend?.(text)` first, sends to `deps.ownerJid` as `'chat'`, logs "AI reply could not be sent", and appends the `answer` log row.
- `sendGroupReply(deps, secrets, outgoing, {failure})` (lines 31-52): group. Sends to `deps.roomJid` as `'groupchat'` with `outgoing.opts`, logs "AI group reply could not be sent", appends `answer` only when `failure` is false, and returns `{kind:'failed', text}` when `failure` is true.

Callers:
- `dm-tool-turn.ts:94,101`;
- `group-turn.ts:251,270,373,377`.

Replace both with one `sendTurnReply(...)` that takes the target (jid, `'chat'` or `'groupchat'`, opts), the secrets, the text and `{ failure, beforeFinalSend }`. Keep every difference above exactly as it is today:
- the two log messages stay distinct;
- `beforeFinalSend` runs only for the DM, before the send;
- a failed send returns `{kind:'failed', text:''}`.

### Step B — one prompt assembly (plan T4)
`apps/server/src/agents/gateway/dm-turn.ts:252-310` and `apps/server/src/agents/gateway/group-turn-body.ts:218-292` both do, in this order:
1. load history (with a logged fallback to `[]`);
2. the owner or sender name;
3. `now` and the prompt time zone;
4. `loadMemoryContext(...)`;
5. merge the fresh batch into history, skipping ids MAM already returned;
6. call `buildDmMessages` / `buildGroupMessages`.

The group adds `senderNamesByJid`.

Move this into `loadTurnPrompt(input)` in a new `apps/server/src/agents/gateway/turn-prompt.ts`, with a `kind: 'dm' | 'group'` input carrying what differs: jid and kind, history limit, time-zone source, memory scope and the fresh-message mapping. The two builders stay in `apps/server/src/agents/context.ts`; do not touch that file.

**What must not change:**
- the message arrays stay byte for byte: same order, same memory block, same history cap, same fresh-merge rule;
- the history-failure log lines keep their text;
- `withToolGuide` stays where it is.

### Rules
- Behaviour-preserving only. Do not touch the loop (`tool-rounds.ts`), the turn input (`dm-turn-input.ts`), `context.ts` or anything outside the Allowed files; those are later plan steps.
- No new tests. The tests below must pass unchanged. If one needs a change, stop and report BLOCKED with why.
- Product lines go down by at least 60.

### Allowed files
- `apps/server/src/agents/turn-send.ts`
- `apps/server/src/agents/dm-tool-turn.ts`
- `apps/server/src/agents/group-turn.ts`
- `apps/server/src/agents/gateway/turn-prompt.ts` (new)
- `apps/server/src/agents/gateway/dm-turn.ts`
- `apps/server/src/agents/gateway/group-turn-body.ts`
- `work/T-2144-ai-turn-send-prompt.md`

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/group-turn-card.test.ts src/agents/reply.test.ts src/agents/dm-turn.fake-provider.test.ts src/agents/reply-mention.test.ts src/agents/context.test.ts src/agents/context-edits.test.ts src/agents/prompt-time.test.ts src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts
pnpm gate
```

### Acceptance
- All the listed tests pass unchanged, and the gate passes.
- Product lines go down by at least 60.
- The Report shows `wc -l` of the six files before and after.
- **Lead:** reads the diff for prompt order and log text. The live check in "ai test › General" waits for Julio (plan §4: DM "hello", @mention in the topic, remember a fact).

---

## Report (written by the worker when done)

### What I did

Fix round, after the first attempt was +33 lines against `main`.

- **Step A reverted.** `turn-send.ts`, `dm-tool-turn.ts` and `group-turn.ts`
  are back to exactly `main` (they no longer appear in the diff). Both senders
  and every call site are untouched; no wrapper remains.
- **Step B kept.** New `apps/server/src/agents/gateway/turn-prompt.ts` holds
  `loadTurnPrompt(input)`: history load with the logged fallback to `[]`, the
  owner name (DM) or sender name (group), `now` and the time-zone lookup,
  `loadMemoryContext`, the fresh-batch merge that skips ids MAM already
  returned, and the `buildDmMessages` / `buildGroupMessages` call. `context.ts`
  and `withToolGuide` are untouched.
- **Input shrunk.** The four fields `deps`, `logger`, `loadMemory` and
  `secretsFor` became one `ctx` field:
  `Pick<DmTurnContext, 'deps' | 'logger' | 'loadMemoryContext' | 'secretsFor'>`,
  imported as a type only (no runtime cycle), and both callers pass the `ctx`
  they already hold. The chat discriminator moved into the documented `chat`
  object (`{ kind, jid, key, limit }`), which removed a top-level field. The
  group-only fields (`senderName`, `groupName`, `topicName`, `handoffNames`)
  are flat instead of a nested object, so the group call site loses two lines.
  The fresh-row mapping spreads each item and overrides the fields the two
  paths differ in, which drops three more lines. `PromptItem` stays as a
  two-line alias because the inline form is longer.
- No tests added or changed. No dependencies added. Message-array order,
  memory block, history cap, fresh-merge rule and both history log texts are
  unchanged. `status` stays `review`.

### Checks run

- Task test command, unchanged files, `--reporter=dot`:
  `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/group-turn-card.test.ts src/agents/reply.test.ts src/agents/dm-turn.fake-provider.test.ts src/agents/reply-mention.test.ts src/agents/context.test.ts src/agents/context-edits.test.ts src/agents/prompt-time.test.ts src/agents/gateway-group.test.ts src/agents/gateway-stop.test.ts`
  → **9 files passed, 59 tests passed**.
- `pnpm gate` from the repo root, final run:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.3s)
PASS  lint  (0.8s)
PASS  typecheck  (2.9s)
PASS  effect  (0.4s)
PASS  build @zilar/server  (0.5s)
PASS  tests @zilar/server  (9.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into your Dockerfile
WARN  size: apps/server/src/agents/gateway/group-turn-body.ts: 404 lines (main 472); limit 400 (soft limit 400; fine when keeping the file whole saves lines)
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Line counts

`wc -l`, before (main) → after:

| File | Before | After |
| --- | ---: | ---: |
| `apps/server/src/agents/turn-send.ts` | 52 | 52 |
| `apps/server/src/agents/dm-tool-turn.ts` | 102 | 102 |
| `apps/server/src/agents/group-turn.ts` | 378 | 378 |
| `apps/server/src/agents/gateway/turn-prompt.ts` (new) | 0 | 121 |
| `apps/server/src/agents/gateway/dm-turn.ts` | 378 | 320 |
| `apps/server/src/agents/gateway/group-turn-body.ts` | 472 | 404 |
| **All six files** | **1,382** | **1,377 (−5)** |

`git diff main --numstat -- apps/server/src` (the task files in that output):

```
11  69  apps/server/src/agents/gateway/dm-turn.ts
17  85  apps/server/src/agents/gateway/group-turn-body.ts
121  0  apps/server/src/agents/gateway/turn-prompt.ts
```

Summed net: **−5** (149 added, 154 deleted). The three step-A files are
identical to `main`, so the diff no longer lists them.

Caveat for the lead: running that exact command over the whole
`apps/server/src` in this worktree now also counts commits `main` gained after
this branch point (the local `main` ref has moved; the gate's base reports 4
changed files). The task-file sum above is the six-file net.

### Notes for the lead

- Prompt assembly order is unchanged: history → name → `now`/time zone →
  memory → fresh merge → builder. The fresh rows keep the same sender fields
  (DM: owner JID, `now`, resolved; group: item sender, timestamp, optional
  nick). `senderNamesByJid` still runs after the merge and still falls back to
  an empty map.
- History-failure log text is unchanged: `AI history lookup failed; replying
  without history` and `AI group history lookup failed; replying without
  history`.
- The group resolves its handoff roster just before the prompt call (the
  handoff names are builder input); the prompt output and access decision are
  unchanged.
- The live check in "ai test › General" (DM "hello", @mention in the topic,
  remember a fact) is left to Julio as the task says.

### Round

Fix round for the prereview. Per the lead override, findings 1 (Step A) and 2
(`−60` lines) are accepted as they stand; `sendTurnReply` was not re-added and
the three Step A files stay identical to `main`.

- Finding 3 (nit): the fresh-message mapping now writes each `ChatMessage`
  field explicitly (`id`, `chatJid`, `kind`, `fromJid`, `fromResolved`,
  `fromNick` when defined, `body`, `timestamp`, `outgoing`) instead of
  spreading `...item`. Runtime objects no longer carry `synthetic`,
  `scheduled`, `wake`, `handoff` or `delegationId`.
- Finding 4 (nit): `now` is sampled after the history load and after the name
  lookup, matching the old DM order (and the group's, where the name is not
  awaited); history failure still falls back to `[]` before `now` is read.

Tests added: none (the spec asks for no new tests; the listed tests pass
unchanged). Commits: `T-2144: fix finding 4 - sample now after history load`,
`T-2144: fix finding 3 - write fresh message fields explicitly`.

Nine-file test command with `--reporter=dot`: **9 files passed, 59 tests
passed**.

`pnpm gate`: **GATE PASS** (install, format, lint, typecheck, effect, build
and tests pass; scope clean; same soft-limit WARN for `group-turn-body.ts`).

`git diff main --numstat -- apps/server/src` net for the task's six files:
**151 added, 154 deleted (net −3)**. The same command over the whole
`apps/server/src` prints 3,162 / 3,020 (net +142) because the local `main` ref
has moved since this branch point and the output then includes unrelated
commits; the six-file sum is the task net. `wc -l` of the six files:
52 + 102 + 378 + 123 + 320 + 404 = **1,379** (main 1,382, −3).



## Review (written by Claude)

Approved with the lead's scope change: only step B (T4, one prompt assembly) merges, net −3.

**Why step A was dropped:** the first try was +33. Step A (one reply send) saved nothing, because each caller needed its own wrapper around `sendTurnReply`. The lead reverted it in a fix round. The later pre-review's must-fix "step A missing" and should-fix "−60 missed" are that decision, and are overruled. The plan's T2 estimate (−20) does not hold, so step A stays out.

**What merged:** `gateway/turn-prompt.ts` `loadTurnPrompt` now does history load, fresh-batch merge, names, time zone and memory, then `buildDmMessages` or `buildGroupMessages`, for both DM and group turns. It takes the turn context instead of four separate deps.

**Behaviour:** the pre-review found step B behaviour-preserving, with the same log texts and the same memory scope. The fix round put `now` back after the history load and lists the fresh-message fields explicitly, as main did. DM pending messages carry no `fromNick`, so the shared spread changes nothing for DMs. The spec's nine tests pass (59 tests), and the gate passes.

**Live check:** the AI live check in "ai test › General" (DM "hello", an @mention, remember a fact) is on Julio's daytime list.
