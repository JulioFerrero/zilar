---
id: T-0594
title: "Tool args T-A: the registry/gateway decode seam: `argsSchema` accepts zod OR Effect Schema during the move; one `decodeActionArgs` helper replaces the four `.safeParse` calls in policy.ts and gateway.ts; `invalid_args` unchanged; tests unchanged"
status: todo
milestone: M5
branch: task/T-0594-tool-args-decode-seam
model: auto
effort: low
depends_on: [T-0571]
estimate: 0.5 day
---

# T-0594: the tool-args decode seam (plan task T-A)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. The plan is `docs/audit/tool-args-schema-plan.md`; read its §2 and §4 (T-A), and `docs/audit/tool-args-schema-plan-open-findings.md` (finding 1).

This is the foundation task: after it, each adapter can switch its `argsSchema` from zod to Effect Schema on its own, and a later task removes zod from the registry.

### Verified facts (do not re-derive)
- **`apps/server/src/actions/registry.ts`:**
  - line 1 is `import type { z } from 'zod'`;
  - line 95 is `argsSchema: z.ZodType<Args>;`, with the comment at 77.
- **The four consumers** (the lead checked with `grep -n "argsSchema.safeParse" apps/server/src/actions/*.ts`):
  - `apps/server/src/actions/policy.ts:47`: a failure gives `{ kind: 'deny', reason: 'invalid_args' }`;
  - `apps/server/src/actions/gateway.ts:274`, `331` and `421`: a failure gives `{ status: 'denied', reason: 'invalid_args' }` (or the same denial);
  - the parsed value is read as `parse.data` at `gateway.ts:281,340,430,439`.
- **The decode message is discarded** at every one of these sites; only success or failure and the decoded value matter.
- **Plan finding 1:** `Schema.Schema` takes **one** type argument in Effect 4.0.2. The Effect side of the union must be a schema whose decoding needs no services. Use `Schema.Codec<Args, unknown, never>`, or whatever type `Schema.decodeUnknownExit` accepts for a service-free decode; check `node_modules/effect` and say which in the Report.

### What to build
1. **`registry.ts`:**
   - export `type ArgsSchema<Args> = z.ZodType<Args> | <the Effect codec type>`;
   - change `argsSchema` to `ArgsSchema<Args>`;
   - update the comment at line 77: "zod or Effect Schema while the tool layer moves (plan T-A); a later task removes zod".
2. **`decodeActionArgs(schema, raw)`**, exported from `registry.ts`, returning `{ ok: true; value: Args } | { ok: false }`:
   - for zod (`typeof (schema as { safeParse?: unknown }).safeParse === 'function'`), call `safeParse`;
   - for Effect, call `Schema.decodeUnknownExit(schema, { onExcessProperty: 'error' })(raw)`;
   - **no message is needed**: the callers discard it. The plan's issue walker belongs to T-B, not here.
   
   The Effect branch uses `onExcessProperty: 'error'` because every zod args schema in the codebase is `.strict()`; check that with grep and say so in the Report.
3. **The four call sites** use `decodeActionArgs(...)` and read `.value` where they read `.data`, with the same denials.
4. **Tests:**
   - every existing test passes **unchanged** (they all use zod fake adapters);
   - add **one** new test in `apps/server/src/actions/registry.test.ts` that builds an Effect `Schema.Struct({ value: Schema.String })`, checks that `decodeActionArgs` accepts `{ value: 'a' }`, and rejects `{ value: 1 }` and `{ value: 'a', extra: 1 }`.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts"), `docs/audit/tool-args-schema-plan.md` (§0, §2 and §4 T-A), `docs/audit/tool-args-schema-plan-open-findings.md`, `apps/server/src/actions/registry.ts`, `apps/server/src/actions/policy.ts` (lines 35-60) and `apps/server/src/actions/gateway.ts` (lines 265-445).

### Allowed files
`apps/server/src/actions/registry.ts`, `apps/server/src/actions/policy.ts`, `apps/server/src/actions/gateway.ts`, `apps/server/src/actions/registry.test.ts`, `work/T-0594-tool-args-decode-seam.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot actions approvals agents/tools web-tools tools/adapters
pnpm gate
```

### Acceptance
- `argsSchema` accepts zod or an Effect schema, and the four sites decode through `decodeActionArgs` with the same `invalid_args` denials.
- One new registry test covers the Effect branch.
- Every other test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
