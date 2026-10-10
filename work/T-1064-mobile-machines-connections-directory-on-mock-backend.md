---
id: T-1064
title: "Mock H2-3 (mobile): machines, connections and directory run on @zilar/mock-backend through mockFetch (contacts waits for backend domains)"
status: merged
milestone: M5
branch: task/T-1064-mobile-machines-connections-directory-on-mock-backend
model: auto
effort: default
depends_on: [T-1061]
estimate: 0.25 day
---

# T-1064: Machines, connections and directory on the shared mock backend

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §2, slice H2-3, without contacts. The lead read main (2026-10-10).

**Three hooks still pick old mocks with named scenarios:**
- `apps/mobile/src/components/machines/use-machines-api.ts:28-41` (`./machines-mock`);
- `apps/mobile/src/components/connections/use-connections-api.ts:28-41` (`./connections-mock`);
- `apps/mobile/src/components/directory/use-directory-api.ts:28-41` (`@/mock/directory`).

**Their callers read only `api`:**
- `app/ais/[id].tsx:54-55`
- `app/explore.tsx:62`
- `app/at/[handle].tsx:56`
- `components/chat/new-group-sheet.tsx:86`

**The backend has these domains:** `machines`, `connections`, `directory` and `public-groups` (`packages/mock-backend/src/domains/index.ts`).

**Contacts is out of scope.** Its client also calls contact requests, blocks and users by handle, which the backend lacks (audit §1b). Its callers `app/settings/blocked.tsx:39` and `app/settings/requests.tsx:46` also read `scenario`.

**The pattern** is `apps/mobile/src/components/chat/use-approvals-api.ts` after T-1061: `mockToken` from `@/mock/gate`, `mockFetch` from a guarded `require('@/mock/backend')`, and `API_URL` from `@/lib/auth`.

### What to build
1. **Probe first.** Mobile mock mode has no fallback: a request the backend does not answer becomes a 404.
   - For each hook, list every method and path its client factory calls (`lib/machines-api.ts`, `lib/connections-api.ts`, `lib/directory-api.ts`), and probe each one against `createMockBackend({ delayMs: 0 }).http(path, init)` with a throwaway script. Do not commit it.
   - Switch a hook only when every call gets a `Response`. Otherwise leave it on its old mock, and list the missing routes in the Report.
2. **The adapters:** each switched hook's mock branch builds its real factory with `(mockToken, mockFetch, API_URL)`. The named scenarios go (Julio, mock-plan Q2), and the handle becomes `{ api, mock: boolean }`, with the same gate rule as `use-approvals-api.ts`. Check with grep that no caller reads `scenario` from these three hooks.
3. **No deletions,** and no change to contacts. Say in the Report whether `machines-mock.ts`, `connections-mock.ts` and `mock/directory.ts` are still imported.

The lead runs a phone smoke in mock mode:
- an AI's page (machines and connections);
- Explore (the directory);
- the new-group sheet.

### Read first
`AGENTS.md`, `docs/audit/mock-sweep-status.md` §1-§2, `apps/mobile/src/components/chat/use-approvals-api.ts`, the three hooks, and their `lib/*-api.ts` factories.

