---
id: T-0137
title: Mobile: group roles and private-topic access
status: planned
milestone: M5
branch: task/T-0137-mobile-roles-admin
model: meta/muse-spark-1.3-contributor
depends_on: [T-0112, T-0116]
estimate: 2 days
---

# T-0137: Mobile: group roles and private-topic access

## Spec (written by Claude, do not edit)

### Why
Web has custom group roles (T-0116): labels that give access to private topics and approver rights. Mobile shows topics (T-0112) but cannot manage roles, attach them to topics or show them on members. Mobile is the smaller share of the work (about 20%), so keep it small and match how the mobile app already does lists, sheets, stores and its mock (`EXPO_PUBLIC_GALENA_MOCK`). Read `AGENTS.md` first, including the security checklist. Nothing here can be run in a simulator by the worker, so tests and typecheck carry the proof; say in the Report what still needs a human look.

### What to build
1. **Roles screen** (group owner/admin): list roles with member counts, create, rename, delete (with a confirm that says what it removes), and assign/unassign members (`PUT /api/groups/:id/roles/:roleId/members`; the server diffs inside a transaction, send the full desired member list as web does).
2. **Members list** shows role chips next to each member (the `roles` field on members).
3. **Topic access**: in the topic settings sheet, for private topics, pick which roles have access and which role approves AI actions (`/api/topics/:id/roles`); public topics show neither and say so. Going public clears roles (server does it; refresh the topic afterwards and do not keep stale roles in the store).
4. Non-admins see roles read-only; every write control is hidden for them and the API errors (403/404) are shown as a neutral message.
5. Mock mode covers all of it, including the private-to-public flip clearing roles.

### Read first
`AGENTS.md`, `work/T-0116-group-roles.md` (Spec, Report, Review), `apps/server/src/roles/routes.ts`, `apps/server/src/topics/service.ts` (`patchTopic`), the web `lib/api.ts` roles/topic-roles sections and the web `GroupPanel.tsx` for behaviour, `work/T-0112-topics-mobile.md`, `apps/mobile/src/app/group/[id].tsx`.

### Allowed files
`apps/mobile/**`, `packages/chat-core/src/**` only if a shared type must change (say so in the Report), `work/T-0137-mobile-roles-admin.md`. Not allowed: server, web, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2
```
(Affected tests while working; the full mobile suite once at the end. Do NOT start simulators, Metro, or `expo run`; Julio's simulators are off limits.)

### Acceptance criteria
- [ ] Role create, rename, delete and member assignment work in the store with tests, including error mapping.
- [ ] Member chips and the topic access picker have render tests; public topics show no role controls.
- [ ] The private-to-public flip leaves no roles in the store (test).
- [ ] Non-admin views are read-only (test).
- [ ] Mock mode covers it.

### Out of scope
Web changes, server changes, role-based message permissions beyond what T-0116 built.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
