---
id: T-0551
title: "Effect lane E, batch 7: mobile topics-api and chat-api onto Effect Schema + the T-0506 request pipeline with the shared lenient error envelope; same exports (parseTopic and friends stay), same errors, tests unchanged"
status: merged
milestone: M5
branch: task/T-0551-effect-mobile-api-batch-7
model: auto
effort: low
depends_on: [T-0547]
estimate: 1 day
---

# T-0551: mobile API clients batch 7 on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase moves to Effect 4, mobile included.
- **Recipe:** `apps/mobile/src/lib/pins-api.ts` (T-0506) and `docs/EFFECT_GUIDE.md`, "Moving a mobile API client onto Effect".
- **Recent examples:** `apps/mobile/src/lib/profile-api.ts` (T-0541) and `apps/mobile/src/lib/ais-api.ts` (T-0547).
- **Shared lenient error envelope:** `apps/mobile/src/lib/api-error-body.ts`. Use it; never write a local `ErrorBodySchema`.

`chat-api.ts` reads topics from the chats list, so the two files move together.

### Verified facts (do not re-derive)
These files validate by hand today. **Every export stays the same.**
- **`apps/mobile/src/lib/topics-api.ts`** (508 lines):
  - `TopicsApiError` (line 109) and `createTopicsApi` (341);
  - **these exported parsers keep their signatures and results:**
    - `parseTopicKind(value)` (135), `parseTopicStatus(value)` (149) and `parseTopicVisibility(value)` (163). These map unknown values to a default; keep the same defaults;
    - `parseTopic(value): Topic | null` (209);
    - `chatEntryTopics(entry): Topic[]` (293);
  - `glyphForTopicName` (505) is pure and stays as it is.
- **`apps/mobile/src/lib/chat-api.ts`** (439 lines): `ChatApiError` (102) and `createChatApi` (380), plus the exported types.
- **Tests that cover them (all unchanged):**
  - `apps/mobile/src/lib/{chat-api,chat-api.topics,topics-api,topics}.test.ts`;
  - `apps/mobile/src/components/chat/{chat-list-item,message-list,new-group-sheet,new-topic-sheet,topic-row}.test.tsx`;
  - every `apps/mobile/src/store/*.test.ts`. The real store runs these clients, so this is the main proof.

### What to build
1. **Convert both files with the recipe** and the shared envelope:
   - the same exported names, types and signatures;
   - the same tolerance. The chats list is the app's home screen: one malformed chat or topic entry is dropped or defaulted **exactly** as today, and never fails the whole list unless it does today;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
   
   The `parse*` exports become thin wrappers over schema decodes, with the same defaults.
2. **Tests:** every existing test passes **unchanged**. You may add one new `*.effect.test.ts` per client.
3. **In the Report,** list each place where the hand validator dropped or defaulted a value, and the schema construct that now does it.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the mobile API section), `apps/mobile/src/lib/pins-api.ts`, `apps/mobile/src/lib/api-error-body.ts`, `apps/mobile/src/lib/profile-api.ts`, then both files and their tests.

### Allowed files
- `apps/mobile/src/lib/topics-api.ts`, `apps/mobile/src/lib/chat-api.ts`;
- the new, optional test files: `apps/mobile/src/lib/topics-api.effect.test.ts`, `apps/mobile/src/lib/chat-api.effect.test.ts`;
- `work/T-0551-effect-mobile-api-batch-7.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot chat-api topics chat-list-item message-list new-group-sheet new-topic-sheet topic-row src/store
pnpm gate
```

### Acceptance
- Both clients decode with Effect Schema and the shared envelope, and run as Effect pipelines, with the same exports, defaults and errors.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Converted `apps/mobile/src/lib/topics-api.ts` and `apps/mobile/src/lib/chat-api.ts`
to the T-0506 Effect recipe (Effect Schema decodes + shared
`errorFieldsOf` envelope + `Effect.runPromise` at the edge). Same exports,
signatures, defaults and errors; no existing test touched.

Tolerant spots and the schema construct now handling each:
- topics-api: unknown kind/status/visibility (incl. absent key) -> `chat` /
  `open` / `private` via `Schema.Unknown` + `withDecodingDefault` +
  `decodeTo(..., transform(parseTopicKind/Status/Visibility))`.
