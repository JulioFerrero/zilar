---
id: T-1069
title: "Mock H2-4a (mobile): contacts and directory run on @zilar/mock-backend through mockFetch"
status: merged
milestone: M5
branch: task/T-1069-mobile-contacts-directory-on-mock-backend
model: auto
effort: default
depends_on: [T-1067]
estimate: 0.25 day
---

# T-1069: Mobile contacts and directory on the shared mock backend

## Spec (written by Claude, do not edit)

### Why
T-1067 added the backend routes that contacts and directory were missing: contact-requests, `users/by-handle`, blocks, `handles/check` and `PUT /me/handle`. T-1064 kept directory on its old mock only because `GET /handles/check` was missing.

What the lead read on main (2026-10-11):
- **The hooks:**
  - `apps/mobile/src/components/contacts/use-contacts-api.ts:19-41` picks `./contacts-mock`, with scenarios `'default' | 'empty' | 'error'` (`contacts-mock.ts:19`);
  - `apps/mobile/src/components/directory/use-directory-api.ts:28-41` picks `@/mock/directory`.
- **The callers that read `scenario`:** `app/settings/blocked.tsx:39` and `app/settings/requests.tsx:46`. Each one only renders a "Mock data" footer when `scenario !== null` (`blocked.tsx:166-170`, `requests.tsx:209-213`).
- **The pattern** is `apps/mobile/src/components/machines/use-machines-api.ts` after T-1064: `mockToken` from `@/mock/gate`, `mockFetch` from a guarded `require('@/mock/backend')`, `API_URL` from `@/lib/auth`, and the handle `{ api, mock }`.

### What to build
1. **Probe first.** Mobile mock mode has no fallback. List every method and path `lib/contacts-api.ts` and `lib/directory-api.ts` call, and probe each one against `createMockBackend({ delayMs: 0 }).http(path, init)` with the backend's seed ids, in a throwaway script that you do not commit. Switch a hook only when every call gets a `Response`. Otherwise leave it, and list the missing routes.
2. **The adapters:** each switched hook builds its real factory with `(mockToken, mockFetch, API_URL)`. The named scenarios go (Julio, mock-plan Q2), and the handle becomes `{ api, mock: boolean }`.
3. **The callers:** in `blocked.tsx` and `requests.tsx`, read `mock` instead of `scenario` for the "Mock data" footer. Change nothing else in those screens. Check with grep that no other caller reads `scenario` from these hooks.
4. **No deletions.** Say in the Report whether `components/contacts/contacts-mock.ts` and `mock/directory.ts` are still imported.

The lead runs a phone smoke in mock mode:
- Settings › Blocked and Settings › Requests;
- `zilar://u/taken_user` (the profile by handle, then Add contact);
- Explore;
- the new-group sheet's handle check.

### Read first
`AGENTS.md`, `work/T-1067-mock-backend-contacts-blocks-handles.md` (its Report), `apps/mobile/src/components/machines/use-machines-api.ts`, the two hooks, their `lib/*-api.ts` factories, `apps/mobile/src/app/settings/blocked.tsx` and `apps/mobile/src/app/settings/requests.tsx`.

