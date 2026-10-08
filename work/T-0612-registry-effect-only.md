---
id: T-0612
title: "Tool args T-G: the action registry takes Effect schemas only (ArgsSchema loses its zod member, decodeActionArgs loses the zod branch, registry.ts drops zod); the fake adapters in the actions and approval-rule tests switch from z.object to Schema.Struct with the same assertions"
status: todo
milestone: M5
branch: task/T-0612-registry-effect-only
model: auto
effort: low
depends_on: [T-0604]
estimate: 0.5 day
---

# T-0612: the action registry on Effect Schema only (plan task T-G)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. Plan: `docs/audit/tool-args-schema-plan.md`, **§4 T-G** (read it). Every production adapter now carries an Effect schema: T-0594, T-0595, T-0597, T-0598, T-0603 and T-0604 are all merged. The zod member of the seam can go.

### Verified facts (do not re-derive; re-check every line with grep before editing)
- **`apps/server/src/actions/registry.ts`:**
  - line 2: `import type { z } from 'zod'`;
  - line 8: `ArgsSchema<Args> = z.ZodType<Args> | Schema.Codec<Args, unknown, never>`;
  - lines 15-27: `decodeActionArgs` has a `safeParse` branch (19-22) and the strict Effect branch (23-26).
  
  After this task, `ArgsSchema<Args> = Schema.Codec<Args, unknown, never>`, only the Effect branch remains, and the comments say so.
- **`apps/server/src/actions/policy.ts`** and **`apps/server/src/actions/gateway.ts`** have no zod today, which the lead checked with grep. Change them only if typecheck requires it.
- **The production adapters must already carry no zod cast.** Run `grep -rn "ZodType\|from 'zod'" apps/server/src/actions apps/server/src/tools apps/server/src/web-tools apps/server/src/agents apps/server/src/sandbox --include='*.ts' | grep -v test`. If it prints anything, stop and report it as a blocker in the task file, with `status: blocked`.
- **The test fakes** (the lead's grep):

| File | Lines |
| --- | --- |
| `apps/server/src/actions/gateway.test.ts` | 45, 668, 720, 759, 854, 893, 1377, 1519, 1599, 1692, 1764: `z.object({ value: z.string() })` |
| `apps/server/src/actions/registry.test.ts` | 20, the same |
| `apps/server/src/actions/policy.test.ts` | 6: `echoSchema`; 7: `strictSchema` (`required`: an int ≥ 0); 9: the parameter type `z.ZodTypeAny` |
| `apps/server/src/actions/flow.e2e.test.ts` | 61, 77, 597, 762: `value` of 1 to 64 |
| `apps/server/src/approvals/rules.test.ts` | 808: `{ text: string }`; 847: `text` **trimmed**, then 1 to 200 |

  Each becomes the Effect equivalent (`Schema.Struct`, `Schema.String`, the length and int checks; for 847 a trimming string such as `Schema.Trim` plus the checks), and the zod import goes.
- **Strictness changes in the tests.** The Effect decode is **strict**, but these zod fakes were **not** `.strict()`. If any test passes an extra key to a fake adapter and expects success, it would now fail. **Find out with the test run.** If one fails for this reason only, report the exact test name in the task file and set `status: blocked`. **Do not change an assertion.**
- **Assertions stay byte-identical**; only the schema constructors and imports change.

### What to build
1. Make the registry Effect-only (the type, the decode and the import).
2. Switch the five test files' fakes, and remove their zod imports. No assertion changes.
3. Confirm with grep that no file under `apps/server/src/actions/` imports zod.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts"), the plan §4 T-G, and `apps/server/src/actions/registry.ts` (lines 1-40).

### Allowed files
`apps/server/src/actions/registry.ts`, `apps/server/src/actions/policy.ts`, `apps/server/src/actions/gateway.ts`, `apps/server/src/actions/registry.test.ts`, `apps/server/src/actions/policy.test.ts`, `apps/server/src/actions/gateway.test.ts`, `apps/server/src/actions/flow.e2e.test.ts`, `apps/server/src/approvals/rules.test.ts`, `work/T-0612-registry-effect-only.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot actions approvals/rules
pnpm gate
```

### Acceptance
- The registry is Effect-only, and no file in `actions/` imports zod.
- The test fakes are on Effect Schema with the same assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
