---
id: T-1292
title: "AI connections: replace a provider key in place (a new PATCH on a connection, plus a 'Replace key' action on web) so the AIs using it keep working (AI-20); web AI forms show plain fallback text for network errors instead of 'Failed to fetch' (AI-21); key handling tested"
status: todo
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
`apps/server/src/connections/*.ts`, `apps/server/src/agents/*.ts`, `packages/api-contract/src/**/*.ts`, `apps/web/src/components/ais/*.tsx`, `apps/web/src/components/ais/*.ts`, `apps/web/src/components/connections/*.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api/*.ts`, `apps/web/src/mock/*.ts`, `packages/mock-backend/src/**/*.ts`, `packages/chat-core/src/ai-errors.ts`, `work/T-1292-ai-connection-key.md`.

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

## Review (written by Claude)
