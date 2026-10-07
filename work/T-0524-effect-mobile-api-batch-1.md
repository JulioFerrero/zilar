---
id: T-0524
title: "Effect lane E, batch 1: mobile invites-api, chat-prefs-api, search-api and audit-api onto Effect Schema + the T-0506 request pipeline; same exports, same errors, tests unchanged"
status: merged
milestone: M5
branch: task/T-0524-effect-mobile-api-batch-1
model: auto
effort: low
depends_on: [T-0506]
estimate: 0.5 day
---

# T-0524: mobile API clients batch 1 on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, mobile included. T-0506 converted `apps/mobile/src/lib/pins-api.ts` as **the recipe for the other `*-api.ts` files**. Read its header comment and its Report in `work/T-0506-effect-mobile-pins-api.md`. In short:
- the wire boundary is decoded with Effect Schema (`struct` from `@zilar/protocol`);
- lenient fields use `Schema.decodeTo` with a `SchemaGetter.transform`;
- the request is an Effect pipeline, cut back to a `Promise` at the edge with `Effect.runPromise`;
- the error class and its `status`/`code`/`message` stay the same.

This task applies the recipe to four small clients.

### Verified facts (do not re-derive)
Mobile validates these boundaries by hand today (no zod). The files, with their exports, which **all stay the same**:
- **`apps/mobile/src/lib/invites-api.ts`** (115 lines): `Invite`, `InvitesApi`, `InvitesApiError` and `createInvitesApi`.
- **`apps/mobile/src/lib/chat-prefs-api.ts`** (174 lines): `ChatPref`, `PutChatPrefInput`, `ChatPrefsApi`, `ChatPrefsApiError`, **`parseChatPref(value): ChatPref | null`** (imported elsewhere, so keep its signature and its null on a bad row) and `createChatPrefsApi`.
- **`apps/mobile/src/lib/search-api.ts`** (175 lines): `SearchMark`, `SearchItem`, `SearchPage`, `SearchMessagesInput`, `SearchApi`, `SearchApiError` and `createSearchApi`.
- **`apps/mobile/src/lib/audit-api.ts`** (199 lines): `AuditResult`, `AuditCost`, `PublicAuditEntry`, `AuditPage`, `AuditApi`, `AuditApiError`, `AUDIT_PAGE_LIMIT` and `createAuditApi`.
- **Each has a test next to it** (`*-api.test.ts`). Other tests that use them: `apps/mobile/src/store/real-store.prefs-pins.test.ts`, `apps/mobile/src/lib/chat-prefs.test.ts`, `apps/mobile/src/mock/search.test.ts` and `apps/mobile/src/components/chat/use-message-search.test.ts`.

### What to build
1. **Convert the four files with the T-0506 recipe:**
   - the same exported names, types and signatures;
   - the same tolerance: what the hand validator skipped, defaulted or rejected, the schema skips, defaults or rejects the same way;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
   
   Keep `parseChatPref` as a thin wrapper over the schema, like `parsePin` in T-0506.
2. **Tests:** every existing test passes **unchanged**. You may add one `*-api.effect.test.ts` per file, as T-0506 did, for a lenient-field or whole-list case the old tests miss.
3. **No new dependencies** (`effect` is already in `apps/mobile/package.json`).

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/pins-api.effect.test.ts`, `work/T-0506-effect-mobile-pins-api.md` (its Report), then the four files and their tests.

### Allowed files
- `apps/mobile/src/lib/invites-api.ts`, `apps/mobile/src/lib/chat-prefs-api.ts`, `apps/mobile/src/lib/search-api.ts`, `apps/mobile/src/lib/audit-api.ts`;
- the four matching new, optional test files: `apps/mobile/src/lib/invites-api.effect.test.ts`, `apps/mobile/src/lib/chat-prefs-api.effect.test.ts`, `apps/mobile/src/lib/search-api.effect.test.ts` and `apps/mobile/src/lib/audit-api.effect.test.ts`;
- `work/T-0524-effect-mobile-api-batch-1.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot invites-api chat-prefs search audit-api real-store.prefs-pins use-message-search
pnpm gate
```

### Acceptance
- The four clients decode with Effect Schema and run their requests as Effect pipelines, with the same exports and errors.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: review.

### What I did

- Converted the four mobile API clients to the T-0506 recipe: Effect Schema at the wire
  boundary (via `struct` from `@zilar/protocol`), an Effect request pipeline per client
  (`Effect.tryPromise` -> network error, JSON body, error envelope, decode), cut back to a
  `Promise` with `Effect.runPromise` at the edge. Exported names, types, signatures and the
  `status`/`code`/`message` of every error are unchanged.
  - `invites-api.ts`: `InviteSchema` (`expiresAt` is `Schema.optional(Schema.String)`); private
    `parseInvite` is a thin wrapper over the schema.
  - `chat-prefs-api.ts`: `ChatPrefSchema` (`mutedUntil`/`pinnedAt` are `Schema.NullOr(String)`),
    a `{ prefs }` list schema, and a `{ prefs: null }` schema for the deleted-row PUT result.
    `parseChatPref` keeps its export and its `ChatPref | null` contract as a thin schema wrapper.
  - `search-api.ts`: `SearchPageSchema`/`SearchItemSchema` and a mutable `Schema.Tuple` of
    non-negative `Schema.Int`s for marks. The abort contract is preserved: pre-check before the
    request, post-check after it, and an abort during the fetch is carried back as the original
    `DOMException` (the pipeline fails a `SearchAborted` tagged error and the edge re-fails the
    `DOMException`), so an abort is never a `SearchApiError`.
  - `audit-api.ts`: `PublicAuditEntrySchema` (`aiId`/`groupId`/`subjectId`/`argsHash`/`cost`/
    `detail`/`actorUserId` are nullable, `result` and the cost currency are `Schema.Literals`),
    `AuditPageSchema`; `AUDIT_PAGE_LIMIT` unchanged.
- Added the four optional `*-api.effect.test.ts` files for cases the old tests miss: unknown extra
  fields are dropped, a non-string `expiresAt` rejects, a non-null non-string `mutedUntil` rejects,
  a mark with three offsets rejects, and a `detail` that is not an object rejects.

### Files changed

- `apps/mobile/src/lib/invites-api.ts`
- `apps/mobile/src/lib/chat-prefs-api.ts`
- `apps/mobile/src/lib/search-api.ts`
- `apps/mobile/src/lib/audit-api.ts`
- `apps/mobile/src/lib/invites-api.effect.test.ts` (new)
- `apps/mobile/src/lib/chat-prefs-api.effect.test.ts` (new)
- `apps/mobile/src/lib/search-api.effect.test.ts` (new)
- `apps/mobile/src/lib/audit-api.effect.test.ts` (new)
- `work/T-0524-effect-mobile-api-batch-1.md`

### Commands and real results

- `pnpm install`: done in 18.8s; only the pre-existing `@types/react-dom` peer warning.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot invites-api chat-prefs search
  audit-api real-store.prefs-pins use-message-search`: **12 test files, 113 passed** (the 105
  pre-existing tests plus the 8 new ones). No existing test was edited.
