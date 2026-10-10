---
id: T-1080
title: "Mock backend: GET /voice/transcription follows the integrations voice setting; seed voice as configured; fix stale comments"
status: merged
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
- **What T-1073 mirrored:** "enabled" came from the old `apps/web/src/mock/api.ts:1037-1040` (its `voice/transcription` branch, deleted in T-1074; see `git show 39438d8f~1:apps/web/src/mock/api.ts`), so mock mode showed transcripts.
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

### What I did

Made the mock backend's voice-transcription endpoints follow the integrations
voice setting, and fixed the stale comments.

1. **Route** — `packages/mock-backend/src/domains/voice-transcription/routes.ts`:
   renamed the `_data` parameter to `data` and changed
   `const status: EnabledStatus = { enabled: true };` to
   `{ enabled: data.integrations.voiceConfigured }`.
2. **Seed** — `packages/mock-backend/src/domains/integrations/seed.ts`: voice is
   now seeded as configured (`voiceConfigured: true`,
   `voiceBaseUrl: 'https://api.openai.com/v1'`, `voiceModel: 'whisper-1'`). No
   key is seeded (secrets stay write-only).
3. **Comments** — dropped the citations of the deleted
   `apps/mobile/src/components/integrations/integrations-mock.ts` in
   `integrations/seed.ts` and `integrations/routes.ts`; the seed is described as
   the shared default.
4. **No other changes, no tests.**

### Files changed

- `packages/mock-backend/src/domains/voice-transcription/routes.ts`
- `packages/mock-backend/src/domains/integrations/seed.ts`
- `packages/mock-backend/src/domains/integrations/routes.ts`
- `work/T-1080-mock-voice-follows-integrations.md` (status/report)

### Proof (step 4) — throwaway script, not committed

I ran a temporary vitest file (deleted afterwards) against `createMockBackend()`:

```
GET /voice/transcription after seed -> {"enabled":true}
DELETE /settings/integrations/voice-transcription -> 200
GET /voice/transcription after delete -> {"enabled":false}
```

Test Files 1 passed (1); Tests 1 passed (1).

### Commands run and real results

- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/t1080-proof.test.ts`: 1 file, 1 test passed (throwaway proof above, then deleted).
- `pnpm --filter @zilar/mock-backend typecheck`: passed, no output.
- `pnpm gate`:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (0.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.0s)
  PASS  effect  (1.7s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes

- None. The seed comment now reads "the shared default, with Telegram and email
  configured and voice transcription set up." I removed the "(T-1078)" reference
  from the seed comment but kept it in `integrations/routes.ts` (that file is
  T-1078's route file); the spec only asked to drop the mobile-mock citations.

### Problems / open questions

- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:**
  - `GET /voice/transcription` answers `{ enabled: data.integrations.voiceConfigured }`;
  - the integrations seed sets voice up, with `https://api.openai.com/v1` and `whisper-1` and no key;
  - the comments no longer cite the deleted mobile mock.
- **The proof** (the worker's throwaway script): `enabled: true` after the seed, and `enabled: false` after the voice integration is deleted.
- **Check:** the gate passed. It is a backend-only change with no app files, so the lead ran no UI check.
