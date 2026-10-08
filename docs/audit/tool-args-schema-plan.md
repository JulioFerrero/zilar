# Plan: the AI tool argument layer on Effect Schema

T-0571, read-only audit. This document maps the zod still left in the AI tool
argument layer, proposes the Effect Schema contract for the action registry,
records the exact error texts that must not change, and splits the work into
small tasks. It writes no code.

Sources read for this plan: `docs/EFFECT_GUIDE.md`,
`docs/audit/effect-everywhere-plan.md`, `apps/server/src/actions/registry.ts`,
`apps/server/src/agents/tools.ts`, `apps/server/src/tools/schemas.ts`,
`apps/server/src/routines/schedule.ts`, plus the other files cited inline.

## 0. Findings that shape the plan

- **The adapter `argsSchema` never reaches the model as JSON Schema.** The
  `parameters` the model sees are hand-written JSON objects in
  `agents/tools.ts` (`PERSONA_TOOLS` L255-289, `MEMORY_TOOLS` L296-350,
  `buildRequestActionTool` L373-392, `buildDelegateTool` L399-430,
  `TASK_STATUS_TOOL_DEF` L434-450, and the group arrays L458-485). A grep for
  `toJSONSchema` / `JSONSchema` / `zod-to-json` under `apps/server/src`
  returns nothing outside tests, so no zod→JSON-Schema conversion exists to
  replace. The adapter schemas are validation-only.
- **The registry never returns a schema's message.** `actions/policy.ts:47`,
  `actions/gateway.ts:274`, `:331` and `:421` call `argsSchema.safeParse` and
  use only `.success`; every failure becomes the fixed reason `invalid_args`
  (`policy.ts:49`, `gateway.ts:279`, `:338`, `:423`; asserted at
  `actions/policy.test.ts:88`, `actions/gateway.test.ts:381`,
  `actions/flow.e2e.test.ts:518`, `tools/adapters.test.ts:592,599,601`,
  `web-tools/adapters.test.ts:205,209,213,277,362,366,368,376,413,417,459`).
  No adapter args schema message is test-asserted.
- **Only `agents/tools.ts` returns schema text to the model.** `firstIssue`
  (`agents/tools.ts:240-242`) feeds `parseToolArguments` (`:139-238`), whose
  `reason` becomes `invalid: ${parsed.reason}` in
  `agents/reply.ts:591` (and the hand-written `invalid: unknown tool` at
  `reply.ts:602`). Its schemas declare no custom messages, so the model
  currently sees zod's default messages (collect in §3).
- **The messages the service/HTTP layer carries are not test-asserted.**
  `tools/schemas.ts` and `routines/schedule.ts` messages reach
  `ToolServiceError`/`RoutineServiceError` (`tools/service.ts:147,474`,
  `routines/service.ts:110,330`) and the HTTP 400 body, but the route tests
  assert only `error.code` (`tools/routes.test.ts:160`, `:742`). They must
  still be preserved for production parity, but a byte change breaks no test
  today.
- **The only tests that call the schemas directly are three parse-call
  sites** (§4 names them), plus five test files that build fake adapters with
  `argsSchema: z.object(...)`.
- **The tools HTTP module is already on Effect Schema** (`tools/api.ts:88`
  `STRICT_DECODE`, `:471`, `:567`), but it only defines the revert/run bodies;
  the name/description/source/hosts rules still live in `tools/schemas.ts`.

## 1. Map of the tool layer

Every zod schema in the layer, who imports it, and how its text is used.
"none asserted" means no test asserts a message; the `invalid_args` /
`.ok` / `.success` assertions are listed per file only when relevant.

### 1.1 `apps/server/src/actions/registry.ts` (type-only)

| Line | Schema | Consumer / use |
| --- | --- | --- |
| 1 | `import type { z } from 'zod'` | — |
| 95 | `argsSchema: z.ZodType<Args>` | `actions/policy.ts:47`, `actions/gateway.ts:274,331,421`; `actions/demo.ts:49`, `tools/adapters.ts` (casts L372,404,448,544,615,667,735,775,855,898), `web-tools/adapters.ts` (casts L179,313,386,490,544). Message: discarded, mapped to `invalid_args`. |

### 1.2 `apps/server/src/agents/tools.ts` (model-facing)

| Line | Schema | Consumer / use |
| --- | --- | --- |
| 29-34 | `UpdatePersonaArgsSchema` strict | `parseToolArguments` L170 |
| 36 | `RevertPersonaArgsSchema` strict | `parseToolArguments` L163 |
| 38-42 | `RecallArgsSchema` strict | `parseToolArguments` L182 |
| 46-50 | `MemoryZoomArgsSchema` strict | `parseToolArguments` L189 |
| 52-56 | `RememberArgsSchema` strict | `parseToolArguments` L196 |
| 62-70 | `DelegateArgsSchema` strict | `parseToolArguments` L203 |
| 72-76 | `TaskStatusArgsSchema` strict | `parseToolArguments` L222 |
| 82-87 | `RequestActionArgsSchema` strict | `parseToolArguments` L228 |
| 240-242 | `firstIssue(error: z.ZodError)` | first message → `reason` → `reply.ts:591` `invalid: …` → **model**. Tests assert only `.ok` and hand-written reasons (`tools.test.ts:50,58,66,79,102,111,121,132,141`). |

