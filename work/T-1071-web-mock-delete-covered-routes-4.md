---
id: T-1071
title: "Mock sweep W4 (web): delete the mock/api.ts /topics/:id, roles, audit, approvals, approval-rules, connections and machines routes the shared backend answers"
status: todo
milestone: M5
branch: task/T-1071-web-mock-delete-covered-routes-4
model: auto
effort: default
depends_on: [T-1068]
estimate: 0.25 day
---

# T-1071: Web mock sweep, part 4

## Spec (written by Claude, do not edit)

### Why
T-1068's Report ("Size / what is left") lists what is still covered but kept in `apps/web/src/mock/api.ts`:
- **the `/topics/:id` block** (get, patch, archive, members, AIs, roles, tools; it was at `api.ts:1720-1872` before T-1068 merged), with the helpers only it uses: `topicToView`, `findTopic`, `patchMockTopic`, `mockAiName` and `MOCK_AI_NAMES`, and `toolListRow`, `currentVersionOf` and `lastRunStatusOf`;
- **the other covered families:** `groups/:id/roles`, `audit`, `groups/:id/approval-rules`, `approval-rules/:id`, `connections`, `machines` and `approvals`.

T-1068's probe already showed that the backend answers every `/topics/:id` method, and `docs/audit/mock-sweep-status.md` §1a lists the other families as covered. Web mock mode asks the backend first (`apps/web/src/mock/backend.ts`).

### What to build
1. **Probe first,** as in T-1068, with the backend's seed ids and a throwaway script that you do not commit. Probe every method and path of every branch above. Delete only the branches where every call gets a `Response`.
2. **Delete those branches,** and the helpers only they used (`grep` first).
3. **Keep:**
   - the uncovered branches (push, voice);
   - the branches T-1067 just made covered (`PUT /me/handle`, users, contact-requests, blocks, `handles/check`). They are the next slice;
   - the state and seed machinery.
4. **Size:** at most about 800 changed lines. Stop at a family boundary if it would go over, and list what is left.
5. **No other file changes.**

The lead runs a web check with `?mock=1`:
- open a topic's info: members, AIs, tools;
- the group roles;
- Settings › AIs › Dev-1: connections, machine, activity;
- Settings › Machines;
- approve the Dev team card.

### Read first
`AGENTS.md`, `work/T-1068-web-mock-delete-covered-routes-3.md` (its Report), `apps/web/src/mock/backend.ts`, and `apps/web/src/mock/api.ts`.

### Allowed files
`apps/web/src/mock/api.ts`, `work/T-1071-web-mock-delete-covered-routes-4.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report lists every probed method and path with the backend's status, and every branch kept with the reason.

---

## Report (written by the worker when done)

## Review (written by Claude)
