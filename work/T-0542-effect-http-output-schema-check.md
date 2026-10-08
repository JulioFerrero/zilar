---
id: T-0542
title: "Effect C (HTTP) check: every HttpApi success schema in the merged api.ts modules lists every field the service returns (no silently stripped fields); fix any gap and pin it with a test"
status: todo
milestone: M5
branch: task/T-0542-effect-http-output-schema-check
model: auto
effort: low
depends_on: [T-0536]
estimate: 0.5 day
---

# T-0542: no stripped fields in HttpApi responses

## Spec (written by Claude, do not edit)

### Why
In Effect `HttpApi`, an endpoint's **success schema encodes the response**, and a `Schema.Struct` drops keys it does not list. If an `api.ts` schema omits a field that the service returns, web and mobile silently lose that field. TypeScript does not catch it, because extra properties are allowed when an object is assigned to the narrower type.

The lead checked `groups/api.ts` (T-0536) by hand and found it complete. The modules that merged earlier were never checked this way. See `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP", item 8.

### Verified facts (do not re-derive)
- **The Effect HTTP modules in main:**
  - `apps/server/src/handles/api.ts`, `apps/server/src/contact-requests/api.ts`;
  - `apps/server/src/blocks/api.ts`, `apps/server/src/contacts/api.ts`, `apps/server/src/directory/api.ts`;
  - `apps/server/src/chat-prefs/api.ts`, `apps/server/src/chat-folders/api.ts`;
  - `apps/server/src/pins/api.ts`, `apps/server/src/roles/api.ts`, `apps/server/src/audit/api.ts`;
  - `apps/server/src/groups/api.ts`.
  
  More are merging tonight (xmpp, chats, AI memory). Check those too if they are in main when you start: `find apps/server/src -name api.ts`.
- **The clients read these responses:** web through `apps/web/src/lib/api.ts`, and mobile through `apps/mobile/src/lib/*-api.ts`.

### What to build
1. **For every endpoint in every `api.ts`,** compare the success schema with the TypeScript type of the value the handler returns: the service function's return type, the view mapper and so on. Write a table in the Report with one row per endpoint: module, method and path, and either "complete" or "missing: <fields>". Optional fields count: an `x?: T` the service may return must be `Schema.optional(...)` in the schema.
2. **For each gap,** add the missing fields to the schema. For each module with a gap, add **one** test to that module's existing test file that asserts the missing field reaches the HTTP response. **No other test changes.**
3. If a field is missing on purpose (an internal value the old Hono route did not send either; check `git log -p` for the old `routes.ts`), leave it out and say so in the Report.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/groups/api.ts` (a checked example), then each `api.ts` and the service functions it calls.

### Allowed files
- every `api.ts` listed above: `apps/server/src/handles/api.ts`, `apps/server/src/contact-requests/api.ts`, `apps/server/src/blocks/api.ts`, `apps/server/src/contacts/api.ts`, `apps/server/src/directory/api.ts`, `apps/server/src/chat-prefs/api.ts`, `apps/server/src/chat-folders/api.ts`, `apps/server/src/pins/api.ts`, `apps/server/src/roles/api.ts`, `apps/server/src/audit/api.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/xmpp/api.ts`, `apps/server/src/chats/api.ts` and `apps/server/src/agents/memory/api.ts`;
- their test files, **only to add the one test per module with a gap**: `apps/server/src/handles/handles.test.ts`, `apps/server/src/contact-requests/contact-requests.test.ts`, `apps/server/src/blocks/blocks.test.ts`, `apps/server/src/contacts/contacts.test.ts`, `apps/server/src/groups/visibility.test.ts`, `apps/server/src/chat-prefs/chat-prefs.test.ts`, `apps/server/src/chat-folders/chat-folders.test.ts`, `apps/server/src/pins/pins.test.ts`, `apps/server/src/roles/roles.test.ts`, `apps/server/src/audit/routes.test.ts`, `apps/server/src/groups/groups.test.ts`, `apps/server/src/xmpp/routes.test.ts`, `apps/server/src/chats/chats.test.ts` and `apps/server/src/agents/memory/routes.test.ts`;
- `work/T-0542-effect-http-output-schema-check.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot handles contact-requests blocks contacts groups chat-prefs chat-folders pins roles audit xmpp chats agents/memory authz-sweep
pnpm gate
```

### Acceptance
- The Report has the per-endpoint table.
- Every gap is fixed and pinned by a test, or explained as intentional.
- Every other test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