### 1.3 `apps/server/src/tools/schemas.ts` (shared rules)

| Line | Schema | Consumer / use |
| --- | --- | --- |
| 11-13 | `toolNameSchema` (regex, custom msg) | `tools/adapters.ts:306,315,322,339,353`; `tools/service.ts` via `toolVersionInputSchema` |
| 18-24 | `toolDescriptionSchema` (min/max/control, custom msgs) | `tools/adapters.ts:311`; `tools/service.ts:139,466` |
| 28-34 | `toolMessageSchema` | `tools/adapters.ts:311`; `tools/service.ts:139,466` |
| 37-44 | `toolSourceSchema` (byte length, custom msgs) | same |
| 49-79 | `singleHostSchema` (private; trim, 8 custom msgs, lowercase transform) | `toolHostsSchema` |
| 82-85 | `toolHostsSchema` (max 5, dedupe) | `tools/adapters.ts:356`; `tools/service.ts:672` (`toolHostsSchema.parse`) |
| 88-94 | `toolVersionInputSchema` | `tools/adapters.ts:311` (`toolVersionInputSchema.strict()`), `tools/service.ts` via `parseToolVersionInput` |
| 105-116 | `parseToolVersionInput` (first issue message) | `tools/service.ts:139,466` → `ToolServiceError('invalid_request', message)` → HTTP 400 body; **none asserted** (`tools/routes.test.ts:160,742` assert codes). |

### 1.4 `apps/server/src/tools/adapters.ts`

| Line | Schema | Consumer / use |
| --- | --- | --- |
| 246-257 | `inputField(maxBytes)` `z.unknown().refine` (custom msg) | `toolRunArgsSchema:316`, `routineScheduleArgsSchema:357` |
| 302 | `toolListArgsSchema` (empty strict) | adapter `tool.list` L372 |
| 304-309 | `toolReadArgsSchema` | `tool.read` L404 |
| 311 | `toolSaveArgsSchema = toolVersionInputSchema.strict()` | `tool.save` L448 |
| 313-318 | `toolRunArgsSchema` | `tool.run` L544 |
| 320-324 | `toolApproveHostsArgsSchema` | `tool.approve_hosts` L667 |
| 326 | `toolRevokeHostsArgsSchema` (alias) | `tool.revoke_hosts` L735 |
| 337-342 | `toolRevertArgsSchema` | `tool.revert` L615 |
| 344-349 | `routineTitleSchema` (custom msgs) | `routineScheduleArgsSchema`, `routineTitleArgsSchema` |
| 351-359 | `routineScheduleArgsSchema` (embeds `routineScheduleSchema` L355 and `toolHostsSchema` L356) | `routine.schedule` L775 |
| 361-365 | `routineTitleArgsSchema` | `routine.pause` L855, `routine.delete` L898 |

Every message is discarded at the gateway → `invalid_args`. `tools/adapters.test.ts`
asserts only summaries (`:592` `invalid_args`) and `.success`/`.parse`
booleans (`:374,524,628`).

### 1.5 `apps/server/src/web-tools/adapters.ts`

| Line | Schema | Consumer / use |
| --- | --- | --- |
| 167-172 | `webFetchArgsSchema` strict | `web.fetch` L179 |
| 223-231 | `webWikipediaArgsSchema` strict (custom msg L228 `lang must be 2-3 letters`) | `web.wikipedia` L313 |
| 237-241 | `wikipediaSearchSchema` (external response) | `parseWikipediaSearch` L264-276 (try/catch → `null`) |
| 243-256 | `wikipediaExtractSchema` (external response) | `parseWikipediaExtract` L278-290 (try/catch → `null`) |
| 375-379 | `webPriceArgsSchema` strict | `web.price` L386 |
| 464-469 | `webFeedArgsSchema` strict | `web.feed` L490 |
| 532-536 | `webSearchArgsSchema` strict | `web.search` L544 |

Arg-schema messages → `invalid_args` (none asserted as text;
`web-tools/adapters.test.ts:205,209,…` assert the code). Wikipedia response
messages are swallowed (`return null`).

### 1.6 `apps/server/src/routines/schedule.ts`

| Line | Schema | Consumer / use |
| --- | --- | --- |
| 18-39 | `dailyScheduleSchema` (strict, `superRefine`: unknown time zone L30, duplicate weekdays L36) | `routineScheduleSchema` |
| 41-54 | `intervalScheduleSchema` (strict) | `routineScheduleSchema` |
| 56-59 | `routineScheduleSchema` (discriminated union) | `tools/adapters.ts:30,355`; `parseRoutineSchedule` L71 |
| 70-83 | `parseRoutineSchedule` → first issue message | `routines/service.ts:108,230,328,483`, `routines/scheduler.ts:143`; message → `RoutineServiceError` (`routines/service.ts:110,330`) → HTTP 400; **none asserted** (`routines/schedule.test.ts` asserts only `.ok`). |

