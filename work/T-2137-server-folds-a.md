---
id: T-2137
title: "Server (actions to groups): fold single-use files back into their only importer where the split was for size or is one concept — fewer imports, exports and repeated types; no behaviour change"
status: merged
milestone: M5
branch: task/T-2137-server-folds-a
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2137: Fold single-use server files (actions to groups)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. Each fold below removes the import and export lines, and any type or helper the two files both declare.

The lead listed these at `e4a868766`. Each mover has exactly one production importer, the host; the tests listed import it too.

| Mover (lines) | Host (lines) | Tests that import the mover |
| --- | --- | --- |
| `actions/approval-path.ts` (171) | `actions/decisions.ts` (204) | — |
| `actions/decisions.ts` (204) | `actions/gateway.ts` (171) | — |
| `ai/catalog-map.ts` (214) | `ai/catalog.ts` (170) | — |
| `ais/status.ts` (162) | `ais/api.ts` (437) | — |
| `ais/templates.ts` (18) | `ais/persona.ts` (168) | — |
| `audit/list.ts` (275) | `audit/api.ts` (92) | message-blocks/respond.test.ts |
| `card-media/strip.ts` (205) | `card-media/fetch.ts` (225) | card-media/strip.test.ts |
| `chat-prefs/backgrounds.ts` (142) | `chat-prefs/service.ts` (189) | — |
| `chats/delete-own.ts` (194) | `chats/api.ts` (162) | — |
| `chats/list-handler.ts` (256) | `chats/api.ts` (162) | — |
| `chats/reply-handler.ts` (176) | `chats/api.ts` (162) | — |
| `chats/unread-queries.ts` (133) | `chats/unread.ts` (293) | — |
| `config/server-schema.ts` (217) | `config/load.ts` (235) | — |
| `connections/probe.ts` (168) | `connections/api.ts` (313) | connections/catalog-provider.test.ts |
| `contact-requests/decide.ts` (205) | `contact-requests/service.ts` (203) | — |
| `contact-requests/service.ts` (203) | `contact-requests/api.ts` (230) | blocks/blocks.test.ts contact-requests/contact-requests.test.ts contacts/contacts.test.ts |
| `gifs/giphy-parse.ts` (161) | `gifs/giphy.ts` (185) | — |
| `gifs/giphy.ts` (185) | `gifs/api.ts` (387) | — |
| `groups/delete-group.ts` (123) | `groups/api.ts` (312) | — |
| `groups/ownership.ts` (144) | `groups/api.ts` (312) | — |

All paths are under `apps/server/src/`.

### Steps
For each row, read both files.
1. **Fold** when the mover is a slice of the host's concept (a handler, a parser, a schema or a query helper that only the host uses) or was split out for size:
   - move its code into the host;
   - delete the mover;
   - remove the now-internal `export`s the host no longer needs;
   - drop declarations that become duplicates.
2. **Chains.** Fold in order. For example, `actions/approval-path.ts` goes into `actions/decisions.ts`, which then goes into `actions/gateway.ts`, only if the result stays within the cap.
3. **Cap.** No host may end above 650 lines; skip a fold that would push it over. Several movers into one host count together.
4. **Skip** a fold when the mover is a separate concept a reader looks for by name, or a worker-thread or process entry loaded by path. Check for `new Worker(`, `import.meta.url` or a file-path string that names the mover before folding it.
5. **Tests.** Update the import path, or the `vi.mock(...)` path, in each listed test; change nothing else in it. No new tests.

### Rules
- No behaviour change: the same SQL, routes, limits, log fields and error strings.
- The diff only moves code, removes import/export lines and removes duplicates. It changes no line of logic.
- Do not touch `apps/server/src/agents/**` or `apps/server/src/auth/**`.
- Product lines go down by at least 60.

### Allowed files
- `apps/server/src/actions/approval-path.ts`
- `apps/server/src/actions/decisions.ts`
- `apps/server/src/actions/gateway.ts`
- `apps/server/src/ai/catalog-map.ts`
- `apps/server/src/ai/catalog.ts`
- `apps/server/src/ais/api.ts`
- `apps/server/src/ais/persona.ts`
- `apps/server/src/ais/status.ts`
- `apps/server/src/ais/templates.ts`
- `apps/server/src/audit/api.ts`
- `apps/server/src/audit/list.ts`
- `apps/server/src/blocks/blocks.test.ts`
- `apps/server/src/card-media/fetch.ts`
- `apps/server/src/card-media/strip.test.ts`
- `apps/server/src/card-media/strip.ts`
- `apps/server/src/chat-prefs/backgrounds.ts`
- `apps/server/src/chat-prefs/service.ts`
- `apps/server/src/chats/api.ts`
- `apps/server/src/chats/delete-own.ts`
- `apps/server/src/chats/list-handler.ts`
- `apps/server/src/chats/reply-handler.ts`
- `apps/server/src/chats/unread-queries.ts`
- `apps/server/src/chats/unread.ts`
- `apps/server/src/config/load.ts`
- `apps/server/src/config/server-schema.ts`
- `apps/server/src/connections/api.ts`
- `apps/server/src/connections/catalog-provider.test.ts`
- `apps/server/src/connections/probe.ts`
- `apps/server/src/contact-requests/api.ts`
- `apps/server/src/contact-requests/contact-requests.test.ts`
- `apps/server/src/contact-requests/decide.ts`
- `apps/server/src/contact-requests/service.ts`
- `apps/server/src/contacts/contacts.test.ts`
- `apps/server/src/gifs/api.ts`
- `apps/server/src/gifs/giphy-parse.ts`
- `apps/server/src/gifs/giphy.ts`
- `apps/server/src/groups/api.ts`
- `apps/server/src/groups/delete-group.ts`
- `apps/server/src/groups/ownership.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `work/T-2137-server-folds-a.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, including the server tests it runs.
- Product lines go down by at least 60.
- The Report lists each row: folded (lines saved) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Folded single-use server files into their hosts, moving code verbatim and dropping the
now-internal imports, exports and duplicate declarations. Net product lines: 3097
deletions against 2959 insertions = **138 lines saved** (`git diff --numstat`), above the
required 60.

