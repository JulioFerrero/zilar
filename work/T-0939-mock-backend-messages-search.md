---
id: T-0939
title: "Mock backend B: the full message seed and the /search route in @zilar/mock-backend (docs/audit/mock-plan.md task B)"
status: merged
milestone: M5
branch: task/T-0939-mock-backend-messages-search
model: auto
effort: default
depends_on: [T-0937]
estimate: 0.5 day
---

# T-0939: Mock backend B, messages and search

## Spec (written by Claude, do not edit)

### Why
Task B of `docs/audit/mock-plan.md` section 4 (read the plan and "Julio's answers" at its end). T-0937 (merged) built `packages/mock-backend` with a text-only subset of messages (`src/data/messages.ts`, 110 lines, 2–7 per chat).

The fake XMPP (task F2) serves history from this seed, so it needs the real demo content. It now lives in:
- web `apps/web/src/mock/messages.ts` (1,148 lines; `mockMessages` `:1114`, `mockLastMessage` `:1141`);
- the helpers it uses in `apps/web/src/mock/helpers.ts` (voice and waveform `:29`, image SVGs, the approval card `:75`);
- mobile's copy in `apps/mobile/src/mock/messages.ts` (258 lines).

Web search is `searchMessages` at `apps/web/src/mock/api.ts:4152`, routed at `:3054`; mobile's is `apps/mobile/src/mock/search.ts` (152 lines).