### 1.7 `apps/server/src/actions/demo.ts`

| Line | Schema | Consumer / use |
| --- | --- | --- |
| 20-22 | `DemoEchoArgsSchema` (`text` trim 1..200, no custom msg) | adapter `demo.echo` L49; test calls it directly (`demo.test.ts:154-157`) and via the gateway. |

### 1.8 `apps/server/src/sandbox/types.ts`

| Line | Schema | Consumer / use |
| --- | --- | --- |
| 41-51 | `limitsSchema` | `resolveLimits` L53-67 (`safeParse`; failure silently falls back to `DEFAULT_LIMITS`) |
| 110-113 | `toolOutputSchema` | `parseToolOutput` L115-126 (failure → `null`) |

No schema message leaves either function.

### 1.9 `apps/server/src/sandbox/run-tool.ts`

| Line | Schema | Consumer / use |
| --- | --- | --- |
| 36-58 | `workerResultSchema` | `workerEventSchema` L62-73 |
| 62-73 | `workerEventSchema` | `onMessage` L201-205: a failed decode silently ignores the message (no text) |
| 75-78 | `outputJsonSchema` | `runWorker` L304-315: a failed decode produces the fixed hand-written `'tool must return a string or { text, data }'` |

The fixed text is asserted nowhere as a literal: `sandbox/run-tool.test.ts`
asserts only `error.kind === 'invalid_output'` (`:309,329`). The migration must
still keep the literal byte-identical wherever it appears
(`sandbox/run-tool.ts:277,289,309,320` and `tool-worker.ts:510`).

## 2. The registry contract

Target (after the final tighten task): `argsSchema` is an Effect
`Schema.Schema<Args>`; the gateway decodes through one helper that returns the
same "first issue" text zod's `issues[0]?.message` returned. The helper walks
Effect's issue tree exactly like `apps/server/src/xmpp/config.ts:77-96`
(`Composite`/`Pointer`/`MissingKey`/`InvalidValue`/`Filter`/`Encoding`).

```ts
import { Exit, Schema, SchemaIssue } from 'effect';

// Same text zod's `issues[0]?.message` gave. T-B owns the field-name → leaf-type table.
export function decodeActionArgs<Args>(schema: Schema.Schema<Args>, raw: unknown,
  options?: { onExcessProperty: 'error'; expectedLeaf?: ExpectedLeaf },
): { ok: true; value: Args } | { ok: false; message: string } {
  const exit = Schema.decodeUnknownExit(schema, { errors: 'all', onExcessProperty: options?.onExcessProperty })(raw);
  if (Exit.isSuccess(exit)) return { ok: true, value: exit.value };
  for (const r of exit.cause.reasons) if (r._tag === 'Fail') {
    const m = first(r.error.issue, raw, options?.expectedLeaf); if (m !== undefined) return { ok: false, message: m }; }
  return { ok: false, message: 'invalid' };
}

const msg = (m: unknown): string | undefined => typeof m === 'string' && m.length > 0 ? m : undefined;
type ExpectedLeaf = (key: PropertyKey | undefined) => string | undefined;
const leafTag = (t: string): string => t === 'String' ? 'string' : t === 'Number' ? 'number' : t === 'Boolean' ? 'boolean' : 'object';

function first(issue: SchemaIssue.Issue, raw: unknown, leaf: ExpectedLeaf | undefined, path: ReadonlyArray<PropertyKey> = []): string | undefined {
  switch (issue._tag) {
    case 'Composite': for (const c of issue.issues) { const m = first(c, raw, leaf, path); if (m !== undefined) return m; } return undefined;
    case 'AnyOf': // empty when no member matches (Effect 4.0.2); zod names the discriminator instead.
      if (issue.issues.length === 0) return msg(issue.annotations?.message) ?? `Invalid discriminator value. Expected 'daily' | 'interval'`;
      for (const c of issue.issues) { const m = first(c, raw, leaf, path); if (m !== undefined) return m; } return undefined;
    case 'Pointer': {
      const k = issue.path.at(-1);
      const child = typeof raw === 'object' && raw !== null && k !== undefined ? (raw as Record<PropertyKey, unknown>)[k] : undefined;
      return first(issue.issue, child, leaf, [...path, ...issue.path]); }
    case 'UnexpectedKey': return `Unrecognized key: "${String(path.at(-1) ?? '?')}"`;
    case 'MissingKey': {
      const e = path.length === 0 ? 'object' : (leaf?.(path.at(-1)) ?? 'string');
      return msg(issue.annotations?.message) ?? `Invalid input: expected ${e}, received undefined`; }
    case 'InvalidType': { // `args: []` decodes to Objects, so check the raw array for the `record` text.
      const r = Array.isArray(raw) ? 'array' : typeof raw;
      const e = issue.ast._tag === 'Objects' && Array.isArray(raw) ? 'record' : leafTag(issue.ast._tag);
      return msg(issue.ast.annotations?.message) ?? `Invalid input: expected ${e}, received ${r}`; }
    case 'InvalidValue': return msg(issue.annotations?.message);
    case 'Filter': return msg(issue.filter.annotations?.message) ?? first(issue.issue, raw, leaf, path);
    case 'Encoding': return first(issue.issue, raw, leaf, path);
    default: return undefined;
  }
}
```

