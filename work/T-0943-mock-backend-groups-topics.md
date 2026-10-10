---
id: T-0943
title: "Mock backend D1: groups, members, topics and roles domains in @zilar/mock-backend, plus topic rows on the group chat entries (docs/audit/mock-plan.md task D, part 1)"
status: merged
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

**Status: review. Gate passes; only `packages/mock-backend` and this task file changed.**

### What I did

Added the first half of task D: the `groups`, `topics` and `roles` domains in
`@zilar/mock-backend`, and put the Dev team's topic rows on its `ChatEntry`.

- **`groups`** (`src/domains/groups/`): `seed.ts` holds the seven seeded groups
  and channels from web's `mockGroupDetails` (`apps/web/src/mock/groups.ts`),
  keyed by the ids the `chats` seed uses; AI rows use the unified
  `@ai.zilar.test` JIDs of the `ais` domain. `routes.ts` answers
  `POST /groups`, `GET /groups/:id`, `GET/POST /groups/:id/members`,
  `PUT /groups/:id/members/:userId/role`, `DELETE /groups/:id/members/:userId`,
  `POST /groups/:id/ais`, `DELETE /groups/:id/ais/:aiId` and
  `PATCH /groups/:id` (topic switch, listener, background, visibility/handle via
  `classifyHandle` from `@zilar/protocol`). The public-group `by-handle`/`join`
  and the invite-link paths are left to T-0944.
- **`topics`** (`src/domains/topics/`): `seed.ts` holds the seven Dev-team
  topics from web's `TOPIC_SEEDS` (JID chat ids, `ai-dev-1`, the private Hiring
  topic's Designers role, the pricing page's approver role). `routes.ts` answers
  `GET/POST /groups/:id/topics` and `GET/PATCH /topics/:id`,
  `POST /topics/:id/archive`, members, AIs and roles, with the same 404 rule for
  a missing or archived topic. `view.ts` builds the contract `Topic` row and is
  shared with the chats route.
- **`roles`** (`src/domains/roles/`): the Dev-team roles from web's
  `seedGroupRoles` and their create/rename/delete/set-members routes; deleting a
  role detaches it from the group's topics and clears it as approver.
- **The chats seed and route:** the Dev team entry now carries the seven topic
  rows (`topics: seedTopicViews()`), and `GET /chats` rebuilds each group's
  `topics` from the live topics table so a created or archived topic shows there
  at once.

### Files changed

New: `src/domains/{groups,roles,topics}/` (each `index.ts`, `seed.ts`,
`state.ts`, `tables.ts`, `routes.ts`; `topics/` also `view.ts`). Edited:
`src/domains/index.ts` (three import lines + three alphabetical array lines),
`src/domains/chats/seed.ts` (Dev-team `topics`), `src/domains/chats/routes.ts`
(live topics), and this task file. Every file is under 400 lines (largest is
`groups/routes.ts` at 325).

### Commands and real results

- `pnpm install` — "Done in 16.6s using pnpm v10.32.1" (no lockfile change).
- `pnpm --filter @zilar/mock-backend typecheck` — clean.
- No single tests were run: `packages/mock-backend` has no test files and the
  task says no tests, so the gate's `SKIP tests` is correct.
- `pnpm gate` (repo root) — summary:

  ```
  gate: 20 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (0.4s)
  PASS  typecheck  (1.4s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Proof (throwaway script, not committed)

A scratch `.ts` outside the repo (imports `createMockBackend` and the contract
schemas by absolute path, runs with `pnpm exec tsx`), `delayMs: 0`, decoding
every body with its contract schema (`GroupDetail`, `GroupMemberList`,
`TopicList`, `GroupRoleList`, `Topic`, `ChatEntry`, `ChatList`):

```
1. GET /groups/g-devteam -> Dev team | members 4 | ais Dev-1, QA-1
2. GET /groups/g-devteam/members -> You:owner Ana:admin Luis:member Marco:member
3. GET /groups/g-devteam/topics -> 7 rows: General | Checkout button hidden on Safari | New pricing page | Daily standup | Release 2.4 notes | Hiring: frontend role | Ideas
4. GET /groups/g-devteam/roles -> Designers(2) Devs(2)
5. POST /groups/g-devteam/topics -> t-mock-1 Proof topic chatJid t-mock-1@rooms.zilar.test
6. GET /chats after create -> 8 dev-team rows; new present: true
7. after archive -> 7 dev-team rows; new gone: true
```

### Deviations / decisions (all intentional)

- **Domains extend the shared interfaces from their own folder.** The
  domain pattern (`T-0942`) has every seed return `Partial<MockSeed>` and every
  state return `Partial<MockData>`, but `MockSeed`/`MockData` still list their
  keys in `src/data/index.ts` and `src/state.ts`. To honour this task's "touch
  only your own domain folders, your line in `src/domains/index.ts`, and the
  `chats` seed" (and to stop the parallel T-0944/T-0945 work from colliding in
  those two files), each new domain augments `MockSeed`/`MockData` with a
  `declare module` in its own `tables.ts`. This is the only way I found to make
  "a new domain is a folder plus one line" true; flag it if you would rather the
  two shared files list the new keys explicitly.
- **I edited `chats/routes.ts`, not only the seed.** The acceptance asks that a
  topic created or archived through `/groups/:id/topics` shows up in `/chats`;
  the seed alone is static, so the route now rebuilds each group's `topics` from
  the live table (`groupTopicViews`). The change is one import and one map.
- **A few group endpoints web's mock lacked.** web's mock has no `GET
  /groups/:id`, no `POST /groups/:id/members` and no add/remove AI, so the real
  store's group panel would have no answer for them. I implemented them in the
  same shape as the web mock's other group routes, and kept web's rules for the
  routes it does have (channel-only owner role change, `channel_needs_admin`,
  the owner cannot be removed). `POST /groups/:id/join` and `by-handle` are
  deliberately left to T-0944.
- **`createTopic` also reads `owner`, `linkUrl` and `linkLabel`**, which web's
  mock ignored but the contract accepts; `PATCH /topics/:id` mirrors web's
  `patchMockTopic` (including the `confirmExposeHistory` gate).
- **Topic chat ids are JIDs** (`dev-team@rooms.zilar.test` for General,
  `t-devteam-*@rooms.zilar.test` for the rest, `t-mock-N@rooms.zilar.test` for
  created ones), per the unified JID-keyed seed (plan Q2).
- Group detail shows 4 Dev-team members (web's detail) while the chat entry says
  `memberCount: 6`; public topic `memberCount` therefore follows web and is 4.
  I kept web's numbers rather than inventing two more members.

### Open questions

- None. The one thing worth a lead decision is the interface-augmentation
  mechanism above.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 4 nits.**
- **New domains:** `groups`, `topics` and `roles` in `packages/mock-backend`, with the Dev team's 7 topics on its chat entry. A created topic appears in `/chats`, and an archived one leaves it.
- **Size:** 1,622 lines added, with no file over 325, and only the package changed.
- **Nits:** parity cases the seed cannot reach today.
- **Check:** the gate passed.
