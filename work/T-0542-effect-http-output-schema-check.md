---
id: T-0542
title: "Effect C (HTTP) check: every HttpApi success schema in the merged api.ts modules lists every field the service returns (no silently stripped fields); fix any gap and pin it with a test"
status: merged
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

### Summary

I checked every `api.ts` module present in this branch: 11 modules, 42 endpoints. For each endpoint I compared the success schema against the TypeScript type of the value the handler returns (the service function's return type / the view mapper). **Every schema already lists every field, including the optional ones. No field is silently stripped, so no schema changed and no test was added.** The checked `groups/api.ts` (T-0536) is complete, as the task said.

Two families of endpoints do not apply a response encoder at all, but their schemas still match the payload:
- handlers returning `HttpServerResponse.jsonUnsafe(...)` (`audit`, `groups` create, `pins` create, `roles` create, `chat-folders` create, `contact-requests` create), and
- `roles` delete (`HttpApiSchema.NoContent`, 204).

For those the schema is the client-facing type; it lists the same fields the raw JSON carries (e.g. `audit`'s `at` is a `Date` in the service and declared `Schema.String` on the wire, serialised by `JSON.stringify`).

### Per-endpoint table

| Module | Method and path | Result |
| --- | --- | --- |
| handles | GET `/api/handles/check` | complete (`{ available, reason? }`) |
| handles | PUT `/api/me/handle` | complete (`{ handle }`) |
| contact-requests | POST `/api/contact-requests` | complete (`{ request: ContactRequest, incoming? }`, raw 200/201) |
| contact-requests | GET `/api/contact-requests` | complete (`{ incoming, outgoing }`) |
| contact-requests | POST `/api/contact-requests/:id/accept` | complete (`{ request: ContactRequest }`) |
| contact-requests | POST `/api/contact-requests/:id/decline` | complete (`{ request: ContactRequest }`) |
| contact-requests | DELETE `/api/contact-requests/:id` | complete (`{ request: ContactRequest }`) |
| contact-requests | GET `/api/users/by-handle/:handle` | complete (`{ userId, name, handle, image, relation }`) |
| blocks | PUT `/api/blocks/:userId` | complete (`{ blocked: boolean }`) |
| blocks | DELETE `/api/blocks/:userId` | complete (`{ blocked: boolean }`) |
| blocks | GET `/api/blocks` | complete (`{ blocked: BlockedUserView[] }`) |
| contacts | GET `/api/contacts` | complete (`Contact[]`) |
| directory | GET `/api/directory` | complete (`{ entries: DirectoryEntry[], next }`) |
| directory | GET `/api/groups/by-handle/:handle` | complete (`DirectoryEntry`) |
| chat-prefs | GET `/api/chat-prefs` | complete (`{ prefs: ChatPrefView[], defaultBackground }`) |
| chat-prefs | PUT `/api/chat-prefs/:chatJid` | complete (`ChatPrefView \| { prefs: null }`) |
| chat-prefs | GET `/api/chat-background` | complete (`{ defaultBackground }`) |
| chat-prefs | PUT `/api/chat-background` | complete (`{ defaultBackground }`) |
| chat-folders | GET `/api/chat-folders` | complete (`{ folders: ChatFolderView[] }`) |
| chat-folders | POST `/api/chat-folders` | complete (`{ folder: ChatFolderView }`, raw 201) |
| chat-folders | PUT `/api/chat-folders/order` | complete (`{ folders: ChatFolderView[] }`) |
| chat-folders | PATCH `/api/chat-folders/:id` | complete (`{ folder: ChatFolderView }`) |
| chat-folders | DELETE `/api/chat-folders/:id` | complete (`{ deleted: boolean }`) |
| pins | GET `/api/pins` | complete (`{ pins: PinView[] }`) |
| pins | POST `/api/pins` | complete (`PinView`, raw 201) |
| pins | DELETE `/api/pins/:id` | complete (`PinView`) |
| roles | GET `/api/groups/:id/roles` | complete (`{ roles: GroupRoleDetail[] }`) |
| roles | POST `/api/groups/:id/roles` | complete (`GroupRoleDetail`, raw 201) |
| roles | PATCH `/api/groups/:id/roles/:roleId` | complete (`GroupRoleDetail`) |
| roles | DELETE `/api/groups/:id/roles/:roleId` | complete (204, `NoContent`) |
| roles | PUT `/api/groups/:id/roles/:roleId/members` | complete (`GroupRoleDetail`) |
| audit | GET `/api/audit` | complete (`{ entries: PublicAuditEntry[], next }`, raw) |
| groups | POST `/api/groups` | complete (`GroupDetail`, raw 201) |
| groups | GET `/api/groups/:id` | complete (`GroupDetail`) |
| groups | GET `/api/groups/:id/members` | complete (`{ members: GroupMemberView[] }`) |
| groups | PUT `/api/groups/:id/members/:userId/role` | complete (`GroupDetail`) |
| groups | POST `/api/groups/:id/members` | complete (`GroupDetail`) |
| groups | DELETE `/api/groups/:id/members/:userId` | complete (`GroupDetail`) |
| groups | POST `/api/groups/:id/ais` | complete (`GroupDetail`) |
| groups | DELETE `/api/groups/:id/ais/:aiId` | complete (`GroupDetail`) |
| groups | PATCH `/api/groups/:id` | complete (`GroupDetail`) |
| groups | POST `/api/groups/:id/join` | complete (`{ groupId, alreadyMember }`) |

Field-by-field sources: `contacts/service.ts` `Contact`; `directory/service.ts` `DirectoryEntry`/`DirectoryPage`; `audit/service.ts` `PublicAuditEntry`/`ListAuditPage`; `handles/store.ts` `checkHandleAvailability`/`checkGroupHandleAvailability`/`claimHandle`; `blocks/service.ts` `BlockedUserView`; `pins/service.ts` `PinView`; `roles/service.ts` `GroupRoleDetail`; `chat-prefs/service.ts` `BackgroundFields`/`ChatPrefView`; `chat-folders/service.ts` `ChatFolderView`; `contact-requests/service.ts` `ContactRequestView`/`OtherUserProfile`/`ContactRequestRow` and `toJson`; `groups/service.ts` `GroupDetail`/`GroupMemberView`/`GroupAiView` and `groups/join.ts` `JoinPublicGroupResult`.

### Intentional omissions (item 3)

No success schema is missing a field of the value its handler returns, so there was nothing to leave out. Three internal values are read by a service but are not part of the returned response value (so they are not schema fields, not gaps):

- `listMembersForViewer` also returns `isAdmin`; the `/api/groups/:id/members` handler answers only `{ members }`, like the deleted Hono route.
- `DirectoryRow.createdAt` (used for the cursor) and `ContactListRow.image` (folded into `avatarUrl`) never reach the response.
- `audit`'s `costCurrency`/`costAmount` columns are folded into the public `cost` object by `toPublicAuditEntry`.

### Modules not checked

`apps/server/src/xmpp/api.ts`, `apps/server/src/chats/api.ts` and `apps/server/src/agents/memory/api.ts` do not exist in this branch (`find apps/server/src -name api.ts` returns the 11 modules above); those modules still use Hono `routes.ts` here. T-0533 ("move xmpp token, chats and AI memory onto Effect HTTP", commit `2ba9808d`) is on another branch and is not in `main`, so its schemas were out of scope.

### Commands run

- `pnpm install` — done, no changes.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot handles contact-requests blocks contacts groups chat-prefs chat-folders pins roles audit xmpp chats agents/memory authz-sweep` — 27 test files passed, 364 tests passed (156s), including the 158-route 401 authz sweep. No test was changed.
- `pnpm gate` — summary lines:

```
gate: 1 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (34.4s)
PASS  lint  (1.2s)
PASS  typecheck  (1.2s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The one changed file is this task file.

### Deviations / problems

None. No gaps found; no `api.ts` or test file was edited, only this task file. If the reviewer knows of a field the schemas above are expected to carry that I did not account for, I am happy to re-check that specific field.

## Review (written by Claude)

Approved (lead, 2026-10-08). Audit only: 42 endpoints across 11 api.ts modules checked against the handler return types, with no stripped field found and no code changed. Lead spot-check: chat-folders FolderView lists all nine ChatFolderView fields. The lead also checked groups (T-0536) and topics (T-0539) by hand. New modules follow EFFECT_GUIDE item 8.