The gateway replaces `.safeParse` (`policy.ts:47`, `gateway.ts:274,331,421`)
with `decodeActionArgs(adapter.argsSchema, raw)` and keeps returning
`invalid_args` on failure — the message is still discarded there. `argsSchema`
is only ever consumed on those four lines, so no other call site changes.

## 3. Message parity

### 3.1 Custom messages (must stay byte-identical)

Head form is `Schema.Trim.check(...)` / `Schema.String.check(...)` (e.g. `apps/server/src/ais/api.ts:114`); probe-verified below.

| zod rule (file:line) | message | Effect Schema check |
| --- | --- | --- |
| `tools/schemas.ts:11` | `name must match ^[a-z][a-z0-9_-]{1,39}$` | `Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{1,39}$/, { message }))` |
| `tools/schemas.ts:20` | `description must not be empty` | `Schema.Trim.check(Schema.isMinLength(1, { message }))` |
| `tools/schemas.ts:21` | `description must be at most 200 characters` | `Schema.Trim.check(Schema.isMaxLength(200, { message }))` |
| `tools/schemas.ts:22-24` | `description must not contain control characters` | `Schema.makeFilter((v) => hasControl(v) ? msg : undefined)` |
| `tools/schemas.ts:30` | `message must not be empty` | `Schema.Trim.check(Schema.isMinLength(1, { message }))` |
| `tools/schemas.ts:31` | `message must be at most 200 characters` | `Schema.Trim.check(Schema.isMaxLength(200, { message }))` |
| `tools/schemas.ts:32-34` | `message must not contain control characters` | `Schema.makeFilter(...)` |
| `tools/schemas.ts:39-41` | `source must not be empty` | `Schema.makeFilter` on `Buffer.byteLength(v,'utf8') >= 1` |
| `tools/schemas.ts:42-44` | `source must be at most 65536 bytes` | `Schema.makeFilter` on the byte ceiling |
| `tools/schemas.ts:52` | `hosts must not contain an empty entry` | `Schema.Trim.check(Schema.isMinLength(1, { message }))` |
| `tools/schemas.ts:53` | `each host must be at most 253 characters` | `Schema.String.check(Schema.isMaxLength(253, { message }))` |
| `tools/schemas.ts:54-56` | `each host must be letters, digits, dots or hyphens` | `Schema.String.check(Schema.isPattern(/^[A-Za-z0-9.-]+$/, { message }))` |
| `tools/schemas.ts:57-59` | `each host must contain at least one dot` | `Schema.makeFilter(...)` |
| `tools/schemas.ts:60-62` | `each host must not contain a wildcard` | `Schema.makeFilter(...)` |
| `tools/schemas.ts:63-65` | `each host must not start or end with a dot` | `Schema.makeFilter(...)` |
| `tools/schemas.ts:66-68` | `each host must not contain an empty label` | `Schema.makeFilter(...)` |
| `tools/schemas.ts:69-71` | `each host must not be an IP literal` | `Schema.makeFilter(...)` |
| `tools/schemas.ts:72-74` | `each host label must be 1-63 characters` | `Schema.makeFilter(...)` |
| `tools/schemas.ts:75-78` | `each host label must not start or end with a hyphen` | `Schema.makeFilter(...)` |
| `tools/schemas.ts:84` | `at most 5 hosts` | `Schema.Array(<single host schema>).check(Schema.isMaxLength(5, { message }))`, where the element is the full per-host schema (`tools/schemas.ts:49-79`), then the dedupe transform; the key-length rule must not run on keys (`docs/EFFECT_GUIDE.md:172`). Dropping the per-host checks would weaken host validation (empty/IP/wildcard/dot/hyphen rules would go unenforced). |
| `tools/schemas.ts:79,85` | (transform) trim+lowercase, dedupe | `Schema.decodeTo(Target, { decode: SchemaGetter.transform(...), encode: SchemaGetter.transform(...) })` with `SchemaGetter` imported from `'effect'` (`apps/server/src/config.ts:15-16,60,73`); **as in zod, run `.trim()` before the length checks** (`tools/schemas.ts:50-52` trims first). The §2 sketch does not use `SchemaGetter`, so T-E imports it. |
| `tools/adapters.ts:255` | `input must serialise to at most N bytes` | `Schema.makeFilter` (16 KiB for `tool.run`, `MAX_ROUTINE_INPUT_BYTES` for `routine.schedule`) |
| `tools/adapters.ts:346` | `title must not be empty` | `Schema.String.check(Schema.isMinLength(1, { message }))` |
| `tools/adapters.ts:347-349` | `title must be at most N characters` | `Schema.String.check(Schema.isMaxLength(N, { message }))` |
| `routines/schedule.ts:23` | `time must be HH:MM (00:00-23:59)` | `Schema.String.check(Schema.isPattern(..., { message }))` |
| `routines/schedule.ts:24` | `timezone must not be empty` | `Schema.String.check(Schema.isMinLength(1, { message }))` |
| `routines/schedule.ts:30` | `unknown IANA time zone` | `Schema.makeFilter` calling `isKnownTimeZone` (`schedule.ts:113`) |
| `routines/schedule.ts:36` | `weekdays must not contain duplicates` | `Schema.makeFilter` (whole-array check) |
| `routines/schedule.ts:46` | `everyMinutes must be an integer` | `Schema.Int` (or `Schema.isInt({ message })`) |
| `routines/schedule.ts:48` | `everyMinutes must be at least 60` | `Schema.makeFilter(v => v >= 60 ? undefined : msg)` |
| `routines/schedule.ts:51` | `everyMinutes must be at most 10080` | `Schema.makeFilter(v => v <= 10080 ? undefined : msg)` |
| `web-tools/adapters.ts:228` | `lang must be 2-3 letters` | `Schema.String.check(Schema.isPattern(/^[a-zA-Z]{2,3}$/, { message }))` |

