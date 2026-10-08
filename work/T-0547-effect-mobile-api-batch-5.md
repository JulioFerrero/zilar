---
id: T-0547
title: "Effect lane E, batch 5: mobile auth-api, machines-api, ais-api and invite-links-api onto Effect Schema + the T-0506 request pipeline with the shared lenient error envelope; same exports, same errors, tests unchanged"
status: merged
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

Converted the four batch-5 clients to the T-0506 Effect pipeline with the
shared lenient error envelope (`errorFieldsOf` from `api-error-body.ts`).
No local `ErrorBodySchema` anywhere. Same exports, same error classes,
statuses, codes and messages; all existing tests unchanged and green.

What changed (4 files):
- `apps/mobile/src/lib/auth-api.ts`: `MeSchema` (`jid` lenient null via
  `Unknown.pipe(withDecodingDefault(null), decodeTo(NullOr(String)))`,
  copying `connections-api.ts`); `fetchMe`/`updateMe` run through a shared
  `requestEffect` + `Effect.runPromise` edge with `AuthApiError` mapping
  (network 0/`network_error`, envelope code/message with the old per-field
  fallbacks, 200/`invalid_response`). `checkInvite` keeps its unauthenticated
  GET, no auth header, exact same init — it decodes `{ valid }` with an
  optional-boolean struct and returns `valid === true`, `false` for
  non-OK/non-object bodies. Never logs cookies or tokens.
- `apps/mobile/src/lib/machines-api.ts`: `MachineSchema` (strict status
  literals, `online` optional boolean so a missing key stays omitted),
  `PairingCodeSchema`, `MachineIdSchema` (`machineId` required null|string,
  so a missing key still fails), raw-array `MachineListSchema`. deny/delete
  use a `Schema.Unknown` accept-any `parseIgnored` (204 empty body, same as
  the old `() => ({ok:true})`). Same bearer headers, paths, verbs and JSON
  bodies. Removed the hand `isRecord`/`isString` guards.
- `apps/mobile/src/lib/ais-api.ts`: `PublicAiSchema` (`machineId` lenient
  null, always present like the old guard; unknown fields such as
  `avatarUrl` dropped), `ConnectionSchema` (`label` lenient null),
  bare-array list schemas. `deleteAi` accepts any 2xx body. `buildCreateBody`
  untouched.
- `apps/mobile/src/lib/invite-links-api.ts`: `GroupInviteLinkSchema`
  (`label`/`maxUses`/`expiresAt` required-nullable: explicit null passes,
  missing/wrong-type fails), `JoinPreviewSchema` (`groupId`/`kind`
  optional-strict: absent omitted, wrong-type fails), `{links}` envelope
  list schema, accept-any `parseRevoke`. `extractJoinToken`,
  `joinFailureMessage`, `resolveGroupChat` byte-identical.

Deviation found while testing: the `checkInvite` test pins the exact
`fetch` init (`{headers:{accept}}`), so that one call does NOT pass an
abort `signal` (the bearer `requestEffect`s do, per the recipe).

Single-file tests run (all pass, files untouched):
- `auth-api.test.ts`: 6 passed
- `machines-api.test.ts`: 13 passed
- `ais-api.test.ts`: 18 passed
- `invite-links-api.test.ts`: 15 passed

Gate (from repo root, `pnpm gate`):
- `gate: 5 changed file(s) against main`
- `PASS install (frozen) (4.9s)`, `PASS format (113.2s)`, `PASS lint (1.1s)`,
  `PASS typecheck (33.5s)`, `PASS tests @zilar/mobile (25.8s)`
- `scope: every changed file is inside the Allowed files`
- `GATE PASS`
- (First gate run failed on prettier in 2 files; fixed with
  `prettier --write` on those files only. Second run failed on 2 unused
  single-item parsers; removed them. Third run passed.)

Security checklist: no cookies/tokens reach logs or errors (error mapping
only forwards the server's `code`/`message` on failure paths, as before);
no new routes; no permission/cap logic on the client side; audit n/a.

No new dependencies. No open questions.

## Review (written by Claude)

Approved (lead, 2026-10-08). The auth, machines, ais and invite-links mobile clients are on Effect Schema plus the T-0506 pipeline and the shared envelope, with the same exports, tolerances and headers; checkInvite stays unauthenticated. phone:smoke with ZILAR_ROUTES covering /, /ais, /ais/new, /settings/machines and /settings/profile: all passed, and the screenshots render (empty states match the test user). Pre-review clean.
