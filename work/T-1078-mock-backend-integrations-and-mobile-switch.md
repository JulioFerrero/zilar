---
id: T-1078
title: "Mock backend F6 + H2-5: integrations domain in @zilar/mock-backend; mobile integrations run on it; delete integrations-mock.ts"
status: todo
milestone: M5
branch: task/T-1078-mock-backend-integrations-and-mobile-switch
model: auto
effort: default
depends_on: [T-1076]
estimate: 0.25 day
---

# T-1078: Integrations in the shared mock backend, and mobile on it

## Spec (written by Claude, do not edit)

### Why
The lead read main (2026-10-11):
- **The contract** `packages/api-contract/src/integrations.ts` (114 lines) has `GET /settings/integrations`, `PUT`/`DELETE /settings/integrations/telegram` and `PUT /settings/integrations/email`.
- **`@zilar/mock-backend` has no `integrations` domain** (`packages/mock-backend/src/domains/`). The old web `mock/api.ts` had none either, so web mock mode answers 404 there today (`apps/web/src/mock/backend.ts`).
- **Mobile** keeps its own mock in `apps/mobile/src/components/integrations/integrations-mock.ts` (178 lines).
  - Its scenarios are `'default' | 'unconfigured' | 'not-owner' | 'error'` (`:19`).
  - Its default seed is at `:64-75`: Telegram configured and stored; email configured, from `Zilar <hello@example.com>`; voice not configured.
  - It is picked by `use-integrations-api.ts:28-42`. The only caller is `app/settings/integrations.tsx:50`, which reads only `{ api }`. The only importer of `integrations-mock` is the hook.
- **The factory:** `createIntegrationsApi` in `apps/mobile/src/lib/integrations-api.ts:81`.
- **The pattern:** `apps/mobile/src/components/machines/use-machines-api.ts`:
  - `mockToken` from `@/mock/gate`, and `mockFetch` from a guarded `require('@/mock/backend')`;
  - a pure `…MockActive(envMock, params, paramAllowed)` gate;
  - the handle `{ api, mock }`.

### What to build
1. **A new domain** `packages/mock-backend/src/domains/integrations/` (`index.ts`, `routes.ts`, `seed.ts`, `state.ts`), in the shape of `pins`, plus one alphabetical line in `domains/index.ts`.
   - **Routes:** mirror the mobile mock's behaviour and its default seed.
   - **Never store or return a secret.** A `PUT` records only "configured" and the non-secret fields, such as the email `from`. Never echo the bot token or the API key back, as the server does not.
   - **Shapes:** every response decodes with the contract schema.
2. **Probe first,** with a throwaway script that you do not commit. Call `createMockBackend({ delayMs: 0 }).http(path, init)` for every method and path `createIntegrationsApi` uses, and decode each response with the contract schema. Run it from `@zilar/web` if decoding needs `effect`, as T-1067 did. If any call fails, stop and report.
3. **`use-integrations-api.ts`** follows the machines pattern: `createIntegrationsApi(mockToken, mockFetch, API_URL)` in mock mode, and the handle `{ api, mock }`. The scenarios are gone (mock-plan Q2).
4. **Delete `integrations-mock.ts`,** after `grep -rn` across `apps/mobile` confirms that nothing else imports it.
5. **No tests.** No other files change, and every file is under 400 lines.

The lead's checks:
- **phone, mock mode:** Settings › Integrations shows Telegram and email configured; remove Telegram, then it reads not configured;
- **web, `?mock=1`:** Settings › Integrations loads.

### Read first
`AGENTS.md`, `packages/mock-backend/src/domains/pins/`, `packages/api-contract/src/integrations.ts`, `apps/mobile/src/components/integrations/integrations-mock.ts`, `apps/mobile/src/lib/integrations-api.ts`, and `apps/mobile/src/components/machines/use-machines-api.ts`.

### Allowed files
`packages/mock-backend/src/domains/integrations/index.ts`, `packages/mock-backend/src/domains/integrations/routes.ts`, `packages/mock-backend/src/domains/integrations/seed.ts`, `packages/mock-backend/src/domains/integrations/state.ts`, `packages/mock-backend/src/domains/index.ts`, `apps/mobile/src/components/integrations/use-integrations-api.ts`, `apps/mobile/src/components/integrations/integrations-mock.ts`, `work/T-1078-mock-backend-integrations-and-mobile-switch.md`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the decoded probe for every route, and the grep for `integrations-mock`.

---

## Report (written by the worker when done)

## Review (written by Claude)
