---
id: T-2092
title: "AI tools: derive each tool's JSON parameters from its Effect Schema (Schema.toJsonSchemaDocument) instead of writing them twice — a test proves the model receives exactly today's JSON"
status: merged
milestone: M5
branch: task/T-2092-tool-json-from-schemas
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2092: Tool JSON from the Effect schemas

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total line count must really go down, with no feature lost. Every AI tool's arguments are written twice:
- once as an Effect Schema that checks the model's call;
- once as a hand-written JSON Schema that is sent to the model.

This is the message pipeline, so the JSON the model receives must not change. A test proves that.

### Facts (read by the lead on 2026-10-18 at `77c826ad8`)
- **The Effect schemas.** `apps/server/src/agents/tools/schemas.ts` (281 lines) defines 19 argument schemas with `struct` from `@zilar/protocol`: `UpdatePersonaArgsSchema` (`:79`), `RevertPersonaArgsSchema` (`:84`), `RecallArgsSchema` (`:92`), `MemoryZoomArgsSchema`, `RememberArgsSchema`, `DelegateArgsSchema`, `TaskStatusArgsSchema`, `BashArgsSchema` … `GitArgsSchema`, `RequestActionArgsSchema`, `AskPeopleArgsSchema`, `PostBlocksArgsSchema`, `FetchMediaArgsSchema` and `SaveTextMediaArgsSchema` (`:228`).
- **The hand-written JSON.** 21 `parameters:` objects are spread over four files:
  - `apps/server/src/agents/tools/definitions.ts` (321 lines; for example `UPDATE_PERSONA_TOOL` at `:60-80`);
  - `apps/server/src/agents/tools/desk-definitions.ts` (160);
  - `apps/server/src/agents/tools/media-tool.ts` (71);
  - `apps/server/src/agents/tools/blocks-tool.ts` (42).

  `withTaskTitle` (`definitions.ts:~35-55`) adds the `task_title` property afterwards.
- **The Effect API.** Effect 4.0.4 exports `Schema.toJsonSchemaDocument(schema, options?)`, returning a draft-2020-12 document (`node_modules/effect/dist/Schema.d.ts:11735`). `apps/server/src/ai/model-prompt.ts:119` passes `parameters` to the model.
- **The existing test.** `apps/server/src/agents/tools/desk-definitions.test.ts`.

### Steps
1. **Pin today's JSON first.** Create `apps/server/src/agents/tools/tool-params.test.ts`, which imports today's full tool lists (the exported arrays in `definitions.ts` and the desk, media and blocks definitions) and snapshots each tool's `function.parameters`. Use an inline literal or `toMatchInlineSnapshot`, so the expected JSON lives in the test. Commit it while it passes on the old code.
2. **Derive.** Create `apps/server/src/agents/tools/tool-params.ts` with `toolParameters(schema)`.
   - It calls `Schema.toJsonSchemaDocument`, drops `$schema`, and inlines `$defs` if there are any, returning the plain object the model gets today.
   - Where today's JSON has something the Effect schema lacks (`minLength`, `maxLength`, `pattern`, `enum`, a property `description`), add it to the Effect schema as a check or annotation, so the checks and the JSON say the same thing.
3. **Replace.** Swap every hand-written `parameters` object for `toolParameters(XArgsSchema)`.
   - The step-1 test must still pass **unchanged**. If one tool cannot match exactly, keep that one hand-written and name it in the Report.
   - Keep `withTaskTitle`.
4. **Size.** Product lines must go down by at least 150; test lines don't count. Report the counts.

### Allowed files
- `apps/server/src/agents/tools/schemas.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/tools/desk-definitions.ts`
- `apps/server/src/agents/tools/media-tool.ts`
- `apps/server/src/agents/tools/blocks-tool.ts`
- `apps/server/src/agents/tools/tool-params.ts`
- `apps/server/src/agents/tools/tool-params.test.ts`
- `apps/server/src/agents/tools/desk-definitions.test.ts`
- `work/T-2092-tool-json-from-schemas.md`

