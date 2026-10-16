---
id: T-1743
title: "Review follow-ups from T-1737/T-1738/T-1740/T-1741: failure reply without a synthetic quote, clearer routine list and id messages, group wording in the web role error, the last phone fetch omits cookies, a stale comment"
status: merged
milestone: M5
branch: task/T-1743-review-follow-ups
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1743: Small follow-ups from today's reviews

## Spec (written by Claude, do not edit)

### Why
The pre-reviews of T-1737, T-1738, T-1740 and T-1741 (merged on 2026-10-16) left small, safe follow-ups that need files outside those tasks.

### Facts (the lead read them on 2026-10-16)
1. **The failure reply quotes a synthetic id.** `apps/server/src/agents/gateway/group-turn.ts:341-347`: when a turn throws, the fixed failure reply is sent with `replyTo: { id: trigger.id }`. For a synthetic approval follow-up trigger (T-1738 marks it `synthetic`), that id exists in no chat.
2. **Unclear routine messages.**
   - `apps/server/src/tools/routine-list-lines.ts:15` prints `runs tool ${routine.toolName}`, which reads "runs tool ," when the saved tool was deleted;
   - `apps/server/src/tools/adapter-support.ts:172` and `:179` answer `no such routine` also when an id prefix matches several routines.
3. **Channel wording for groups.** `apps/web/src/store/effects/groupSettings.ts:107`: the role change's fallback error says "This channel is not available yet.", and since T-1741 it's also used for groups.
4. **One phone fetch still sends cookies.** `apps/mobile/src/lib/effect/raw-request.ts:25` calls `fetchWithTimeout` without `credentials: 'omit'` (T-1736 and T-1740 set it everywhere else).
5. **A stale comment.** `apps/mobile/src/components/ais/tool-detail-loader.tsx:142` refers to `runningRef` "in `routines-section.tsx`", but T-1740 moved it to `apps/mobile/src/components/ais/use-routine-actions.ts`.

### Steps
1. **`group-turn.ts`:** send the failure reply without `replyTo` when the trigger is synthetic. Keep the mention.
2. **`routine-list-lines.ts`:** a tool routine whose tool name is empty reads `runs a deleted tool`.
3. **`adapter-support.ts`:** when an id prefix matches more than one routine, answer `that id matches several routines: <ids>; use the full id`.
4. **`groupSettings.ts:107`:** "This group is not available yet."
5. **`raw-request.ts`:** add `credentials: 'omit'` to the init.
6. **`tool-detail-loader.tsx:142`:** point the comment at `use-routine-actions.ts`.
7. **No new tests.** Keep each file under 400 lines.

### Allowed files
- `apps/server/src/agents/gateway/group-turn.ts`
- `apps/server/src/tools/routine-list-lines.ts`
- `apps/server/src/tools/adapter-support.ts`
- `apps/web/src/store/effects/groupSettings.ts`
- `apps/mobile/src/lib/effect/raw-request.ts`
- `apps/mobile/src/components/ais/tool-detail-loader.tsx`
- `work/T-1743-review-follow-ups.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/tools src/agents/gateway --reporter=dot
pnpm gate
```

### Acceptance
- **All six items are done.**
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

All six follow-ups from the Spec are done, one edit per file:

1. **`apps/server/src/agents/gateway/group-turn.ts`** (failure reply, ~line 344): the
   reply options now spread `...(trigger.synthetic === true ? {} : { replyTo: { id: trigger.id } })`,
   matching the existing T-1738 pattern in `apps/server/src/agents/group-turn.ts:117`. A
   synthetic approval follow-up no longer quotes an id that exists in no chat; the
   `mentions` entry is unchanged.
2. **`apps/server/src/tools/routine-list-lines.ts`** (`routineLine`): a tool routine
   whose `toolName` is `''` now reads `runs a deleted tool` instead of `runs tool ,`.
3. **`apps/server/src/tools/adapter-support.ts`** (`findRoutineTarget`, id branch): an
   exact id match is returned first; then a prefix that matches several routines answers
   `that id matches several routines: <ids>; use the full id`; zero matches still answer
   `no such routine`; a single prefix match is returned as before.
4. **`apps/web/src/store/effects/groupSettings.ts`** (line 107, `changeChannelRole`):
   fallback error is now `This group is not available yet.` (was "This channel ...").
5. **`apps/mobile/src/lib/effect/raw-request.ts`**: added `credentials: 'omit'` to the
   request init, alongside the existing `api-client.ts` behaviour.
6. **`apps/mobile/src/components/ais/tool-detail-loader.tsx`** (line 142): the stale
   comment now points at `use-routine-actions.ts`, where T-1740 moved `runningRef`.

No new tests (per Spec item 7); no test referenced the changed strings
(`grep` for `runs tool` / `no such routine` / `not available yet` found only the source
lines, no assertions). Every changed file is well under 400 lines.

### Checks run

- `pnpm install`: Done in 20.4s using pnpm v10.32.1 (one pre-existing peer-dependency
  warning: `@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18, unrelated).
- `pnpm --filter @zilar/server exec vitest run src/tools src/agents/gateway --reporter=dot --maxWorkers=2`
  (the task's first check, plus the AGENTS worker cap): `Test Files 16 passed (16)`,
  `Tests 124 passed (124)`.
- `pnpm gate` (repo root): `gate: 7 changed file(s) against main`; PASS install
  (frozen) / format / lint / typecheck / effect / tests @zilar/mobile / tests @zilar/server /
  tests @zilar/web; `scope: every changed file is inside the Allowed files`;
  migration/images/size checks pass; `GATE PASS`.

### Notes for the lead

- No blockers, no deviations from the Spec. The 7 changed files are the six allowed
  source files plus this task file.
- No security-relevant surface changed: the edits are wording, one request init flag,
  and reply-option construction; no new routes, queries, caps or logs.

## Review (written by Claude)

- **Accepted at `f6cdc2b5f`.** The pre-review is clean (1 nit) and the packet is current. The lead ran the tool tests: 7 passed.
- **The six items are in:**
  - the failure reply has no `replyTo` for a synthetic trigger;
  - a deleted tool reads "runs a deleted tool";
  - an ambiguous id prefix lists the ids;
  - the web role error says "group";
  - `raw-request.ts` omits cookies;
  - the comment points at `use-routine-actions.ts`.
- **Nit left:** a delegation handoff can still quote a dangling id.