Rows (net lines saved computed per mover/host pair):

| Row | Outcome |
| --- | --- |
| `actions/approval-path.ts` (171) → `actions/decisions.ts` → `actions/gateway.ts` | folded as one chain, 8 saved |
| `actions/decisions.ts` (204) → `actions/gateway.ts` | folded in the same chain, included above |
| `ai/catalog-map.ts` (214) → `ai/catalog.ts` | folded, 16 saved; `PROVIDERS`/`PROVIDER_NAMES`/mapping became internal, `catalogBaseUrl` stays exported |
| `ais/status.ts` (162) → `ais/api.ts` | folded, 8 saved |
| `ais/templates.ts` (18) → `ais/persona.ts` | skipped: `ais/queries.ts` also imports `AiTemplate` from `./templates`, and that file is outside Allowed files |
| `audit/list.ts` (275) → `audit/api.ts` | folded, 0 net (275 removed, imports added); `listAuditForAi` stays exported for its test |
| `card-media/strip.ts` (205) → `card-media/fetch.ts` | folded, 6 saved; `stripImageMetadata` stays exported for its test |
| `chat-prefs/backgrounds.ts` (142) → `chat-prefs/service.ts` | folded, 17 saved; `requireChatAccess`/`ChatAccess` re-exports kept |
| `chats/delete-own.ts` (194) → `chats/api.ts` | folded, 20 saved together with `list-handler` |
| `chats/list-handler.ts` (256) → `chats/api.ts` | folded, included above |
| `chats/reply-handler.ts` (176) → `chats/api.ts` | skipped: `chats/api.ts` is 592 lines after the other two folds; adding this mover would exceed the 650-line cap |
| `chats/unread-queries.ts` (133) → `chats/unread.ts` | folded, 13 saved |
| `config/server-schema.ts` (217) → `config/load.ts` | folded, 3 saved |
| `connections/probe.ts` (168) → `connections/api.ts` | skipped: `app/deps.ts` also imports `ProviderProbe` from `./probe`, and that file is outside Allowed files |
| `contact-requests/decide.ts` (205) → `contact-requests/service.ts` → `contact-requests/api.ts` | folded as one chain, 20 saved |
| `contact-requests/service.ts` (203) → `contact-requests/api.ts` | folded in the same chain, included above |
| `gifs/giphy-parse.ts` (161) → `gifs/giphy.ts` | folded, 7 saved |
| `gifs/giphy.ts` (185) → `gifs/api.ts` | skipped: host is 387 lines, folding would exceed the 650-line cap |
| `groups/delete-group.ts` (123) → `groups/api.ts` | folded, 17 saved together with `ownership` |
| `groups/ownership.ts` (144) → `groups/api.ts` | folded, included above |

Tests: only the import paths changed in `card-media/strip.test.ts`,
`message-blocks/respond.test.ts`, `blocks/blocks.test.ts`, `contacts/contacts.test.ts` and
`contact-requests/contact-requests.test.ts`. No new tests.

Files changed: the 16 deleted movers plus their hosts, the five test files above, and this
task file. Everything is inside the task's Allowed files.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/unread.test.ts`
  → 1 file passed, 10 tests passed.
- `pnpm gate` → `GATE PASS`:
  - `PASS install (frozen)`
  - `PASS format`
  - `PASS lint`
  - `PASS typecheck`
  - `PASS effect`
  - `PASS build @zilar/server`
  - `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`

Two earlier gate runs failed and were fixed: a truncated tail from the
`contact-requests` merge (syntax error), duplicate imports left in `ai/catalog.ts`, and
three missing imports (`Effect` in `config/load.ts`, `EjabberdAdminClient` in
`chats/api.ts`, the `requireChatAccess` re-export in `chat-prefs/service.ts`).

### Notes for the lead

- `ais/templates.ts` and `connections/probe.ts` have a second production importer outside
  the Allowed files (`ais/queries.ts` and `app/deps.ts`), so they cannot be deleted in
  this task without touching out-of-scope files.
- The `chats` and `gifs` chains hit the 650-line cap; the rows with the best saving were
  folded and the remainder is reported as skipped, per the spec's cap rule.
- No behaviour lines changed; only imports/exports/internal visibility and file
  boundaries moved.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit: Report arithmetic). Net −134: 16 single-use server files folded into their only importer (actions, ai catalog, ais status, audit list, card-media strip, chat-prefs backgrounds, chats delete/list and unread queries, config schema, contact-requests, giphy parse, groups delete/ownership).

**Skips:** 4 rows were skipped for sound reasons: a second importer outside the list, or the 650-line host cap.

**Lead fix round:** two "why" comments the fold dropped are back above the moved code: the metadata-stripping rule in `card-media/fetch.ts` and the one-query unread rule in `chats/unread.ts`. The gate ran the server suite. Live route probe after the push.
