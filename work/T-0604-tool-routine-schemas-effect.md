---
id: T-0604
title: "Tool args T-E: the coupled tool + routine schemas (tools/schemas.ts, routines/schedule.ts, tools/adapters.ts, tools/service.ts) zod to Effect Schema with the §3.1 custom texts byte-identical; adapter casts flip to the Effect type; parseToolVersionInput/parseRoutineSchedule keep their { ok } signatures; tools/adapters.test parse calls switch; one schedule union test"
status: merged
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

### What I did

Converted the four coupled files from zod to Effect Schema, keeping the
`{ ok }` helper signatures and every §3.1 text byte-identical.

- `apps/server/src/tools/schemas.ts`: `toolNameSchema`,
  `toolDescriptionSchema`, `toolMessageSchema`, `toolSourceSchema`,
  `singleHostSchema` (trim, then the ten rules, then lowercase),
  `toolHostsSchema` (max 5 then dedupe, `Schema.mutable(Schema.Array(...))`)
  and `toolVersionInputSchema` (`struct()` from `@zilar/protocol`, so decoded
  fields stay mutable like the zod types). `parseToolVersionInput` keeps its
  `{ ok }` signature; unknown keys are stripped (the old schema was a
  non-strict `z.object`).
- `apps/server/src/routines/schedule.ts`: `dailyScheduleSchema`,
  `intervalScheduleSchema`, `routineScheduleSchema` (`Schema.Union` of two
  structs with a `kind` literal), the exported types via
  `Schema.Schema.Type`, and `parseRoutineSchedule` (strict decode, keeps its
  `{ ok }` signature and the daily `weekdays` default). The union's empty
  `AnyOf` returns the lead-mandated fixed text
  `kind must be 'daily' or 'interval'`.
