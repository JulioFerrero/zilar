---
id: T-0570
title: "Effect Schema, server batch 3: push/config.ts, push/subscriptions.ts, ais/templates.ts and connections/providers.ts drop zod; same PushConfig type, defaults and boot-exit message; stale 'stays zod' comments fixed; tests unchanged"
status: merged
milestone: M5
branch: task/T-0570-effect-schema-server-batch-3
model: auto
effort: low
depends_on: [T-0557]
estimate: 0.5 day
---

# T-0570: push config and three small schema modules on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod everywhere.

**The pattern to copy is `apps/server/src/config.ts` (T-0504)**, which already moved the server env config to Effect Schema:
- `withDefault` (line 43);
- the port-from-text schema (around line 56-63);
- the `'true' | 'false'` boolean (around line 70);
- `Schema.decodeUnknownExit(schema, { errors: 'all' })` (line 462).

### Verified facts (do not re-derive)
1. **`apps/server/src/push/config.ts`** (115 lines):
   - `pushEnvSchema` (line 8):
     - `PUSH_ENABLED` is `'true' | 'false'`, defaults to `'false'` and maps to a boolean;
     - five optional strings of at least 1 character: VAPID public key, VAPID private key, VAPID subject, component JID and component secret;
     - `PUSH_COMPONENT_PORT` defaults to `'5347'`, must match `^\d+$`, becomes an int, and must be 1..65535;
     - `PUSH_COMPONENT_HOST` defaults to `'127.0.0.1'` and must match `^[A-Za-z0-9.-]+$`;
     - `PUSH_STORAGE_KEY` is optional, with at least 32 characters.
   - `type PushConfig` (47) comes from `z.infer`. **Keep the same shape**: `PUSH_ENABLED: boolean`, `PUSH_COMPONENT_PORT: number`, `PUSH_COMPONENT_HOST: string`, the rest optional `string`.
   - `loadPushConfig` (63) parses after `emptyPushSettingsAsUnset` and **throws** on any invalid value. `push/config.test.ts:24,25,41` expect `toThrow()`.
   - **`loadPushConfigOrExit`** (71). When the failure is on `PUSH_COMPONENT_HOST`, it prints the fixed message `Invalid push configuration: PUSH_COMPONENT_HOST must be a plain hostname (letters, digits, dots, hyphens)` and calls `process.exit(1)`. Any other failure is rethrown. It detects the host failure today with `z.ZodError` and the issue path. **Keep this behaviour.** The mechanism is your choice: an issue-path check on the Effect error, or a small typed error that `loadPushConfig` throws naming the failing keys. Never echo a value.
   - `pushConfigError` (91) is plain code; leave it unchanged.
   - Users: `apps/server/src/app.ts:27,415`, `apps/server/src/index.ts:37,260` and `apps/server/src/push/routes.test.ts:13,28`.
2. **`apps/server/src/push/subscriptions.ts`** (20 lines):
   - `WebPushKeysSchema`, `WebPushSubscriptionSchema` (endpoint: zod v4 `z.url()`, max 2048; `expirationTime?: number | null`; keys) and `UserAgentSchema`;
   - **no other file imports the schemas.** Only `type WebPushSubscription` is used, by `push/store.ts:6` and five push test files. Keep that type identical;
   - `isUrl` in `packages/protocol/src/common.ts:141` matches `z.url()`.
3. **`apps/server/src/ais/templates.ts`** (24 lines):
   - `AiTemplateSchema = z.enum(AI_TEMPLATES)`, which nobody imports (`ais/api.ts:52` imports `AI_TEMPLATES` only);
   - `type AiTemplate` comes from `z.infer`, so write it as `(typeof AI_TEMPLATES)[number]` or derive it from the Effect Schema;
   - `ais/service.ts:14` uses the type.
4. **`apps/server/src/connections/providers.ts`** (19 lines):
   - `ProviderIdSchema = z.enum(PROVIDER_IDS)`. After T-0557 no file imports it; check with grep;
   - `type ProviderId` is already plain TypeScript;
   - **`connections/api.ts`** has a local `ConnectionProvider` Literals schema (around line 86-90). Make it use the new Effect `ProviderIdSchema` from `./providers`. Fix the comments at `connections/api.ts` lines 21 and 86-87 that say providers "stays zod".
5. **The same stale comment in push:** `apps/server/src/push/api.ts` lines 15 and 92 say `WebPushSubscriptionSchema` "stays zod". Make `push/api.ts` use the new Effect schemas from `./subscriptions` **if it repeats the same rules** (read it first), or else fix the comments. **Response and request rules stay identical.**
- **Tests (all unchanged):** `apps/server/src/push/*.test.ts`, `apps/server/src/connections/*.test.ts`, `apps/server/src/ais/*.test.ts` and `apps/server/src/config.test.ts`.

### What to build
1. **Convert the four files to Effect Schema:**
   - the same rules, defaults and types;
   - no `zod` import left in any of the four;
   - exported schema names stay.
