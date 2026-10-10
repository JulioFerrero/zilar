---
id: T-1073
title: "Mock backend F4: push (config, subscriptions, settings, test) and voice transcription domains in @zilar/mock-backend"
status: todo
milestone: M5
branch: task/T-1073-mock-backend-push-voice
model: auto
effort: default
depends_on: [T-1059]
estimate: 0.25 day
---

# T-1073: Push and voice transcription in the shared mock backend

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mock-sweep-status.md` §1b: the shared backend has no push or voice-transcription routes. Web still serves them from `apps/web/src/mock/api.ts` (main, 2026-10-11):
- **push:** `:1332-1405` (config, subscriptions create, list and delete, settings get and put, test);
- **voice:** `:1407-1420` (`GET /voice/transcription`, `POST /voice/transcript`).

The contract is `packages/api-contract/src/push.ts`: `GET /push/config`, `POST`/`GET /push/subscriptions`, `DELETE /push/subscriptions/:id`, `GET`/`PUT /push/settings` and `POST /push/test`. The voice-transcription routes come from the server's `apps/server/src/voice-transcription/api.ts` and their contract group.

These are the last fallbacks web needs, apart from avatars.

### What to build
1. **New domains** `push` and `voice-transcription` under `packages/mock-backend/src/domains/`, in the same module shape as `pins` (T-1044): `tables.ts`, seed, state, routes and index, plus one alphabetical line each in `domains/index.ts`. A stateless domain may skip `tables`, seed and state, like `handles`.
   - Mirror web's mock behaviour and data from the anchors above.
2. **Response shapes:** every response decodes with its contract schema. Find the voice-transcription contract group with `grep` in `packages/api-contract/src/`, and name it in the Report.
3. **Scope:** no app files change, and no tests. Prove it in the Report with a throwaway script against `createMockBackend()`, decoding each response. Run it from `@zilar/web` if decoding needs `effect`, as T-1067 did.
4. **Size:** every file is under 400 lines.

### Read first
`AGENTS.md`, `packages/mock-backend/src/domains/pins/` (the shape), `packages/mock-backend/src/domains/handles/` (a stateless domain), `packages/api-contract/src/push.ts`, `apps/web/src/mock/api.ts:1325-1425`, and `work/T-1067-mock-backend-contacts-blocks-handles.md` (its Report).

### Allowed files
`packages/mock-backend/src/domains/push/index.ts`, `packages/mock-backend/src/domains/push/routes.ts`, `packages/mock-backend/src/domains/push/seed.ts`, `packages/mock-backend/src/domains/push/state.ts`, `packages/mock-backend/src/domains/push/tables.ts`, `packages/mock-backend/src/domains/voice-transcription/index.ts`, `packages/mock-backend/src/domains/voice-transcription/routes.ts`, `packages/mock-backend/src/domains/voice-transcription/seed.ts`, `packages/mock-backend/src/domains/voice-transcription/state.ts`, `packages/mock-backend/src/domains/voice-transcription/tables.ts`, `packages/mock-backend/src/domains/index.ts`, `work/T-1073-mock-backend-push-voice.md`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the decoded proof for each new route.

---

## Report (written by the worker when done)

## Review (written by Claude)
