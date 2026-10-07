---
id: T-0500
title: "Effect lane F: packages/runner-tunnel zod to Effect Schema (control frames + option parsing), behaviour and tests unchanged"
status: todo
milestone: M5
branch: task/T-0500-effect-runner-tunnel-schema
model: auto
effort: low
depends_on: [T-0490]
estimate: 0.5 day
---

# T-0500: runner-tunnel on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, with Effect Schema replacing zod. Plan `docs/audit/effect-everywhere-plan.md` §4.4 lane F covers `runner-tunnel` and `apps/runner`.

This task is **only the schema part** of `packages/runner-tunnel`. The `ws`/mux logic moves to Effect in a later task.

### Verified facts (do not re-derive)
- **The package:** `packages/runner-tunnel/package.json` depends on `ws` ^8.22.0 and `zod` ^4.6.5. `apps/server` (`src/machines/hub.ts:1-2` imports `TunnelServer` and `KeyRegistry`) and `apps/runner` depend on it.
- **`packages/runner-tunnel/src/protocol.ts`** (203 lines, `import { z } from 'zod'` at line 1):
  - **the exported constants** (`PROTOCOL_VERSION`, the `CLOSE_*` codes 4400-4404, the `FRAME_*` values, `MAX_*` and `STREAM_WINDOW_BYTES`, lines 4-31) stay as they are;
  - **the schemas:** private `runnerIdSchema` (string 1..128), `streamIdSchema` (int 0..0xffffffff) and `portSchema` (int 1..65535) at lines 33-35;
  - **the exported `z.strictObject` schemas** `HelloSchema`, `ChallengeSchema`, `AuthSchema`, `ReadySchema`, `HeartbeatSchema`, `TunnelOpenSchema`, `TunnelRefusedSchema`, `TunnelClosedSchema`, `TunnelPauseSchema`, `TunnelResumeSchema`, `ModelOpenSchema` (from line 37) and two maps by `type` (`runnerToServerSchemas`, `serverToRunnerSchemas`);
  - **`ControlMessage`** is a union of `z.infer` types (from line 119);
  - **`parseControlMessage(raw, direction)`** (from line 149) never throws. It returns `{ ok: false, code, reason }` with exact reasons: `'frame is not JSON'`, `'frame is not an object'`, `'frame has no string type'`, `` `unknown message type ${t}` `` (`CLOSE_UNKNOWN_TYPE`) and `` `invalid ${t} frame` `` (`CLOSE_MALFORMED`).
- **`packages/runner-tunnel/src/runner.ts`:** `RunnerOptionsSchema = z.strictObject({...})` (from line 18) with `.default(...)` values (for example `runnerVersion` '0.1.0', `exposedPorts` [], `enableModelListener` true, `reconnectBaseMs` 250, `reconnectMaxMs` 5000, `handshakeTimeoutMs` 10000). It is parsed with `.parse({...})` in the constructor (line 94), so invalid options **throw** (`runner.test.ts:181` expects a throw, `:175` no throw).
- **`packages/runner-tunnel/src/server.ts`:** `ServerOptionsSchema` (from line 25), with `gatewayUrl: z.string().url().startsWith('http://')` and defaults. It is parsed in `static start` (line 131), and the type is `z.infer` in the constructor (line 85).
- **The tests** (`protocol.test.ts`, `runner.test.ts`, `auth.test.ts`, `resilience.test.ts`, `mux.test.ts`, `keys.test.ts`, `engine.test.ts`, `model.test.ts`, `preview.test.ts`) never import zod; they assert on behaviour (close codes, reasons, throws).
- **The Effect 4 Schema API** (installed `effect` 4.0.0, `dist/Schema.d.ts`): `Schema.Struct`, `Schema.Literal`, `Schema.check(...)` (line 4124) with the filters `isMinLength`/`isMaxLength` (6134/6181), `isInt` (5860), `isPattern` (5346) and `isStartingWith` (5524); `Schema.URL` (6702); `withDecodingDefault` (4773); `decodeUnknownExit` (1223) and `decodeUnknownSync` (1460); and the parse option `onExcessProperty: "error"` (strict objects, `SchemaAST.d.ts:419`).
- **Strict objects:** T-0494 found that `z.strictObject` equals decoding with `onExcessProperty: "error"`. `Schema.is` ignores excess keys, so do not use it for strict checks.

### What to build
1. **Package:** in `packages/runner-tunnel/package.json`, remove `zod` and add `effect` at the same range as `apps/server/package.json` (`^4.0.0`). Run `pnpm install`.
2. **`protocol.ts`:**
   - every schema becomes Effect Schema with the same bounds, and the exported names stay;
   - `ControlMessage` and the other exported types come from `typeof X.Type`;
   - `parseControlMessage` keeps its signature, its never-throws contract and **exactly the same codes and reasons**, decoding strictly (excess keys reject, like `z.strictObject`).
3. **`runner.ts` and `server.ts`:** the options schemas become Effect Schema with the same bounds and defaults. Invalid options must still throw synchronously where `.parse` threw (use `decodeUnknownSync` with strict excess-property handling). `gatewayUrl` must still require a valid URL that starts with `http://`.
4. **The rest of the package** is untouched (mux, keys, http-agent, test-harness, demo).
5. **Tests:** every test in `packages/runner-tunnel/src/*.test.ts` passes **unchanged**, and `apps/server` and `apps/runner` typecheck unchanged. If anything else must change, stop and report BLOCKED with the file and line. Add `packages/runner-tunnel/src/protocol.schema.test.ts` covering:
   - an excess key on each of two frame types gives `invalid <type> frame`;
   - a stream id of 2^32 is rejected;
   - the runner option defaults are applied.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-everywhere-plan.md` §2.5, `packages/runner-tunnel/src/protocol.ts`, `packages/runner-tunnel/src/runner.ts:1-120`, `packages/runner-tunnel/src/server.ts:1-140`.

### Allowed files
`packages/runner-tunnel/package.json`, `pnpm-lock.yaml`, `packages/runner-tunnel/src/protocol.ts`, `packages/runner-tunnel/src/runner.ts`, `packages/runner-tunnel/src/server.ts`, `packages/runner-tunnel/src/protocol.schema.test.ts`, `work/T-0500-effect-runner-tunnel-schema.md`.

### Checks
```bash
pnpm --filter @zilar/runner-tunnel test --reporter=dot
pnpm gate
```

### Acceptance
- `@zilar/runner-tunnel` has no zod.
- The frames and options validate exactly as before (same codes, reasons and throws).
- The existing tests are untouched and green, and the new schema test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
