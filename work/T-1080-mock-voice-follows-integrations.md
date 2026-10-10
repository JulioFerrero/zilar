---
id: T-1080
title: "Mock backend: GET /voice/transcription follows the integrations voice setting; seed voice as configured; fix stale comments"
status: todo
milestone: M5
branch: task/T-1080-mock-voice-follows-integrations
model: auto
effort: default
depends_on: [T-1078]
estimate: 0.1 day
---

# T-1080: Mock voice transcription follows the integrations setting

## Spec (written by Claude, do not edit)

### Why
These are the T-1078 pre-review follow-up and nit. The lead read main (2026-10-11):
- **The mismatch:**
  - `packages/mock-backend/src/domains/voice-transcription/routes.ts:28-30` always answers `{ enabled: true }`;
  - the integrations seed has voice off: `voiceConfigured: false` in `packages/mock-backend/src/domains/integrations/seed.ts`;
  - so in mock mode the Integrations screen says "Not set up" while voice messages still offer transcripts.
- **What T-1073 mirrored:** "enabled" came from web's old mock, so mock mode showed transcripts.
- **The state:** `data.integrations.voiceConfigured`, declared in `packages/mock-backend/src/domains/integrations/state.ts:16`. Saving voice turns it on and removing it turns it off (`:63`, `:66`).
- **Stale comments:** `integrations/seed.ts:1-4` and `integrations/routes.ts:3` cite `apps/mobile/src/components/integrations/integrations-mock.ts`, which T-1078 deleted.

### What to build
1. **The route:** `voice-transcription/routes.ts` answers `{ enabled: data.integrations.voiceConfigured }`, and the `_data` parameter becomes `data`.
2. **The seed:** in `integrations/seed.ts`, seed voice as configured: `voiceConfigured: true`, `voiceBaseUrl: 'https://api.openai.com/v1'`, `voiceModel: 'whisper-1'`. Mock mode keeps showing transcripts, and the Integrations screen agrees. Seed no key.
3. **The comments:** in `integrations/seed.ts` and `integrations/routes.ts`, drop the citations of the deleted mobile mock, and say the seed is the shared default.
4. **Proof in the Report:** a throwaway script, not committed, run against `createMockBackend()`:
   - `GET /voice/transcription` gives `enabled: true`;
   - then `DELETE` the voice integration (find the method and path in `routes.ts`), and the same GET gives `enabled: false`.
5. **No other changes,** and no tests.

### Read first
`AGENTS.md`, `packages/mock-backend/src/domains/voice-transcription/routes.ts`, and `packages/mock-backend/src/domains/integrations/`.

### Allowed files
`packages/mock-backend/src/domains/voice-transcription/routes.ts`, `packages/mock-backend/src/domains/integrations/seed.ts`, `packages/mock-backend/src/domains/integrations/routes.ts`, `work/T-1080-mock-voice-follows-integrations.md`.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report has the proof from step 4.

---

## Report (written by the worker when done)

## Review (written by Claude)
