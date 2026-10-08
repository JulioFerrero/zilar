---
id: T-0597
title: "Tool args T-C: demo.echo args (actions/demo.ts) zod to Effect Schema through the T-0594 seam; trimmed 1..200 text; extra keys now rejected (decided by the lead); demo.test parse calls switch to Effect; no zod left in demo.ts"
status: todo
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

## Review (written by Claude)
