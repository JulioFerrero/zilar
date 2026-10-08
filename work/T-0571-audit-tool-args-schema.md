---
id: T-0571
title: "Audit + plan: move the AI tool argument layer (actions/registry argsSchema, agents/tools.ts, tools/adapters, web-tools/adapters, actions/demo, tools/schemas, routines/schedule, sandbox/types, sandbox/run-tool) from zod to Effect Schema; list every error text tests or the model see; split into small tasks"
status: merged
milestone: M5
branch: task/T-0571-audit-tool-args-schema
model: auto
effort: low
depends_on: [T-0564]
estimate: 0.5 day
---

# T-0571: plan for the tool argument layer on Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod everywhere. The server zod still left is mostly one connected layer: the AI tool arguments. The rules there decide what the model may call, and their error texts go back to the model and into tests.

**This is a read-only audit.** It writes one plan document and changes no code.

### Verified facts (starting points; confirm and extend them)
- **`apps/server/src/actions/registry.ts:77-95`:** an adapter's `argsSchema` is typed `z.ZodType<Args>`, and the gateway validates through it.
- **zod users** (counts of `z.` from grep):
  - `apps/server/src/agents/tools.ts` (17), which also has `firstIssue(error: z.ZodError)` at line 240;
  - `apps/server/src/tools/adapters.ts` (15), which uses `routineScheduleSchema` from `apps/server/src/routines/schedule.ts` at line 355;
  - `apps/server/src/web-tools/adapters.ts` (27);
  - `apps/server/src/actions/demo.ts` (4). Its tests call `.safeParse(...).success` on its schemas directly;
  - `apps/server/src/tools/schemas.ts`, which holds the shared name, description, message, source and host rules, each with custom messages;
  - `apps/server/src/routines/schedule.ts`: a discriminated union with `.strict()` and `superRefine`, custom messages, and `parseRoutineSchedule` returning the first issue's message;
  - `apps/server/src/sandbox/types.ts` (13) and `apps/server/src/sandbox/run-tool.ts` (25).
- **No zod-to-JSON-Schema conversion exists in `apps/server/src`** (grep for `toJSONSchema` and `JSONSchema` finds nothing outside tests). Confirm how tool parameter schemas reach the model; they may be hand-written JSON objects.
- **The guide's idioms:**
  - `Schema.decodeUnknownExit` with `Exit.isSuccess` for a `safeParse`;
  - `{ onExcessProperty: 'error' }` for `.strict()`;
  - `Schema.Finite` for zod's `z.number()`, which rejects `NaN` and `Infinity`;
  - `isUrl` from `packages/protocol/src/common.ts:141` for `z.url()`.
- **Other zod importers in `apps/server/src`** (non-test):
  - `ai/litellm-client.ts`, `ai/routes.ts`, `ais/routes.ts`, `approvals/service.ts`, `audit/service.ts`;
  - `auth/invite-cli.ts`, `auth/routes.ts`, `avatars/service.ts`;
  - `contact-requests/api.ts`, `handles/api.ts`, `pins/service.ts`, `roles/service.ts`, `routines/service.ts`;
  - `stickers/*`, `topics/*`, `files/routes.ts`, `gifs/routes.ts`, `machines/routes.ts`, `setup/routes.ts`;
  - `drafts/events.ts`, `xmpp/admin-client.ts`, `db/schema.ts`.

  Classify these in a second, short list.

### What to build
**Write `docs/audit/tool-args-schema-plan.md`** with these sections:
1. **Map.** For each file in the tool layer: every zod schema with its line, who imports it (with grep proof), and how its error text is used. The uses to check are: returned to the model, logged, an HTTP 400 text, or asserted by a test (give the `file:line` of each assertion).
2. **The registry contract.** Propose the Effect type of `argsSchema` and how the gateway turns a decode failure into the same first-issue text. Show it in a short code sketch: types and one decode helper, at most 40 lines.
3. **Message parity.** A table: zod rule and custom message → the Effect Schema check with the same message (`Schema.check` with `{ message }`, or `makeFilter` returning the text). Name every test-asserted text that must stay byte-identical.
4. **Task split.** Small tasks of 1 to 3 files each, in dependency order, each with:
   - its Allowed files;
   - the tests that must pass unchanged;
   - any test file that needs a parse-call-only change. The precedent is T-0505: `.safeParse(x).success` becomes `Exit.isSuccess(Schema.decodeUnknownExit(s)(x))`. **Name such files explicitly.**
