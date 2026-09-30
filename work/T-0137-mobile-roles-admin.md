---
id: T-0137
title: Mobile: group roles and private-topic access
status: merged
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
- API clients (`lib/roles-api.ts` new, `lib/topics-api.ts` extended, `lib/chat-api.ts` extended): hand-written guards, no zod (mobile pattern). Roles CRUD + replace-the-set member PUT; `setTopicRoles` PUT; `Topic.roles`/`approverRole` parsed (absent = none, for older servers); `GroupMember.roles` parsed (absent = none).
- Pure logic (`lib/roles.ts` new): `mayManageRoles`, `describeRolesError` (403/404 → one neutral line), `topicRoleLabel` ("Designers (3)"), `approverLine`, `deleteRoleConfirmText`, `attachedRoleIds`, `sortGroupRoles`, `rolesByUserId`, `membersWithChips`, `topicAccessRows`, `approverOptions`, `showsTopicAccess`.
- Real store: `groupRoles`/`refreshGroupRoles`/`createGroupRole`/`renameGroupRole`/`deleteGroupRole`/`setGroupRoleMembers` (group-id keyed cache, revision-bump publish) and `topicRoles`/`refreshTopicRoles`/`setTopicRoles` (topic-id keyed cache). `create/patch/setTopicRoles` replace the cache from the full response, so the private→public flip leaves no roles behind. Loaders reject so screens can show Retry.
- Mock store + seeds (`mock/topics.ts`): Designers (you+Ana) / Devs (you+Luis) like the web mock; hiring topic carries Designers, UI topic names Designers approver; all writes in-memory incl. the public flip clearing roles and public topics refusing roles.
- UI: topics-screen header "Members and roles" button → `GroupRolesSheet` (members + chips for all; CRUD + assign multi-select for managers; delete confirm says holders lose access). `TopicInfoSheet` gains the access section for private topics (attached "Name (count)" + Add-roles picker + Approvers picker for managers; read-only list + "Approvers: X" for others) and "Roles are only available on private topics." for public ones. `RoleChips` component.
- Tests: 9 (roles-api) + 14 (roles) + 6 (mock store) + 8 (real store) + 2 (chips render) + 4 (roles sheet render: manager CRUD vs member read-only, loading/error) + 4 (topic sheet render: manager/private, non-manager, public, error) + 4 (topic roles parse/PUT) + 2 (member roles parse/reject). Existing fixtures updated for the new required fields.

### Files changed
- New: `apps/mobile/src/lib/{roles-api.ts,roles.ts}`, `apps/mobile/src/components/chat/{role-chips.tsx,group-roles-sheet.tsx}`, `apps/mobile/src/types/react-dom-server.d.ts` (ambient, `@types/react-dom` would be a new dep).
- Tests (new): `lib/{roles-api,roles}.test.ts`, `components/chat/{role-chips,group-roles-sheet,topic-sheets-roles}.test.tsx`, `store/{real-store.roles,roles-mock}.test.ts`; extended `lib/{topics-api,chat-api}.test.ts`.
- Edited: `lib/{topics-api.ts,chat-api.ts}` (roles parsing), `lib/topics.test.ts` + `store/real-store.test.ts` (fixtures for new required fields), `store/{types,real-store,chat-store}.ts`, `mock/topics.ts`, `app/{group/[id],chat/[id]}.tsx`, `components/chat/topic-sheets.tsx`.

### Commands run and real results
- `pnpm install`: ok (9.9s).
- `pnpm format:check`: pass (after `prettier --write` on touched files).
- `pnpm lint` (oxlint): pass (fixed 2: TDZ capture of `chatGroupId`, set-state-in-effect).
- `pnpm typecheck` (turbo 10/10): pass.
- `pnpm --filter @galena/mobile test --maxWorkers=2`: 45 files passed, 2 skipped; 456 passed, 2 skipped, 0 failed.
- `grep` for `any`/`@ts-ignore`/disable comments in touched non-test source: no hits.

### Review round 2 (pre-review findings 1–4 fixed)

1. Topic screen manager gating: `app/chat/[id].tsx` now issues
   `refreshGroupDetail` for the topic's group on mount (deep links included),
   and the info sheet takes `rolesLoading` (detail not loaded yet, no roles
   error): it renders "Checking your role…" instead of a silent read-only
   view. Render test added.
