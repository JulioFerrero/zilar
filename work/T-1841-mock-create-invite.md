---
id: T-1841
title: "Mock backend answers POST /api/invites (code + url), so the web Add dialog's 'Invite with a link' Copy works in mock mode instead of 'Couldn't create a link'"
status: merged
milestone: M5
branch: task/T-1841-mock-create-invite
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1841: The mock creates invites

## Spec (written by Claude, do not edit)

### Why
**In web mock mode on 2026-10-17,** the topic Add dialog's "Invite with a link" row showed "Couldn't create a link". The dialog calls `client.auth.createInvite()` (`apps/web/src/lib/api/chats.ts:164-166`), which is `POST /invites` (`packages/api-contract/src/auth.ts:147`). The mock backend has no `invites` route, so every mock QA pass of the Add dialog shows a failure that live doesn't have.

### Facts (read by the lead on 2026-10-17)
- **The success shape is `AuthInvite { code, url, expiresAt? }`** (`packages/api-contract/src/auth.ts:97-101`).
- **The server builds the URL** as `${PUBLIC_URL}/invite/${code}` (`apps/server/src/auth/api.ts:154`).
- **`packages/mock-backend/src/domains/invite-links/routes.ts`:**
  - `handleInviteLinks` routes on `request.segments` (`:24-33`), serving `groups/:id/invite-links` and `join/:token`;
  - `jsonResponse` comes from `../../http/shared`.

### Steps
1. In `handleInviteLinks`, answer `POST invites` (segments `['invites']`) with `jsonResponse({ code, url: \`https://zilar.test/invite/${code}\` })`, where `code` is a fresh random string (for example `crypto.randomUUID().slice(0, 8)`).
2. **No tests.** Keep the file at most 400 lines.

### Allowed files
- `packages/mock-backend/src/domains/invite-links/routes.ts`
- `work/T-1841-mock-create-invite.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In web mock mode, the topic Add dialog's "Invite with a link" shows Copy, not "Couldn't create a link".
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `packages/mock-backend/src/domains/invite-links/routes.ts`: `handleInviteLinks` now answers
  `POST invites` (segments exactly `['invites']`) with `{ code, url }`, where `code` is
  `randomToken().slice(0, 8)` and `url` is `https://zilar.test/invite/${code}`. I reused the
  file's existing `randomToken()` helper instead of `crypto.randomUUID()` because the mock
  backend also runs under Hermes on mobile, which has no Web Crypto. Any other method or a
  longer path still falls through to `undefined`, so the web dispatcher's fallback is unchanged.
- No tests: the spec says none, and the gate skips `@zilar/mock-backend` tests for this change.
- File stays at 190 lines (limit 400).

### Checks run

- `pnpm install`: done in 15.4s.
- `pnpm gate` from the repo root ended with `GATE PASS`. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.7s)
  PASS  format  (1.1s)
  PASS  lint  (1.5s)
  PASS  typecheck  (3.8s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No standalone test runs: the change has no nearby test files and the spec says no tests.

### Notes for the lead

- I did not run the web Add dialog in mock mode myself; the acceptance check ("Copy, not
  \"Couldn't create a link\"") is left to the lead's smoke. The route now answers a success
  shape matching `AuthInvite { code, url }` (`packages/api-contract/src/auth.ts:97-101`).
- `DELETE /invites/:code` still has no mock handler; it was out of scope for this task.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `43bcf823a`. The mock answers `POST invites` with `{ code, url }`. The lead checks the Add dialog in mock mode on main after the merge.