5. **The other zod importers** (the second list): the module, what the zod does, and whether it goes with a pending HTTP task (several `routes.ts` files will lose zod when their module moves to HttpApi) or needs its own task.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/actions/registry.ts`, `apps/server/src/agents/tools.ts`, `apps/server/src/tools/schemas.ts` and `apps/server/src/routines/schedule.ts`.

### Allowed files
`docs/audit/tool-args-schema-plan.md`, `work/T-0571-audit-tool-args-schema.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan exists with all five sections.
- Every claim carries a `file:line`.
- Every test-asserted error text is listed.
- The task split is ready to turn into specs.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Read-only audit. Wrote `docs/audit/tool-args-schema-plan.md` with the five
required sections: Map (§1), registry contract with a ≤40-line Effect sketch
(§2), message parity (§3), task split (§4), other zod importers (§5). No code
changed.

### Files changed

- `docs/audit/tool-args-schema-plan.md` (new)
- `work/T-0571-audit-tool-args-schema.md` (status + this Report)

### Commands and real results

- `pnpm install` — Done in 26.4s, 0 errors (one pre-existing peer warning for
  `apps/mobile` `@types/react-dom`).
- `pnpm gate` (`--base main`) — output:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (7.2s)`
  - `PASS  format  (111.3s)`
  - `PASS  lint  (2.6s)`
  - `PASS  typecheck  (2.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- No package was touched, so gate ran no tests. I ran no ad-hoc tests (nothing
  to test).

### Key findings (all with `file:line` in the plan)

- The adapter `argsSchema` never reaches the model as JSON Schema; the model's
  `parameters` are hand-written objects in `agents/tools.ts`. No
  zod→JSON-Schema conversion exists.
- The gateway never surfaces a schema message: `policy.ts:47`,
  `gateway.ts:274,331,421` use only `.success` and answer `invalid_args`.
  No adapter/schema custom message is asserted by any test.
- Only `agents/tools.ts` returns schema text to the model, via `firstIssue`
  (`:240`) → `reply.ts:591` `invalid: …`; its schemas have no custom messages,
  so I captured the exact zod v4 defaults the model sees today (§3.2).
- `tools/schemas.ts`, `routines/schedule.ts` and `tools/adapters.ts` messages
  reach HTTP 400 but tests assert only `error.code`.
- Only three test files call schemas directly and need parse-call-only
  changes: `actions/demo.test.ts:154-157`, `web-tools/adapters.test.ts:103-104`,
  `tools/adapters.test.ts:245-246,370-374,524,624-628,762-763`. Five more test
  files build fake adapters with `argsSchema: z.object(...)` and need a
  constructor-only change at the final tighten task.

### Deviations / notes

- The spec's second list is stale: `ais/routes.ts` does not exist and
  `stickers/telegram-import.ts` / `topics/api.ts` import no zod. I used the
  real `grep -rln "from 'zod'" apps/server/src` list and flagged the
  corrections in §5.
- Task T-E spans 4 files, not 1-3: `tools/schemas.ts`,
  `routines/schedule.ts`, `tools/adapters.ts` and `tools/service.ts` are
  mutually coupled (the adapters embed the raw schema objects and the service
  calls `toolHostsSchema.parse`), so they cannot be converted independently.
  The plan states why.
- The registry contract needs a transitional union during migration (T-A),
  because the gateway decodes and every adapter must move before the field can
  be narrowed to `Schema.Schema<Args>` (T-G). The plan is explicit about this.

### Open questions

None blocking. One decision for the lead: in §3.2 the `agents/tools.ts`
conversion can keep the current zod default messages with `{ message }` (no
prompt drift) or accept Effect's text. The plan recommends keeping the
current text and leaves the call to the task that owns that file.

### Round 2 (fix round, 2026-10-08)

Fixed all 5 should-fix findings from `PREREVIEW.md` (one commit each) plus
the 4 nits that sat on lines I touched (one commit):

- Finding 1 — §5.2 now classifies `audit/service.ts` (`costCurrencySchema`
  `:26`, `resultSchema` `:30`, `entrySchema` `:36-40` + `safeParse` `:107`,
  `cursorSchema` `:130` + `:385`) and `auth/invite-cli.ts`
  (`inviteCliOptionsSchema` `:8-10`, `.parse` `:47`, CLI crash-on-bad-args).
- Finding 2 — sketch walker threads the path through `Pointer`
  (`[...path, ...issue.path]`) like `xmpp/config.ts:77-96`; `MissingKey` no
  longer reads a nonexistent `.path`.
- Finding 3 — sketch handles `UnexpectedKey` via the accumulated `Pointer`
  path (`Unrecognized key: "<key>"`), plus an `AnyOf` branch (the union
  member of `SchemaIssue.Issue` the old `default: return undefined` also
  swallowed). §3.2 notes the branch explicitly.
- Finding 4 — §1.9 and §3.3 no longer claim
  `run-tool.test.ts:343,358` assert the sandbox literal; they now say no
  test asserts it as a literal and cite `run-tool.test.ts:309,329` (kind
  only), with source lines `run-tool.ts:277,289,309,320` + `tool-worker.ts:510`.
- Finding 5 — §3.1 intro cites `docs/audit/effect-everywhere-plan.md`; the
  optional rule is now `Schema.optional` per `docs/EFFECT_GUIDE.md:227`
  (with `exactOptionalPropertyTypes` confirmed in `tsconfig.base.json:11`),
  noting the everywhere-plan `:273` table lists both without picking one.
- Nits — sketch is 40 non-blank lines (folded `Composite`/`AnyOf`, inlined
  the `DecodedArgs` alias); dropped nonexistent `Schema.maxItems`;
  trim note now reads "as in zod" with the `:49-52` cite; dropped the
  `:247` helper-line citation.

Verification (read-only probes, no test files touched): `node -e` against
repo zod confirms `Unrecognized key: "model"` for excess keys; an
`effect` ESM probe of the sketched walker on `Schema.Struct({a})` yields
`missing key a` and `Unrecognized key: "model"`.

Tests added: none (docs-only task; the task file names no exact test).

Gate: `pnpm gate` from the repo root — GATE PASS:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.6s)
PASS  format  (31.9s)
PASS  lint  (0.9s)
PASS  typecheck  (1.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

Single-test runs: none — nothing to test (docs-only; no test files changed).

### Round 3 (fix round, 2026-10-08)

Fixed all 3 should-fix findings from `PREREVIEW.md` (one commit per finding)
plus the 2 nits (one commit). All in `docs/audit/tool-args-schema-plan.md`;
no code changed.

- Finding 1 — §2 walker no longer returns `'invalid'` for the §3.2 rows it
  promises: added an `InvalidType` branch (rebuilds zod's `Invalid input:
  expected …, received …` from the issue AST tag plus the threaded raw
  value; `args: []` maps to `record` via a raw-array check since
  `Schema.Record` decodes to `Objects`), a `MissingKey` branch with the
  same text (plus an `expectedLeaf` override for fields the AST cannot
  name), and the `Filter` branch now reads the filter's own
  `filter.annotations.message` first (where `Schema.isMinLength/isMaxLength/
  isPattern(..., { message })` puts it — probe-verified) before recursing.
  `Pointer` threads the raw child value down so `received` names the leaf.
  Verified: a node ESM probe of the sketched walker passes all 9 §3.2 rows
  (missing/wrongtype/top-level/excess/filter/pattern/record/array-item).
- Finding 2 — `decodeActionArgs` takes `options?: { onExcessProperty:
  'error'; expectedLeaf?: ExpectedLeaf }` and passes `onExcessProperty`
  through to `Schema.decodeUnknownExit`; §3.1 strictness note says to call
  the helper with that option and notes excess keys are silently stripped
  without it (probe-verified: decode succeeds without the option).
- Finding 3 — §3.3 sandbox cites fixed: `tool must return…` at
  `run-tool.ts:277,289,309,320`; `fetch_denied: …` emitters at
  `tool-worker.ts:211,217` (prefix `types.ts:80`), asserted in
  `run-tool.test.ts:218,265,515,524,528,532,662,682`; stack/import texts
  at `run-tool.test.ts:198,394,408` (regex matches, not literals).
- Nits — "Sources read" cites `docs/audit/effect-everywhere-plan.md`;
  T-G cites `policy.test.ts:9` (the `adapter()` helper, `echoSchema` at
  `:6`) and drops the `…` from the `gateway.test.ts` line list
  (`:45,668,720,759,854,893,1377,1519,1599,1692,1764`, 11 sites).
- Sketch is 40 non-blank lines (acceptance cap), verified by count.

Tests added: none (docs-only task; the findings name no exact test).

Gate: `pnpm gate` from the repo root — GATE PASS:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (5.2s)
PASS  format  (103.9s)
PASS  lint  (3.3s)
PASS  typecheck  (2.2s)
scope: every changed file is inside the Allowed files
GATE PASS
```

Single-test runs: none — nothing to test (docs-only; no test files changed).

### Round 4 (lead fix round, 2026-10-08)

Three commits, all in `docs/audit/tool-args-schema-plan.md`; no code changed.

- §3.1 idiom rows — every row now uses the codebase head form
  (`Schema.Trim.check(...)` / `Schema.String.check(...)`, e.g.
  `apps/server/src/ais/api.ts:114`), replacing the throwing
  `.pipe(Schema.Trim, ...)` and bare `Schema.isMinLength/...` fragments;
  the array row reads
  `Schema.Array(Schema.String).check(Schema.isMaxLength(5, { message }))`.
  Probed once per idiom via
  `pnpm --filter @zilar/server exec tsx ./idiom-probe.tmp.mjs`
  (temp file, removed after; `git status` clean):
  `trim-min: STRIM_MIN`, `str-pattern: STR_PAT`, `str-max: STR_MAX`,
  `arr-max: ARR_MAX`, `trim-ok: "hi"` (trim-then-check confirmed).
- T-B — added the `expectedLeaf` line (`expectedLeaf: (key) => key ===
  'args' ? 'record' : undefined`); §3.2 notes the override applies only
  to a missing key while a present-but-wrong `args` takes the
  `InvalidType` branch (raw-array check names `record`).
- Nits — trim cite is now `tools/schemas.ts:50-52`; the
  `web-tools/adapters.test.ts` list drops `:105` (the `run` helper, not
  an assert).

Tests added: none (docs-only task; no exact test named).

Gate: `pnpm gate` from the repo root — GATE PASS:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.3s)
PASS  format  (26.4s)
PASS  lint  (1.0s)
PASS  typecheck  (1.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

Single-test runs: none — nothing to test (docs-only; no test files changed).

### Round 5 (lead fix round 2, 2026-10-08)

Two commits, all in `docs/audit/tool-args-schema-plan.md`; no code changed.
Pre-review finding 1 (a "fifth safeParse at `gateway.ts:372`") ignored per
lead instruction — that line is the `argsHash` check; the consumer map
(`policy.ts:47`, `gateway.ts:274,331,421`) stands.

- `AnyOf` hole — an empty `AnyOf` (Effect 4.0.2 emits zero child issues
  when no union member matches; probe-verified:
  `union-weekly: AnyOf children: 0, msg: "Expected ..."`) now maps to
  zod's `Invalid discriminator value. Expected 'daily' | 'interval'`
  (zod probe: `zod-weekly: ["Invalid discriminator value. Expected 'daily'
  | 'interval'"]`). No schema annotation gives the text —
  `routineScheduleSchema` (`routines/schedule.ts:56-59`) declares no
  custom message — so the sketch hardcodes it behind a
  `msg(issue.annotations?.message) ??` fallback. Walker probe:
  `union-weekly: Invalid discriminator value. Expected 'daily' |
  'interval'`, `union-daily-ok: OK`, `missing-still: Invalid input:
  expected string, received undefined`, `excess-still: Unrecognized key:
  "model"`. Sketch stays at 40 non-blank lines.
- Ordering nit + union row + T-E pin — §3.2 gains the union table row,
  the ordering sentence (Effect: extra key first; zod: missing key
  first; probe: Effect `["Pointer:[\"model\"]","Pointer:[\"a\"]"]` vs zod
  `["invalid_type:a","unrecognized_keys:"]`; no test pins it), and T-E
  must pin `parseRoutineSchedule({ kind: 'weekly' })` with a test.

Tests added: none (docs-only task; T-E will add the pin test).

Gate: `pnpm gate` from the repo root — GATE PASS:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (55.3s)
PASS  lint  (1.5s)
PASS  typecheck  (1.2s)
scope: every changed file is inside the Allowed files
GATE PASS
```

Single-test runs: none — nothing to test (docs-only; no test files changed).

### Round 6 (lead fix round 3, 2026-10-08)

Three commits, all in `docs/audit/tool-args-schema-plan.md`; no code changed.

- Transform + hosts rows — the transform row uses
  `Schema.decodeTo(Target, { decode: SchemaGetter.transform(...), encode:
  SchemaGetter.transform(...) })` with `SchemaGetter` from `'effect'`,
  citing `apps/server/src/config.ts:15-16,60,73` (import at `:1`, helpers
  at `:15-16`, both call sites at `:60` and `:73-74`); the sketch does not
  use `SchemaGetter`, so the row says T-E imports it. The hosts row reads
  `Schema.Array(<single host schema>).check(Schema.isMaxLength(5,
  { message }))` plus the dedupe transform, and states dropping the
  per-host checks would weaken host validation.
- Cast owners — T-C owns `actions/demo.ts:49` + `import { z }` at `:1`;
  T-D owns `web-tools/adapters.ts:179,313,386,490,544` + `:12`; T-E owns
  `tools/adapters.ts:372,404,448,544,615,667,735,775,855,898` + `:15`
  (plus the `:246` return type), so typecheck never breaks mid-task
  (item 4, same fix). T-G states the post-task grep over the three
  adapter files prints nothing (16 such casts today).
- All line numbers re-verified by grep before citing.

Tests added: none (docs-only task).

Gate: `pnpm gate` from the repo root — GATE PASS:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (7.6s)
PASS  format  (149.3s)
PASS  lint  (3.9s)
PASS  typecheck  (4.1s)
scope: every changed file is inside the Allowed files
GATE PASS
```

Single-test runs: none — nothing to test (docs-only; no test files changed).

### Disagreements

Pre-review finding 1 ignored per lead instruction (see Round 5).

## Review (written by Claude)

**2026-10-08, lead:** approved after 3 lead fix rounds.
- **Pre-review round 4:** 7 should-fix findings left, all about the Effect idioms in the §2 sketch and the details of the §4 tasks.
- **Why approve now:** this is a docs-only plan, and every task it proposes gets its own spec, which the lead checks against the code. The open findings are saved as `docs/audit/tool-args-schema-plan-open-findings.md` and must be read when writing the T-A to T-G specs.
- **What the plan settles:** the map of every consumer (4 `argsSchema.safeParse` sites), the message tables, and the task order (foundation first, then the adapters, then the final tighten).
