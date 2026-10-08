---
id: T-0603
title: "Tool args T-B: the eight model tool-argument schemas in agents/tools.ts zod to Effect Schema; rejection reasons name the field and problem from keys/tags only (never a value), following the plan's §2 walker and §3.2 table as closely as practical; tests unchanged"
status: merged
milestone: M5
branch: task/T-0603-agent-tool-args-effect
model: auto
effort: low
depends_on: [T-0594]
estimate: 1 day
---

# T-0603: the model tool arguments on Effect Schema (plan task T-B)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. The plan is `docs/audit/tool-args-schema-plan.md` (§1.2, §2, §3.2 and §4 T-B). Its open findings, `docs/audit/tool-args-schema-plan-open-findings.md` (items 2-6), are about the §2 walker: **read them, and fix what applies.**

### Verified facts (do not re-derive)
**`apps/server/src/agents/tools.ts`** (zod import at the top). The eight strict schemas:
- `UpdatePersonaArgsSchema` (29-34);
- `RevertPersonaArgsSchema` (36);
- `RecallArgsSchema` (38-42);
- `MemoryZoomArgsSchema` (46-50), with the block regex `/^\d{1,9}-\d{1,9}$/`;
- `RememberArgsSchema` (52-56);
- `DelegateArgsSchema` (62-70);
- `TaskStatusArgsSchema` (72-76);
- `RequestActionArgsSchema` (82-87): `action` trimmed, 1..`ACTION_NAME_MAX_LENGTH`, matching `ACTION_NAME_PATTERN`; `args` is `z.record(z.string(), z.unknown())`. **An array or a primitive for `args` must be rejected.**

They feed `UpdatePersonaArgs` and `RequestActionArgs` (89-90) and `parseToolArguments` (decodes at 163-230). On failure it returns `{ ok: false, reason: firstIssue(error) }`, where `firstIssue` (240-242) is the first zod issue message.

**The rule that matters.** The `reason` goes back to the **model**. `apps/server/src/agents/tools.test.ts:135-143` and `160-168` assert that **no argument value is ever echoed** in a reason; this is security-relevant. No test pins zod's own wording (the lead checked: grep finds no "Invalid input", "Too small" or "Unrecognized key" in `agents/*.test.ts`). The pinned texts are hand-written: `arguments are not valid JSON` and `unknown tool: ...`.

**The lead's decision.**
- **Build reasons from keys, schema tags and annotations only, never from values.**
- Follow the plan's §2 walker and §3.2 table as closely as practical (field name plus problem, for example `Invalid input: expected string, received undefined`, or `Unrecognized key: "x"`).
- Exact zod parity is **not** required where Effect's issue tree makes it awkward, such as the ordering nit or an `AnyOf` with no child issues. In those cases a short, clear text like `persona: too long` is fine.
- In the Report, list for each of the eight schemas the reason for three inputs: a missing required key, a wrong type, and an extra key.

**Decode options.** All eight are `.strict()` in zod, so decode with `onExcessProperty: 'error'`. `.trim()` before the length checks becomes `Schema.Trim.check(...)` (the codebase idiom, `apps/server/src/ais/api.ts:114`). `args` becomes `Schema.Record(Schema.String, Schema.Unknown)`; check that it rejects `[]`, and say how.

**The helper.** Put the walker in `apps/server/src/agents/tools.ts`, or in a new `apps/server/src/agents/tool-arg-issues.ts` if it is long. `decodeActionArgs` in `actions/registry.ts` stays as it is, since it needs no message.

**Tests (all unchanged):**
- `apps/server/src/agents/tools.test.ts`;
- `apps/server/src/agents/reply.test.ts`;
- `apps/server/src/agents/gateway.test.ts`;
- `apps/server/src/agents/integration.test.ts`.