### What to build
1. **The seed's messages:** every thread in web `mock/messages.ts`, with the same content, as bare-JID-keyed records in the shape the fake XMPP will emit (`packages/xmpp-core/src/types.ts`: the message event and `HistoryPage`). That covers voice, images, approval cards, edits, reactions and replies where web has them. Split it into files under 400 lines each (for example `src/data/messages/<thread>.ts`) plus small builders in `src/data/builders.ts` for the voice and image helpers.
2. **`src/http/search.ts`:** the contract's message search (`packages/api-contract/src/search.ts`), answered from the seed, with the same rules as web's `searchMessages` (the query length 2–100, matching and snippets). Register it in `src/http.ts`.
3. **No app file changes, no tests** (Julio's rule). Prove it in the Report with a throwaway script: the message count per thread, one `search` query and its response decoded with the contract schema.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/**`, `apps/web/src/mock/messages.ts`, `apps/web/src/mock/helpers.ts`, `apps/web/src/mock/api.ts:3054-3066` and `:4152-4297`, `packages/xmpp-core/src/types.ts`, `packages/api-contract/src/search.ts`.

### Allowed files
`packages/mock-backend/**`, `work/T-0939-mock-backend-messages-search.md`.

T-0940 and T-0941 add other routes to the same package in parallel. Register your route in `src/http.ts` with a single line, to keep the merge simple.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the counts and the decoded search response.

---

## Report (written by the worker when done)

**Status: done (task B). Every check passes; only `packages/mock-backend` and this task file changed.**

### What I built

1. **The full message seed, re-expressed as fake-XMPP records.** Every thread in
   web `apps/web/src/mock/messages.ts` (all 12 chats, 121 bubbles) is now in
   `src/data/messages/<thread>.ts`, one file per thread, keyed by bare chat JID
   in `src/data/messages/index.ts`. Each record is the shape the fake XMPP
   emits: the content a `ChatMessage` event carries (`body`, `payload`,
   `forward`, `replyTo`, `mentions`) plus the archive stanzas that produce the
   rest — a XEP-0444 `reactions` record per reactor, a XEP-0308 `correction`
   for each edited message, a XEP-0424 `retraction` for each deleted one. That
   is why the record counts are higher than web's bubble counts. `createSeed`
   fills `chatJid`, `kind`, `fromJid`-derived `outgoing`/`fromResolved` and the
   relative `timestamp`, so `MockMessage` is now `ChatMessage`
   (`packages/xmpp-core/src/types.ts`).
2. **`src/data/builders.ts`** — the voice/waveform, inline-SVG image, file,
   progress-card and approval-card builders (web's `mock/helpers.ts`): voice and
   images are real protocol `Payload`s (`voice`, `attachment kind:'image'`), and
   the approval card is the same `approval.request` payload.
3. **`src/http/search.ts`** — `GET /search` answered from the seed, with web's
   rules: trimmed query 2–100 chars (else 400 `invalid_request`), case-
   insensitive substring match over text bodies only (reaction/correction/
   retraction stanzas and body-less deleted messages are not searchable),
   newest first, one code-point mark per hit, `limit` default 20 / clamp 1–50.
   The cursor is the contract's epoch-ms `before`; `nextBefore` is the oldest
   returned timestamp in ms (like the real server, `search/routes.ts:517`).
   Registered in `src/http.ts` with one import and one route entry.

Files (all under 400 lines): `data/builders.ts` (112),
`data/messages/{shared,index,ana,acme,dev-ai,dev-team,familia,gym,luis,marketing-ai,marta,product,qa,viernes}.ts`
(9–92), `data/index.ts` (68), `http/search.ts` (146), `http.ts` (47, +2 lines);
`data/messages.ts` deleted; `tsconfig.json` includes
`../xmpp-core/src/types/xmpp.d.ts` (the same `include` the other packages that
import `@zilar/xmpp-core` use, so its source typechecks).

### Seed counts (records per thread, incl. stanzas)

```
threads: 12
ana@zilar.test: 34            acme@rooms.zilar.test: 1
dev-team@rooms.zilar.test: 32 viernes@rooms.zilar.test: 38
dev-1@ai.zilar.test: 7        marta@zilar.test: 3
familia@rooms.zilar.test: 7   qa@rooms.zilar.test: 5
luis@zilar.test: 3            marketing@ai.zilar.test: 4
gym@rooms.zilar.test: 3       product@rooms.zilar.test: 2
payloads: 15, invalid: 0      (each validated with PayloadSchema)
```

121 bubbles + 17 stanzas (6 reaction, 6 reaction for vie/ana-21, 3 correction,
4 retraction — see files) = 138 records. Web's per-thread bubble counts are
28/1/32/27/7/3/7/5/3/4/3/2.

### Throwaway proof (scratch file, not committed)

Run with `pnpm --filter @zilar/devtools exec tsx <abs path>`, decoding the
response with the contract's `SearchPage` via `@zilar/protocol`'s
`decodeOrThrow`:

```
GET /api/search?q=coffee -> 200
{ "items": [
  { "chatJid":"ana@zilar.test","messageId":"ana-22","senderName":"You",
    "at":"2026-10-10T12:30:00.000Z","snippet":"Coffee at 6:30 then","marks":[[0,6]] },
  { "chatJid":"ana@zilar.test","messageId":"ana-14","senderName":"Ana",
    "at":"2026-10-10T08:15:00.000Z","snippet":"Do you want to grab coffee before?",
    "marks":[[20,26]] } ] }

GET /api/search?q=coffee&limit=1 -> 200
{ "items": [ { "messageId":"ana-22", ... } ], "nextBefore":"1791635400000" }

GET /api/search?q=tickets&chat=ana%40zilar.test -> 200
  items: ana-11 ("Found the tickets in my bag 😄", marks [[10,17]]),
         ana-2  ("Yes! I got the tickets 🎉", marks [[15,22]])
  (the 'Tickets' image and the tickets.pdf file have no body, so they are not hits)

GET /api/search?q=a -> 400 {"error":{"code":"invalid_request","message":"Invalid search query"}}
```

### Commands and real results

- `pnpm install` — "Done in 12s using pnpm v10.32.1" (no lockfile change).
- `pnpm --filter @zilar/mock-backend typecheck` — clean (`tsc --noEmit`, no
  output). Before the `tsconfig.json` include it failed only inside
  `@zilar/xmpp-core` (`@xmpp/client` had no declarations), which the include
  fixes.
- Single test files: none run — `packages/mock-backend` has no test files
  (Julio's "no tests" rule in the spec), so there is nothing to run in
  isolation.
- `pnpm gate` — summary lines:

  ```
  gate: 21 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.9s)
  PASS  effect  (1.1s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes for the reviewer

- **Web's `image` field became an `attachment` payload.** `ChatMessage` has no
  image field and the protocol has no `image` payload, so the three web images
  (`ana-10`, `vie-7`, `dev-12`) and the two attachment images are
  `attachment kind:'image'` payloads with the same SVG `url` and 640×420 the web
  seed used. Voice and the cards are likewise the real protocol payloads.
- **`c-acme` has one message**, exactly like web (`acme-1`). The old subset had
  invented `acme-2`/`acme-3`, which are not in web and are gone.
- **The forward in `ana-3`** now names the unified room JID
  (`viernes@rooms.zilar.test`) instead of web's mock id
  (`c-viernes@conference.zilar.test`), per the plan's Q2 ("the ids may change").
- **The `mentions` JID in `dev-31`** is `you@zilar.test` (web used the client
  id `u-you@zilar.test`); the displayed range (0–4, `@You`) is unchanged.
- **The search cursor is epoch-ms**, unlike web's mock which returned an ISO
  `nextBefore` (and would not round-trip through the contract's numeric
  `before`). This follows the contract and the real server.
- Login/paging against the seed over XMPP (F2) is not part of this task; the
  records are the `ChatMessage`s F2 will emit.
- No app file, dependency or test changed. No secrets; the security checklist
  has no new surface here (in-memory read-only seed and one read route).

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 5 nits.**
- **The seed:** 139 message records across all 12 threads, split into per-thread files with `data/builders.ts`.
- **Search:** `/search` ports web's rules.
- **Size:** 881 lines added and 135 removed, with no file over 146, and only the package changed.
- **Nits:** the count typos in the Report, plus minor polish.
- **Check:** the gate passed. It merges after T-0941, with a "keep both sides" step on `data/index.ts` and `http.ts`.
