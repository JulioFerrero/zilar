---
id: T-1068
title: "Mock sweep W3 (web): delete the mock/api.ts groups, invite-links, join, directory and topics routes the shared backend answers"
status: todo
milestone: M5
branch: task/T-1068-web-mock-delete-covered-routes-3
model: auto
effort: default
depends_on: [T-1065]
estimate: 0.25 day
---

# T-1068: Web mock sweep, part 3

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §1a lists these families as covered by `@zilar/mock-backend`: groups (create, get, patch, members, roles, topics), invite-links, join, by-handle, directory, and topics (get, patch, archive, members, AIs, roles, tools).

T-1062 and T-1065 deleted the other covered families. `apps/web/src/mock/api.ts` is now 2,824 lines. Web mock mode asks the backend first (`apps/web/src/mock/backend.ts:17-23`), so a covered branch cannot run.

The lead found the branch heads on main (2026-10-11): `head === 'groups'` at `:1670`, `:1914` and `:1939`, plus the later `groups`/`topics`/`directory` blocks between `:1670` and `:2523`. Read the file; the line numbers moved after T-1065.

### What to build
1. **Probe first,** as in T-1062 and T-1065. With a throwaway script, not committed, call `createMockBackend({ delayMs: 0 }).http(path, init)` for **every** method and path each groups, invite-links, join, by-handle, directory and topics branch handles. Use the backend's seed ids (`g-devteam`, `dev-team@rooms.zilar.test`, the topics seed ids) so each call reaches the domain, not just a 404 for an unknown id. Delete only the branches where every call gets a `Response`.
2. **Delete those branches,** and the helpers only they used (`grep` first).
3. **Keep these** for the next slice (W4): the roles routes, `audit`, `approvals`, `approval-rules`, `connections` and `machines`. Also keep every uncovered branch (`PUT /me/handle`, users, contact-requests, blocks, `handles/check`, push, voice) and the state and seed machinery.
4. **Size:** at most about 800 changed lines. Stop at a family boundary if it would go over, and list what is left.
5. **No other file changes.**

The lead runs a web check with `?mock=1`:
- open Dev team and a topic;
- the group info: members and invite links;
- Explore, and join a public group.

### Read first
`AGENTS.md`, `work/T-1065-web-mock-delete-covered-routes-2.md` (its Report), `docs/audit/mock-sweep-status.md` §1, `apps/web/src/mock/backend.ts`, and `apps/web/src/mock/api.ts`.

### Allowed files
`apps/web/src/mock/api.ts`, `work/T-1068-web-mock-delete-covered-routes-3.md`.

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
