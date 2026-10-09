# Simplify and speed-up plan (2026-10-09)

Julio asked: "before testing by me, run a deep deep deep analysis, can we reduce the code? do you see duplicated code? can we simplify? can we use other system that is more performant and clear, etc".

This is the lead's synthesis of nine read-only audits:

| Report | Area | Model |
| --- | --- | --- |
| A | web vs mobile | Opus |
| B | API contract | Opus |
| C | server | Sonnet |
| D | web app | Sonnet |
| E | mobile app | Sonnet |
| F | tests | Sonnet |
| G | dead code and clones, measured with knip and jscpd | Sonnet |
| H | tooling, CI and Docker | Sonnet |
| I | shared packages | Sonnet |

The full reports, with every `file:line`, are in `docs/audit/simplify-2026-10-09/`. Each finding below names its report, so `A-F1` is report A, finding F1.

## 0. Bottom line

- **Size:** about 200k source lines and 195k test lines. About **18-20k source lines (9-10%)** and **7-10k test lines** can go without losing behaviour. Most of it comes from three root causes, not from scattered dead code; confirmed dead code is only about 300 lines.
- **Real bugs:** the duplication has already caused bugs users can see. Mobile never marks AI chats as AI, so there is no AI badge and no "writing…" line, and a few other behaviours drift between web and mobile.
- **Performance:**
  - On both web and mobile, every chat row and every message re-renders on every store change, AI tokens included, and no list is virtualised.
  - The web ships one 416 KB gzip bundle that includes the mock backend.
  - The server checks the session in the database on every request, and runs 4 user-facing lists as N+1 queries.
  - CI takes 11 minutes, 10 of them for server tests.
- **What should stay:** xmpp.js, Effect, the HttpApi server, packages consumed as TS source, the UI kit, PGlite in tests, and the stores' `StoreApi` contract.

## 1. Verified by the lead (not just reported)

| Claim | Check |
| --- | --- |
| Mobile AI chats are never marked as AI | `apps/mobile/src/store/real-store.ts:168` sets `isAI: false`. Web reads `entry.isAi` (`apps/web/src/store/effects/chatRows.ts:57`). Mobile UI reads `chat.isAI` in 6 places (`chat-header.tsx:55,57,86,101`, `topic-row.tsx`, `chat-list-item.tsx`). |
| Failed mobile text send stays "sending" | `apps/mobile/src/store/effects/send.ts:364` says so by design ("a reconnect can resend later"). Web marks it Not sent with Retry and a 60 s timeout. |
| Web subscribes to the whole store | `apps/web/src/store/ChatStoreProvider.tsx:49-50`, `useAtomValue(useChatStoreApi().atom)` with no selector. |
| Mobile renders every loaded message | `apps/mobile/src/components/chat/message-list.tsx:289`, `initialNumToRender={Math.max(entries.length, 1)}`. |
| No session cookie cache | No `cookieCache` in `apps/server/src/auth/auth.ts`. |
| Missing indexes | The membership tables have composite PKs led by `group_id`/`topic_id` (drizzle SQL), so a lookup by `user_id` or `ai_id` alone has no index. |
| Git proxy is not mounted | Nothing outside tests imports `apps/server/src/git/*`. G and B are right; C was not. |

Not yet verified by the lead: render costs (no profiler run), the N+1 counts, the server bundle startup numbers (H measured them locally, but parity is unverified), and Hermes `TextDecoder` on Android.

## 2. The root causes

1. **The chat client is written twice.**
   - 286 functions in web and mobile are at least 60% alike, and 64 store functions are verbatim copies (A).
   - `chat-core` is only 1.6k lines, so every rule (mentions, edits, reactions, forwarding, sorting, money format, debounce) exists twice and drifts apart.
2. **The API contract is locked inside the server.**
   - The server already declares 157 `HttpApiEndpoint`s, but it sits next to handlers and server imports. So web rewrites it in `lib/api.ts` (2.7k lines) and mobile in 25 `*-api.ts` (8k lines).
   - Shapes are written 3 to 6 times (`Me` 6 times, `GroupDetail` 5), and mobile copies the whole transport 25 times (B, E).