Notes on the rule→check mapping, from `docs/audit/effect-everywhere-plan.md:267-279`
and `docs/EFFECT_GUIDE.md:171-173,227`:
- `.strict()` → call `decodeActionArgs` with `{ onExcessProperty: 'error' }`
  (the option the gateway's decode helper must accept and pass through to
  `Schema.decodeUnknownExit`, per the §2 sketch); the strict objects are
  `agents/tools.ts` L34,36,42,50,56,70,76,87 and the schemas at
  `tools/adapters.ts`, `web-tools/adapters.ts`, `routines/schedule.ts`.
  Without the option excess keys are silently stripped (probe-verified), so
  the §3.2 `Unrecognized key: "model"` row would never fire.
- `z.number()` → `Schema.Finite` (rejects `NaN`/`Infinity`), then the bound
  filters; `z.number().int()` → `Schema.Int`.
- `z.url()` → `Schema.makeFilter(isUrl)` with `isUrl` from
  `packages/protocol/src/common.ts:141` (matches `z.url()`'s "any URL"
  behaviour better than `Schema.URLFromString`).
- `.optional()` → `Schema.optional` (not `optionalKey`), because
  `exactOptionalPropertyTypes` is on (`tsconfig.base.json:11`), per
  `docs/EFFECT_GUIDE.md:227`. `docs/audit/effect-everywhere-plan.md:273` lists
  both (`Schema.optionalKey` / `Schema.optional` — key vs value optional) without
  picking one.
- `z.infer` types → `typeof Schema.Type` / `Schema.Schema.Type<typeof s>`.

### 3.2 Messages the model currently sees from `agents/tools.ts` (no custom message)

`firstIssue` (`tools.ts:240`) returns zod v4 defaults; these lines change
when the schemas move to Effect Schema. No test asserts them, but the model
sees them, so capture them here for a conscious choice (keep the same text via
`{ message }`, or accept Effect's text):

| Input | zod v4 message today |
| --- | --- |
| trim-to-empty `persona`/`query`/`text`/`objective` (`:31,40,54,65`) | `Too small: expected string to have >=1 characters` |
| `persona` over 4000 (`:31`) | `Too big: expected string to have <=4000 characters` |
| missing required string (`:32,64,74`) | `Invalid input: expected string, received undefined` |
| extra key on a strict object (`:34,70,76,87`) | `Unrecognized key: "model"` |
| top-level not an object (`:82-87`) | `Invalid input: expected object, received string` |
| `block` not `\d{1,9}-\d{1,9}` (`:48`) | `Invalid string: must match pattern /^\d{1,9}-\d{1,9}$/` |
| `action` not dotted (`:84`) | `Invalid string: must match pattern /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/` |
| `args` not an object (`:85`) | `Invalid input: expected record, received array` |
| `acceptance` item not a string (`:67`) | `Invalid input: expected string, received number` |
| `kind` not `daily`/`interval` (`routines/schedule.ts:56-59`, via `routine.schedule` args) | `Invalid discriminator value. Expected 'daily' | 'interval'` |

Effect's default text differs (e.g. "Missing key", "Expected string"). The
plan keeps the current text three ways: `{ message }` on the string checks
(trims/lengths/patterns), the sketch's `UnexpectedKey` branch (keyed off the
accumulated `Pointer` path, since `UnexpectedKey` carries no path of its own),
and the sketch's `MissingKey`/`InvalidType` branches (which rebuild zod's
`Invalid input: expected …, received …` from the issue AST tag plus the raw
value, with an `expectedLeaf` override for fields whose leaf type the AST
cannot name. The override applies only to a missing key: a missing `args`
reads `record` from `expectedLeaf`, while a present-but-wrong `args` (e.g.
`[]`) takes the `InvalidType` branch, which names `record` off the raw array.
T-B owns that override table. The task that owns
`agents/tools.ts` decides and records it.

Ordering note: when an input both misses a key and carries an extra key,
Effect reports the extra key first (`Unrecognized key: ...`) while zod
reports the missing key first (`Invalid input: expected ..., received
undefined`). No test pins this order; accept the change and name it.

