---
id: T-0547
title: "Effect lane E, batch 5: mobile auth-api, machines-api, ais-api and invite-links-api onto Effect Schema + the T-0506 request pipeline with the shared lenient error envelope; same exports, same errors, tests unchanged"
status: todo
milestone: M5
branch: task/T-0547-effect-mobile-api-batch-5
model: auto
effort: low
depends_on: [T-0538]
estimate: 1 day
---

# T-0547: mobile API clients batch 5 on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase moves to Effect 4, mobile included. The recipe is `apps/mobile/src/lib/pins-api.ts` (T-0506) and `docs/EFFECT_GUIDE.md`, "Moving a mobile API client onto Effect". **Use the shared lenient error envelope in `apps/mobile/src/lib/api-error-body.ts` (T-0538)**; never write a local `ErrorBodySchema`.

### Verified facts (do not re-derive)
These files validate by hand today. **Every export stays the same.**
- **`apps/mobile/src/lib/auth-api.ts`** (126 lines): `AuthApiError` (line 10), `fetchMe` (70), `updateMe` (83), `checkInvite` (108), plus the exported types.
- **`apps/mobile/src/lib/machines-api.ts`** (278 lines): `MachinesApiError` (57), `createMachinesApi` (190), plus the exported types.
- **`apps/mobile/src/lib/ais-api.ts`** (305 lines): `AisApiError` (78), `buildCreateBody` (170; a request builder that stays as it is), `createAisApi` (215), plus the exported types.
- **`apps/mobile/src/lib/invite-links-api.ts`** (360 lines): `InviteLinksApiError` (67), `createInviteLinksApi` (204), plus `extractJoinToken` (292), `joinFailureMessage` (331) and `resolveGroupChat` (348). Those three are pure helpers that stay as they are.
- **Tests that cover them (all unchanged):**
  - `apps/mobile/src/lib/{auth-api,machines-api,ais-api,invite-links-api}.test.ts`;
  - `apps/mobile/src/auth/session-store.test.ts`;
  - `apps/mobile/src/components/ais/{ais.test.ts,machine-picker.test.tsx}`;
  - `apps/mobile/src/components/chat/{invite-links-sheet,join-link}.test.tsx`;
  - `apps/mobile/src/components/machines/{errors.test.ts,machine-change.test.ts,machines-screen.test.tsx}`;
  - `apps/mobile/src/store/{invite-links,real-store.invite-links}.test.ts`.

### What to build
1. **Convert the four files with the T-0506 recipe** and the shared envelope:
   - the same exported names, types and signatures;
   - the same tolerance: what the hand validator skipped, defaulted or rejected, the schema skips, defaults or rejects the same way;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
2. **`auth-api.ts`** carries session cookies and headers: keep every request header, credential option and path exactly as it is. Only the response decode changes. Never log a cookie or token.
3. **Tests:** every existing test passes **unchanged**. You may add one new `*.effect.test.ts` per client.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the mobile API section), `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/api-error-body.ts`, then the four files and their tests.

### Allowed files
- `apps/mobile/src/lib/auth-api.ts`, `apps/mobile/src/lib/machines-api.ts`, `apps/mobile/src/lib/ais-api.ts`, `apps/mobile/src/lib/invite-links-api.ts`;
- the new, optional test files: `apps/mobile/src/lib/auth-api.effect.test.ts`, `apps/mobile/src/lib/machines-api.effect.test.ts`, `apps/mobile/src/lib/ais-api.effect.test.ts`, `apps/mobile/src/lib/invite-links-api.effect.test.ts`;
- `work/T-0547-effect-mobile-api-batch-5.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot auth-api session-store machines ais invite-links join-link
pnpm gate
```

### Acceptance
- The four clients decode with Effect Schema and the shared envelope, and run as Effect pipelines, with the same exports and errors.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
