---
id: T-1068
title: "Mock sweep W3 (web): delete the mock/api.ts groups, invite-links, join, directory and topics routes the shared backend answers"
status: merged
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

### What I did

Probed `@zilar/mock-backend` first (throwaway test, deleted, not committed), then deleted
the `mockRequest` branches whose every method and path the shared backend answers, plus
the two helpers only they used.

Deleted branch families:

- groups invite-links: `GET`/`POST /groups/:id/invite-links`, `DELETE /groups/:id/invite-links/:linkId`;
- join: `GET`/`POST /join/:token`;
- directory: `GET /directory`;
- by-handle: `GET /groups/by-handle/:handle`;
- groups join: `POST /groups/:id/join`;
- groups create: `POST /groups`;
- groups patch: `PATCH /groups/:id`;
- groups members: `GET /groups/:id/members`, `PUT /groups/:id/members/:userId/role`, `DELETE /groups/:id/members/:userId`;
- groups topics: `GET`/`POST /groups/:id/topics`.

Deleted helpers found by `grep` as used only from the deleted branches:
`validInviteLinkOptions` (invite-link 400 bounds) and `glyphForTopic` (group-topic
glyph), plus the branch-local `encodeMockDirectoryCursor`/`decodeMockDirectoryCursor`
(the directory branch's nested cursor helpers).

I did **not** touch the `me`/`users`/`contact-requests`/`blocks`/`handles`/`push`/`voice`
branches, the `groups/:id/roles` block, the `/topics/:id` block, `audit`,
`approval-rules`, `connections`, `machines`, `approvals`, or the state and seed
machinery.

### Files changed

- `apps/web/src/mock/api.ts` (deletions plus two helper removals)
- `work/T-1068-web-mock-delete-covered-routes-3.md` (this report + status)

### Probe (spec item 1)

Throwaway vitest file `packages/mock-backend/src/__t1068-probe.test.ts` (created, run,
then deleted; not committed) called `createMockBackend({ delayMs: 0 }).http(path, init)`
with a fresh backend per line and the backend's seed ids (`g-devteam`, `g-acme`,
`u-luis`, `u-marco`, `link-friends`, `'a'.repeat(64)`, `t-devteam-general`,
`t-devteam-bug`, `t-devteam-hiring`, `ai-dev-1`, `ai-qa-1`, `acme`). Run:
`pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1068-probe.test.ts`
→ `Test Files 1 passed (1)`, `Tests 1 passed (1)`. All 29 lines returned a `Response`;
no line returned `undefined`.

```
GET    /groups/g-devteam/invite-links                          backend=200
POST   /groups/g-devteam/invite-links                          backend=201
DELETE /groups/g-devteam/invite-links/link-friends             backend=204
GET    /join/aaaaaaaa…(64)                                     backend=200
POST   /join/aaaaaaaa…(64)                                     backend=200
GET    /directory                                              backend=200
GET    /directory?q=ac&kind=group                              backend=200
GET    /directory?cursor=not-a-cursor                          backend=400
GET    /groups/by-handle/acme                                  backend=200
POST   /groups/g-devteam/join                                  backend=404
POST   /groups                                                 backend=201
GET    /groups/g-devteam                                       backend=200
PATCH  /groups/g-devteam                                       backend=200
GET    /groups/g-devteam/members                               backend=200
PUT    /groups/g-acme/members/u-luis/role                      backend=200
DELETE /groups/g-devteam/members/u-marco                       backend=200
GET    /groups/g-devteam/topics                                backend=200
POST   /groups/g-devteam/topics                                backend=201
GET    /topics/t-devteam-general                               backend=200
PATCH  /topics/t-devteam-general                               backend=200
POST   /topics/t-devteam-general/archive                       backend=400
GET    /topics/t-devteam-general/members                       backend=200
POST   /topics/t-devteam-general/members                       backend=200
DELETE /topics/t-devteam-general/members/u-luis                backend=404
GET    /topics/t-devteam-bug/ais                               backend=200
POST   /topics/t-devteam-bug/ais                               backend=200
DELETE /topics/t-devteam-bug/ais/ai-dev-1                      backend=200
PUT    /topics/t-devteam-hiring/roles                          backend=200
GET    /topics/t-devteam-bug/tools                             backend=200
```

