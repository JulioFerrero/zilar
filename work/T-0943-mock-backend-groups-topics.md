---
id: T-0943
title: "Mock backend D1: groups, members, topics and roles domains in @zilar/mock-backend, plus topic rows on the group chat entries (docs/audit/mock-plan.md task D, part 1)"
status: todo
milestone: M5
branch: task/T-0943-mock-backend-groups-topics
model: auto
effort: default
depends_on: [T-0942]
estimate: 0.5 day
---

# T-0943: Mock backend D1, groups and topics

## Spec (written by Claude, do not edit)

### Why
This is the first half of task D in `docs/audit/mock-plan.md` (read the plan and "Julio's answers"). T-0942 (merged) made each domain a folder: **a new domain is a folder plus one alphabetical line in `packages/mock-backend/src/domains/index.ts`** (read its header comment).

The web mock routes to port live in `apps/web/src/mock/api.ts`:
- `groups` POST `:3354`, PATCH `:3408`, `groups/members` `:3507`, `groups/topics` `:3613`, `groups/roles` `:3678`;
- `topics` `:3766`.

The seed comes from:
- `apps/web/src/mock/topics.ts` (240 lines: `TOPIC_SEEDS` `:33`, members and AIs per topic `:226-240`);
- `apps/web/src/mock/groups.ts` (131: `mockGroupDetails` `:38`);
- `apps/web/src/mock/members.ts` (26).

Mobile's twin, the cross-check, is `apps/mobile/src/mock/topics.ts` (374). The T-0937 Review noted that the group chat entries in `src/domains/chats/seed.ts` have no `topics` yet.

### What to build
1. **New domains:**
   - `groups` (the details, members and settings);
   - `topics` (create, patch, archive, members and AIs per topic);
   - `roles`.

   Each one answers its contract group (`packages/api-contract/src/groups.ts`, `topics.ts`, `roles.ts`) with the same bodies and mutations as the web mock. Seeds are keyed by the JIDs already in use (`dev-team@rooms.zilar.test`, `ai-dev-1`, …).
2. **The chats seed:** add the Dev team's 7 topics to its `ChatEntry` (the contract's `topics` field), so `GET /chats` lists the topic rows as the real server does, and a topic created or archived through `/groups/:id/topics` shows up in `/chats`.
3. **Keep every file under 400 lines,** with one alphabetical line per domain in `src/domains/index.ts`.
4. **No app file changes, no tests.** Prove it in the Report with a throwaway script:
   - `GET` the group detail, the members, the topics and the roles, each decoded with the contract schema;
   - create a topic and show it in `/chats`;
   - archive it and show it gone.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/domains/index.ts` and one existing domain (`ais/`) as the pattern, `apps/web/src/mock/api.ts:3354-3919`, `apps/web/src/mock/topics.ts`, `groups.ts` and `members.ts`, and the three contract files.

### Allowed files
`packages/mock-backend/**`, `work/T-0943-mock-backend-groups-topics.md`.

T-0944 (channels, invite links, directory) and T-0945 (the fake XMPP) work in the same package in parallel. Touch only your own domain folders, your line in `src/domains/index.ts`, and the `chats` seed.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the decoded responses and the topic create/archive proof.

---

## Report (written by the worker when done)

## Review (written by Claude)