- `apps/server/src/tools/adapters.ts`: all arg schemas on `struct()` +
  `Effect Schema`; dropped the zod import; `inputField` return type and the
  ten `as unknown as z.ZodType<unknown>` casts flipped to
  `Schema.Codec<unknown, unknown, never>`; `toolSaveArgsSchema` no longer
  calls `.strict()` (strictness comes from the gateway's decode option).
- `apps/server/src/tools/service.ts`: `toolHostsSchema.parse(...)` →
  `Schema.decodeUnknownSync(toolHostsSchema)(...)` (still throws on bad
  input); added the `effect` import.
- `apps/server/src/tools/adapters.test.ts`: dropped the zod import; the five
  parse sites now use `decodeActionArgs` from `../actions/registry` with the
  same expectations.
- `apps/server/src/routines/schedule.test.ts`: one new test pinning
  `parseRoutineSchedule({ kind: 'weekly' })` → `kind must be 'daily' or 'interval'`.

`EFFECT_GUIDE.md` "custom messages" and the task say the `{ message }` option
on `isMinLength`/`isMaxLength` does not reach the issue annotations, so every
custom rule is a `Schema.makeFilter` that returns the text. A small issue-tree
walker (first custom `InvalidValue`/`Filter` annotation, else the error
message's first line) extracts the first message in `parseToolVersionInput`
and `parseRoutineSchedule`.

### Files changed

All inside the Allowed files:
`apps/server/src/tools/schemas.ts`, `apps/server/src/routines/schedule.ts`,
`apps/server/src/tools/adapters.ts`, `apps/server/src/tools/service.ts`,
`apps/server/src/tools/adapters.test.ts`,
`apps/server/src/routines/schedule.test.ts`,
`work/T-0604-tool-routine-schemas-effect.md`.

### Commands run

Single-file runs while working (both green):

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/schedule.test.ts`
  → 1 file, 23 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/adapters.test.ts`
  → 1 file, 27 passed.

Task's Checks command:

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot tools routines actions`
  → 25 files, 411 passed.

`pnpm gate` (first run failed only on `format`; I ran
`pnpm exec prettier --write` on the three flagged files, then re-ran):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (20.7s)
PASS  lint  (0.9s)
PASS  typecheck  (9.8s)
PASS  tests @zilar/server  (352.8s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Text probe (`pnpm --filter @zilar/server exec tsx -e "..."`, final code)

32 custom texts across the four files; all PASS. The wildcard text is
unreachable through the composed `singleHostSchema` (the charset regex rejects
`*` first, exactly as the old zod chain did), so it is probed in isolation.

```
PASS name: "name must match ^[a-z][a-z0-9_-]{1,39}$"
PASS description-empty: "description must not be empty"
PASS description-max: "description must be at most 200 characters"
PASS description-control: "description must not contain control characters"
PASS message-empty: "message must not be empty"
PASS message-max: "message must be at most 200 characters"
PASS message-control: "message must not contain control characters"
PASS source-empty: "source must not be empty"
PASS source-max: "source must be at most 65536 bytes"
PASS host-empty-entry: "hosts must not contain an empty entry"
PASS host-max253: "each host must be at most 253 characters"
PASS host-charset: "each host must be letters, digits, dots or hyphens"
PASS host-needs-dot: "each host must contain at least one dot"
PASS host-start-end-dot: "each host must not start or end with a dot"
PASS host-empty-label: "each host must not contain an empty label"
PASS host-ip: "each host must not be an IP literal"
PASS host-label-len: "each host label must be 1-63 characters"
PASS host-label-hyphen: "each host label must not start or end with a hyphen"
PASS hosts-max: "at most 5 hosts"
PASS host-wildcard(isolated): "each host must not contain a wildcard"
PASS time: "time must be HH:MM (00:00-23:59)"
PASS timezone-empty: "timezone must not be empty"
PASS timezone-unknown: "unknown IANA time zone"
PASS weekdays-dup: "weekdays must not contain duplicates"
PASS everyMinutes-int: "everyMinutes must be an integer"
PASS everyMinutes-min: "everyMinutes must be at least 60"
PASS everyMinutes-max: "everyMinutes must be at most 10080"
PASS union-kind: "kind must be 'daily' or 'interval'"
PASS tool.run-input: "input must serialise to at most 16384 bytes"
PASS routine.schedule-input: "input must serialise to at most 2048 bytes"
PASS routine-title-empty: "title must not be empty"
PASS routine-title-max: "title must be at most 80 characters"
```

### Deviations / notes

- **33 vs 32 texts.** §3.1 has 31 message rows; row 250 covers two texts
  (`tool.run` 16384 and `routine.schedule` 2048), and the union adds one. The
  `lang must be 2-3 letters` text is in `web-tools/adapters.ts`, which is T-D's
  Allowed file, not this task's. Counted within these four files: 32. All pass.
- **No `Schema.Trim` on description/message.** The plan §3.1 table writes
  `Schema.Trim.check(...)` for `tools/schemas.ts:20,21,30,31`, but the zod
  code there has no `.trim()` (`tools/schemas.ts` uses `z.string().min/max`).
  Adding trim would change accept/reject behaviour (a whitespace-only
  description is accepted today, rejected after trim), so I used plain
  `Schema.String.check(...)`. Trim is kept only where zod had it
  (`singleHostSchema`).
- **Custom-message construction.** As instructed, every custom text is a
  `Schema.makeFilter` (not `{ message }` on `isMinLength`/`isMaxLength`),
  because Effect 4.0.2 drops those annotations and the `parse*` helpers walk
  the issue tree.
- **`toolVersionInputSchema` stays non-strict** for `parseToolVersionInput`
  (strips unknown keys, matching the old `z.object`); the adapter path applies
  `onExcessProperty: 'error'` in `decodeActionArgs`, matching the old
  `toolVersionInputSchema.strict()`.
- **Union text** is the fixed `kind must be 'daily' or 'interval'` from the
  task (the plan's `Invalid discriminator value...` wording is overridden).

### Open questions

None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 nit. The packet (14:35) is newer than HEAD f34d6f03.
- **Lead check:**
  - the four files have no zod;
  - the probe passes all 32 texts in scope (the 33rd, `lang`, is in T-0598's file);
  - the union text is pinned by the one new `schedule.test.ts` case;
  - the `adapters.test.ts` changes are only the parse-call swaps, with the same expectations;
  - not adding `Trim` where zod had none is correct (the plan table was wrong there).
- **Follow-up (nit):** the `schedule.ts:2` header still says zod.