3. **Server services are `async` functions wrapped in Effect.**
   - This is where most of the server boilerplate comes from: 56 identical `runSql` copies, 417 `Effect.promise` hops, `HttpError` thrown as a defect, 196 envelope wrappers, 25 schema-error layers, about 20 rate-limit layers, and 157 hand-written route manifests (C, B).
4. **Whole-store subscriptions, plus the mock in production.** Both apps re-render everything on every change. Both bundle the mock backend because the mock switch is a runtime check (A, D, E).
5. **Test infrastructure is copied per file.**
   - Copies: 38 `seedAi`, 15 `seedGroup`, 8 `fakeCore`, about 25 `fakeApi`, 80 `jsonResponse`, and more than 40 flush helpers, which caused today's red CI (T-0842).
   - Speed: the DB snapshot is rebuilt per file (F).

## 3. The programme, in order

Each item is task-sized and keeps the existing tests as its safety net. "Lines" means source lines removed unless it says tests.

### Phase 0: bugs and cheap performance (1-2 days, low risk; before Julio's live test)

| # | What | Report | Lines / gain | Risk |
| --- | --- | --- | --- | --- |
| 0.1 | Mobile marks AI chats as AI (`isAi` from the roster, as web does) | A-F1a | bug | low |
| 0.2 | Align the other drift: pinned topics first on mobile, one money format, one search debounce. Failed send on mobile is Julio's call (D-1). | A-F1 | bugs | low |
| 0.3 | Web store selector hook (`useChatStore(selector)`; `useAtomValue` takes one) and `memo` on `MessageBubble` and `ChatListItem` | A-F2, D-W2 | re-renders | low |
| 0.4 | Mobile message list: real windowing (no `initialNumToRender` = all), memoised bubbles, the AI draft out of the list entries | E-F2 | the biggest runtime cost | medium |
| 0.5 | Mock backend out of the production bundles (build-time flag or alias), web and mobile | D-W1, E-F3, G-F6 | web −112 KB min (8%), mobile −5k lines in the bundle | low |
| 0.6 | One migration: indexes on `group_members(user_id)`, `topic_members(user_id)`, `topic_ais(ai_id)`, `group_ais(ai_id)`, `group_member_roles(user_id)` and `lower(xmpp_accounts.jid)` | C-F9 | lookup speed | low; one schema task |
| 0.7 | Fix the 4 N+1 lists: tools, topic views, approvals `canDecide`, sticker discover | C-F8 | queries per page | low-medium |
| 0.8 | Mobile fonts: bundle only the 5 used faces and drop the unused Material Symbols font | E-F5 | −4.4 MB of assets | low |

### Phase 1: deletions (1 day; some need Julio)

| # | What | Report | Lines |
| --- | --- | --- | --- |
| 1.1 | Confirmed dead files and 41 unreferenced declarations; drop `export` on the 756 file-local exports | G-F1, G-F2 | about 300 |
| 1.2 | Dead light theme in the dark-only mobile app (155 `[scheme]` lookups) | E-F4 | about 400 |
| 1.3 | `apps/server/drizzle/meta/` (3.7 MB of snapshots nothing reads; check the migrator reads only `*.sql`) and 66 stale drizzle comments | G-F7 | 3.7 MB |
| 1.4 | Julio decides: `packages/agent-drivers` (no importers), the unmounted git proxy, the unused `effect/runtime.ts` and `logger.ts` | I-F4, G-F3 | about 2.9k with tests |
| 1.5 | Julio decides: the OpenCode-era lead code in devtools (autopilot, sessions, model schedule) | H-F7 | about 11.8k with tests |

### Phase 2: server boilerplate (3-4 days, low-medium risk)

