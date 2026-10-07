---
id: T-0499
title: "Effect P4: packages/agent-drivers on Effect — zod schemas to Effect Schema, the HTTP calls and the poll loop on Effect, AgentDriver Promise API unchanged"
status: todo
milestone: M5
branch: task/T-0499-effect-agent-drivers
model: auto
effort: low
depends_on: [T-0490]
estimate: 0.5 day
---

# T-0499: agent-drivers on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, with Effect Schema replacing zod. Plan `docs/audit/effect-everywhere-plan.md` §4.3 picks `packages/agent-drivers` as the package pilot (P4): one zod file, and no other package imports it.

### Verified facts (do not re-derive)
- **The package:** `packages/agent-drivers/package.json` depends only on `zod` ^4.6.5, with scripts `typecheck` and `test`. No other `package.json` in the repo depends on `@zilar/agent-drivers`.
- **The files:** `src/index.ts` (3 lines), `src/types.ts` (86), `src/rules.ts` (38) with `src/rules.test.ts`, and `src/opencode-v2.ts` (433) with `src/opencode-v2.test.ts` (481). `src/fake-opencode-server.ts` is the test double.
- **`src/opencode-v2.ts`:**
  - the **zod schemas** are at lines 24-84 (`SessionIdSchema` with a `/^ses/` regex, `CreateSessionResponseSchema`, `PromptResponseSchema`, `InterruptResponseSchema`, `MessageSchema`, `MessagesResponseSchema`, `Text`/`Reasoning`/`ToolContentSchema`, `PermissionRequestSchema`, `PermissionListResponseSchema`, `ErrorBodySchema`) and the types are inferred at lines 86-87;
  - **`readErrorMessage`** (around line 103) caps the message at 500 characters;
  - **`delay(ms, signal)`** (lines 133-150) is an abortable `setTimeout`;
  - **`class OpenCodeV2Driver implements AgentDriver`**: `start`, the polling run, `request(...)`, `describeFailure` and `parseBody(operation, response, schema: z.ZodType<T>)` (lines 412-428). A failure throws `DriverError(operation, message)` with fixed messages ("returned invalid JSON", "returned an unexpected response body");
  - **`createOpenCodeV2Driver(options)`** is at line 431.
- **The rules:** Effect 4 idioms from `docs/EFFECT_GUIDE.md`, including the "Effect 4 facts learned" section (`Effect.callback`, `timeoutOrElse`, `tryPromise` signals, loops with `Schedule`). The Schema mapping is in the plan §2.5.

### What to build
1. **Package:** add `effect` ^4.0.2 to `packages/agent-drivers/package.json`, remove `zod`, and run `pnpm install` to update `pnpm-lock.yaml`.
2. **Schemas:** rewrite them with Effect Schema (`Schema.Struct`, `Schema.Literal`, `optionalKey`, a pattern check for the session id), with types from `typeof X.Type`. `parseBody` takes a `Schema` and decodes with `Schema.decodeUnknown`, giving the same `DriverError` messages.
3. **Internals:**
   - every HTTP call is an `Effect.tryPromise` using the given `fetchImpl` and the signal;
   - `delay` becomes `Effect.sleep`, interruptible when the run's signal aborts;
   - the polling run becomes an Effect loop. **Keep the exact poll interval, the boundary and selection logic (`selectAfter`), the delta emission and the permission handling.**
   - The public `AgentDriver` methods stay Promise or async-iterator based, exactly as `types.ts` declares, running the Effect programs at the edge.
4. **`types.ts` and `rules.ts`:** keep the exported types. Convert only if they hold zod (check).
5. **Tests:** `src/opencode-v2.test.ts` and `src/rules.test.ts` pass **unchanged**. If a test asserts on zod specifics and must change, stop and report BLOCKED with the line. You may add `src/opencode-v2.effect.test.ts`, for example: aborting a run interrupts the poll sleep promptly.
6. **Report:** give the line counts, and note any Effect 4 surprises.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-everywhere-plan.md` §2.5, `packages/agent-drivers/src/` (all files).

### Allowed files
`packages/agent-drivers/package.json`, `pnpm-lock.yaml`, `packages/agent-drivers/src/opencode-v2.ts`, `packages/agent-drivers/src/types.ts`, `packages/agent-drivers/src/rules.ts`, `packages/agent-drivers/src/opencode-v2.effect.test.ts`, `work/T-0499-effect-agent-drivers.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/agent-drivers test --reporter=dot
pnpm gate
```

### Acceptance
- `@zilar/agent-drivers` has no zod and runs on Effect inside, with the same public API and behaviour.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