### 3.3 Test-asserted texts that must stay byte-identical

These are the only schema-adjacent texts a test pins; most are literals in
the source, not zod messages, but a migration must not perturb them:

- `arguments are not valid JSON` — `agents/tools.test.ts:71,149` (literal in
  `agents/tools.ts:160`).
- `unknown tool: <safe name>` — `agents/tools.test.ts:156,302` (literal in
  `tools.ts:150`).
- `invalid: unknown tool` (model-facing) — `agents/reply.test.ts:1328`,
  `agents/gateway.test.ts:3756,3894,6355,6564`.
- `invalid_args` — see §0 (`policy.test.ts:88`, `gateway.test.ts:381`,
  `flow.e2e.test.ts:518`, `tools/adapters.test.ts:592,599,601`,
  `web-tools/adapters.test.ts:205,209,213,277,362,366,368,376,413,417,459`).
- Sandbox fixed texts, all literals in `sandbox/run-tool.ts` (`tool must
  return a string or { text, data }` at `:277,289,309,320`; asserted nowhere
  as a literal — `run-tool.test.ts:309,329` assert only
  `error.kind === 'invalid_output'`) and `sandbox/tool-worker.ts`
  (`fetch_denied: …` emitters at `:211,217`, prefix in `types.ts:80`;
  asserted in `run-tool.test.ts:218,265,515,524,528,532,662,682`), plus
  stack/import texts (`run-tool.test.ts:198,394,408`, matched by regex, not
  literals).
- `Revert to v1` / `Back to the good one` — version labels, not errors
  (`tools/service.test.ts:699,725`, `tools/routes.test.ts:591`).

No custom zod message from `tools/schemas.ts`, `routines/schedule.ts`,
`tools/adapters.ts` or `web-tools/adapters.ts` is asserted by any test.

## 4. Task split

Order: T1 first (the decode seam), then T2-T6 in any order, then T7 last.
Each task is independent except where stated; every task must pass `pnpm gate`
on its own.

### T-A — Registry + gateway decode seam (foundation)

- **Allowed:** `apps/server/src/actions/registry.ts`,
  `apps/server/src/actions/policy.ts`, `apps/server/src/actions/gateway.ts`.
- **What:** introduce `decodeActionArgs` and a transitional `ArgsSchema<Args>`
  union (`z.ZodType<Args> | Schema.Schema<Args, unknown, never>`) that branches
  on `typeof schema.safeParse === 'function'` (zod has it, Effect Schema does
  not); replace the four `.safeParse` calls, keep `invalid_args` identical.
- **Tests unchanged:** `actions/registry.test.ts` (`:18`), `actions/policy.test.ts`
  (`:14`), `actions/gateway.test.ts` (all `argsSchema: z.object` fake adapters),
  `actions/flow.e2e.test.ts` (`:61,77,597,762`), `approvals/rules.test.ts`
  (`:808,847`). No parse-call change.

### T-B — `agents/tools.ts`

- **Allowed:** `apps/server/src/agents/tools.ts`.
- **What:** the eight schemas (L29-87) and `firstIssue` (L240-242) to Effect
  Schema. Keep the §3.2 texts with `{ message }` so the model sees the same
  reason; replace `firstIssue` with `firstIssueMessage` (or reuse the helper
  from T-A). `.strict()` becomes `{ onExcessProperty: 'error' }`. Pass an
  `expectedLeaf` override so a missing or undefined `args` keeps the zod text
  `Invalid input: expected record, received undefined` (e.g. `expectedLeaf:
  (key) => key === 'args' ? 'record' : undefined`).
- **Tests unchanged:** `agents/tools.test.ts` (asserts `.ok`/hand-written
  reasons), `agents/reply.test.ts`, `agents/gateway.test.ts`. No parse-call
  change.

### T-C — `actions/demo.ts`

- **Allowed:** `apps/server/src/actions/demo.ts`,
  `apps/server/src/actions/demo.test.ts`.
- **What:** `DemoEchoArgsSchema` (L20-22) to `Schema.Struct` + `Schema.Trim`
  + length checks; keep the `as unknown as …` cast shape until T-G.
  T-C owns the `as unknown as z.ZodType<unknown>` cast at
  `actions/demo.ts:49` (flipped to the Effect type) and removes the
  `import { z }` (`demo.ts:1`).
- **Test parse-call change:** `actions/demo.test.ts:154-157`
  `DemoEchoArgsSchema.safeParse(x).success` →
  `Exit.isSuccess(Schema.decodeUnknownExit(DemoEchoArgsSchema)(x))`.

### T-D — `web-tools/adapters.ts`

- **Allowed:** `apps/server/src/web-tools/adapters.ts`,
  `apps/server/src/web-tools/adapters.test.ts`.
- **What:** the five arg schemas (L167-172, 223-231, 375-379, 464-469,
  532-536) to Effect Schema, keeping `lang must be 2-3 letters` (L228); the
  two Wikipedia response schemas (L237-256) to Effect Schema, still swallowed
  by `parseWikipediaSearch`/`parseWikipediaExtract`. T-D owns the
  `as unknown as z.ZodType<unknown>` casts at `:179,313,386,490,544`
  (flipped to the Effect type) and removes the `import { z }` (`:12`).
