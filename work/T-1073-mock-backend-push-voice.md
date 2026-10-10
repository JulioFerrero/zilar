---
id: T-1073
title: "Mock backend F4: push (config, subscriptions, settings, test) and voice transcription domains in @zilar/mock-backend"
status: merged
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

### What I did

Added the two new `@zilar/mock-backend` domains and their two lines in
`domains/index.ts`, mirroring web's mock (`apps/web/src/mock/api.ts:1330-1424`)
and the contract shapes:

- **`push`** (stateful, 5 files: `tables.ts`, `seed.ts`, `state.ts`,
  `routes.ts`, `index.ts`): `GET /push/config`, `GET`/`POST /push/subscriptions`,
  `DELETE /push/subscriptions/:id`, `GET`/`PUT /push/settings`, `POST /push/test`.
  Seed is web's: no devices, previews on (`api.ts:731-733`). The device row is
  the contract's `PushDevice`; subscribe mints `mock-push-device-N` plus
  `mock-node-<id>` and answers the contract's `RegisteredDevice`; an invalid
  body answers `400 invalid_subscription`; an unknown device on delete/test
  answers `404 Push device not found`; a non-boolean `showPreviews` answers
  `400 invalid_request`. Writes replace the array/boolean, never mutate in place.
- **`voice-transcription`** (stateless, 2 files: `routes.ts`, `index.ts`):
  `GET /voice/transcription` → `{ enabled: true }` and `POST /voice/transcript`
  → `{ text: 'Transcript of <url>' }`; an empty `url` answers
  `400 invalid_request`. No tables/seed/state, like `handles`.

### The voice-transcription contract group

Grepping `packages/api-contract/src/` for voice finds no route group for
transcription: only `VoiceIntegrationStatus` in the `integrations` group
(`packages/api-contract/src/integrations.ts:68-84`), which is the owner-settings
status, not these routes. The routes' group is **`voiceTranscription`**, defined
in `apps/server/src/voice-transcription/api.ts:64-88`:
`GET /voice/transcription` → `EnabledStatus`, `POST /voice/transcript` →
`TranscriptResult`, with the schemas in
`apps/server/src/voice-transcription/schemas.ts:20-21` (`{ enabled: boolean }`,
`{ text: string }`). Because those schemas live in `apps/server` and
`@zilar/mock-backend` depends only on `@zilar/api-contract`, `@zilar/chat-core`,
`@zilar/protocol` and `@zilar/xmpp-core`, the voice domain declares local
`EnabledStatus`/`TranscriptResult` interfaces that match the schemas exactly, and
the proof decodes the responses with the server's real schemas.

### Files changed

New: `packages/mock-backend/src/domains/push/{tables,seed,state,routes,index}.ts`
and `packages/mock-backend/src/domains/voice-transcription/{routes,index}.ts`.
Modified: `packages/mock-backend/src/domains/index.ts` (one import and one array
entry each, alphabetical: `push` after `public-groups`, `voice-transcription`
after `topics`). 8 files, none outside the Allowed files. Every file is under
400 lines.

### Commands and real results

- `pnpm install`: done.
- `pnpm --filter @zilar/mock-backend typecheck`: clean.
- Throwaway proof (temporary test, deleted before the gate; not part of the
  change):
  `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/mock/t1073-proof.test.ts`
  → **2 passed**. It ran from `@zilar/web` (as T-1067 did) because the proof
  needs `effect` to decode and the mock-backend package deliberately does not
  depend on it.
- `pnpm gate` (repo root):

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.6s)
PASS  typecheck  (0.7s)
PASS  effect  (0.4s)
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Decoded proof (one line per route, real output)

```
PROOF GET /push/config -> 200 {"vapidPublicKey":"mock-vapid-public-key","pushJid":"push.mock.test"}
PROOF GET /push/subscriptions (empty) -> 200 {"devices":[]}
PROOF POST /push/subscriptions -> 200 {"id":"mock-push-device-1","node":"mock-node-mock-push-device-1","jid":"push.mock.test"}
PROOF POST /push/subscriptions (invalid) -> 400 {"error":{"code":"invalid_subscription","message":"The push subscription is invalid"}}
PROOF GET /push/subscriptions -> 200 {"devices":[{"id":"mock-push-device-1","userAgent":"vitest","createdAt":"2026-10-10T22:19:24.529Z","lastUsedAt":null,"inactive":false}]}
PROOF GET /push/settings -> 200 {"showPreviews":true}
PROOF PUT /push/settings -> 200 {"showPreviews":false}
PROOF PUT /push/settings (invalid) -> 400 {"error":{"code":"invalid_request","message":"showPreviews must be a boolean"}}
PROOF POST /push/test -> 200 {"sent":true}
PROOF POST /push/test (missing) -> 404 {"error":{"code":"not_found","message":"Push device not found"}}
PROOF DELETE /push/subscriptions/:id -> 200 {"removed":true}
PROOF DELETE /push/subscriptions/:id (missing) -> 404 {"error":{"code":"not_found","message":"Push device not found"}}
PROOF GET /voice/transcription -> 200 {"enabled":true}
PROOF POST /voice/transcript -> 200 {"text":"Transcript of https://x.test/a.ogg"}
PROOF POST /voice/transcript (invalid) -> 400 {"error":{"code":"invalid_request","message":"url must not be empty"}}
```

Every 200 body above was passed through its contract schema with
`Schema.decodeUnknownSync`: `PushConfig`, `RegisteredDevice`, `PushDeviceList`,
`PushSettings`, `PushTestResult`, `PushRemoved` for push, and the server's
`EnabledStatus` and `TranscriptResult` for voice; all decoded.

### Deviations / notes

- **Voice schemas are not in `@zilar/api-contract`**, so the domain declares
  local interfaces matching the server schemas, and the proof decodes with the
  server's real schemas (see the group note above). If the lead wants the
  schemas shared, they would have to move into `@zilar/api-contract`.
- **Push device list/remove/test bodies are plain object literals**:
  `@zilar/api-contract` only exports *type* aliases for `PushConfig`,
  `PushDevice`, `PushSettings` and `RegisteredDevice`; `PushDeviceList`,
  `PushRemoved` and `PushTestResult` are schema *values* with no type alias, so
  those three are not annotated (they are still decoded in the proof).
- No app files changed and no tests committed (spec §3).

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits and 2 follow-ups.**
- **The change:** new `push` and `voice-transcription` domains in `@zilar/mock-backend`:
  - **push:** config, subscriptions create, list and delete, settings get and put, test. It mirrors web's mock;
  - **voice:** `GET /voice/transcription` and `POST /voice/transcript`.
  - All 8 files are under 120 lines, and no app files changed.
- **The proof:** a throwaway script decoded every new response with the real schemas: the push contract and the server's voice schemas.
- **Follow-up 1:** there is no `voiceTranscription` group in `@zilar/api-contract`, so the mock re-declares `EnabledStatus` and `TranscriptResult` locally. They could drift from the server's.
- **Follow-up 2:** `push/routes.ts:39`, noted in the pre-review.
- **Check:** the gate passed.
- **Next:** delete web's push and voice branches from `mock/api.ts`.
