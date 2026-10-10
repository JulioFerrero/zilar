---
id: T-1071
title: "Mock sweep W4 (web): delete the mock/api.ts /topics/:id, roles, audit, approvals, approval-rules, connections and machines routes the shared backend answers"
status: merged
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

### What I did

Probed `@zilar/mock-backend` first (throwaway test, deleted, not committed), then deleted
the `mockRequest` branches whose every method and path the shared backend answers, plus
every helper that only those branches used (`grep`-checked, plus a final scan for
unused top-level names).

Deleted branch families:

- `groups/:id/roles`: `GET`/`POST /groups/:id/roles`,
  `PATCH`/`DELETE /groups/:id/roles/:roleId`,
  `PUT /groups/:id/roles/:roleId/members`;
- `/topics/:id`: `GET`/`PATCH /topics/:id`, `POST /topics/:id/archive`,
  `GET`/`POST /topics/:id/members`, `DELETE /topics/:id/members/:userId`,
  `GET`/`POST /topics/:id/ais`, `DELETE /topics/:id/ais/:aiId`,
  `PUT /topics/:id/roles`, `GET /topics/:id/tools`;
- `audit`: `GET /audit`;
- `groups/:id/approval-rules`: `GET`;
- `approval-rules/:id`: `DELETE`;
- `connections`: `GET`/`POST /connections`, `POST /connections/:id/test`,
  `DELETE /connections/:id`;
- `machines`: `GET /machines`, `POST /machines/pairing-codes`,
  `POST /machines/:id/{approve,deny,revoke}`, `PATCH /machines/:id`, `DELETE /machines/:id`;
- `approvals`: `GET /approvals`, `GET /approvals/:id`, `POST /approvals/:id/decision`.

Deleted helpers that became unused once those branches went (grep-confirmed as
used only from the deleted branches and each other): `currentVersionOf`,
`lastRunStatusOf`, `toolListRow`, `MOCK_AI_NAMES`, `mockAiName`, `MOCK_PEOPLE_NAMES`,
`mockPersonName`, `roleToView`, `findRole`, `topicToView`, `findTopic`,
`hasMockControlCharacters`, `createConnection`, `patchMockTopic`,
`createPairingCodeResponse`, `conflict`, `publicApproval`, `isPendingApproval` and
`noContent`; and the now-unused imports `mockGroupDetails` (from `./groups`) and
`approvalCard` + `MOCK_TOPIC_NOT_FOUND` (from `./helpers`).

I did **not** touch the push or voice branches, the `me`/`users`/`contact-requests`/
`blocks`/`handles` branches T-1067 covered (the next slice), or the state and seed
machinery (`MockState`/`seedState`/`resetMockApi`/`setMockDelay`/`mockRequest`, and the
seed functions the seed still calls: `seedTopics`, `seedGroupRoles`, `seedTools`, …). The
seeded `groupRoles`, `approvals`, `approvalRules`, `audit`, `connections`, `machines` and
`tools` state fields stay, because the seed populates them.

### Files changed

- `apps/web/src/mock/api.ts` (deletions plus the helper removals)
- `work/T-1071-web-mock-delete-covered-routes-4.md` (this report + status)

### Probe (spec item 1)

Throwaway vitest file `packages/mock-backend/src/__t1071-probe.test.ts` (created, run,
then deleted; not committed) called `createMockBackend({ delayMs: 0 }).http(path, init)`
with a fresh backend per line and the backend's seed ids (`g-devteam`, `role-designers`,
`role-devs`, `t-devteam-general`, `t-devteam-bug`, `t-devteam-hiring`, `u-luis`,
`conn-openai`, `conn-anthropic`, `mach-pending`, `mach-approved`, `apr-42`). Run:
`pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1071-probe.test.ts`
→ `Test Files 1 passed (1)`, `Tests 1 passed (1)`. Every one of the 35 lines returned a
`Response`; no line returned `undefined`.

