---
id: T-1078
title: "Mock backend F6 + H2-5: integrations domain in @zilar/mock-backend; mobile integrations run on it; delete integrations-mock.ts"
status: merged
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

### What I did

Added an `integrations` domain to the shared mock backend and pointed the mobile
integrations hook at it, then deleted the app-local mock.

- **`packages/mock-backend/src/domains/integrations/`** (`index.ts`, `routes.ts`,
  `seed.ts`, `state.ts`), in the shape of `pins`:
  - Routes: `GET /settings/integrations`, `PUT`/`DELETE
    /settings/integrations/telegram`, `PUT /settings/integrations/email` (the
    contract's group), plus `PUT`/`DELETE
    /settings/integrations/voice-transcription` for the voice settings routes
    `createIntegrationsApi` uses (not in the contract yet, mirroring
    `apps/server/src/voice-transcription/`).
  - Seed mirrors the mobile mock's `default` scenario: Telegram configured and
    stored; email configured and stored, from `Zilar <hello@example.com>`; voice
    not configured. `source` is `'stored'` while configured, else `null`.
  - Secrets are write-only: a `PUT` records only "configured" and the non-secret
    fields (the email `from`, the voice base URL/model). The bot token, the
    Resend key and the transcription key are accepted and dropped, never stored
    and never echoed.
- **`packages/mock-backend/src/domains/index.ts`**: one import and one array
  entry for `integrationsDomain`, alphabetical (after `handles`, before
  `invite-links`).
- **`apps/mobile/src/components/integrations/use-integrations-api.ts`**: follows
  `use-machines-api.ts`. A pure `integrationsMockActive(envMock, params,
  paramAllowed)` gate, `createIntegrationsApi(mockToken, mockFetch, API_URL)`
  from a guarded `require('@/mock/backend')`, and the handle `{ api, mock }`.
  The scenarios are gone (mock-plan Q2).
- **Deleted `apps/mobile/src/components/integrations/integrations-mock.ts`**.

### Files changed

- New: `packages/mock-backend/src/domains/integrations/{index,routes,seed,state}.ts`.
- Modified: `packages/mock-backend/src/domains/index.ts`,
  `apps/mobile/src/components/integrations/use-integrations-api.ts`, this task
  file.
- Deleted: `apps/mobile/src/components/integrations/integrations-mock.ts`.

Every file is well under 400 lines. No tests (UI + mock code).

### Commands and real results

- `pnpm install`: done.
- `pnpm --filter @zilar/mock-backend typecheck`: clean (no output).
- Throwaway probe (temporary test, run then deleted; kept out of the repo):
  `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/mock/t1078-proof.test.ts`
  → **1 passed**, every response decoded with its schema. It ran from `@zilar/web`
  because the proof needs `effect` to decode and `@zilar/mock-backend`
  deliberately does not depend on it. The file was deleted before the gate.
- `grep -rn "integrations-mock" apps/mobile` → **no matches** (confirms nothing
  else imported the deleted mock).
- `pnpm gate` (repo root):

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (0.9s)
PASS  lint  (1.0s)
PASS  typecheck  (2.7s)
PASS  effect  (0.7s)
SKIP tests @zilar/mobile (no nearby test files)
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The first gate run failed only on `format` for
`use-integrations-api.ts` and `routes.ts`; I ran `prettier --write` on both and
the next gate passed.

### Decoded proof (one line per route, real output)

```
PROOF GET /settings/integrations -> 200 {"telegram":{"configured":true,"source":"stored"},"email":{"configured":true,"source":"stored","from":"Zilar <hello@example.com>"},"voiceTranscription":{"configured":false,"baseUrl":null,"model":null},"canManage":true}
PROOF PUT telegram -> 200 {"ok":true}
PROOF DELETE telegram -> 200 {"ok":true}
PROOF PUT email -> 200 {"ok":true}
PROOF GET /voice/transcription -> 200 {"enabled":true}
PROOF PUT voice-transcription -> 200 {"ok":true}
PROOF DELETE voice-transcription -> 200 {"ok":true}
```

`GET /settings/integrations` and each `PUT`/`DELETE` decode with
`IntegrationsStatus` / `IntegrationsOk`. `GET /voice/transcription` decodes with
the mobile module's hand-written `{ enabled: boolean }` and the voice
`PUT`/`DELETE` with `{ ok: boolean }` (these routes are outside the contract).
The probe also asserts that after saving a Telegram token, an email key and a
voice key the status JSON contains none of them (write-only).

### Deviations, problems and notes

- The voice settings routes are not in the contract; I added them to the
  integrations domain so every path `createIntegrationsApi` calls is served.
  `GET /api/voice/transcription` is still served by the pre-existing stateless
  `voice-transcription` domain, which hardcodes `{ enabled: true }`; the
  integrations seed has voice not configured. The screen reads voice state from
  `GET /settings/integrations` (`data.voiceTranscription`), not from
  `/voice/transcription`, so the mismatch is not visible on the screen; I left
  the other domain alone (outside the Allowed files).
- The `integrations` domain needs a shared type and the `MockSeed`/`MockData`
  module augmentation, which `pins` puts in `tables.ts`. That file is not in the
  Allowed files, so the type and augmentations live in `state.ts` instead.
- No open questions.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 2 nits and 2 follow-ups.**
- **The change:**
  - a new `integrations` domain in `@zilar/mock-backend`. Telegram and email are configured in the seed, voice is not. The bot token and the API key are validated and dropped, never stored or echoed;
  - `use-integrations-api.ts` runs on `mockFetch`, with the handle `{ api, mock }`;
  - `integrations-mock.ts` (178 lines) is deleted.
- **The lead's phone smoke** (mock): Settings › Integrations shows:
  - **Email:** Connected, "Now: Zilar <hello@example.com>";
  - **Voice transcription:** Not set up;
  - **Telegram bot:** Connected. Remove asks "Remove the Telegram token?", and after Confirm it reads "Not set up".
- **The lead's web check** (`?mock=1`): Settings › Integrations loads Email, Telegram and Voice. Since T-1074 it had answered 404.
- **The nits:** comments cite the deleted mobile mock; `setEmail` skips the contract's `isMailbox` check.
- **The follow-ups:**
  - `voice-transcription/routes.ts:29` says enabled while the integrations seed says voice is not set up;
  - `docs/audit/mock-sweep-status.md` and `mock-plan.md` still list `integrations-mock.ts`.
- **Check:** the gate passed.