### Allowed files
`apps/mobile/src/components/contacts/use-contacts-api.ts`, `apps/mobile/src/components/directory/use-directory-api.ts`, `apps/mobile/src/app/settings/blocked.tsx`, `apps/mobile/src/app/settings/requests.tsx`, `work/T-1069-mobile-contacts-directory-on-mock-backend.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report lists every probed method and path with the backend's status.

---

## Report (written by the worker when done)

### What I did

Switched both hooks onto the shared mock backend, following the T-1064
`components/machines/use-machines-api.ts` pattern:

- `components/contacts/use-contacts-api.ts` and
  `components/directory/use-directory-api.ts` now build the real factory with
  `(mockToken, mockFetch, API_URL)` behind the literal build-time condition
  (`__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK`), keep a pure
  `…MockActive(envMock, params, paramAllowed)` gate (the same shape as
  `machinesMockActive`: empty / `0` off, `false` the one explicit opt-out,
  anything else on), and expose `{ api, mock: boolean }`.
- `app/settings/blocked.tsx` and `app/settings/requests.tsx` read `mock`
  instead of `scenario` for the "Mock data" footer. Nothing else in those
  screens changed.

The named scenarios (`default` / `empty` / `error`) are gone from both hooks,
as the task requires (mock-plan §Q2: the deep links and scenarios are rebuilt
on the unified seed, not kept).

### Probe (throwaway, not committed)

Per spec step 1 I probed every method and path the two factories call against
`createMockBackend({ delayMs: 0 }).http(path, init)`, in a temporary test file
`packages/mock-backend/src/t1069-probe.test.ts` that I deleted before the gate.
Every call answered a `Response` (none returned `undefined`/"NOT SERVED"), so
both hooks were switched. The contact-request accept/decline probes used a
one-off seed with two incoming rows (`cr-in` from `u-ana`, `cr-in2` from
`u-luis`); everything else ran on the default seed. Real output:

| # | Method | Path | Status |
|---|--------|------|--------|
| 1 | GET | `/api/users/by-handle/taken_user` | 200 |
| 2 | GET | `/api/users/by-handle/some_guy` | 200 |
| 3 | GET | `/api/users/by-handle/admin` | 404 |
| 4 | POST | `/api/contact-requests` | 201 |
| 5 | GET | `/api/contact-requests` | 200 |
| 6 | POST | `/api/contact-requests/cr-in/accept` | 200 |
| 7 | POST | `/api/contact-requests/cr-in2/decline` | 200 |
| 8 | DELETE | `/api/contact-requests/cr-1` | 200 |
| 9 | PUT | `/api/blocks/u-ana` | 200 |
| 10 | GET | `/api/blocks` | 200 |
| 11 | DELETE | `/api/blocks/u-ana` | 200 |
| 12 | GET | `/api/directory` | 200 |
| 13 | GET | `/api/groups/by-handle/hiking_club` | 200 |
| 14 | POST | `/api/groups/g-hiking/join` | 200 |
| 15 | GET | `/api/groups/g-acme` | 200 |
| 16 | PATCH | `/api/groups/g-acme` | 200 |
| 17 | GET | `/api/handles/check?handle=acme&kind=group` | 200 |
| 18 | GET | `/api/handles/check?handle=ada_fresh&kind=group` | 200 |

Rows 1–14, 17–18 are contacts (1–11) and directory (12–18); rows 15–16 are the
`DirectoryApi.getGroupVisibility` / `setGroupVisibility` calls, probed with
`g-acme` (a seed group the viewer owns). The 404 on row 3 is the served route's
own answer for an unknown handle, not the mock's "no route" fallback.

### No deletions

Neither module is imported any more:
- `components/contacts/contacts-mock.ts`: previously imported only by
  `use-contacts-api.ts`; after this change it has no importer (grep for
  `contacts-mock`, `createMockContactsApi`, `resetContactsMock` finds only the
  file itself).
- `mock/directory.ts`: previously imported only by `use-directory-api.ts`;
  after this change it has no importer (grep finds only the file itself).

Both files are untouched, as the spec requires ("No deletions").

### Files changed

`apps/mobile/src/components/contacts/use-contacts-api.ts`,
`apps/mobile/src/components/directory/use-directory-api.ts`,
`apps/mobile/src/app/settings/blocked.tsx`,
`apps/mobile/src/app/settings/requests.tsx`, this task file.

### Commands and real results

- `pnpm install`: done (10.5s), no changes needed.
- Throwaway probe:
  `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/t1069-probe.test.ts`
  → **1 passed**. File deleted before the gate.
- No test files exist near the change (`components/contacts`, `components/directory`
  and `app/settings` have none), so no other single test run was needed.
- `pnpm gate` (repo root):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.2s)
PASS  lint  (0.7s)
PASS  typecheck  (3.1s)
PASS  effect  (0.6s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes

- `GET`/`PATCH /api/groups/:id` (the visibility slice) are served by the
  `groups` domain, which reads `data.groups` (the groups the viewer belongs to),
  not the directory registry. I probed with `g-acme`, a seed group the viewer
  owns; a directory-only id such as `g-hiking` answers 404 there. That is fine
  for `useGroupVisibility`, which is owner-only (`mayChangeVisibility`) and only
  opens on a managed group.
- The "Mock data" footer now shows whenever the mock is active, exactly as
  before (`scenario !== null` ⇔ mock on). The behavioural change is only that
  `?mock=empty` / `?mock=error` no longer select a mock variant; they fall back
  to the shared default seed, which is the intended Q2 change.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit.**
- **The change:**
  - `use-contacts-api` and `use-directory-api` run on `@zilar/mock-backend` through `(mockToken, mockFetch, API_URL)`. The worker's probe got a `Response` for every client call;
  - the scenarios are gone;
  - `blocked.tsx` and `requests.tsx` read `mock` for the "Mock data" footer, and nothing else in them changed.
- **The lead's phone smoke** (mock):
  - **Explore** lists Neighbors, Cooking, Zilar news (Channel), Hiking club and Acme;
  - **`zilar://u/some_guy`** shows Some guy with Send request and Block, and Send request answers "Request sent." with Cancel;
  - **Settings › Requests** then shows "1 pending", under Sent: Some guy, "Waiting for an answer";
  - **Settings › Blocked** opens.
- **Check:** the gate passed.