- topics-api: `roles` absent -> `[]` (`Schema.optional`), malformed role entry
  or non-array -> row null; `approverRole` absent/null -> null
  (`optional(NullOr(...))` + `?? null`), malformed object -> row null.
- topics-api: `owner`/`linkUrl`/`linkLabel` stay required `NullOr`
  (absent or wrong type -> row null, as before); `ais` entries all must parse.
- topics-api: `chatEntryTopics` non-array/missing -> `[]`, malformed rows
  dropped via `parseTopic` (struct wrapper + loop).
- topics-api: `membersCanCreateTopics` any non-boolean -> `false` via lenient
  boolean with decoding default `false`.
- chat-api: `Me.jid` missing/non-string -> null (lenient null-string);
  contact/DM `avatarUrl` missing/non-string -> absent (lenient optional-string).
- chat-api: group `chatKind`/`subscriberCount`/`description` malformed ->
  entry null (strict `optional`); `topics` non-array -> entry null, malformed
  rows inside dropped via `parseTopic`.
- chat-api: member `handle` null/absent/`''` -> absent
  (`optional(NullOr(String))` + map), non-string -> detail null; member
  `roles` absent -> `[]`, malformed -> detail null.
- chat-api: `membersCanCreateTopics` non-boolean -> absent (lenient
  tri-state); group `ais` absent/non-array -> `[]`, malformed entry in an
  array -> detail null.
- Both: network throw -> `(0, network_error)`; non-JSON error body keeps
  per-field fallbacks (`request_failed` / `Request failed (N)`) via the
  shared envelope; no session -> `(401, unauthorized)` before fetch;
  undecodable success body -> `(200, invalid_response)`.

Files changed:
- `apps/mobile/src/lib/topics-api.ts` (Effect Schema + pipeline)
- `apps/mobile/src/lib/chat-api.ts` (Effect Schema + pipeline)
- `apps/mobile/src/lib/topics-api.effect.test.ts` (new: network/fallback/401)
- `apps/mobile/src/lib/chat-api.effect.test.ts` (new: network/fallback/401)

Commands (real results):
- `pnpm install --prefer-offline`: ok.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/lib/chat-api.test.ts src/lib/chat-api.topics.test.ts
  src/lib/topics-api.test.ts`: 3 files, 34 passed.
- Same runner for `src/lib/topics.test.ts`, 5 chat component suites and
  `src/store`: 352 passed, 1 skipped.
- Same runner for the 2 new effect suites: 6 passed.
- `pnpm gate`: GATE PASS (install, format, lint, typecheck, mobile tests;
  scope: every changed file inside Allowed files). First gate run failed on
  prettier for `chat-api.ts` + `topics-api.effect.test.ts`; fixed with
  `prettier --write` on those two files, re-ran affected tests (18 passed),
  second gate run passed.

Security checklist: no secrets/tokens in logs or errors (typed errors carry
only status/code/message); no deletes/updates here beyond the existing
API shapes (unchanged paths/bodies); no caps/uniqueness logic; permission
check (token present) runs before any fetch; 401/404 answers unchanged;
no new routes; audit untouched (ids only, as before).

Round 2 (fix round): fixed prereview finding 1 (non-array group `ais`
now tolerated as `[]` via a lenient `Unknown`-with-default + array-or-undefined
transform, instead of a strict optional array). Tests added: group detail
with `ais: "oops"` in `chat-api.effect.test.ts` resolves with `ais: []`.
Single tests: `chat-api.effect.test.ts` + `chat-api.test.ts`: 2 files,
16 passed. `pnpm gate`: GATE PASS (install, format, lint, typecheck,
mobile tests; scope: every changed file inside Allowed files).

## Review (written by Claude)

Approved (lead, 2026-10-08) after one auto fix round (non-array group ais now reads as []). The topics and chat mobile clients are on Effect Schema plus the T-0506 pipeline and the shared envelope, with the same exports, parse defaults and per-entry tolerance. phone:smoke passed on / and /settings/folders, and the lead opened the test group by hand: the chat list, group header (2 members, 0 AIs, 1 topic) and General topic all load live data. Pre-review clean.