2. Swallowed group-roles load failure: the screen tracks
   `infoGroupRolesError`, the sheet renders it with a "Retry loading group
   roles" button (`groupRolesError`/`onRetryGroupRoles`) instead of silently
   degrading to attached-only. Render test added.
3. Over-mocked sheet tests: added `apps/mobile/vitest.config.mts` with only
   the `@` → `./src` alias (no new dependency; native-primitive mocks
   untouched) and unmocked `@/lib/roles` in both sheet suites — they now
   verify the real label/line/confirm wiring, plus a guard test that fails if
   the copy changes.
4. Nit (dead helpers): the sheet now renders `topicAccessRows` (attached
   first, rest sorted by name) and `approverOptions`; deleted the unused
   `showsTopicAccess` (+ its assertions).

### Commands run and real results (round 2)
- `pnpm format:check`: pass for all owned files (the only warn is the lead's
  untracked `PREREVIEW.md`, which I must not edit).
- `pnpm lint` (oxlint): pass. `pnpm typecheck` (turbo 10/10): pass.
- `pnpm --filter @galena/mobile test --maxWorkers=2`: 45 files passed,
  2 skipped; 461 passed, 2 skipped, 0 failed.
- `grep` for `any`/`@ts-ignore`/disable comments in touched non-test source:
  no hits.

### Review round 3 (pre-review round 2: findings 1–2 fixed, nit 3 checked)

1. Roles writes take the group id directly: `create/rename/delete/setMembers`
   now accept `groupId` (store types, real store, mock store), and the group
   screen passes its route param — an empty group with zero loaded topic rows
   can manage roles. Removed the now-unused `groupIdForRolesWrite`. Tests:
   real-store "writes roles for a group with zero loaded topic rows" (empty
   chat list, create/assign/delete all hit `g1`) plus mock unknown-group
   rejection.
2. `describeRolesError(error, failure)` now takes `'write' | 'load'`: 403 →
   neutral everywhere; 404 on writes → neutral (same-404 server rule);
   404 on loads → "This group or role is no longer available. Refresh and
   try again."; anything else → generic retry lines, never raw server text.
   Both screens pass the mode at every call site (write saves, load/refresh
   retries). Unit tests rewritten for the matrix.
3. Nit (mock approver): read `topics/service.ts` `setTopicRoles` — the
   approver role must belong to the group but need NOT be attached
   (lines 794–800). The mock already matches, so no guard added; pinned with
   a mock test (unattached group role as approver succeeds).

### Commands run and real results (round 3)
- `pnpm format:check`: pass for all owned files (only warn is the lead's
  untracked `PREREVIEW.md`, which I must not edit).
- `pnpm lint` (oxlint): pass. `pnpm typecheck` (turbo 10/10): pass.
- `pnpm --filter @galena/mobile test --maxWorkers=2`: 45 files passed,
  2 skipped; 464 passed, 2 skipped, 0 failed.
- `grep` for `any`/`@ts-ignore`/disable comments in touched non-test source:
  no hits.

### Problems, deviations from the spec, open questions
- Write actions changed signature from `chatId` to `groupId` (both stores +
  `ChatStoreState`); the only caller is the group screen, updated. Topic
  actions still resolve via chat row, unchanged.
- Still not live-checked (no simulator per task rules): needs a human look
  at roles on an empty group, the gone-vs-denied messages, and the Retry
  paths in mock mode.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** Approved after three rounds. Verified in the packets: the topic screen loads the group detail with a "Checking your role" state, roles load errors show Retry with write/load-aware messages, roles writes take the route's group id directly (empty groups work), both sheet suites exercise the real `@/lib/roles` helpers, the mock matches the server (approver need not be attached; private-to-public clears roles). Roles are keyed per group/topic, ids are URL-encoded, the token only travels in the authorization header. Mobile only; to be run on the Android emulator after the batch merge.

### Findings
- Nit: the initial roles-load failure on the group screen uses the hardcoded generic line instead of `describeRolesError(error, 'load')`.

### Follow-ups
- Use `describeRolesError` for the first load on the group screen.