### Allowed files
`apps/mobile/src/components/machines/use-machines-api.ts`, `apps/mobile/src/components/connections/use-connections-api.ts`, `apps/mobile/src/components/directory/use-directory-api.ts`, `work/T-1064-mobile-machines-connections-directory-on-mock-backend.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report lists every probed method and path with the backend's status.

---

## Report (written by the worker when done)

**Status: review.** Machines and connections switched to `@zilar/mock-backend`
through `mockFetch`. **Directory was left on its old mock**: the probe shows the
backend does not serve `GET /api/handles/check`, so `checkGroupHandle` (called by
`new-group-sheet.tsx`, `new-channel-sheet.tsx` and `use-group-visibility.ts`)
would 404 in mock mode. The spec's rule is "switch a hook only when every call
gets a `Response`", so directory stays.

### Files changed
- `apps/mobile/src/components/machines/use-machines-api.ts` — replaced the
  `./machines-mock` scenario branch with `createMachinesApi(mockToken, mockFetch,
  API_URL)`; handle is now `{ api, mock }` (same gate as `use-approvals-api.ts`).
- `apps/mobile/src/components/connections/use-connections-api.ts` — same, with
  `createConnectionsApi(mockToken, mockFetch, API_URL)`.
- `apps/mobile/src/components/directory/use-directory-api.ts` — **unchanged** (see
  the probe result below).
- `work/T-1064-...md` — this report.

### Probe results (throwaway vitest script, not committed, since deleted)
Method: `createMockBackend({ delayMs: 0 }).http(path, init)` per spec. `undefined`
= no backend route; any number = the route matched (the domain answered).

Machines (`useMachinesApi` → `createMachinesApi`):

| Method + path | Backend |
| --- | --- |
| `GET /api/machines` | `200` |
| `POST /api/machines/pairing-codes` | `201` |
| `POST /api/machines/:id/approve` (`mach-pending`) | `200` |
| `POST /api/machines/:id/deny` (`mach-pending`) | `204` |
| `POST /api/machines/:id/revoke` (`mach-approved`) | `200` |
| `PATCH /api/machines/:id` (`mach-revoked`) | `200` |
| `DELETE /api/machines/:id` (`mach-revoked`) | `204` |
| `PUT /api/ais/:id/machine` (`ai-qa-1`) | `200` |

Every call answers a `Response` → **switched**.

Connections (`useConnectionsApi` → `createConnectionsApi`):

| Method + path | Backend |
| --- | --- |
| `GET /api/connections` | `200` |
| `POST /api/connections` | `201` |
| `POST /api/connections/:id/test` (`conn-openai`) | `200` |
| `DELETE /api/connections/:id` (`conn-openai`) | `204` |

Every call answers a `Response` → **switched**.

Directory (`useDirectoryApi` → `createDirectoryApi`):

| Method + path | Backend |
| --- | --- |
| `GET /api/directory` | `200` |
| `GET /api/groups/by-handle/:handle` (`hiking_club`) | `200` |
| `POST /api/groups/:id/join` (`g-hiking`) | `200` |
| `GET /api/groups/:id` (`g-devteam`, joined) | `200` |
| `GET /api/groups/:id` (`g-hiking`, directory-only) | `404` (route matched) |
| `PATCH /api/groups/:id` (`g-devteam`, joined) | `200` |
| `PATCH /api/groups/:id` (`g-hiking`, directory-only) | `404` (route matched) |
| `GET /api/handles/check?handle=...&kind=group` | **`undefined` — no route** |

The `404`s on `g-hiking` are served `Response`s (the groups domain answers
not-found; directory-only groups are not in the groups table); the visibility
route works for joined groups. The blocker is `/api/handles/check`, so **directory
is not switched** and the missing route is `GET /api/handles/check`.

### Old mock files after this change
- `apps/mobile/src/components/machines/machines-mock.ts` — **no longer imported**
  (only a doc-comment reference in `stickers-mock.ts`).
- `apps/mobile/src/components/connections/connections-mock.ts` — **no longer
  imported** (only a doc-comment reference in `integrations-mock.ts`).
- `apps/mobile/src/mock/directory.ts` — **still imported**, by the unchanged
  `use-directory-api.ts`.

No callers read `scenario` from these three hooks (grep: only
`use-stickers-api` / `use-ais-api` / `use-contacts-api` readers use it; contacts
is out of scope). No test imports the removed mock helpers or the hook handles.

### Commands run
- `pnpm install` — Done, 1172 packages, no errors.
- Probe (throwaway): `pnpm --filter @zilar/mock-backend test --maxWorkers=2
  --reporter=dot src/probe-t1064.test.ts` — 1 passed; the statuses above.
- `pnpm gate` — summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.9s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- Only 2 of the 3 hooks were switched; directory is blocked on the missing
  `GET /api/handles/check` backend route (spec §1 says to leave it and report).
  The phone smoke's Explore (search/join) and the AI page (machines/connections)
  now run on the backend; the new-group sheet still uses the directory old mock,
  so its handle check keeps working.
- No single hook test exists to run (UI code, no nearby test files); the gate
  reported `SKIP tests @zilar/mobile`.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** `use-machines-api` and `use-connections-api` run on `@zilar/mock-backend` through `(mockToken, mockFetch, API_URL)`, and the named scenarios are gone.
- **Directory stays on its old mock, correctly:** the worker's probe found that the backend lacks `GET /api/handles/check`, which `checkGroupHandle` calls. That route is already on the board's list of missing backend routes.
- **The lead's phone smoke** (mock, on this branch, which does not yet have T-1063):
  - Dev-1's page shows the backend's connections ("OpenAI · Work key", "Anthropic · Personal key");
  - the machine picker shows "Home machine" and "The platform (no machine)", with dev-mac on macOS 27.0, arm64;
  - Explore opens.
- **Check:** the gate passed.