- **Test parse-call change:** `web-tools/adapters.test.ts:103-104`
  (`as z.ZodType<unknown>` + `.safeParse`) and its `import { z }` at `:16`.
  Everything else in the file stays.

### T-E — tool + routine arg schemas (the coupled group)

- **Allowed:** `apps/server/src/tools/schemas.ts`,
  `apps/server/src/routines/schedule.ts`,
  `apps/server/src/tools/adapters.ts`, `apps/server/src/tools/service.ts`.
- **Why four files:** `tools/adapters.ts` embeds the raw schema objects from
  `tools/schemas.ts` (`:306,311,315,322,339,353,355,356`) and
  `routines/schedule.ts` (`:30,355`), and `tools/service.ts:672` calls
  `toolHostsSchema.parse`. They cannot be converted independently; converting
  any one breaks the others at typecheck. `routines/service.ts` and
  `routines/scheduler.ts` need **no** change (they use only
  `parseRoutineSchedule`, `nextRunAfter` and the `RoutineSchedule` type).
- **What:** every schema in §1.3, §1.4 and §1.6 to Effect Schema with the §3.1
  messages; `parseToolVersionInput`/`parseRoutineSchedule` keep their
  `{ ok }` signatures. T-E must pin the union text with a test:
  `parseRoutineSchedule({ kind: 'weekly' })` returns
  `Invalid discriminator value. Expected 'daily' | 'interval'`.
  T-E also owns the `as unknown as z.ZodType<unknown>` casts in
  `tools/adapters.ts` (`:372,404,448,544,615,667,735,775,855,898`, flipped
  to the Effect type) and its zod import (`:15`), plus the
  `z.ZodType<unknown>` return type at `:246`, so typecheck never breaks
  mid-task.
- **Tests unchanged:** `tools/service.test.ts`, `tools/routes.test.ts`
  (`:160,742` codes), `routines/schedule.test.ts`, `routines/service.test.ts`,
  `routines/scheduler.test.ts`, `routines/scheduler.effect.test.ts`.
- **Test parse-call change:** `tools/adapters.test.ts` `import { z }` (`:6`)
  and the five sites `:245-246`, `:370-374`, `:524`, `:624-628`, `:762-763`
  (`as z.ZodType<unknown>` + `.safeParse`/`.parse`).

### T-F — `sandbox/types.ts` + `sandbox/run-tool.ts`

- **Allowed:** `apps/server/src/sandbox/types.ts`,
  `apps/server/src/sandbox/run-tool.ts`.
- **What:** `limitsSchema` (types.ts:41-51), `toolOutputSchema`
  (types.ts:110-113), `workerResultSchema`/`workerEventSchema`/
  `outputJsonSchema` (run-tool.ts:36-78) to Effect Schema. Keep the
  silent-ignore behaviour (`run-tool.ts:202-205`) and the fixed literal
  `tool must return a string or { text, data }`.
- **Tests unchanged:** `sandbox/run-tool.test.ts`, `run-tool.effect.test.ts`.
  No parse-call change.

### T-G — Tighten the registry to Effect only (last)

- **Allowed:** `apps/server/src/actions/registry.ts`,
  `apps/server/src/actions/policy.ts`, `apps/server/src/actions/gateway.ts`,
  and the fake-adapter test files `apps/server/src/actions/registry.test.ts`,
  `apps/server/src/actions/policy.test.ts`,
  `apps/server/src/actions/gateway.test.ts`,
  `apps/server/src/actions/flow.e2e.test.ts`,
  `apps/server/src/approvals/rules.test.ts`.
- **What:** `argsSchema: Schema.Schema<Args>`; delete the zod branch from
  `decodeActionArgs` and the `import type { z } from 'zod'`
  (`registry.ts:1`). Requires T-A through T-F merged. After T-G no
  adapter cast to `z.ZodType` is left: grep `as unknown as z.ZodType`
  over `apps/server/src/actions/demo.ts`,
  `apps/server/src/tools/adapters.ts` and
  `apps/server/src/web-tools/adapters.ts` prints nothing.
