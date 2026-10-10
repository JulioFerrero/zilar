---
id: T-1069
title: "Mock H2-4a (mobile): contacts and directory run on @zilar/mock-backend through mockFetch"
status: todo
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

## Review (written by Claude)
