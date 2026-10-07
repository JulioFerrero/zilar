---
id: T-0501
title: "Effect lane F: apps/runner zod to Effect Schema (pair response, identity file, capabilities report); only the test lines that call zod change"
status: todo
milestone: M5
branch: task/T-0501-effect-runner-app-schema
model: auto
effort: low
depends_on: [T-0490]
estimate: 0.5 day
---

# T-0501: apps/runner on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, with Effect Schema replacing zod. Plan `docs/audit/effect-everywhere-plan.md` §4.4 lane F. This task covers the schemas of `apps/runner`. T-0500 does `packages/runner-tunnel` in parallel; the two tasks touch no common source file.

### Verified facts (do not re-derive)
- **The package:** `apps/runner/package.json` dependencies are `@zilar/runner-tunnel` and `zod` ^4.6.5; devDependencies are `@zilar/server`, `tsx` and `vitest`.
- **`apps/runner/src/pair.ts`:**
  - `pairResponseSchema = z.strictObject({ machineId: string 1..128, status: z.literal('pending') })` is at line 92;
  - it is used with `safeParse` at line 162; a failure throws `PairError('malformed_response', 'The server response did not include a machine id.')`.
- **`apps/runner/src/identity.ts`:**
  - **`export const IdentitySchema`** (line 19) is a `z.strictObject` with these fields:
    - `version` (literal `IDENTITY_VERSION`);
    - `serverUrl` (`.url()`);
    - `machineId` (1..128);
    - `publicKey` (1..1024);
    - `privateKey` (1..4096);
    - `name` (1..64);
    - `createdAt` (1..64);
    - an optional `hubUrl` (`.url()`, plus a refine that requires `ws://` or `wss://`, with the message `'hubUrl must use ws:// or wss://'`).
  - **`export type RunnerIdentity = z.infer<…>`** is at line 36.
  - **`safeParse`** is at line 173; a failure throws `IdentityError(... 'corrupt')`.
- **`apps/runner/src/capabilities.ts`:**
  - **`export const CapabilitiesSchema`** (line 24) is a `z.strictObject` with these fields:
    - strings that are **trimmed by zod's `.trim()` transform**, then length-checked;
    - ints and numbers with bounds;
    - arrays with `max`;
    - `tools`, a record (keys 1..128) with a refine of at most 64 entries and the message `'tools must have at most 64 entries'`.
  - **`export type Capabilities`** is at line 43.
  - **`detectCapabilities` ends with `return CapabilitiesSchema.parse(report)`** (line 132), so it throws on an invalid report.
- **The tests that call zod:**
  - `apps/runner/src/capabilities.test.ts:6` imports zod and defines a zod `ServerCapabilitiesSchema` (from line 12), a mirror of the server's schema, used at `:82` with `safeParse(...).success`; `:145` calls `CapabilitiesSchema.safeParse(report).success`;
  - `apps/runner/src/identity.test.ts:232-247` calls `IdentitySchema.safeParse(...)` and asserts that `JSON.stringify(parsed.error.issues)` matches `/ws:\/\/ or wss:\/\//`.
- **The Effect 4 Schema API** (installed `effect` 4.0.0, `dist/Schema.d.ts`):
  - `Schema.Struct`, `Schema.Literal`, `Schema.Record`, `Schema.Array`;
  - `Schema.check(...)` with `isMinLength`/`isMaxLength`/`isInt`/`isStartingWith`, and `Schema.makeFilter` for a custom check with its own message;
  - `Schema.Trim` (7251), which **trims on decode** like zod's `.trim()`; `Schema.Trimmed` (7227) only checks;
  - `Schema.URL` (6702);
  - `decodeUnknownExit` (1223), `decodeUnknownSync` (1460);
  - `onExcessProperty: "error"` for strict objects.
- **The strict-object precedent:** T-0494 found that `Schema.is` ignores excess keys. Decode with `onExcessProperty: "error"` to keep `z.strictObject` behaviour.

### What to build
1. **Package:** in `apps/runner/package.json`, remove `zod` and add `effect` at `^4.0.0` (the same range as `apps/server`). Run `pnpm install`.
2. **The three schemas** become Effect Schema with the same exported names, bounds and messages. The `hubUrl` message stays `hubUrl must use ws:// or wss://` and the `tools` message stays the same. The capabilities strings **must still be trimmed on decode**. The exported types come from `typeof X.Type`.
3. **Call sites:**
   - `pair.ts` and `identity.ts` decode strictly and keep the same errors and messages;
   - `detectCapabilities` still throws on an invalid report.
4. **Tests:** the only allowed test changes are the lines that call zod.
   - **`capabilities.test.ts`:** port the `ServerCapabilitiesSchema` mirror to Effect Schema, with the same bounds as today, and replace the `safeParse(...).success` calls with an Effect `Exit` check (for example `Exit.isSuccess(decodeUnknownExit(S, { onExcessProperty: 'error' })(x))`).
   - **`identity.test.ts:232-247`:** keep the same input. Assert that decoding fails and that the failure's message text contains `ws:// or wss://`.
   - **Everything else** (inputs, expected outcomes, other tests) stays unchanged. If anything else must change, stop and report BLOCKED with the file and line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-everywhere-plan.md` §2.5, `apps/runner/src/pair.ts`, `apps/runner/src/identity.ts`, `apps/runner/src/capabilities.ts`, `apps/runner/src/capabilities.test.ts`, `apps/runner/src/identity.test.ts:220-250`.

### Allowed files
`apps/runner/package.json`, `pnpm-lock.yaml`, `apps/runner/src/pair.ts`, `apps/runner/src/identity.ts`, `apps/runner/src/capabilities.ts`, `apps/runner/src/capabilities.test.ts`, `apps/runner/src/identity.test.ts`, `work/T-0501-effect-runner-app-schema.md`.

### Checks
```bash
pnpm --filter @zilar/runner test --reporter=dot
pnpm gate
```

### Acceptance
- `@zilar/runner` has no zod.
- The pair, identity and capabilities validation behave as before, including trimming and messages.
- Only the zod-calling test lines changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