| # | What | Report | Lines |
| --- | --- | --- | --- |
| 2.1 | One shared `runSql` | C-F1 | about 390 |
| 2.2 | One schema-error middleware instead of 25 | C-F2, B-B4 | about 420 |
| 2.3 | Rate-limit middleware factory | C-F3 | about 450 |
| 2.4 | One `authed`/`handle` helper with typed errors, replacing `withErrorEnvelope` + `requestIdOf` ×196 and `HttpError` thrown as a defect | C-F4, B-B4 | about 900 |
| 2.5 | Derive route manifests from the HttpApi (`HttpApi.reflect` exists in 4.0.2) | C-F5, B-B2 | about 300 |
| 2.6 | One `groups/access.ts` for membership and role checks (41 copies of `FROM group_members`) | C-F10 | clarity and safety |
| 2.7 | Small duplicates: crypto envelope ×3, `errorName` ×7, `isUniqueViolation` ×6, `bareJid` ×5 (into `protocol`) | C-F14, I-F5 | about 300 |
| 2.8 | Error codes as constructors (`xmpp_unavailable` is 502 in 9 places and 503 in 21; `pin_limit` 400 vs `too_many_pins` 409) | B-B7 | consistency |

### Phase 3: one API contract (5-7 days, medium risk; the largest code cut)

| # | What | Report | Lines |
| --- | --- | --- | --- |
| 3.1 | Make the server contract truthful: 14 handlers send 201 while declaring 200, 7 declare `Void` but send 204, and 33 of 68 writes declare no payload. Precondition for derived clients. | B-B1 | - |
| 3.2 | A `TextDecoder` polyfill for Hermes (the derived client decodes every body with it; B checked the iOS binary) | B-B6 | - |
| 3.3 | `packages/api-contract`: the schemas, groups, error envelope and middleware tags, imported by the server, with clients derived by `HttpApiClient`. Migrate group by group, keeping the current exported client functions as thin facades so screens and tests do not change. B proved it end to end in a prototype (`b-api/proto.mjs`). | B-B3 | about 9.5k (mobile 6k, web 2k, server 1.5k), plus 2-2.5k test lines; web bundle +15 KB gzip once |
| 3.4 | One mobile transport and one error class (falls out of 3.3) | B-B5, E-F1 | included above |

### Phase 4: one client core (6-8 days, medium risk; fixes drift for good)

| # | What | Report | Lines |
| --- | --- | --- | --- |
| 4.1 | Verbatim pure helpers into `chat-core`: the message ledger (ids, edits, reactions, mentions), forwarding, folders (the server copy too), handle rules ×3, JID helpers | A-F3, I-F5, I-F6, I-F7, G-F4 | about 1.2k |
| 4.2 | Shared React and Effect glue: `use-action`, `atomStore`, `chatPrefs`, routines, AI limits and templates | A-F4, G-F4 | about 0.3-0.5k |
| 4.3 | A platform-free store core in `packages/client-core`, behind ports for the API, XMPP, bytes, voice, storage, visibility, drafts and navigation. The current `StoreApi` and `createRealChatStore(deps)` stay, so the 16k lines of store tests guard it. | A-F6 | about 5k |
| 4.4 | Optional: the mock stores rebuilt on the core | A-F7, E-F6 | about 1.5-2.5k |

### Phase 5: tests and CI (2-3 days, low risk)

| # | What | Report | Gain |
| --- | --- | --- | --- |
| 5.1 | Build the migrated DB snapshot once per run (`globalSetup`), not once per file | F-F1 | 5-10% of server test CPU (unmeasured) |
| 5.2 | Shard the server tests in CI (3 shards) | H-F1 | CI about 11 → 5 min |
| 5.3 | Cut the slow loop tests: 600 real requests for a 429, 200 sticker uploads | F-F2, H-F2 | 100-150 CPU-s |
| 5.4 | Shared seeds and fakes: a server `test-seed.ts`, one `createFakeXmppCore()`, store fakes, native-module mocks in setup files | F-F4/5/6, I-F1 | 5-7k test lines |
| 5.5 | One `flush`/`waitFor`/`jsonResponse` per package, and a lint rule against `setTimeout(resolve, 0)` | F-F8 | stops the T-0842 class of flake |
| 5.6 | Replace the 9 brittle source-pinning tests with behaviour tests | F-F7 | unblocks refactors |
| 5.7 | Split `agents/gateway.test.ts` (7.2k lines, 100 s) around its harness | F-F3 | parallelism |

