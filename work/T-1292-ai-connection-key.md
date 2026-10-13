---
id: T-1292
title: "AI connections: replace a provider key in place (a new PATCH on a connection, plus a 'Replace key' action on web) so the AIs using it keep working (AI-20); web AI forms show plain fallback text for network errors instead of 'Failed to fetch' (AI-21); key handling tested"
status: merged
milestone: M5
branch: task/T-1292-ai-connection-key
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1292: Replace a provider key; plain AI form errors

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-features-audit.md`:
- **AI-20** (P2, `:300`): connections can be listed, created, tested and deleted, but not edited (`apps/server/src/connections/service.ts`, `apps/server/src/connections/api.ts`, `packages/api-contract`). A key-rejected reply sends the owner to Connections, but replacing the key means creating a new connection, switching every AI to it, then deleting the old one. The audit's fix:
  - a PATCH with a new key that clears `litellm_model_id` for the AIs using it;
  - `ensureAiModel` then re-registers them.
- **AI-21** (P2, `:309`): `describeAiError` returns `error.message` for anything that isn't an `ApiError` (`apps/web/src/components/ais/errors.ts`), so a network failure reads "Failed to fetch". The shared table's default case also passes server text through (`packages/chat-core/src/ai-errors.ts`).

**First recheck both findings on main.** If one is already fixed, say so with `file:line` and skip it.

### What to build
1. **Server:**
   - a new PATCH at `/api/connections/{id}` (follow the existing route and contract style; add it to `packages/api-contract`) that takes a new key;
   - owner only, with the same validation and encryption as create (`apps/server/src/connections/crypto.ts`), stores the key and clears `litellm_model_id` for the owner's AIs on that connection;
   - optionally runs the existing probe, and answers like create. Never log or return the key.
2. **Web:** a "Replace key" action on a connection in the existing Connections UI (find it), with a password-type input, plus success and error states.
3. **AI-21:** non-`ApiError` errors use the given `fallback`, and the shared table's default case uses a generic line, not server text.
4. **Tests** (keys), up to 3, in `apps/server/src/connections/*.test.ts`:
   - the owner replaces a key, it's stored encrypted, and the AIs' model id is cleared;
   - another user gets 404;
   - the key never appears in the response.

### Read first
`AGENTS.md`, `docs/audit/ai-features-audit.md` (`:300-320`), `apps/server/src/connections/*.ts`, `apps/web/src/components/ais/errors.ts`, `packages/chat-core/src/ai-errors.ts` and the web Connections UI (find it).

### Allowed files
`apps/server/src/connections/*.ts`, `apps/server/src/agents/*.ts`, `packages/api-contract/src/**/*.ts`, `apps/web/src/components/ais/*.tsx`, `apps/web/src/components/ais/*.ts`, `apps/web/src/components/connections/*.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api/*.ts`, `apps/web/src/mock/*.ts`, `packages/mock-backend/src/**/*.ts`, `packages/chat-core/src/ai-errors.ts`, `work/T-1292-ai-connection-key.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/connections --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. No migration.
- **The lead's check on the web mock:** Replace key on a connection shows success.

---

## Report (written by the worker when done)

**Status:** review. `pnpm gate` ends with `GATE PASS`; it lists **one** file outside the Allowed files (see "Scope / needs the lead's decision" below).

### Recheck of the two findings on main

Both are still present on `main` (base `e326c48ed`):

- **AI-20:** `packages/api-contract/src/connections.ts` had only `list` / `create` / `test` / `remove`, and `apps/server/src/connections/service.ts` had no update. Confirmed, not fixed.
- **AI-21:** `apps/web/src/components/ais/errors.ts:11` returned `error.message` for a non-`ApiError`, and `packages/chat-core/src/ai-errors.ts:38` (default case) returned `error.message`. Confirmed, not fixed.

### What I did

1. **Server (AI-20).**
   - `apps/server/src/connections/service.ts`: new `updateConnectionKey(db, { id, owner, encryptedKey })`. One `sql.withTransaction`: an owner-scoped `UPDATE provider_connections SET encrypted_key, updated_at = now() ... WHERE id AND owner RETURNING *`, then `UPDATE llm_virtual_keys SET litellm_model_id = NULL WHERE ai_id IN (SELECT id FROM ais WHERE provider_connection_id = <id> AND owner = <owner>)`. Returns the public row, or `null` when no owned row matched (nothing is cleared then).
   - `apps/server/src/connections/api.ts`: new PATCH `update` handler, mirroring `create`: `requireCipher()` (503) → manual body decode (400, same `Invalid JSON body` / `Invalid connection request` texts) → `updateConnectionKey` → 404 when `null`, else the `ConnectionView` (200). The key is encrypted with the same `crypto.ts` cipher and never logged or returned.
2. **Contract.** `packages/api-contract/src/connections.ts`: `UpdateConnectionPayload` (`{ key }`, same trim + 1..16384 rules as create) and `HttpApiEndpoint.patch('update', '/connections/:id', { params, payload, success: ConnectionView })`.
   The endpoint declares its payload for the typed client but is served with `handleRaw`, exactly like `create`, so `requireCipher` (503) still runs before the decode (400).
