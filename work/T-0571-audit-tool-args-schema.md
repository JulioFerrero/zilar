---
id: T-0571
title: "Audit + plan: move the AI tool argument layer (actions/registry argsSchema, agents/tools.ts, tools/adapters, web-tools/adapters, actions/demo, tools/schemas, routines/schedule, sandbox/types, sandbox/run-tool) from zod to Effect Schema; list every error text tests or the model see; split into small tasks"
status: todo
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

## Review (written by Claude)