### What to build
1. **Convert the eight schemas and the two exported types** (`UpdatePersonaArgs` and `RequestActionArgs` keep their names and shapes).
2. **Replace `firstIssue`** with the key-and-tag-only walker.
3. **`agents/tools.ts`** ends with no zod import.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts" and "Schema, custom messages"), `docs/audit/tool-args-schema-plan.md` (§1.2, §2, §3.2 and §4 T-B), `docs/audit/tool-args-schema-plan-open-findings.md`, `apps/server/src/xmpp/config.ts` (lines 60-100, the codebase walker), `apps/server/src/agents/tools.ts` and `apps/server/src/agents/tools.test.ts`.

### Allowed files
`apps/server/src/agents/tools.ts`, `apps/server/src/agents/tool-arg-issues.ts`, `work/T-0603-agent-tool-args-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/tools agents/reply agents/gateway agents/integration
pnpm gate
```

### Acceptance
- The eight model tool schemas are on Effect Schema, and the rejection reasons name the field and problem without ever echoing a value.
- The Report includes the reasons table.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Converted the eight model tool-argument schemas and the two exported types in
`apps/server/src/agents/tools.ts` from zod to Effect Schema, and replaced
`firstIssue` with a key/tag/annotation-only walker in a new
`apps/server/src/agents/tool-arg-issues.ts`. `agents/tools.ts` now has no zod
import. `actions/registry.ts` (`decodeActionArgs`) was left untouched.

- Schemas use `struct()` from `@zilar/protocol` (mutable fields, matching the
  old zod shapes); `.trim()` is `Schema.Trim.check(...)`; lengths/patterns are
  `Schema.isMinLength` / `Schema.isMaxLength` / `Schema.isPattern`;
  `acceptance` is `Schema.mutable(Schema.Array(...)).check(Schema.isMaxLength(10))`;
  `args` is `Schema.Record(Schema.String, Schema.Unknown)`.
- Decoding goes through one `decodeToolArguments` helper:
  `Schema.decodeUnknownExit(schema, { errors: 'all', onExcessProperty: 'error' })`.
  All eight were `.strict()` in zod, so excess keys fail.
- `firstIssueReason` walks `Composite`/`AnyOf`/`Pointer`/`Filter`/`Encoding`/
  `MissingKey`/`UnexpectedKey`/`InvalidType`/`InvalidValue`. It reads only keys,
  schema tags and code-written annotations; the raw input is inspected for its
  runtime type name only (string/number/array/null), never its content, so
  persona text or an action argument can never leak into a reason.

### Reasons the model now sees (8 schemas x 3 inputs)

Probed by calling the real `parseToolArguments` with a throwaway `tsx` script
(no repo file created).

| Schema | Missing required key | Wrong type | Extra key |
| --- | --- | --- | --- |
| `update_persona` | missing `summary` -> `Invalid input: expected string, received undefined` | `persona: 42` -> `Invalid input: expected string, received number` | `model` -> `Unrecognized key: "model"` |
| `revert_persona` | none (no required key; `{}` is valid) | n/a (any key is an extra key) | `force` -> `Unrecognized key: "force"` |
| `recall` | missing `query` -> `Invalid input: expected string, received undefined` | `query: 42` -> `Invalid input: expected string, received number` | `chat` -> `Unrecognized key: "chat"` |
| `memory_zoom` | missing `block` -> `Invalid input: expected string, received undefined` | `block: 42` -> `Invalid input: expected string, received number` | `ai` -> `Unrecognized key: "ai"` |
| `remember` | missing `text` -> `Invalid input: expected string, received undefined` | `text: 42` -> `Invalid input: expected string, received number` | `chatKey` -> `Unrecognized key: "chatKey"` |
| `delegate` | missing `to` -> `Invalid input: expected string, received undefined` | `to: 42` -> `Invalid input: expected string, received number` | `extra` -> `Unrecognized key: "extra"` |
| `task_status` | missing `task_id` -> `Invalid input: expected string, received undefined` | `task_id: 42` -> `Invalid input: expected string, received number` | `ai` -> `Unrecognized key: "ai"` |
| `request_action` | missing `args` -> `Invalid input: expected record, received undefined` | `args: [1,2,3]` -> `Invalid input: expected record, received array` | `model` -> `Unrecognized key: "model"` |