3. **Web API.** `apps/web/src/lib/api/ais.ts`: `replaceConnectionKey(id, key)` (trims the key, calls `client.connections.update`); re-exported from `apps/web/src/lib/api.ts`.
4. **Web UI.** `apps/web/src/routes/ConnectionsPage.tsx`: a "Replace key" icon action (`KeyRound` from lucide) on each connection row opens an inline form with a password-type `SecretInput`, Save/Cancel. Success shows "Key replaced"; a failure shows the fixed sentence (or "Paste your API key" when empty) via `role="alert"`.
5. **AI-21.** `apps/web/src/components/ais/errors.ts`: a non-`ApiError` now returns the caller's `fallback`. `packages/chat-core/src/ai-errors.ts`: the default case returns the fixed sentence `Something went wrong. Try again.`; I added an explicit `invalid_request` case that keeps the server's message, which the file's own comment already promised (it had been relying on the default case).
6. **Mock.** `packages/mock-backend/src/domains/connections/routes.ts`: `PATCH /api/connections/:id` returns the unchanged row (200) — the mock stores no keys — so the web mock shows success. 404 for an unknown id.
7. **Tests.** `apps/server/src/connections/update-key.test.ts` (new, 3 tests): (a) owner replaces a key → stored ciphertext changes and decrypts to the new key, and the AI's `litellm_model_id` is cleared; (b) another user → 404 and the stored key is untouched; (c) the response body never contains the old or new key (nor `encryptedKey`).

### Files changed

- `apps/server/src/connections/service.ts`
- `apps/server/src/connections/api.ts`
- `apps/server/src/connections/update-key.test.ts` (new)
- `packages/api-contract/src/connections.ts`
- `apps/web/src/lib/api/ais.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/ais/errors.ts`
- `apps/web/src/routes/ConnectionsPage.tsx` ← **outside Allowed files**
- `packages/chat-core/src/ai-errors.ts`
- `packages/mock-backend/src/domains/connections/routes.ts`
- `work/T-1292-ai-connection-key.md`

### Commands run (real results)

- `pnpm install` → up to date ("Done in 22s").
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/connections` → `Test Files 2 passed (2)`, `Tests 11 passed (11)`.
- `pnpm --filter @zilar/server exec vitest run src/connections --reporter=dot` (the task's Checks line) → `Test Files 2 passed (2)`, `Tests 11 passed (11)`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts` → `Tests 5 passed (5)` — the new PATCH route is swept and answers 401 unauthenticated.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/lib/api` → `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `pnpm gate` (from the repo root), after one earlier `format` failure on the new test file (fixed with `pnpm exec prettier --write apps/server/src/connections/update-key.test.ts`):

```
gate: 11 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.9s)
PASS  lint  (0.9s)
PASS  typecheck  (7.7s)
PASS  effect  (1.2s)
SKIP  tests @zilar/api-contract  (no nearby test files)
PASS  tests @zilar/chat-core  (1.6s)
SKIP  tests @zilar/mock-backend  (no nearby test files)
PASS  tests @zilar/server  (9.7s)
PASS  tests @zilar/web  (8.4s)
scope: 1 file(s) outside the Allowed files:
  apps/web/src/routes/ConnectionsPage.tsx
migration: every added migration continues from the base
GATE PASS
```

### Scope / needs the lead's decision

The Allowed files name `apps/web/src/components/connections/*.tsx`, but that directory has never existed in this repo (checked `git log --all`): the web Connections UI is `apps/web/src/routes/ConnectionsPage.tsx`, a route page. The "Replace key" action cannot ship on the Connections page without editing it, so I edited it — the single file outside scope. Please add `apps/web/src/routes/ConnectionsPage.tsx` to the Allowed files (or tell me to move the UI). I did not edit the Spec/Allowed-files block myself.

### Deviations / notes

- **Probe not run on replace** (it was optional in the spec): `create` does not probe either, so replace matches create and just returns the view. Say the word and I will add the probe.
- **No rate limit on PATCH**: `create` has none and there is no per-user connection cap, so replace matches create. Flagging because `AGENTS.md`'s checklist prefers a limit or a cap on writes.
- I did not add a mock-backend test (the spec caps tests at 3, in `apps/server/src/connections`, and UI/mock code gets no tests).
- No migration.

### Security checklist

- The plaintext key never enters `PublicConnection`/the wire, a log line or an error; the PATCH response is the same `ConnectionView` as create.
- The update and the model-id clear run in one transaction and both are owner-scoped, so another user's connection is not touched and the route answers the same 404 as an unknown id.
- `requireCipher` (503) and the decode (400) keep create's order; the new route is covered by the 401 sweep.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (2 nits, 2 follow-ups).**
- **Scope:** my spec named a nonexistent `components/connections/` folder, so I added `apps/web/src/routes/ConnectionsPage.tsx` to the Allowed files. The page is the right place.
- **Lead's check on the web mock:** Connections → the OpenAI key icon shows a hidden "New API key" field; a fake test value plus Save key shows "Key replaced".
- **Server:** the update runs in one transaction, owner-scoped, clears `litellm_model_id` for that owner's AIs on the connection, and never returns the key; 3 tests.
- **Follow-ups:**
  - the mobile twin `apps/mobile/src/components/ais/errors.ts:17` still shows `error.message` (next mobile batch);
  - the mock's PATCH accepts an empty key.