The 404/400 lines are the backend's own "private group / General cannot be archived /
not a member" answers, not `undefined`; the backend has a matching route for every
method and path, so those branches are dead in web mock mode (`apps/web/src/mock/backend.ts`
`dispatch` asks the backend first). `GET /groups/g-devteam` is not a deleted branch (the
old web mock never had a `GET /groups/:id` branch); probed for completeness.

### Branches kept, and why

- `PUT /me/handle` (inside the `me` branch) — the backend `me` domain serves only `GET`/`PATCH /me`; not covered.
- `users/by-handle` `GET`, contact-requests (`POST`/`GET`/accept/decline/`DELETE`), blocks (`GET`/`PUT`/`DELETE`), `handles/check` `GET` — no backend route; not covered.
- push (config/subscriptions/settings/test) and voice (transcription/transcript) — no backend route; not covered.
- `groups/:id/roles` (`GET`/`POST`/`PATCH`/`DELETE`/members) — covered by the backend `roles` domain, but kept for the next slice (W4) per spec item 3 ("the roles routes").
- `audit` `GET`, `groups/:id/approval-rules` `GET`, `approval-rules/:id` `DELETE`, `connections`, `machines`, `approvals` — covered, but kept for W4 per spec item 3.
- `/topics/:id` (`GET`/`PATCH`/archive/members/AIs/roles/tools) — covered by the backend `topics` domain, but kept: see "Size / what is left" below.
- `MockState`/`seedState`/`resetMockApi`/`setMockDelay`/`mockRequest` and the seed helpers — the state and seed machinery, kept per spec item 3.

### Size / what is left

`git diff --numstat` for `apps/web/src/mock/api.ts`: **0 insertions, 649 deletions
(649 changed lines)**, inside the ~800 budget.

Left for the next slice (W4): the whole `/topics/:id` block (currently
`api.ts:1720-1872`), together with the helpers only it still uses — `topicToView`,
`findTopic`, `patchMockTopic`, `mockAiName` + `MOCK_AI_NAMES`, `toolListRow` +
`currentVersionOf` + `lastRunStatusOf` — plus `groups/:id/roles`, `audit`,
`approval-rules`, `connections`, `machines` and `approvals`. Deleting the `/topics/:id`
block as well would have required deleting those eight helpers too (~312 further
changed lines), taking the diff to ~960 — over the ~800 cap — so per spec item 4 I
stopped at the family boundary and list it here.

### Commands and real results

- `pnpm install` → done, no errors (one pre-existing mobile peer-dependency warning: `@types/react-dom` wants `@types/react@^19.3.0`, found `19.2.18`).
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/__t1068-probe.test.ts` → `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- No single test file covers `apps/web/src/mock/api.ts` (only `apps/web/src/mock/gate.test.ts` exists in the folder and it does not import `api.ts`), so the nearest tests are the `@zilar/web` suite that `pnpm gate` runs.
- `pnpm gate` → **GATE PASS**; summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/web  (2.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / open questions

- The spec's §Why also lists `topics (get, patch, archive, members, AIs, roles, tools)`
  (the `/topics/:id` block) as a covered family to sweep, but deleting it would push the
  diff to ~960 changed lines, over the ~800 cap in spec item 4. I stopped at the family
  boundary and left the `/topics/:id` block (and its helpers) for the next slice. If the
  lead wants it in this diff instead, it is a one-line-range deletion plus the eight
  helpers named above.
- No functional behaviour change is expected: the shared backend answers every deleted
  route (probe above) and the web dispatcher already tries it first.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** 649 lines deleted from `apps/web/src/mock/api.ts`: the groups (create, get, patch, members, topics list and create), invite-links, join, by-handle and directory branches, with their helpers.
- **Why the deletions are safe:** the worker's probe used the backend's seed ids and got a `Response` for every deleted method and path.
- **Kept:** roles, audit, approvals, approval-rules, connections, machines and `/topics/:id` stay, for W4 and the size cap. The uncovered routes and the state machinery stay too.
- **The lead's web check** (`?mock=1`, branch on port 5199):
  - Dev team › General opens with its topic bar and history;
  - Topic info shows the members ("All 4 members"), AIs, Always allowed, the topic's tool `notes` v2, the routines and the pinned messages.
- **Check:** the gate passed, including the `@zilar/web` tests.
