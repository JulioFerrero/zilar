---
id: T-0303
title: "Mobile mock mode: Settings → Integrations gets an owner mock, so the cards can be tested on the emulator"
status: merged
milestone: M5
branch: task/T-0303-mobile-integrations-mock
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0303: Integrations mock

## Spec (written by Claude, do not edit)

### Why
Emulator QA runs on a mock build. In QA run 13 Settings → Integrations showed only the owner lock, because `useIntegrationsApi` always calls the real server and the mock user is not the owner. So the Email, Voice transcription and Telegram cards have never been checked on a device.

Connections already has a mock beside its hook; this task adds the same for Integrations.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/integrations/use-integrations-api.ts`:** returns `{ api: createIntegrationsApi(getSessionToken) }`. Its comment says "There is no mock scenario".
- **`apps/mobile/src/lib/integrations-api.ts`:**
  - lines 69-77: the `IntegrationsApi` interface (`getIntegrationsStatus`, `saveTelegramBotToken`, `removeTelegramBotToken`, `saveEmailSettings`, `getVoiceTranscriptionStatus`, `saveVoiceTranscriptionSettings`, `removeVoiceTranscriptionSettings`);
  - line 79: `IntegrationsApiError(status, code, message)`;
  - lines 25-46: the status shapes; `IntegrationsStatus` is `{ telegram, email, voiceTranscription?, canManage }`.
- **The pattern to copy:**
  - `apps/mobile/src/components/connections/use-connections-api.ts`: `useGlobalSearchParams`, `process.env.EXPO_PUBLIC_ZILAR_MOCK`, `mockParamAllowed` from `@/mock/gate`, `useMemo`;
  - `apps/mobile/src/components/connections/connections-mock.ts`:
    - `connectionsMockScenario(env, params, paramAllowed)` with scenarios `'default' | 'empty' | 'error'`;
    - state kept at module scope so it survives navigation;
    - secrets are dropped the moment they are saved.
- **`apps/mobile/src/app/settings/integrations.tsx`:** line 70 shows the lock (`'forbidden'`) when `getIntegrationsStatus` rejects with `status === 404`.
- **`apps/mobile/src/components/integrations/integrations-screen.test.tsx`:** line 65 mocks `use-integrations-api` completely, so it is not affected.

### What to build
1. New file `apps/mobile/src/components/integrations/integrations-mock.ts`, mirroring `connections-mock.ts`.
   - Export `IntegrationsMockScenario = 'default' | 'unconfigured' | 'not-owner' | 'error'`, plus `integrationsMockScenario(env, params, paramAllowed)` with the same parsing rules as `connectionsMockScenario`.
   - Export `createMockIntegrationsApi(scenario)`, which returns an `IntegrationsApi`:
     - **`default`:**
       - telegram `{ configured: true, source: 'stored' }`;
       - email `{ configured: true, source: 'stored', from: 'Zilar <hello@example.com>' }`;
       - voice `{ configured: false, baseUrl: null, model: null }`;
       - `canManage: true`.
     - **`unconfigured`:** everything off, with `canManage: true`.
     - **`not-owner`:** `getIntegrationsStatus` rejects with `new IntegrationsApiError(404, 'not_found', 'Not found')`.
     - **`error`:** `getIntegrationsStatus` rejects with `IntegrationsApiError(500, 'server_error', 'Mock failure')`.
     - **Saves and removes:** they update the module-scope state, so a reload shows the change. Secrets are never stored: saving a bot token only flips `configured`/`source`, and saving email keeps `from` but not the key.
     - **`getVoiceTranscriptionStatus`:** returns `{ enabled: voice.configured }`.
2. `use-integrations-api.ts` picks the mock exactly the way `use-connections-api.ts` does. Return `{ api, scenario }`, keeping the `IntegrationsApiHandle` type compatible, and replace the "no mock scenario" comment.
3. New test `apps/mobile/src/components/integrations/integrations-mock.test.ts`:
   - scenario parsing (`'1'` → default, `'not-owner'`, unknown → null, a param ignored when not allowed);
   - `not-owner` rejects with status 404;
   - saving a bot token flips `configured` and the token string appears nowhere in a later `getIntegrationsStatus` result (`JSON.stringify` check);
   - saving email keeps `from`.

### Read first
`AGENTS.md`, the two connections files above, `apps/mobile/src/lib/integrations-api.ts`, `apps/mobile/src/components/integrations/use-integrations-api.ts`, `apps/mobile/src/app/settings/integrations.tsx`.

### Allowed files
`apps/mobile/src/components/integrations/integrations-mock.ts`, `apps/mobile/src/components/integrations/integrations-mock.test.ts`, `apps/mobile/src/components/integrations/use-integrations-api.ts`, `work/T-0303-mobile-integrations-mock.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot integrations
pnpm gate
```

### Acceptance
- On a mock build, Settings → Integrations shows the three cards (`default`), and `?mock=not-owner` shows the lock.
- Outside mock mode nothing changes.
- No secret is kept in mock state.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Built the Integrations mock beside the hook, mirroring `connections-mock.ts`.

Changed files:
- `apps/mobile/src/components/integrations/integrations-mock.ts` (new): `IntegrationsMockScenario = 'default' | 'unconfigured' | 'not-owner' | 'error'`, `integrationsMockScenario` with the same parsing rules as `connectionsMockScenario`, `createMockIntegrationsApi` with module-scope per-scenario state. `default` = telegram stored + email stored (`Zilar <hello@example.com>`) + voice off + `canManage: true`; `unconfigured` = everything off; `not-owner` rejects `getIntegrationsStatus` with `IntegrationsApiError(404, 'not_found', ...)`; `error` rejects with `(500, 'server_error', 'Mock failure')`. Saves flip `configured`/`source` and keep `from` (email) / `baseUrl`+`model` (voice) without storing secrets; removes clear the flags. `getVoiceTranscriptionStatus` returns `{ enabled: voice.configured }`. Also exports `resetIntegrationsMock` for test isolation.
- `apps/mobile/src/components/integrations/use-integrations-api.ts`: picks the mock via `useGlobalSearchParams` + `EXPO_PUBLIC_ZILAR_MOCK` + `mockParamAllowed`, exactly like `use-connections-api.ts`. Returns `{ api, scenario }`; `IntegrationsApiHandle` stays compatible (screen destructures `{ api }`).
- `apps/mobile/src/components/integrations/integrations-mock.test.ts` (new): scenario parsing (`'1'` → default, `'not-owner'`, unknown → null, param ignored when not allowed), `not-owner` → 404, bot token never appears in later status JSON, email save keeps `from`.

Commands and real results:
- `pnpm install`: pass (12.7s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/integrations/integrations-mock.test.ts`: 8 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/integrations/integrations-screen.test.tsx`: 10 passed (unaffected, still mocks the hook).
- `pnpm gate` (first run): GATE FAIL on format (`integrations-mock.test.ts` prettier style); fixed with `pnpm exec prettier --write` on the three touched files (npx was blocked by policy).
- `pnpm gate` (final): `PASS install / format / lint / typecheck / tests @zilar/mobile`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

Deviations: none. `error`/`not-owner` scenarios also reject saves/removes and the voice status (mirrors `connections-mock.ts` where every method fails in `error`); spec only pins `getIntegrationsStatus`.

Security checklist: no secrets stored or logged (token/key dropped at save, `void botToken` to avoid retention); no new routes; no permission changes — mock only, real path untouched.

## Review (written by Claude)

**Approved.** Clean pre-review (1 nit), no fix rounds (Muse, peak).
- `use-integrations-api.ts` picks the mock exactly like the connections hook.
- `not-owner` gives 404 (the lock), and `error` gives 500.
- The bot-token test checks that the secret never appears in later status.

**Nit, accepted:** the email and voice tests do not also assert that `resendApiKey` and `apiKey` are dropped. The code drops them (`saveEmailSettings` keeps only `from`; the voice save keeps only `baseUrl` and `model`). Since this is a mock, the gap stays.

**Still to do:** the next emulator QA can open Settings → Integrations on a mock build.