2. **`connections/api.ts` and `push/api.ts`:** reuse the shared schemas where they repeat them, and fix the stale comments. **There is no change to answers, texts or order**, and the existing route tests prove it.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/config.ts` (lines 30-80 and 455-510), the four files, `apps/server/src/push/api.ts`, `apps/server/src/connections/api.ts`, `apps/server/src/push/config.test.ts`, and `packages/protocol/src/common.ts` (around `isUrl`).

### Allowed files
`apps/server/src/push/config.ts`, `apps/server/src/push/subscriptions.ts`, `apps/server/src/ais/templates.ts`, `apps/server/src/connections/providers.ts`, `apps/server/src/connections/api.ts`, `apps/server/src/push/api.ts`, `work/T-0570-effect-schema-server-batch-3.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot push connections ais config.test
pnpm gate
```

### Acceptance
- The four modules use Effect Schema with the same rules, types and boot-exit behaviour, and no zod.
- The stale "stays zod" comments are gone.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: done. All four modules now use Effect Schema with the same rules,
defaults and types; no `zod` import remains in any of them; the stale
"stays zod" comments are gone; every listed test is unchanged and green.

### Files changed (7; all inside the Allowed files)
- `apps/server/src/push/config.ts` — ported `pushEnvSchema` to `Schema.Struct`
  with local `withDefault`/`booleanFlagSchema` helpers copied from
  `config.ts`, plus a `portSchema`-style check (`^\d+$` → int → 1..65535) and
  a defaulted host pattern. `type PushConfig` is now
  `Schema.Schema.Type<typeof pushEnvSchema>`. `loadPushConfig` decodes with
  `Schema.decodeUnknownExit(schema, { errors: 'all' })`, collects the failing
  struct-key paths and throws a module-private `PushConfigError` carrying
  `failedKeys` (names only, never values). `loadPushConfigOrExit` checks
  `failedKeys.includes('PUSH_COMPONENT_HOST')` and prints the same fixed
  message + `process.exit(1)`; any other failure is rethrown. `pushConfigError`
  is unchanged.
- `apps/server/src/push/subscriptions.ts` — `WebPushKeysSchema`,
  `WebPushSubscriptionSchema` (endpoint max 2048 + `isUrl`, nullable/optional
  `expirationTime`, keys) and `UserAgentSchema` as Effect schemas via
  `struct` from `@zilar/protocol` (keeps zod's mutable field types). Type is
  `Schema.Schema.Type<...>`.
- `apps/server/src/ais/templates.ts` — `AiTemplateSchema = Schema.Literals(AI_TEMPLATES)`;
  `type AiTemplate = (typeof AI_TEMPLATES)[number]`.
- `apps/server/src/connections/providers.ts` — `ProviderIdSchema = Schema.Literals(PROVIDER_IDS)`.
- `apps/server/src/connections/api.ts` — dropped the local `ConnectionProvider`
  literals; `CreateConnectionBody` and `ConnectionView` now use the imported
  `ProviderIdSchema`. Fixed the two comments that said providers "stays zod".
- `apps/server/src/push/api.ts` — dropped the local `PushKeysBody`/`PushEndpoint`;
  `SubscribeBody` now reuses `WebPushSubscriptionSchema.fields.endpoint`,
  `.expirationTime` and `WebPushKeysSchema` from `./subscriptions`, with the
  local `userAgent` field kept as before. Fixed the two comments that said
  `WebPushSubscriptionSchema` "stays zod". Rules, answers and order unchanged.
- `work/T-0570-effect-schema-server-batch-3.md` — status + this Report.

### Commands and real results
- `pnpm install` — "Done in 21.4s".
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot push/ subscriptions connections ais`
  — Test Files: 17 passed | 3 skipped (20); Tests: 196 passed | 4 skipped (200).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot config.test.ts`
  — Test Files: 3 passed (3); Tests: 69 passed (69).
- `pnpm gate` (first run) — **GATE FAIL**: `FAIL format` (85.0s), Prettier
  reported `apps/server/src/push/config.ts`.
- `pnpm exec prettier --write apps/server/src/push/config.ts` — reformatted
  one block (`Schema.isPattern(...)` argument layout); no logic change.
- `pnpm gate` (second run):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (5.6s)
  PASS  format  (83.0s)
  PASS  lint  (2.2s)
  PASS  typecheck  (54.7s)
  PASS  tests @zilar/server  (1332.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The 7 changed files are exactly the six source files plus this task file.

### Deviations / notes
- The host-failure detection mechanism was left to my choice by the spec; I
  used a small typed `PushConfigError` with the failing key names rather than
  inspecting Effect's issue tree in `loadPushConfigOrExit`. It never carries a
  value.
- Prettier reflowed the host `isPattern` call; the fixed host message text is
  unchanged.
- No test files were modified.

### Blocked / needs a decision
None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** 0 must-fix. The packet (07:58) is newer than HEAD d4975be5.
- **No test file changed.**
- **Gate:** passed at the worker.
- **Lead check:** the push env schema keeps the defaults (`false`, `5347`, `127.0.0.1`), the port 1..65535, the host pattern with its fixed boot message, and the storage key of at least 32 characters. `PushConfig` is derived from the schema, and typecheck passed.
- **Accepted nit:** the `failedKeysOf` comment at `push/config.ts:85` mentions a `missing` value that the code does not return. It is logged for a cleanup.
