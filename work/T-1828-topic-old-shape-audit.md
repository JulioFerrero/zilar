---
id: T-1828
title: "Audit only: every remaining read and write of topics.kind, topics.status and topics.owner_ai_id (TopicKind/TopicStatus/TopicOwner, TOPIC_KINDS/TOPIC_STATUSES) across server, contract, mock, web and phone, and the safe order to remove them (clients first, a release, then the drop migration)"
status: merged
milestone: M5
branch: task/T-1828-topic-old-shape-audit
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1828: Audit for dropping the old topic shape (AI work T8)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ai-work-plan.md` §7 step 8 ("T8") drops `kind`, `status` and `owner_ai_id` once nothing reads or writes them. **Julio's decisions (10-15) keep `link_url`/`link_label` and `follow_paused_at`, so those are out of scope.**

The lead's check on 2026-10-17 found:
- the released phone v0.2.7 still decodes `owner` (`apps/mobile/src/lib/topics-api.ts:45`);
- the contract still exports `TOPIC_KINDS`/`TOPIC_STATUSES` (`packages/api-contract/src/topics.ts:38-46`);
- `owner_ai_id` is still read in `apps/server/src/topics/{ais,members,patch,service,views}.ts` and `apps/server/src/groups/ais.ts`;
- `topics.follower_ai_id` (migration `0065_topic_follower.sql`) took over following.

A drop migration on live is irreversible, so the order must be proven first.

### Steps
1. **List every reference**, with `file:line` and whether it **reads**, **writes**, **sends to clients** or only **types**, for:
   - `topics.kind`, `topics.status`, `topics.owner_ai_id` (SQL and rows);
   - `TopicKind`, `TopicStatus`, `TopicOwner`, `TOPIC_KINDS`, `TOPIC_STATUSES`;
   - the `owner`/`kind`/`status` fields of the topic API shapes.

   Cover `apps/server`, `packages/api-contract`, `packages/chat-core`, `packages/client-core`, `packages/mock-backend`, `apps/web` and `apps/mobile`. Skip tests and `.turbo` logs; just count them.
2. **For each client read,** say whether the UI still shows it or the value is dead.
3. **Old clients:** say what a released client (phone v0.2.6 or v0.2.7) does if the server stops sending each field. Read the decode schema the phone uses (strict or optional). That decides whether the server must keep sending a placeholder for a while.
4. **Write `docs/audit/topic-old-shape-removal.md`** (about 150 lines) with:
   - the inventory;
   - the ordered tasks: (a) clients stop reading or decoding, (b) a phone release, (c) the server stops writing and sending, (d) the drop migration with `SET lock_timeout`, as in the plan;
   - each task's files and one acceptance line;
   - which steps are DB-schema tasks.
5. **Change no code.**

### Allowed files
- `docs/audit/topic-old-shape-removal.md`
- `work/T-1828-topic-old-shape-audit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The doc lists every reference with `file:line` and gives a safe removal order, including what old phones do.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Read `AGENTS.md` and this task in full, then surveyed every reference to
  `topics.kind`, `topics.status`, `topics.owner_ai_id`, `TopicKind`, `TopicStatus`,
  `TopicOwner`, `TOPIC_KINDS`, `TOPIC_STATUSES` and the `kind`/`status`/`owner` API
  fields in `apps/server`, `packages/api-contract`, `packages/chat-core`,
  `packages/client-core`, `packages/mock-backend`, `apps/web` and `apps/mobile`.
- Wrote `docs/audit/topic-old-shape-removal.md` with the inventory (`file:line`,
  mark for read/write/send/payload/type), the UI status of each field, what the
  released phone does when a field is missing, and the ordered tasks A–D
  (clients → phone release → server stops → drop migration), each with files, one
  acceptance line, and which step is the DB-schema task (only D).
- Checked the released schemas at tags `v0.2.6` and `v0.2.7` and verified the
  decode behaviour empirically with the repo's effect 4.0.4 (ad-hoc `node -e`
  script, no repo files changed): `kind`, `status` and `owner` are each required;
  omitting one fails the whole `Struct`, while a present unknown value falls back.
- Changed no application code. Files changed: the doc and this task file.

### Checks run

- `pnpm install --prefer-offline` → `Done in 12.8s using pnpm v10.32.1`.
- Decode repro (`node --input-type=module -e '…'`, effect 4.0.4) →
  `full OK`, `no-kind FAIL`, `no-status FAIL`, `no-owner FAIL`,
  `unknown-kind OK {"kind":"chat",…}`.