### Phase 6: build and runtime (2-3 days)

| # | What | Report | Gain |
| --- | --- | --- | --- |
| 6.1 | Web code splitting: lazy settings routes, the markdown stack, login | D-W3 | first load 416 → about 250-280 KB gzip |
| 6.2 | Bundle the server with esbuild instead of running `tsx` in production | H-F3 | start CPU about 3.5 → 0.9 s, RSS 289 → about 180 MB (local, parity unverified); smaller image |
| 6.3 | PGlite lazy-imported, so it moves to devDependencies | H-F5 | −25 MB image |
| 6.4 | Dockerfile layer order and one server build per workflow | H-F4 | merge-to-live 15 → about 8 min |
| 6.5 | `effect` version aligned (`^4.0.2` everywhere), plus a pnpm catalog | G-F9 | hygiene |

### Totals (overlaps between reports removed)

| Bucket | Source lines | Test lines |
| --- | ---: | ---: |
| Contract and transport (3) | about 9.5k | about 2-2.5k |
| Client core (4) | about 6.5-9k | some |
| Server boilerplate (2) | about 2.8k | - |
| Deletions (1), without devtools | about 1.5k | about 1.5k |
| Shared test infrastructure (5) | - | about 5-7k |
| **Total** | **about 18-20k (9-10%)** | **about 7-10k** |

The devtools removal (1.5) would add about 5.5k source and 6.3k test lines.

## 4. Looked at and kept

- **xmpp.js:** stream management is a 98-line fix that works, so a custom client is not worth the risk (I).
- **`core-effect.ts`:** it is a 1,207-line mutable closure, but rewriting it is high risk for little gain. Cover it with tests instead (I-F8).
- **X8 in its full form:** moving events onto Streams would deliver them a tick late, and the stores rely on synchronous `on()`. A narrow X8 (methods become Effects, `on()` stays) is fine after 5.4. The facade itself is only 42 lines (I-F2).
- **Splitting the store state into many atoms:** the store tests rely on read-after-set. A selector hook gets the performance gain without it (A).
- **The rest:** the UI kit (well adopted), PGlite in tests, TS-source packages with no build step, the `zilar-whistle` native module, the mobile polyfills, and TypeScript 7 (`tsc` already takes 2.5-4 s, so the tsgo spike is moot).

## 5. Decisions for Julio

**Decided 2026-10-09 (Julio):**
- **D-4:** everything first, and Julio tests once at the end.
- **D-2 and D-5:** delete `packages/agent-drivers`, the unmounted git proxy and the unused xmpp `events.*` Streams. Keep the devtools lead code.
- **D-1:** keep today's mobile behaviour (a failed send stays "sending" until a reconnect).
- **D-3:** turn on the better-auth session cookie cache for 5 minutes.

The questions as they were asked:

- **D-1, failed text send on mobile:** keep "sending" until a reconnect, or show "Not sent" + Retry after 60 s as web does?
- **D-2, deletions:**
  - `packages/agent-drivers` (no importers);
  - the unmounted git proxy;
  - the OpenCode-era devtools code (about 11.8k lines). The work now runs on Claude subagents, and CLAUDE.md still says to start the autopilot.
- **D-3, session cookie cache in better-auth** (C-F7): it saves at least 2 DB queries per request, but a revoked session stays valid until the cache expires (minutes). It is an auth change.
- **D-4, order relative to your live test:**
  - **Recommended:** run Phases 0 to 2 now. They are low risk and behaviour-preserving, plus the bug fixes. Then you test live and deploy. Phases 3 and 4 come after, so a regression stays easy to place.
  - **Alternative:** do everything first and test once at the end, which is a larger blast radius.
- **D-5, the `events.*` Streams in xmpp-core:** nothing outside xmpp-core uses them (10 unbounded PubSubs per connection). Delete them, or keep them for X8?
