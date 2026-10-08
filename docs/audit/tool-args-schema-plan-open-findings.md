# Open findings on the tool-args plan (T-0571, pre-review round 4)

The lead approved the plan with these findings open. They are inputs for the implementation specs (T-A to T-G): check each one against the code when you write the spec.

## Findings

1. `docs/audit/tool-args-schema-plan.md:360-362` (T-A) — the transitional
   union is `z.ZodType<Args> | Schema.Schema<Args, unknown, never>`, but
   `Schema.Schema` takes one type argument (`Schema.d.ts:739`
   `interface Schema<out T>`; 3-arg form is `Schema.Codec<T, E, R>` at
   `:843`). As written the union does not compile. T-A must say
   `Schema.Schema<Args>` (or `Schema.Codec<Args, unknown, never>`).
   Concrete failure: the T-A implementer copies the union into
   `actions/registry.ts` and typecheck fails on the first line.
   Severity: **should-fix** (breaks the task-split acceptance point; the
   sketch's own `Schema.Schema<Args>` at line 176 is already correct).

2. `docs/audit/tool-args-schema-plan.md:194,303-314` (§2/§3.2) — the empty-
   `AnyOf` fallback hardcodes `Invalid discriminator value. Expected 'daily'
   | 'interval'`, i.e. schedule-specific text inside the shared gateway
   helper. Any *other* union decoded through `decodeActionArgs` (today:
   `sandbox/run-tool.ts:36,62` `workerResultSchema`/`workerEventSchema`,
   both `z.union`) would report the daily/interval text on a real mismatch
   — e.g. a malformed worker event becomes "Invalid discriminator value.
   Expected 'daily' | 'interval'". Those messages are currently swallowed
   (`run-tool.ts:201-205` ignores the message), so nothing breaks today,
   but T-F's conversion inherits a wrong-text landmine. The sketch already
   prefers `msg(issue.annotations?.message)` first (probe: union-level
   `.annotate({ message })` does *not* surface on the empty `AnyOf` in
   4.0.2, so the hardcode is load-bearing for now); the fix is one sentence
   in T-F: annotate or special-case the worker union, not the shared helper.
   Severity: **should-fix** (wrong model/operator-facing text on a reachable
   path once T-F lands; today masked because the message is discarded).

3. `docs/audit/tool-args-schema-plan.md:201-203` (§2 `MissingKey`) — for a
   missing key the walker reads `issue.annotations?.message`, but
   `MissingKey.annotations` is `Schema.Annotations.Key`
   (`SchemaAST.d.ts:532`), whose declared fields are `messageMissingKey`
   (plus `Documentation`), not `message` (`Schema.d.ts:11883-11889`;
   `message` lives on `Bottom` at `:11910` and `Filter` at `:12066`).
   `msg()` still typechecks (base `Annotations` is `[x: string]: unknown`),
   so a `message` annotation *would* be read at runtime, but the plan's
   own §3.1 idiom (`Schema.isMinLength(1, { message })` on the value schema)
   never sets it on the key — the `messageMissingKey`/`message` split is
   exactly the kind of annotation-target confusion this plan exists to
   prevent. T-B must set `messageMissingKey` (or annotate the struct field)
   for any custom missing-key text, not `{ message }` on the value schema.
   Severity: **should-fix** (misdirects the T-B implementer; default
   missing-key rows still work because they fall through to the rebuilt
   zod text).

4. `docs/audit/tool-args-schema-plan.md:204-207` (§2 `InvalidType`) — the
   `record` special-case keys off `issue.ast._tag === 'Objects'`, but a
   top-level non-object takes the same branch: `Schema.Struct(...)` decoded
   from `[]`/`null` yields root `InvalidType ast=Objects` (probe-verified),
   and `raw` is an array for `[]`, so the walker returns
   `Invalid input: expected record, received array` where zod says
   `expected object` (zod probe: top-level `[]` → `expected object...`;
   §3.2 row 5 pins `expected object` for the string case only). Reachable
   today: `RequestActionArgsSchema` has no top-level guard before the struct
   decode, so `args: []` at top level misnames the expected type.
   One-line fix: only apply the `record` rename under a `Pointer`
   (`path.length > 0`, i.e. the `args` field), defaulting the root to
   `object` (matching the existing `MissingKey` root handling at line 202).
   Severity: **should-fix** (wrong model-facing text on a reachable input).

5. `docs/audit/tool-args-schema-plan.md:375-377` (T-B) — the `expectedLeaf`
   override is given only for `args → record`, but the same AST-blindness
   hits every numeric leaf: a missing `everyMinutes` surfaces as
   `MissingKey` (probe-verified), so T-B's own walker prints
   `expected string` where zod says `expected number` (zod probe:
   `invalid_type[everyMinutes]: expected number, received undefined`).
   Either T-B owns a general leaf table (string/number/boolean/array per
   field) or T-E does for the schedule schemas; as written each task can
   assume the other covers it. Severity: **should-fix** (gap between two
   tasks; silent model-facing text regression on missing numeric fields).

6. `docs/audit/tool-args-schema-plan.md:209` (§2 `Filter`) — the walker
   recurses into `issue.issue` when the filter carries no `message`. For a
   `Schema.isMinLength`-style check the inner issue is bare `InvalidValue`
   (probe-verified: `ann=undefined`), so the helper returns `undefined` and
   `decodeActionArgs` falls through to `'invalid'` — but only for filters
   *without* custom messages, i.e. exactly the `agents/tools.ts` no-custom-
   message schemas (§3.2) the helper is built for. In practice every §3.2
   string check gets `{ message }` per the plan, so this is a latent trap,
   not a live row: any future messageless filter decoded through the helper
   yields the opaque `'invalid'` instead of Effect's default text.
   Severity: **nit** (document the fallthrough; consider returning
   `undefined` distinctly from `'invalid'`).

7. `docs/audit/tool-args-schema-plan.md:249` (§3.1 transform row) — the row
   prescribes `Schema.decodeTo(Target, { decode: SchemaGetter.transform…,
   encode: … })`, but `Schema.decodeTo`'s 2-arg overload takes
   `{ decode, encode }` plain functions (`Schema.d.ts:4639-4642`), while
   `SchemaGetter.transform(...)` already returns a full transformation
   object (used bare at `config.ts:60,73`, never wrapped in
   `{ decode:, encode: }`). As written the row double-wraps. The cited
   `config.ts:15-16,60,73-74` lines themselves are accurate. Severity:
   **nit** (wrong composition in the prescription; T-E would catch it at
   typecheck, but the plan should show the `config.ts:60` shape exactly).

## Follow-ups

None — every finding above is fixed inside the plan document, which is an
Allowed file.

Counts: must-fix=0, should-fix=5, nit=2, follow-up=0
