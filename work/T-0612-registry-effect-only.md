---
id: T-0612
title: "Tool args T-G: the action registry takes Effect schemas only (ArgsSchema loses its zod member, decodeActionArgs loses the zod branch, registry.ts drops zod); the fake adapters in the actions and approval-rule tests switch from z.object to Schema.Struct with the same assertions"
status: merged
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

### What I did

- `apps/server/src/actions/registry.ts`: `ArgsSchema<Args>` is now `Schema.Codec<Args, unknown, never>`; deleted the `import type { z } from 'zod'`, the `safeParse` branch and the cast inside `decodeActionArgs`, and updated the two comments that referenced zod / plan T-A.
- Switched the five test files' fake adapters to Effect Schema and removed their `zod` imports. Only the schema constructors and imports changed; every assertion is byte-identical:
  - `registry.test.ts`: one fake -> `Schema.Struct({ value: Schema.String })`.
  - `policy.test.ts`: `echoSchema`; `strictSchema` -> `Schema.Struct({ required: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) })`; the `adapter` parameter type -> `Schema.Codec<unknown, unknown, never>`.
  - `gateway.test.ts`: 11 fakes.
  - `flow.e2e.test.ts`: 4 fakes; `z.string().min(1).max(64)` -> `Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))`.
  - `approvals/rules.test.ts`: 2 fakes; the trimming `text` schema -> `Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200))`.
- `policy.ts` and `gateway.ts` were left unchanged: neither imports zod and typecheck did not require a change.
- Grep confirmations: `from 'zod'` prints nothing under `apps/server/src/actions/` nor in `apps/server/src/approvals/rules.test.ts`; `ZodType|from 'zod'` prints nothing across `actions`, `tools`, `web-tools`, `agents` and `sandbox` (test files excluded), so no production adapter cast is left.

### Commands and results

- `git diff --stat` before committing: 7 files, all inside the Allowed list.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot actions approvals/rules`: **Test Files 11 passed (11), Tests 183 passed (183)** (30.85s). Run before the commits and again after: same result both times.
- `pnpm gate` from the repo root:

  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (42.9s)
  PASS  lint  (1.3s)
  PASS  typecheck  (1.2s)
  PASS  tests @zilar/server  (833.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  The 833.7s test time is machine contention from parallel workers (load average above 100), not a hang.

### Problems / deviations

- Strictness change: the old zod fakes were not `.strict()`, while the Effect decode is strict. No test passes an extra key to a fake adapter, so nothing failed for that reason and no assertion was changed. The full `actions` + `approvals/rules` run and the gate are green.
- No deviations from the Spec.

### Blocked / needs a decision

- Nothing blocked.

### Open questions

- None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (21:19) is newer than HEAD c7e0f289.
- **Lead check:**
  - there is no zod import under `actions/`;
  - the test diffs change only the fake-adapter constructors (no `expect` line changed);
  - the gate passes.
- **The tool-arguments plan (T-A to T-G) is complete.**
