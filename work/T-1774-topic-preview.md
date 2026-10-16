---
id: T-1774
title: "Topic people S6: GET /api/topics/:id/preview — the last 30 messages of a public topic for a group member who has not joined, read from the MUC archive like search (edits applied, retractions and live AI cards dropped), rate-limited"
status: merged
milestone: M5
branch: task/T-1774-topic-preview
model: auto
effort: default
depends_on: [T-1762]
estimate: 45 min
---

# T-1774: The topic preview read

## Spec (written by Claude, do not edit)

### Why
On the approved boards (`docs/design/mockups/topic-people/PhoneJoin.dc.html` and the "Other topics" rows in `WebGroup.dc.html`), a group member opens a public topic they haven't joined and sees its recent messages read-only, with a **Join** key below them. This is plan task **S6**: `docs/plan/topic-people.md` §2.7 and §4 item 7.
- Topic rooms are members-only and history is MUC MAM, so a non-member can't fetch it over XMPP.
- The server reads the archive for them, like message search does.

### Facts (read by the lead on 2026-10-17)
- **The archive pool:**
  - `ArchivePool { query(text, values): Promise<ArchiveRow[]>; close() }` (`apps/server/src/search/service.ts:15-18`);
  - it's handed to routes as an optional `archive` (`apps/server/src/app/routes-messaging.ts:112,130,138`);
  - `createTopicsApi` gets no archive today (`:102-107`; deps type `apps/server/src/topics/api.ts:57-68`).
  - Without a pool, search answers 501 `search_unavailable` (`apps/server/src/search/routes.ts:80-85`).
- **Room scoping:** archive rows of a room have `username` = the room's bare JID `<roomLocalpart>@<mucDomain>` (built at `search/service.ts:135-140`, matched as `username = $n` in `search/archive-query.ts:120-121`). The columns used are `username AS owner, peer, bare_peer, kind, nick, origin_id, timestamp, xml, txt` (`archive-query.ts:131`).
- **Edits and retractions:** `buildArchiveEditsQuery` (`archive-query.ts:74`, exported), and the exported `correctionTarget(xml)` and `retractTarget(xml)` (`apps/server/src/search/snippet.ts:81,90`). The newest-wins merge is in `search/routes.ts:136-160`. Reuse the exported helpers and repeat only the small merge loop.
- **Payloads:** `decodeAgentPayload(xml)` (`apps/server/src/notify/ai-cards.ts:37-44`) returns the `<agent>` payload or `null`. `isLiveAiUiRow(xml)` (`:48-50`) is true for the live progress card, which must never show in history.
- **Timestamps:** `timestamp` is in microseconds. `search/snippet.ts:~40-42` turns it into an ISO string.
- **Access:**
  - `canSeeTopic(db, topic, userId)` and `isTopicMember(...)` are in `apps/server/src/topics/access.ts:81,106`;
  - `getTopic` is in the topics service;
  - a public topic is visible to every group member.
- **The join route pattern:** the contract's `join` endpoint plus `TopicsJoinRateLimit` (`packages/api-contract/src/topics.ts:~289-292`, `packages/api-contract/src/middleware.ts:169-176`), wired in `topics/api.ts:79-83,214-222,312`.

### Steps
1. **The contract:** `packages/api-contract/src/topics.ts` gets:
   - `TopicPreviewMessage = { id: string, at: string, nick: string, body: string, payload?: unknown }`, where `payload` is the decoded payload object (the client decodes it again with its own `decodePayload`);
   - `TopicPreview = { messages: TopicPreviewMessage[] }`;
   - an endpoint `HttpApiEndpoint.get('preview', '/topics/:id/preview', { params: TopicIdParams, success: TopicPreview }).middleware(TopicsPreviewRateLimit)`.
   - Add `TopicsPreviewRateLimit` to `middleware.ts` next to `TopicsJoinRateLimit`.
