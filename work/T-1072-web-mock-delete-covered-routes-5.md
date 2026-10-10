---
id: T-1072
title: "Mock sweep W10 (web): delete the mock/api.ts me, me/handle, users/by-handle, contact-requests, blocks and handles/check routes the shared backend now answers"
status: todo
milestone: M5
branch: task/T-1072-web-mock-delete-covered-routes-5
model: auto
effort: default
depends_on: [T-1071, T-1067]
estimate: 0.25 day
---

# T-1072: Web mock sweep, part 5

## Spec (written by Claude, do not edit)

### Why
T-1067 added `contact-requests` (with `GET /users/by-handle/:handle`), `blocks`, `handles` (`GET /handles/check`) and `PUT /me/handle` to `@zilar/mock-backend`. The backend already served `GET`/`PATCH /me`.

T-1071 kept the matching `apps/web/src/mock/api.ts` branches for this slice. The file is 1,427 lines on main (2026-10-11). Web mock mode asks the backend first (`apps/web/src/mock/backend.ts`), so these branches can no longer run.

### What to build
1. **Probe first,** as in T-1071, with a throwaway script that you do not commit. Call `createMockBackend({ delayMs: 0 }).http(path, init)` for every method and path the following branches handle, using T-1067's seed handles (`taken_user`, a free handle such as `ada_fresh`, `admin`):
   - `me` (`GET`/`PATCH /me`, `PUT /me/handle`);
   - `users/by-handle`;
   - contact-requests (create, list, accept, decline, cancel);
   - blocks (`PUT`, `DELETE`, `GET`);
   - `handles/check`, including `kind=group`.

   Delete only the branches where every call gets a `Response`.
2. **Delete those branches,** and the helpers only they used (`grep` first). These include `mockContactRequestList`, `mockBlockList` and `mockCheckHandle`, if nothing else uses them.
3. **Keep** the push and voice branches (no backend route yet) and the state and seed machinery: `MockState`, `seedState`, `resetMockApi`, `setMockDelay`, `mockRequest`, and every seed function the seed still calls.
4. **Size:** at most about 800 changed lines.
5. **No other file changes.** If deleting a helper breaks an import in another web file, keep the helper and say so in the Report.

The lead runs a web check with `?mock=1`:
- Profile: claim a username, then try a taken one;
- open a profile by handle and send a contact request;
- block and unblock someone.

### Read first
`AGENTS.md`, `work/T-1067-mock-backend-contacts-blocks-handles.md` and `work/T-1071-web-mock-delete-covered-routes-4.md` (their Reports), `apps/web/src/mock/backend.ts`, and `apps/web/src/mock/api.ts`.

### Allowed files
`apps/web/src/mock/api.ts`, `work/T-1072-web-mock-delete-covered-routes-5.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report lists every probed method and path with the backend's status, and every branch kept with the reason.

---

## Report (written by the worker when done)

## Review (written by Claude)