### Checks
```bash
cd apps/server && pnpm exec vitest run src/agents/tools/tool-params.test.ts src/agents/tools/desk-definitions.test.ts src/agents/tools/parse.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The step-1 test passes on both the old and the new code, with its expected values unchanged.
- The gate passes.
- Product lines are at least 150 lower.

---

## Report (written by the worker when done)

### What I did

- **Pinned the JSON first.** Added `apps/server/src/agents/tools/tool-params.test.ts`, which builds all 19 tool definitions (persona, memory, request_action, delegate, task_status, ask_people, blocks, media, and the seven desk tools) and compares each `function.parameters` to an inline literal. It passed on the old code and was committed alone as `47cb6b2ab`. After that commit, Prettier reformatted the file (the gate requires it): quotes, commas and indentation changed, **no expected value changed**.
- **Added `toolParameters(schema)` in `tool-params.ts`.** It derives the JSON with `SchemaRepresentation.toJsonSchemaDocument(SchemaRepresentation.toRepresentation(SchemaAST.toType(schema.ast)), …)`, i.e. from the schema's *type* side, so checks that live below a trim conversion are emitted. It sets `onExcessProperty: 'error'` for `additionalProperties: false`, inlines `$defs` refs and drops `$schema`, strips the `null` branch of optional fields, and drops the `Number.MAX_SAFE_INTEGER` ceiling Effect adds to integers (today's JSON has no such maximum). It also passes `includeAnnotationKey` for `additionalProperties` because Effect omits that keyword when it is the JSON Schema default.
- **Made the schemas say the same thing as the JSON.**
  - Replaced `Schema.Trim` with a small `TrimmedString` (`trim` then check) so the length/pattern checks reach the JSON while padded input is still trimmed before validation.
  - Added the property descriptions from `media-tool.ts` and `blocks-tool.ts` as schema annotations.
  - `post_blocks.icon` is now `Schema.Literals([...BlockIconSchema.literals])` instead of a 40-character string (the JSON already advertised the enum).
  - `post_blocks.blocks` items are now `Schema.Record(Schema.String, Schema.Unknown)` so the JSON says `items: { type: 'object' }` as it did, and runtime rejects non-object blocks.
  - `request_action.args` carries an `additionalProperties: true` annotation so the derived JSON keeps that explicit keyword.
  - `memory_zoom.block` uses the `u` regex flag; Effect only exports `pattern` for Unicode regexes. `request_action.action` keeps its non-Unicode pattern, which today's JSON does not advertise.
- **Replaced the hand-written parameters.** 18 of 19 tools now call `toolParameters(XArgsSchema)`. `revert_persona` stays hand-written: Effect lowers an empty struct to `{ "not": { "type": "null" } }`, which cannot be turned into today's `{ type: 'object', properties: {}, additionalProperties: false }` without editing the derived JSON. `withTaskTitle` is unchanged.
- Added a small `toolDefinition(name, description, parameters)` helper and used it in all four definition files; it builds exactly the same object as before and keeps the count moving down.

**Line counts (product files, tests and the task file excluded):**

| File | Before | After |
| --- | ---: | ---: |
| `schemas.ts` | 281 | 314 |
| `definitions.ts` | 321 | 224 |
| `desk-definitions.ts` | 160 | 72 |
| `media-tool.ts` | 71 | 25 |
| `blocks-tool.ts` | 42 | 15 |
| `tool-params.ts` | 0 | 50 |
| **Total** | **875** | **700** |

Product lines are **175 lower** (target: at least 150).

### Checks run

- `pnpm install --frozen-lockfile`: done in 27.3s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/tools/tool-params.test.ts src/agents/tools/desk-definitions.test.ts src/agents/tools/parse.test.ts`: **3 files passed, 24 tests passed**.
- `pnpm gate` (from the repo root):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (3.2s)
  PASS  format  (2.5s)
  PASS  lint  (2.8s)
  PASS  typecheck  (8.9s)
  PASS  effect  (1.6s)
  PASS  build @zilar/server  (0.9s)
  PASS  tests @zilar/server  (4.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: no changed source file is over 800 lines
  FAIL  comments: 667 added comment line(s) cite a task ID (docs/COMMENTS.md)
  GATE FAIL
  ```

**The gate is red only on `comments`, and that failure is not in this task's files.** The worktree is based on a commit that is 3 commits behind `main` (`main` already contains the T-2077–T-2080 comment-removal commits, which this branch does not have). The comments check runs `git diff -U0 main -- apps packages` (two-dot), so those main-side removals appear in the local diff as 667 "added" comment lines across mobile and web files. I verified that no line added inside this task's paths cites a task ID:

```
git diff -U0 main -- apps/server/src/agents/tools | grep -E "^\+.*\bT-[0-9]{3,4}\b"  → no output
```

I tried to rebase onto `main`, but branch-changing commands are blocked in this session. Re-running the same gate after the branch is rebased (or on the lead's merge commit) should clear the `comments` line; every other step is green and the scope line is clean.

### Notes for the lead

- **Only `revert_persona` is still hand-written**, as allowed by the spec.
- Runtime tightening follows the JSON: `post_blocks.icon` now rejects names outside the lucide enum, and `post_blocks.blocks` rejects non-object items. The protocol's block code already required objects and the enum, so this moves the failure earlier, to the tool-call parse.
- To derive from the type side I used the documented `SchemaRepresentation` + `SchemaAST.toType` path. `Schema.toJsonSchemaDocument` alone lowers the encoded side and silently drops checks that sit under `Schema.Trim`.
- The `maximum: 9007199254740991` removal is deliberate: Effect emits the JavaScript safe-integer ceiling for every integer, today's JSON does not, and the model cannot act on it. It is a normalisation in `toolParameters`, not a schema change.
- No security-relevant code was touched: no routes, queries, logs, secrets or audit detail.

### Blocked / needs a decision

None for the implementation. The only open item is the stale base described above: please rebase the branch on current `main` (or merge it) and rerun `pnpm gate`; the comments failure is main-side drift, not this diff.

## Review (written by Claude)

Approved.
- **What changed.** Every tool except `revert_persona` derives its model JSON from its Effect schema (`toolParameters`). Product lines −175; the pinned-JSON test is 434 lines.
- **Lead check of the acceptance rule.** The test file was restructured after the pin commit `47cb6b2ab`, so the lead ran the ORIGINAL pinned test from `47cb6b2ab` against the new code: **20/20 pass**. The JSON the model receives is unchanged. `tool-params`, `desk-definitions` and `parse` tests: 24/24.
- **Behaviour.** `post_blocks` now rejects unknown icon names and non-object blocks at the tool-call parse instead of later in the protocol's block code. The outcome is the same, only earlier.