2. **The read:** a new `apps/server/src/topics/preview.ts` with `readTopicPreview(archive, roomJid, limit = 30)`. It:
   - runs one rows query (`kind = 'groupchat'`, `username = roomJid`, newest first, `LIMIT 120`, so edit and retract rows don't starve the page) and one edits query for the same room;
   - applies corrections (it shows the newest body) and drops retracted messages, using the search helpers;
   - drops `isLiveAiUiRow` rows and rows with an empty body and no payload;
   - returns the newest 30 messages in **oldest-first** order, with `id` = `origin_id` (or the stanza id the search uses), `nick`, `body` (`txt`) and `payload` (from `decodeAgentPayload`) when present.
   - Every value goes in as a parameter (`$n`), never interpolated.
3. **The route** in `topics/api.ts`:
   - a missing topic, or one the caller can't see, gives 404 `not_found`;
   - a **private or General** topic gives 404 as well (members read those over XMPP);
   - otherwise `readTopicPreview(deps.archive, '<roomLocalpart>@<mucDomain>')`;
   - no archive pool gives 501 `preview_unavailable`;
   - an archive failure gives 502 `preview_failed`, logged with the topic id only.
   - A per-user limiter allows 120 previews an hour.
   - Pass `archive: deps.archive` into `createTopicsApi` in `app/routes-messaging.ts`, and add `archive?: ArchivePool` to its deps.
4. **Tests (permissions, 1, plus the merge, 1)** in a new `apps/server/src/topics/preview.test.ts`:
   - a group member who isn't in a public topic gets 200 with messages in order (a fake `ArchivePool` that returns rows); a private topic they can't see, and a non-group member, both get 404;
   - a corrected message shows its newest body, and a retracted message and a live progress row are left out.

### Allowed files
- `packages/api-contract/src/topics.ts`
- `packages/api-contract/src/middleware.ts`
- `apps/server/src/topics/preview.ts`
- `apps/server/src/topics/preview.test.ts`
- `apps/server/src/topics/api.ts`
- `apps/server/src/app/routes-messaging.ts`
- `work/T-1774-topic-preview.md`

If the search helpers you need aren't exported, export them from their file and add it here with a note (`apps/server/src/search/routes.ts` or `apps/server/src/search/archive-query.ts`). Don't copy them.

### Checks
```bash
cd apps/server && pnpm exec vitest run src/topics/preview.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- A group member can read the last 30 messages of any public, non-General topic without joining it.
- Edits are applied and retractions are hidden.
- Private and General topics, and outsiders, get 404.
- The route is rate-limited.
- The tests and the gate pass.

---

## Report (written by the worker when done)

### What I did

- **Contract** (`packages/api-contract/src/topics.ts`): added `TopicPreviewMessage`
  (`id`, `at`, `nick`, `body`, optional `payload: unknown`) and
  `TopicPreview { messages }`, plus the `GET /topics/:id/preview` endpoint
  (`params: TopicIdParams`, `success: TopicPreview`, `middleware(TopicsPreviewRateLimit)`).
- **Middleware tag** (`packages/api-contract/src/middleware.ts`): added
  `TopicsPreviewRateLimit` next to `TopicsJoinRateLimit`.
- **The read** (`apps/server/src/topics/preview.ts`, new): `readTopicPreview(archive, roomJid, limit = 30)`.
  One newest-first rows query (`kind = 'groupchat'`, `username = $1`, `LIMIT $2`)
  and one bounded edits query (`xml LIKE` the correct/retract namespaces), both
  fully bound (`$n`). It applies the newest-wins correction merge, drops
  retracted messages, retract rows, `isLiveAiUiRow` rows and rows with an empty
  body and no payload, then returns the newest `limit` in oldest-first order
  with `id = originId`, `nick`, `body = txt` and the decoded `payload` when
  present. Reuses the exported `correctionTarget`, `retractTarget`,
  `timestampToIso`, `decodeAgentPayload` and `isLiveAiUiRow`; only the small
  merge loop is repeated from search. Added the required
  `// effect-plain:` marker (the Promise edge over `ArchivePool`, like
  `search/service.ts`) so the Effect ratchet stays green.
- **Route** (`apps/server/src/topics/api.ts`): added the `preview` handler.
  A missing/unseen topic, a private topic and General all answer the shared
  404 `not_found`; no archive pool answers 501 `preview_unavailable`; an archive
  failure answers 502 `preview_failed` logged with `{ topicId }` only. Added
  `archive?: ArchivePool` to the deps type, a 120/hour limiter and its
  `rateLimitLayer`.
- **Wiring** (`apps/server/src/app/routes-messaging.ts`): passed
  `archive: deps.archive` into `createTopicsApi`.
- **Tests** (`apps/server/src/topics/preview.test.ts`, new): a group member who
  is not a topic member reads a public topic's rows oldest-first (200); a
  private topic they are not in, the General topic and an outsider all get 404.
  A second test proves a correction shows its newest body (under the
  correction row's id, as search does) while the retracted message, the retract
  row and the live `progress` card are dropped.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/preview.test.ts`
  → **2 passed** (the first run caught a bad test fixture: rows must arrive
  newest-first like the real query, and the progress payload needs `data.ai`;
  both were test-side fixes).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts`
  → **5 passed** (the reflected `/api/topics/:id/preview` is covered by the 401 sweep).
- `pnpm gate` → **GATE PASS**:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.4s)
  PASS  lint  (0.7s)
  PASS  typecheck  (4.1s)
  PASS  effect  (1.9s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (41.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (The first gate run failed the `effect` ratchet on the new `needs-effect`
  `preview.ts`, H1; fixed with the marker above, no files outside scope.)

### Notes for the lead

- For a corrected message search returns the *correction* row's `originId`
  (`search/routes.ts` `pushItem` uses `row.originId`). The preview **differed**
  from that in round 1; round 2 (below) changed it to the original target id.
- The edit merge is keyed on the target id only (one room), not `chatJid|target`
  as search does, because the read is already scoped to one room.
- No new dependencies.

### Round 2 (lead fix round)

Three commits, one per item; the Report's `status` stays `review`.

1. **`T-1774: preview keeps the original id of an edited message`** — the push
   now uses `key` (`correctionTarget(row.xml) ?? row.originId`) as `id`, so a
   corrected message keeps one id across edits. Extended the correction test:
   the corrected row is now asserted as `m1` (the original's id), not `c1`.
2. **`T-1774: test asserts the preview's room scoping`** — the fake
   `ArchivePool` now takes the topic's room JID and asserts `values[0]` equals
   it on both queries. Verified the guard bites: pointing it at a wrong room JID
   made the read answer 502 and the test fail, then reverted.
3. **`T-1774: preview drops edits of the live AI card`** — the read builds
   `liveIds = liveAiUiIds(rows)` and drops a row when
   `isLiveAiUiRow(row.xml) || isLiveAiUiEdit(row.xml, liveIds)`, matching
   `push/candidates.ts` and `chats/unread-skip.ts`. No new test.

Round 2 checks (run after all three commits):

- `cd apps/server && pnpm exec vitest run src/topics/preview.test.ts --reporter=dot`
  → **2 passed**.
- `pnpm gate` → **GATE PASS**:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (1.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.3s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (14.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
