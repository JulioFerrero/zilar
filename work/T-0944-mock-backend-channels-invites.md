---
id: T-0944
title: "Mock backend D2: invite links, join, directory and public-group lookup domains in @zilar/mock-backend (docs/audit/mock-plan.md task D, part 2)"
status: todo
milestone: M5
branch: task/T-0944-mock-backend-channels-invites
model: auto
effort: default
depends_on: [T-0942]
estimate: 0.5 day
---

# T-0944: Mock backend D2, invites and directory

## Spec (written by Claude, do not edit)

### Why
This is the second half of task D in `docs/audit/mock-plan.md` (read the plan and "Julio's answers"). T-0942 (merged) made each domain a folder: **a new domain is a folder plus one alphabetical line in `packages/mock-backend/src/domains/index.ts`**.

The web mock routes to port live in `apps/web/src/mock/api.ts`:
- `groups/invite-links` at `:3067`;
- `join` at `:3154`;
- `directory` at `:3228`;
- `groups/by-handle` at `:3311`;
- `groups/:id/join` at `:3336`.

Mobile's twins, the cross-check, are `apps/mobile/src/mock/invite-links.ts` (198 lines), `directory.ts` (116) and `channel.ts` (200; the Acme channel).

### What to build
1. **New domains:**
   - `invite-links`: create, list and revoke per group, with the join preview and the join;
   - `directory`: public groups and channels, search;
   - `public-groups`: `groups/by-handle` and `groups/:id/join`.

   Each one answers its contract group (`packages/api-contract/src/invite-links.ts`, `directory.ts`, and the public-group endpoints in `groups.ts`) with the same bodies and mutations as the web mock.
2. **Joining:** a join (by link or as a public group) adds the group to `GET /chats` the way the real server does. Read the `chats` domain's state through the combined `MockData`, as the `tools`/`routines` domains do today, without editing the `chats` files: T-0943 edits the chats seed in parallel. If you cannot do it without editing chats, add an exported mutator in a new file of your own and report it.
3. **Keep every file under 400 lines,** with one alphabetical line per domain in `src/domains/index.ts`.
4. **No app file changes, no tests.** Prove it in the Report with a throwaway script:
   - create an invite link, preview it and join with it;
   - show the group in `/chats`;
   - `GET /directory?q=...`, decoded with the contract schema.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/domains/index.ts` and one existing domain (`tools/` and `routines/` show cross-domain reads), `apps/web/src/mock/api.ts:3067-3353`, and the contract files.

### Allowed files
`packages/mock-backend/**`, `work/T-0944-mock-backend-channels-invites.md`.

T-0943 (groups, topics, roles and the chats seed) and T-0945 (the fake XMPP) work in the same package in parallel. Touch only your own domain folders and your lines in `src/domains/index.ts`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the invite and join proof and the decoded directory response.

---

## Report (written by the worker when done)

## Review (written by Claude)