```
GET    /groups/g-devteam/roles                          backend=200
POST   /groups/g-devteam/roles                          backend=201
PATCH  /groups/g-devteam/roles/role-designers           backend=200
DELETE /groups/g-devteam/roles/role-devs                backend=204
PUT    /groups/g-devteam/roles/role-designers/members   backend=200
GET    /topics/t-devteam-general                        backend=200
PATCH  /topics/t-devteam-general                        backend=200
POST   /topics/t-devteam-general/archive                backend=400
GET    /topics/t-devteam-general/members                backend=200
POST   /topics/t-devteam-general/members                backend=200
DELETE /topics/t-devteam-general/members/u-luis         backend=404
GET    /topics/t-devteam-bug/ais                        backend=200
POST   /topics/t-devteam-bug/ais                        backend=400
DELETE /topics/t-devteam-bug/ais/dev-1                  backend=200
PUT    /topics/t-devteam-hiring/roles                   backend=200
GET    /topics/t-devteam-bug/tools                      backend=200
GET    /audit?groupId=g-devteam                         backend=200
GET    /audit?aiId=dev-1                                backend=200
GET    /audit                                           backend=400
GET    /groups/g-devteam/approval-rules                 backend=200
DELETE /approval-rules/rule-1                           backend=204
GET    /connections                                     backend=200
POST   /connections                                     backend=201
POST   /connections/conn-openai/test                    backend=200
DELETE /connections/conn-anthropic                      backend=204
GET    /machines                                        backend=200
POST   /machines/pairing-codes                          backend=201
POST   /machines/mach-pending/approve                   backend=200
POST   /machines/mach-pending/deny                      backend=204
POST   /machines/mach-approved/revoke                   backend=200
PATCH  /machines/mach-approved                          backend=200
DELETE /machines/mach-pending                           backend=204
GET    /approvals                                       backend=200
GET    /approvals/apr-42                                backend=200
POST   /approvals/apr-42/decision                       backend=200
```

The 400/404 lines are the backend's own domain answers (General cannot be archived,
unknown AI, not a member, missing `groupId`/`aiId`), not `undefined`: the backend has a
matching route for every method and path, so those branches are dead in web mock mode
(`apps/web/src/mock/backend.ts` `dispatch` asks the backend first).

### Branches kept, and why

- push (config/subscriptions/settings/test) and voice (transcription/transcript) — no
  backend route; not covered (spec item 3).
- `me` (`GET`/`PATCH`), `PUT /me/handle`, `users/by-handle`, contact-requests, blocks,
  `handles/check` — covered/uncovered as T-1067 left them; kept for the next slice
  (spec item 3).
- `MockState`/`seedState`/`resetMockApi`/`setMockDelay`/`mockRequest` and every seed
  helper the seed calls (`seedTopics`, `seedGroupRoles`, `seedTools`, `seedRuns`, …) —
  the state and seed machinery, kept per spec item 3.

### Size

`git diff --numstat` for `apps/web/src/mock/api.ts`: **1 insertion, 749 deletions
(750 changed lines)**, inside the ~800 budget. (The single insertion is Prettier's
reflow; the rest are deletions.)

### Commands and real results

- `pnpm install` → done, no errors (one pre-existing mobile peer-dependency warning:
  `@types/react-dom` wants `@types/react@^19.3.0`, found `19.2.18`).
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1071-probe.test.ts`
  → `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- No single test file covers `apps/web/src/mock/api.ts` (only `apps/web/src/mock/gate.test.ts`
  exists in the folder and it does not import `api.ts`), so the nearest tests are the
  `@zilar/web` suite `pnpm gate` runs.
- `pnpm gate` → **GATE PASS**; summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (0.9s)
  PASS  lint  (0.6s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/web  (2.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / open questions

- The first two gate runs were red and fixed in scope before the green run above: one
  `format` failure (blank-line reflow after the block deletions; fixed with
  `prettier --write` on `api.ts`) and one `lint` failure (`noContent` became unused
  once the connections/machines/approval-rules branches went; removed it).
- No functional behaviour change is expected: the shared backend answers every deleted
  route (probe above) and the web dispatcher already tries it first.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The change:** 749 lines deleted from `apps/web/src/mock/api.ts`: the `/topics/:id` block, `groups/:id/roles`, `audit`, `approvals`, `approval-rules`, `connections` and `machines`, with their helpers.
- **Why the deletions are safe:** the worker's probe got a backend `Response` for every deleted method and path.
- **Kept:** push, voice, the `me`/users/contact-requests/blocks/handles routes (the next slice), and the state machinery.
- **The lead's web check** (`?mock=1`, branch on port 5199):
  - **Settings › Machines** shows office-linux pending, with its fingerprint and Approve/Deny, and dev-mac online with "AIs: Dev-1";
  - **Settings › Approvals** shows the `merge_pull_request` card, and Approve answers "Approved “merge_pull_request”." with "Nothing is waiting for you.";
  - **Dev team › General › Topic info** shows Members, AIs in this topic, Tools and Routines.
- **The nit:** two comments in `api.ts` (`:32`, `:706`) still name `approvalCard()`.
- **The follow-up:** the backend's `GET /audit` clamps a garbage `limit` to 20, where the old web branch returned an empty list. That is a mock-only difference.
- **Check:** the gate passed, including the `@zilar/web` tests.