- **Test changes:** each fake adapter's `argsSchema: z.object({ value:
  z.string() })` becomes `Schema.Struct({ value: Schema.String })`
  (`registry.test.ts:18`, `policy.test.ts:9`, `gateway.test.ts:45,668,720,
  759,854,893,1377,1519,1599,1692,1764`, `flow.e2e.test.ts:61,77,597,762`,
  `rules.test.ts:808,847`), and `flow.e2e.test.ts`/others drop the zod import.
  These are constructor-only changes; the assertions stay.

## 5. The other zod importers

The spec's second list is stale: `ais/routes.ts` does not exist, and
`stickers/telegram-import.ts` and `topics/api.ts` import no zod. The full
non-test list from `grep -rln "from 'zod'" apps/server/src` (excluding the
nine tool-layer files in §1) is below. Batch numbers refer to
`docs/audit/effect-everywhere-plan.md:502-507`.

### 5.1 Hono route modules still on `routes.ts` — go with the module's HTTP task

| Module | What the zod does | Disposition |
| --- | --- | --- |
| `ai/routes.ts` | `IssueVirtualKeySchema` body `models` array (`:40-44`) | with the `ai` HTTP migration (not in the batch list) |
| `auth/routes.ts` | `updateMeSchema` name body (`:39`) | with the `auth` HTTP migration |
| `files/routes.ts` | body `chat`/`url` (`:36-37`) | batch 4 |
| `gifs/routes.ts` | query `q`/`pos` (`:43-50`) | batch 5 |
| `invite-links/routes.ts` | token regex + `label` (`:63-67`) | batch 3 |
| `machines/routes.ts` | `machineNameSchema`, `toolsValueSchema`, report body (`:58-74`) | batch 5 |
| `media/routes.ts` | query `chat`/`type`/`before`/`limit` (`:51-54`) | batch 4 |
| `setup/routes.ts` | `setupSchema` body (`:52`) | batch 6 |
| `stickers/routes.ts` | discover query + upload form + telegram-import body (`:127-134`); first-issue message is returned as 400 text at `:175,188,213,248,296,358,394,407` | batch 4 |

### 5.2 Modules already on HttpApi whose service still holds zod — own small task

These already have an `api.ts` (`grep` for `HttpApi` found
`approvals/`, `audit/`, `contact-requests/`, `handles/`, `pins/`, `roles/`,
`routines/`, `topics/`, `tools/`, `xmpp/`), but the service or api file keeps
zod request schemas. Move the schema into the `api.ts` Effect schema or delete
it once the route validates; each is its own 1-2 file task.

| Module | What the zod does |
| --- | --- |
| `approvals/service.ts` | stored-field/argsHash/cost schemas (`:31-44`) |
| `audit/service.ts` | `costCurrencySchema` (`:26`), `resultSchema` (`:30`), entry boundary `entrySchema` (`:36-40`, `safeParse` at `:107`) plus list `cursorSchema` (`:130`, `safeParse` at `:385`) |
| `auth/invite-cli.ts` | CLI options `inviteCliOptionsSchema` (`:8-10`, `.parse` at `:47` — a crash-on-bad-args CLI, not an HTTP route) |
| `pins/service.ts` | `pinKindSchema` enum + `createPinBodySchema` (`:24-25,64-87`) |
| `roles/service.ts` | `createRoleBodySchema`/`renameRoleBodySchema`/members (`:44-49`) |
| `routines/service.ts` | `titleSchema` (`:70`), consumed at `:101-106` |
| `stickers/service.ts` | `stickerVisibilitySchema` + pack bodies (`:27-28,120-140,524`) |
| `topics/service.ts` | create/patch/add-AI bodies (`:111-146,754`) |
| `contact-requests/api.ts` | legacy **zod kept on purpose** to reproduce `issues[0].message` (`:113-123`, comment `:113`) |
| `handles/api.ts` | legacy **zod kept on purpose** for the same reason (`:68-78`) |

`contact-requests/api.ts` and `handles/api.ts` need their own follow-up: their
zod exists only to preserve a byte-identical legacy 400 text, so they can only
drop it once that text may change.

### 5.3 Shared enums / event schemas — own small task

| Module | What the zod does |
| --- | --- |
| `db/schema.ts` | `groupKindSchema` (`:213`), `avatarOwnerKindSchema` (`:898`) drive drizzle column types |
| `topics/access.ts` | `topicVisibilitySchema`/`topicKindSchema`/`topicStatusSchema` (`:17-24`) |
| `avatars/service.ts` | `avatarOwnerKindSchema` (`:24`) |
| `ais/templates.ts` | `AiTemplateSchema` enum (`:7`) |
| `connections/providers.ts` | `ProviderIdSchema` enum (`:19`) |
| `drafts/events.ts` | `DraftEventSchema`/`DraftEndEventSchema` (`:14-25`) — draft SSE payloads |

### 5.4 Clients parsing external payloads — own task per client

| Module | What the zod does |
| --- | --- |
| `ai/litellm-client.ts` | LiteLLM request/response schemas (`:118-144`) |
| `agents/listener/score.ts` | listener score response (`:121-123`) |
| `gifs/giphy.ts` | Giphy media fields (`:34-39`) |
| `gifs/provider.ts` | `gifItemSchema` + provider payload (`:7-12`) |
| `git/token.ts` | GitHub installation-token response (`:31-33`) |
| `push/config.ts` | env schema (`:8-17`) |
| `push/subscriptions.ts` | `WebPushKeysSchema`/`WebPushSubscriptionSchema` (`:5-12`) |
| `voice-transcription/provider.ts` | transcription response (`:19-22`) |
| `web-tools/prices.ts` | CoinGecko/Stooq response schemas (`:57-65`) |
| `xmpp/admin-client.ts` | password/JID/roster schemas (`:15-39`), first-issue message returned at `:176` |

Each client is independent of the registry and of each other; each is a
1-file conversion once its caller is on Effect Schema. They do not belong to
the tool-args tasks above.