Filter failures (too long/short/pattern) name the field and Effect's own
`expected` text, e.g. `persona: a value with a length of at most 4000`,
`block: a string matching the RegExp /^\d{1,9}-\d{1,9}$/`,
`action: a string matching the RegExp /^[a-z].../`.

`args: []` rejection: Effect's `Schema.Record` rejects arrays itself (it fails
with `InvalidType` on the `Objects` AST before any key/value is read). The
walker only checks the raw value's runtime type and reports
`Invalid input: expected record, received array`.

### Open findings (plan §open-findings, items 2-6)

- **Item 3 (MissingKey annotations):** addressed. The walker reads
  `issue.annotations?.messageMissingKey` (not `{ message }` on the value
  schema). No custom missing-key text is set.
- **Item 4 (record rename at the root):** fixed. The `record` rename applies
  only when the accumulated path's last key is `args` (i.e. under a `Pointer`);
  a top-level non-object defaults to `object`.
- **Item 5 (numeric leaf table):** not applicable. These eight schemas have no
  numeric fields; every required key is a string except `args` -> `record`.
- **Item 6 (message-less filter -> opaque `invalid`):** fixed. A filter with no
  `message` uses its `expected` annotation prefixed by the field name, so it is
  never the opaque `invalid`.
- **Item 2 (hardcoded AnyOf text):** not applicable to these schemas (no
  discriminated union). An empty `AnyOf` returns `undefined` and the caller
  falls back to `invalid arguments`; T-F owns its own union text.

### Deviations from the spec (and why)

- `RevertPersonaArgsSchema` is `struct({}).check(Schema.makeFilter(...))`: an
  empty `Schema.Struct({})` ignores `onExcessProperty: 'error'` in Effect
  4.0.2 (probe-verified), so the filter rejects any key and reports
  `Unrecognized key: "<first key>"`. The key is a name, not a value.
- Filter texts are not zod-byte-identical (`Too big: expected string to have
  <=4000 characters`); they use Effect's `expected` annotation with the field
  prefix. The spec allows short, clear text where exact parity is awkward.
- Ordering: with `errors: 'all'`, an input that both misses a key and carries
  an extra key reports the extra key first (Effect) where zod reported the
  missing key first. No test pins this.
- `request_action` success returns `args: { ...parsed.value.args }` so
  `ParsedToolArguments` keeps its mutable `Record<string, unknown>` shape,
  which `ValidToolCall` (`agents/reply.ts`) requires.

### Files changed

- `apps/server/src/agents/tools.ts` (schemas, types, decode helper, removed zod)
- `apps/server/src/agents/tool-arg-issues.ts` (new walker)
- `work/T-0603-agent-tool-args-effect.md` (this report/status)

### Commands and real results

- `pnpm install` -> Done in 27.7s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/tools`
  -> 48 passed (1 file).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/reply
  agents/gateway agents/integration` -> 217 passed, 1 skipped (3 files passed,
  1 skipped).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/tools
  agents/reply agents/gateway agents/integration` (the task's check) ->
  265 passed, 1 skipped (4 files passed, 1 skipped).
- `pnpm --filter @zilar/server typecheck` -> pass (run once after the gate
  typecheck failures below were fixed).
- `pnpm gate` (final) -> install PASS, format PASS, lint PASS, typecheck PASS,
  tests @zilar/server PASS, `scope: every changed file is inside the Allowed
  files`, `GATE PASS`.

Two intermediate gate runs failed and were fixed inside the Allowed files:
a formatting miss in `tool-arg-issues.ts` (ran prettier on that file), then two
type errors (`symbol` to string in `fieldName`; `S['Type']` vs
`Schema.Schema.Type<S>` in `decodeToolArguments`).

### Tests

All four listed test files are unchanged and green (see commands above).


## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (14:18) is newer than HEAD 52143d1d.
- **No test file changed.**
- **Lead check:**
  - `agents/tools.ts` has no zod;
  - the new `tool-arg-issues.ts` walker reads only keys, tags and annotations;
  - the 24-row reasons table matches the zod wording (`Invalid input: expected X, received Y`, `Unrecognized key`), and `args: []` is rejected as `expected record, received array`;
  - the no-echo tests pass.