- `pnpm gate` (from the repo root) → exit 0, summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No package test files were run: the change is docs-only, so the gate skipped
  the nearest-test step (`SKIP effect (no source files changed)`).

### Notes for the lead

- **The key finding:** the phone's decode is stricter than it looks.
  `lenientLiterals` tolerates an unknown *value*, not a *missing key*. v0.2.6 and
  v0.2.7 require `kind`, `status` and `owner`; if the server omits any of them,
  `parseTopic` returns null and `/api/chats` drops **every topic row** from the
  group list. `GET /api/topics/:id` and create/patch responses fail outright.
  Placeholders must stay until the client release is the floor.
- **Payloads matter too:** create/patch use `onExcessProperty: 'error'` and v0.2.7
  still sends `kind` on create, so removing the payload key early returns 400.
- **References the lead's list did not name:** `apps/server/src/groups/service.ts:160-171`
  writes `kind`/`status` when a group's General topic is created;
  `apps/server/src/topics/views.ts:60-96` (`resolveOwnerName`) still reads
  `owner_ai_id` but has no caller; `topicKindSchema`/`topicStatusSchema`,
  `parseTopicKind`/`parseTopicStatus` are dead.
- **`owner` is not only an AI owner:** the response field is built from
  `owner_user_id` or `owner_ai_id`. The plan drops only `owner_ai_id`, so C can
  either keep `owner` as a user-only field or remove the whole field (nothing
  displays it). `owner_user_id` itself is out of scope and stays; nothing writes
  it once the `owner` payload goes — a decision for a later task.
- **Behaviour change at C:** assigning an owner currently also makes that AI the
  follower (`topics/service.ts:97`, `topics/patch.ts:132-133,168-170`). With the
  owner gone, following starts only on an `@mention`, which T-1529 supports.
- **Only D is a DB-schema task.** A and C are code, B is a release. D must wait
  for C to be the only running server release (expand/contract).
- **Deviation from the spec's size hint:** the doc is ~285 lines instead of
  ~150. The seven areas and the required `file:line` inventory did not fit in
  150 without dropping references; I kept every reference and the bullets
  readable.
- Security checklist: docs-only change; no routes, queries, secrets or logs
  added.

### Round 2 (fix round)

- **Findings fixed:** 1 of 1 should-fix, 0 must-fix.
  - Finding 1 (`docs/audit/topic-old-shape-removal.md`, placeholder paragraph):
    the doc no longer prescribes `owner: null`. It now says the server keeps
    sending all three fields until the Task A release is the floor, that
    `kind: 'chat'`/`status: 'open'` are the correct constant placeholders, and
    that `owner` must keep its real mapped value (user or AI) with `null` only
    when the topic truly has none. A blanket `null` would turn a real owner into
    "no owner" for an old build that still reads the field.
  - Nits 2, 3, 4 and 5 were left alone: every one sits on a line this round does
    not touch, and the brief says not to touch nits outside changed lines.
- **Tests added:** none. This is a docs-only change; the finding names no test
  and the decoders are unchanged, so there is no behaviour to assert. The gate
  skipped the nearest-test step for the same reason (`SKIP effect`).
- **Files changed in this round:** `docs/audit/topic-old-shape-removal.md` and
  this task file.
- **Commands run:** `pnpm gate` from the repo root twice: once after the doc fix,
  then once more after this Report edit, so the final tree is the one that
  passed. Both runs ended `GATE PASS`; the second run:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.5s)
  PASS  lint  (0.8s)
  PASS  typecheck  (0.8s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- **Disagreements:** none; finding 1 was correct and is fixed as written.
- Status stays `review`.

### Round 3 (fresh-session verification)

The Round 2 session ended on a service quota error after its commits. This round
started from a clean tree and re-checked that state instead of redoing it:

- `git log --oneline main..HEAD` shows the spec, audit, finding-1 fix and Report
  commits; `git diff --name-only main...HEAD` lists only
  `docs/audit/topic-old-shape-removal.md` and this task file.
- The fixed paragraph is still in place (`docs/audit/topic-old-shape-removal.md`
  §3: keep `kind`/`status` constants, send the real `owner`, `null` only when the
  topic truly has none). Nits 2–5 remain untouched as before.
- No code or test changes were needed or made this round. The finding names no
  test, and the change is docs-only.
- `pnpm gate` from the repo root on the final tree:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (0.8s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

- Status stays `review`.
