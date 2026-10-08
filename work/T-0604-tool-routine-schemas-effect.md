---
id: T-0604
title: "Tool args T-E: the coupled tool + routine schemas (tools/schemas.ts, routines/schedule.ts, tools/adapters.ts, tools/service.ts) zod to Effect Schema with the §3.1 custom texts byte-identical; adapter casts flip to the Effect type; parseToolVersionInput/parseRoutineSchedule keep their { ok } signatures; tools/adapters.test parse calls switch; one schedule union test"
status: todo
milestone: M5
branch: task/T-0604-tool-routine-schemas-effect
model: auto
effort: low
depends_on: [T-0594]
estimate: 1.5 days
---

# T-0604: the tool and routine schemas on Effect Schema (plan task T-E)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. The plan is `docs/audit/tool-args-schema-plan.md`: **§1.3, §1.4, §1.6, §3.1 (the message table) and §4 T-E.** Also read `docs/audit/tool-args-schema-plan-open-findings.md`.

These four files must move together, because `tools/adapters.ts` embeds the schema objects from the other two (plan §4 T-E, "Why four files"). T-0594 added the seam: `ArgsSchema<Args>` in `apps/server/src/actions/registry.ts` accepts an Effect codec.

### Verified facts (do not re-derive; the plan cites every line, so re-check each line number before you rely on it)
- **What converts:**
  - every schema listed in §1.3 (`tools/schemas.ts`);
  - every schema listed in §1.4 (`tools/adapters.ts`);
  - every schema listed in §1.6 (`routines/schedule.ts`);
  - `tools/service.ts:672` `toolHostsSchema.parse`, which must keep throwing on bad input.
- **The §3.1 custom messages reach users:** `parseToolVersionInput` and `parseRoutineSchedule` return the first message, and it becomes an HTTP 400 body (`ToolServiceError` and `RoutineServiceError`). **Every §3.1 text stays byte-identical.**
- **Effect 4.0.2 drops `{ message }` on `isMinLength` and `isMaxLength`** (`docs/EFFECT_GUIDE.md`, "Schema, custom messages"). The §3.1 table writes `{ message }` on those checks anyway; **do not trust it**. Use `Schema.makeFilter` for every custom-message rule, as the guide shows, and **probe all 33 texts** with one script (`pnpm --filter @zilar/server exec tsx -e "..."`). Paste the probe output into the Report.
- **Mapping rules** (from the plan's notes):
  - `.strict()` becomes a strict decode;
  - `z.number()` becomes `Schema.Finite`, and `.int()` becomes `Schema.Int`;
  - `.optional()` becomes `Schema.optional`;
  - `.trim()` runs **before** the length checks;
  - the host array is `Array(<full per-host schema>)`, then max 5, then dedupe. Plan finding 2: **do not drop the per-host checks.**
- **`parseToolVersionInput` (`tools/schemas.ts:105-116`) and `parseRoutineSchedule` (`routines/schedule.ts:70-83`)** keep their `{ ok: true, value } | { ok: false, message }` signatures and their callers.
- **The schedule union** (`routineScheduleSchema`, a discriminated union on `kind`). When `kind` is neither `daily` nor `interval`, Effect gives an `AnyOf` with no child issues. **The lead's decision:** return the fixed text `kind must be 'daily' or 'interval'`, and pin it with **one** new test in `apps/server/src/routines/schedule.test.ts`, asserting `parseRoutineSchedule({ kind: 'weekly' })`. No test pins zod's old wording here.
- **The adapter casts** in `tools/adapters.ts` (§4 T-E lists `:372,404,448,544,615,667,735,775,855,898`, plus the return type at `:246`) flip from `z.ZodType<unknown>` to the Effect type (`ArgsSchema<unknown>` or `Schema.Codec<unknown, unknown, never>`). The zod import goes.
- **The test parse-call change**, in `apps/server/src/tools/adapters.test.ts`:
  - the zod import at `:6`;
  - the five sites `:245-246`, `:370-374`, `:524`, `:624-628` and `:762-763` (`as z.ZodType<unknown>` with `.safeParse` or `.parse`);
  - they become `decodeActionArgs(...)` from `../actions/registry`, with the same expectations.
  
  **These are the only test changes**, apart from the one new schedule test.
- **Tests (all unchanged apart from the above):**
  - `apps/server/src/tools/*.test.ts` (including `routes.test.ts`);
  - `apps/server/src/routines/*.test.ts`;
  - `apps/server/src/actions/*.test.ts`.

### What to build
1. **Convert the four files**, with the §3.1 texts byte-identical (proven by the probe), the same accept/reject behaviour, and the same `{ ok }` helpers.
2. **The adapter casts and imports** as described above, so none of the four files imports zod.
3. **The test changes** listed above, and nothing else in tests.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts" and "Schema, custom messages"), the plan sections above and the open-findings doc, `apps/server/src/actions/registry.ts` (lines 1-30), `apps/server/src/config.ts` (lines 10-80, the `SchemaGetter` transform idiom), and the four source files.

### Allowed files
`apps/server/src/tools/schemas.ts`, `apps/server/src/routines/schedule.ts`, `apps/server/src/tools/adapters.ts`, `apps/server/src/tools/service.ts`, `apps/server/src/tools/adapters.test.ts`, `apps/server/src/routines/schedule.test.ts`, `work/T-0604-tool-routine-schemas-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot tools routines actions
pnpm gate
```

### Acceptance
- The four files have no zod, and all 33 §3.1 texts are byte-identical (probe output in the Report).
- The tool and routine args accept and reject the same inputs, and the union text is pinned.
- Only the listed test lines changed.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
