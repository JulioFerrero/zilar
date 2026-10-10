---
id: T-1064
title: "Mock H2-3 (mobile): machines, connections and directory run on @zilar/mock-backend through mockFetch (contacts waits for backend domains)"
status: todo
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

## Review (written by Claude)
