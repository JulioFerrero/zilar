---
id: T-0597
title: "Tool args T-C: demo.echo args (actions/demo.ts) zod to Effect Schema through the T-0594 seam; trimmed 1..200 text; extra keys now rejected (decided by the lead); demo.test parse calls switch to Effect; no zod left in demo.ts"
status: merged
milestone: M5
branch: task/T-0597-demo-args-effect
model: auto
effort: low
depends_on: [T-0594]
estimate: 0.3 day
---

# T-0597: the demo.echo args on Effect Schema (plan task T-C)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. The plan is `docs/audit/tool-args-schema-plan.md`, §1.7 and §4 T-C. T-0594 added the seam: `ArgsSchema<Args>` accepts an Effect `Schema.Codec<Args, unknown, never>`, and `decodeActionArgs` decodes it with `onExcessProperty: 'error'` (`apps/server/src/actions/registry.ts:8-27`).

### Verified facts (do not re-derive)
- **`apps/server/src/actions/demo.ts`:**
  - line 1 is `import { z } from 'zod'`;
  - `DemoEchoArgsSchema` (20-22) is `z.object({ text: z.string().trim().min(1).max(200) })`. It is **not strict**, so extra keys are stripped today;
  - `type DemoEchoArgs = z.infer<...>` (24);
  - the adapter at line 49 has `argsSchema: DemoEchoArgsSchema as unknown as z.ZodType<unknown>`.
- **The lead's decision (T-0594 review):** through the seam, an Effect args schema is strict, so `{ text, extra }` will now be **rejected** (`invalid_args`) instead of stripped. That is accepted: the model must send exactly the declared args. Record it in the Report.
- **`apps/server/src/actions/demo.test.ts:154-157`** calls `DemoEchoArgsSchema.safeParse(x).success` four times: `''`, `'   '`, 201 × `x`, and `'hello'`. These become `Exit.isSuccess(Schema.decodeUnknownExit(DemoEchoArgsSchema)(x))`, with the same expectations. This is the only test change.
- **Trim before the length check:** `'   '` must fail. Use the codebase idiom `Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))`; see `apps/server/src/ais/api.ts:114`.

### What to build
1. **`demo.ts`:**
   - `DemoEchoArgsSchema` becomes `Schema.Struct({ text: <trimmed 1..200> })`;
   - `DemoEchoArgs` is `typeof DemoEchoArgsSchema.Type`;
   - the adapter's `argsSchema` is the Effect schema, cast to `Schema.Codec<unknown, unknown, never>` (or to `ArgsSchema<unknown>` from `./registry`) instead of `z.ZodType<unknown>`;
   - remove the zod import.
2. **`demo.test.ts`:** only the four parse lines change (154-157), plus the imports they need.
3. **Add one assertion** in the same `it` block: `{ text: 'hello', extra: 1 }` decoded **through `decodeActionArgs`** (from `./registry`) gives `ok: false`. This pins the strict decision.
4. **Tests:** every other test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts"), `docs/audit/tool-args-schema-plan.md` (§1.7 and §4 T-C), `apps/server/src/actions/registry.ts` (lines 1-30), `apps/server/src/actions/demo.ts` and `apps/server/src/actions/demo.test.ts` (lines 140-160).

### Allowed files
`apps/server/src/actions/demo.ts`, `apps/server/src/actions/demo.test.ts`, `work/T-0597-demo-args-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot actions
pnpm gate
```

### Acceptance
- `demo.echo` args decode with Effect Schema through the seam, with the same 1..200 trimmed rule; extra keys are rejected and pinned by a test.
- There is no zod in `demo.ts`.
- Only the listed test lines changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/actions/demo.ts`
  - Removed `import { z } from 'zod'`; added `import { Schema } from 'effect'`.
  - `DemoEchoArgsSchema` is now `Schema.Struct({ text: Schema.Trim.check(Schema.isMinLength(DEMO_ECHO_TEXT_MIN), Schema.isMaxLength(DEMO_ECHO_TEXT_MAX)) })`. The existing `DEMO_ECHO_TEXT_MIN`/`DEMO_ECHO_TEXT_MAX` constants (1 and 200) are reused, so the rule is unchanged and trim runs before the length checks.
  - `DemoEchoArgs` is now `typeof DemoEchoArgsSchema.Type`.
  - The adapter's `argsSchema` cast flipped from `as unknown as z.ZodType<unknown>` to `as unknown as Schema.Codec<unknown, unknown, never>`.
  - `grep` confirms no `zod`/`z.` remains in `demo.ts`.
- `apps/server/src/actions/demo.test.ts`
  - Added `import { Exit, Schema } from 'effect';` and `decodeActionArgs` to the `./registry` import.
  - The four parse calls at the old lines 154-157 now use `Exit.isSuccess(Schema.decodeUnknownExit(DemoEchoArgsSchema)(x))`, with the same expected `false/false/false/true`.
  - Added one assertion in the same `it`: `decodeActionArgs(DemoEchoArgsSchema, { text: 'hello', extra: 1 }).ok` is `false`, pinning the strict (reject-extra-keys) decision through the T-0594 seam.
- No other tests changed.

### Strict decision (from the lead, T-0594 review)
Through the seam the Effect args schema is strict (`onExcessProperty: 'error'`), so `{ text, extra }` is now **rejected** (`invalid_args`) instead of stripped as the old non-strict zod schema did. This is accepted and is pinned by the new `decodeActionArgs` assertion. No other behavior changed: trim-then-1..200 is identical.

### Files changed
- `apps/server/src/actions/demo.ts`
- `apps/server/src/actions/demo.test.ts`
- `work/T-0597-demo-args-effect.md` (status + this Report)

### Commands and real results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot actions/demo.test.ts` → 1 test file passed, 7 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot actions` (task Checks) → 9 test files passed, 130 tests passed (88.0s).
- `pnpm gate` (repo root) → first run FAIL on `format` (prettier flagged `demo.test.ts`); fixed with `pnpm exec prettier --write apps/server/src/actions/demo.test.ts`, then re-run:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (4.0s)
  PASS  format  (46.7s)
  PASS  lint  (1.3s)
  PASS  typecheck  (17.7s)
  PASS  tests @zilar/server  (13.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- None. Only the four parse lines plus imports changed in the test, exactly as specified. The formatting failure on the first gate run was cosmetic and fixed by running prettier on the one changed file.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (13:51) is newer than HEAD ed25466d.
- **Lead check:**
  - only the four parse lines changed, plus one new assertion that pins the strict decision: `{ text, extra }` gives `ok: false` through `decodeActionArgs`;
  - `demo.ts` has no zod.
