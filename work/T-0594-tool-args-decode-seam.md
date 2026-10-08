---
id: T-0594
title: "Tool args T-A: the registry/gateway decode seam: `argsSchema` accepts zod OR Effect Schema during the move; one `decodeActionArgs` helper replaces the four `.safeParse` calls in policy.ts and gateway.ts; `invalid_args` unchanged; tests unchanged"
status: merged
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

### What I did

Introduced the transitional decode seam (plan T-A). `apps/server/src/actions/registry.ts` now exports `type ArgsSchema<Args> = z.ZodType<Args> | Schema.Codec<Args, unknown, never>` and `decodeActionArgs(schema, raw)`, which returns `{ ok: true; value: Args } | { ok: false }`. `ActionAdapter.argsSchema` is typed `ArgsSchema<Args>` and the comment above it now says "zod or Effect schema while the tool layer moves (plan T-A); a later task removes zod".

The four `.safeParse` sites now go through the helper and read `.value` where they read `.data`, with the same denials:
- `actions/policy.ts:47` -> `decodeActionArgs(...)`; still `{ kind: 'deny', reason: 'invalid_args' }` (also changed the adjacent comment from "the adapter's zod schema" to "the adapter's args schema").
- `actions/gateway.ts:274` (`runAllowedAction`), `:331` (`runAutoApprovedAction`), `:421` (`runApprovalPath`); all still `{ status: 'denied', reason: 'invalid_args' }`. The `prepareArgs` call at `:439` now passes `parsed.value`.

Added one test to `actions/registry.test.ts` (`describe('decodeActionArgs (T-0594)')`): builds `Schema.Struct({ value: Schema.String })`, accepts `{ value: 'a' }`, rejects `{ value: 1 }` and `{ value: 'a', extra: 1 }`.

### Finding for the Report (spec asked to check this)

The spec says "every zod args schema in the codebase is `.strict()`". Grep shows that is **almost** true, not exactly:
- strict: all 8 schemas in `tools/adapters.ts`, all 5 in `web-tools/adapters.ts`, both in `routines/schedule.ts`.
- **not strict:** `actions/demo.ts:20` `DemoEchoArgsSchema = z.object({ text: ... })`, and every fake adapter in the tests (`registry.test.ts:19`, `gateway.test.ts` x11, `policy.test.ts`, `flow.e2e.test.ts` x4, `approvals/rules.test.ts` x2) uses plain `z.object`.

So `onExcessProperty: 'error'` matches the strict production schemas but not `demo.echo`. That is harmless in T-A: demo still decodes through the zod branch (`safeParse`), so its behaviour is unchanged. It is a flag for **T-C**: if `demo.echo` moves to Effect Schema through this helper, extra keys change from silently stripped (zod default) to rejected. T-C decides/records that.

### Effect type (spec asked which one)

`Schema.Codec<Args, unknown, never>` typechecks and is what I used. `Schema.decodeUnknownExit` is declared `<S extends ConstraintDecoder<unknown>>` (`node_modules/effect/dist/Schema.d.ts:1263`), and `Schema.Codec<T, E, RD, RE>` has `Encoded=E`, `DecodingServices=RD`, `EncodingServices=RE` (`:843`); `Schema.Codec<Args, unknown, never>` satisfies that constraint and gives `S["Type"] = Args`, so `exit.value` is typed `Args`. `Schema.Schema<Args>` is type-only (`:739`) and does not carry `Encoded`/service fields, so it is the wrong member for this call.

### Files changed

- `apps/server/src/actions/registry.ts` (union type + `decodeActionArgs` + comment; `argsSchema` type)
- `apps/server/src/actions/policy.ts` (one call site + import + comment)
- `apps/server/src/actions/gateway.ts` (import + four call sites, `.data` -> `.value`)
- `apps/server/src/actions/registry.test.ts` (one new test; `Schema` import)
- `work/T-0594-tool-args-decode-seam.md` (this report)

### Commands and real results

- `pnpm install`: done in 55.7s, 1173 packages added; the usual peer-dep warning for `@types/react-dom` in `apps/mobile` (pre-existing, not mine).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot actions/registry.test.ts`: **14 passed (1 file)**, including the new Effect-branch test.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot actions approvals agents/tools web-tools tools/adapters` (spec Checks): **405 passed (25 files)**.
- `pnpm gate` (repo root): summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (4.8s)
  PASS  format  (73.2s)
  PASS  lint  (1.6s)
  PASS  typecheck  (52.6s)
  PASS  tests @zilar/server  (1904.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Existing tests

All existing tests pass unchanged; the only test edit is the one added test (plus its `Schema` import). Nothing else was reformatted.

### Security checklist

Pure refactor of arg decoding; no new route, no new write, no DB, no audit or log change. The deny reason stays the fixed `invalid_args`; no schema message is logged or returned (callers discard it, same as before).

### Deviations / open questions

- Only deviation is the `demo.echo` non-strict schema noted above; not a blocker for T-A and no behaviour change here, but it should be an explicit choice in T-C.
- No other open questions.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 nit and 1 follow-up. The packet (13:34) is newer than HEAD ee3974f6.
- **Lead check:**
  - `ArgsSchema<Args>` is `z.ZodType<Args> | Schema.Codec<Args, unknown, never>`;
  - `decodeActionArgs` branches on `safeParse` and decodes Effect strictly;
  - the four call sites keep the same `invalid_args` denials;
  - one new registry test covers the Effect branch.
- **Follow-up, for T-C (demo):** `DemoEchoArgsSchema` is the one non-strict zod args schema. Moving it to Effect through this seam turns stripped extra keys into a rejection, and the T-C spec must record that change.
- **Nit:** the comment at `registry.ts:105` names the old call shape.