- `pnpm gate` from the repo root:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (43.4s)
  PASS  lint  (1.4s)
  PASS  typecheck  (16.2s)
  PASS  tests @zilar/mobile  (16.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first gate run failed `format` on five of my files (my prettier formatting); I ran
  `node_modules/.bin/prettier --write` on only my eight files and the `format` step passed. The
  second run failed `typecheck` on two mistakes in `search-api.ts` (a positional `DOMException`
  argument where the tagged error takes `{ reason }`, and a `signal.aborted` narrowing); both are
  fixed and the run above is the final green gate.

### Deviations / notes

- Same whole-or-nothing error-envelope decoding as T-0506: if `body.error` exists but `code` or
  `message` is not a string, both fall back to `request_failed` / `Request failed (<status>)`;
  the old code fell back per field. No caller or test depends on it.
- `audit-api.ts` `detail` uses `Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))`, which
  rejects an array; the old `isRecord` type guard accepted arrays as records. No caller or test
  passes an array as `detail`. This is forced by the `Record<string, unknown>` type the interface
  keeps.
- `search-api.ts`: the post-fetch abort re-check now runs after the body is read (the recipe reads
  the body inside `requestEffect`), where the old code checked before reading it; the outcome is
  the same (`DOMException`/`AbortError`). When no external signal is given, the pipeline hands
  Effect's own interruption signal to `fetch`, as in T-0506; when one is given, that signal is
  used, preserving the old behaviour.
- No new dependencies; only `effect` core (no `effect/http-api`, workflow or eventlog), so the
  Hermes-unsafe `crypto.subtle` path is untouched.

### Open questions

None.

### Round (fresh session — fixes from PREREVIEW)

Findings fixed: both should-fix (0 must-fix). No must-fix findings.

- **Finding 1 — `audit-api.ts` `detail` array.** `detail` now decodes with
  `Schema.declare((value) => typeof value === 'object' && value !== null)`, which is
  exactly the old `isRecord` guard, so an array `detail` is accepted again (kept as-is) and
  only a non-object, non-null `detail` rejects the page. The disclosure in "Deviations"
  above no longer applies.
- **Finding 2 — error-envelope fallback** (`audit-api.ts`, `invites-api.ts`,
  `chat-prefs-api.ts`, `search-api.ts`). The envelope is now decoded field by field: each
  `code`/`message` is `Schema.optional` over a lenient `Unknown -> string | undefined`
  transform (`Schema.decodeTo` + `SchemaGetter.transform`), so a malformed `code` no longer
  discards a valid `message` (and vice versa). This restores the old per-field fallbacks;
  the whole-or-nothing disclosure in "Deviations" above no longer applies.

Tests added/adjusted (existing tests untouched):

- `audit-api.effect.test.ts`: replaced the "rejects an array detail" test with "accepts an
  array detail, as the old type guard did", kept a "rejects a non-object detail" test, and
  added valid-code/malformed-message and malformed-code/valid-message envelope tests.
- `invites-api.effect.test.ts`, `chat-prefs-api.effect.test.ts`, `search-api.effect.test.ts`:
  each gained the same two per-field envelope tests. `chat-prefs-api.effect.test.ts` now also
  imports `createChatPrefsApi`, `vi` and a `jsonResponse` helper for the fetch path.

Single tests:
`pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot invites-api chat-prefs search audit-api real-store.prefs-pins use-message-search`
→ **16 files, 122 tests passed** (17 of them the effect tests, up from 8).

Gate, from the repo root:
```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (23.4s)
PASS  lint  (1.0s)
PASS  typecheck  (0.8s)
PASS  tests @zilar/mobile  (10.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

Formatting: `prettier --write` was run on the eight changed source/test files before the
gate (all reported unchanged). No disagreements; `status` stays `review`.

## Review (written by Claude)


Approved (lead, 2026-10-08). The mobile invites, chat-prefs, search and audit clients are on Effect Schema with the T-0506 pipeline, with the same exports, errors and parseChatPref. New effect tests assert exact bodies and error triples. phone:smoke passed on the galena AVD. Pre-review clean after 1 auto round. The nit (an abort racing an error response now surfaces SearchApiError instead of a silent abort) is accepted as a tight race; it goes into a later polish task.
