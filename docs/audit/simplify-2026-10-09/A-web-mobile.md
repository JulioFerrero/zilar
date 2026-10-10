# Audit A: web and mobile duplication, and what to share

Auditor scope: `apps/web/src` vs `apps/mobile/src` (stores, API clients, lib helpers, hooks, component logic), `packages/chat-core`. Read-only; scripts and raw outputs are in the scratch `audit/` dir (`dupscan.mjs`, `fnmatch.mjs`, `union.mjs`, `intra.mjs`, `dup-*.txt`, `fn-*.txt`).

## 1. Summary

- **Most of the duplication is one engine written twice.** 286 functions with the same name are at least 60% alike token for token (4,240 web lines and 4,489 mobile lines). 127 of them are at least 95% alike. In the stores alone, 64 functions (about 760 lines a side) are verbatim copies: the id-alias, edit, reaction and mention "message ledger". In both apps, 35 of the web store's 43 kernel helpers have a twin with the same name.
- **The copies have already drifted, and the drift causes user-visible bugs.** Each was checked by reading the code, none on a device. (a) The mobile real store never marks AI DMs as AI: `isAI: false` at `apps/mobile/src/store/real-store.ts:168`, while web reads `entry.isAi` at `apps/web/src/store/effects/chatRows.ts:57` (since T-0033, 2026-09-28). (b) A failed mobile text send stays "sending" forever (`apps/mobile/src/store/effects/send.ts:364`). Web marks it Not sent with a reason, a Retry and a 60 s timeout (`apps/web/src/store/effects/send.ts:74-95`). (c) Pinned topics float to the top on web (`apps/web/src/store/store.ts:552`) but not on mobile (`apps/mobile/src/lib/topics.ts:136`). (d) Money shows as "€0.02" on web and "EUR 0.02" on mobile. (e) Search debounce is 250 ms on web and 300 ms on mobile.
- **Every web chat component re-renders on every store update.** On web, `useChatStore()` returns the whole state atom with no selector (`apps/web/src/store/ChatStoreProvider.tsx:49-50`). It has 34 call sites, including one per `MessageBubble` (`MessageBubble.tsx:239`, which reads 3 fields) and one per `ChatListItem`. Mobile already uses a selector hook (`chat-store-provider.tsx:76`). Fixing this is S effort; the gain should be measured with the React Profiler (UNVERIFIED).
- **The wire contract exists three times.** The server declares 157 `HttpApiEndpoint`s, 153 of them with `success` schemas. Web re-declares them in `lib/api.ts` (2,690 lines) and mobile again in 25 `*-api.ts` files (7,985 lines). Example: Pin at `apps/server/src/pins/api.ts:96`, `apps/web/src/lib/api.ts:1021` and `apps/mobile/src/lib/pins-api.ts:23,85`. Mobile also copies the same transport code into every file: 25 of 25 files have their own tagged errors, `requestEffect` and `catchTags`, and 43% of mobile API code lines repeat in 10 or more sibling files. `HttpApiClient` is used nowhere.
- **Recommendation.** Grow `chat-core` with the pure helpers (about 1.2k lines removed). Add a new `packages/client-core` with: (1) shared wire schemas and one transport with an auth port (about 7k lines removed); (2) a platform-free store core behind ports for API, XMPP, bytes, voice, storage, visibility, draft stream and navigation (about 5k lines removed); (3) the React and Effect glue (about 0.3k lines removed). That is about 13k of the 114k app lines. Every step keeps the current `createRealChatStore(deps)` and `StoreApi` facades, so the 16k lines of store tests stay as the safety net.
- **On `@effect/atom`:** keep the current `StoreApi` (one writable atom with synchronous get and set) as the core contract, and add one shared selector hook. Splitting the state into many atoms is not justified now (section 3, F6).

## 2. Measurements

| What | Command / method | Result |
|---|---|---|
| App source size | `find … ! -name '*.test.*' \| xargs cat \| wc -l` | web 50,841; mobile 63,505; chat-core 1,578 |
| Real stores (no mocks) | `realStore.ts + effects/*.ts + chatListCache.ts` vs `real-store.ts + effects/*.ts` | web 6,523; mobile 5,452 |
| Mock stores | `wc -l mockStore.ts chat-store.ts` | 1,294 + 1,595 (plus mock dirs 6,308 + 2,973) |
| API clients | `wc -l` | web `lib/api.ts` 2,690 (181 functions, 99 types); mobile 25 `*-api.ts` = 7,985 |
| Exact cross-app copies (5-line windows, normalized whitespace, no comments/imports/brace lines) | `dupscan.mjs 5 exact` | 2,180 of 27,165 web code lines (8.0%); web store 945 of 4,911 (19%); mobile `real-store.ts` 615 of 1,070 |
| Renamed copies (identifiers/strings masked) | `dupscan.mjs 5 fuzzy` | web 17.6%, mobile 16.5%; store 1,293 of 4,911 web lines. Components are noisy (JSX boilerplate, data tables), so I do not rely on them |
| Same-name functions, token LCS ratio | `fnmatch.mjs` (TS AST, 1,520 web fns vs 2,144 mobile fns), union of line ranges | ≥0.6: 286 pairs, 4,240 / 4,489 lines (store 2,356 / 2,431; lib 721 / 814; components+routes 773 / 828; mock 309 / 343). ≥0.8: 2,652 / 2,637 lines. ≥0.95: 127 pairs (store 64 = 761 lines; non-store 56 = 598 lines) |
| Store kernel overlap | names in `Kernel` (`web effects/ctx.ts:26`) vs `StoreHelpers` (`mobile effects/runtime.ts:156`) | 35 of 43 web helpers exist by name on mobile |
| Store surface overlap | members of `ChatStore` (`web store.ts:90`) vs `ChatStoreState` (`mobile types.ts:150`) | 62 common, 39 web-only, 44 mobile-only. Many are the same thing under another name (`chatsState`/`chatsLoad`, `historyState`/`historyLoad`, `groupInfo`/`groupDetail`, `refreshChats`/`reloadChats`, `setMuted`+`setPinned`+`setArchived`/`setChatPref`) |
| Mobile API transport copies | `grep -l` per pattern over `apps/mobile/src/lib/*-api.ts` | `NetworkError`/`RequestError`/`InvalidResponse` classes, `` authorization: `Bearer`` and `catchTags`: 25 of 25 files; `requestEffect`: 24; `withTokenEffect`: 21 |
| Boilerplate inside mobile API | `intra.mjs 10` (4-line fuzzy windows found in ≥10 other files) | 2,171 of 5,046 code lines (43%) |
| Endpoints used by both clients | path literals, `${…}` → `:p` | 70 shared path templates (web 83 found, mobile 114) |
| Server contract | `grep -c` over the 37 `apps/server/src/**/api.ts` | 157 endpoints, 153 `success:` schemas; `HttpApiClient` users: 0 |
| User-facing sentences | `'Capitalised … .'` literals ≥14 chars, non-test, non-mock | web 187, mobile 265, **114 identical**; near-misses such as "Could not archive the topic." vs "… Try again." |
| Store tests | `wc -l` | web 6,854, mobile 9,394; 40 identical test titles (lower bound) |
| Where mobile came from | `grep -riE "mirrors? web\|like web\|web's\|apps/web/src"` in mobile non-test | 163 comments in 97 files point at web as the source; web never points at mobile |
| Task history | `grep -l '^title: "?(mobile\|Mobile)' work/T-*.md` | 149 of 839 tasks are mobile tasks; pairs such as T-0061 (web edits) → T-0078 and T-0085 (mobile edits), T-0835 / T-0836 (the two Effect store conversions) |
| Store hook usage | `grep -c "useChatStore()"` | web 34 whole-state calls in 31 files; mobile 147 selector calls, 0 whole-state |

## 3. Findings (ranked by value / effort)

### F1. Drift bugs that come from the copies: fix them now (S each)

| # | Behaviour | Web | Mobile | Evidence |
|---|---|---|---|---|
| a | AI DM flagged from `/api/chats` | `isAI: entry.isAi === true` | always `isAI: false`; `ChatEntry` has no `isAi` field | `web effects/chatRows.ts:57`, `web lib/api.ts:80`; `mobile real-store.ts:168`, `mobile lib/chat-api.ts:26`. Mobile UI reads `isAI` in 10 places, so the AI subtitle and badges only show in the mock |
| b | Text send fails visibly | `markSendFailed(..., 'timed_out')` after `SEND_TIMEOUT_MS = 60_000`; reason from `sendFailureReasonFor` | errors are swallowed (`orElse(..., undefined)`); the bubble stays `sending`. The comment says "a reconnect can resend later", but the store has no resend code (grep `'sending'` finds only the mock); whether XEP-0198 resends is UNVERIFIED | `web effects/send.ts:74-95,155-175`, `effects/constants.ts:16`; `mobile effects/send.ts:30-35,364-393` |
| c | Topic order in a group | pinned first, then General, then recency | General first, then recency; pins ignored | `web store.ts:552-571`; `mobile lib/topics.ts:136-147` |
| d | Money | `Intl.NumberFormat` currency ("€0.02") | `` `${currency} ${amount.toFixed(2)}` `` ("EUR 0.02") | `web lib/format.ts:29`; `mobile lib/chat.ts:29` |
| e | Message search | 250 ms debounce, no paging | 300 ms, cursor paging | `web lib/useMessageSearch.ts:8`; `mobile components/chat/message-search.ts:22` |
| f | Reverted edit | restores the first-seen text (`baseTextFor`) | no base-text map. Effect unclear: failed edits use `restoreMessage`, so the impact is UNVERIFIED | `web realStore.ts:431-437,576`; `mobile real-store.ts:670-680` |
| g | Contact / chat wire types | `Contact.handle`, group `visibility`, `handle`, `avatarUrl`, `background` | missing from `mobile lib/chat-api.ts:18-33`; mobile group rows never get `visibility`/`handle` (`real-store.ts:182-187`) | as cited |
| h | Unpin result | `Promise<void>` | `Promise<Pin>` (uses the echoed row) | `web effects/ports.ts:159`; `mobile lib/pins-api.ts:45` |
| i | Last read | persisted to `localStorage` per user | memory only (`mobile real-store.ts:242`) | `web effects/reads.ts:30-45` |

- **Impact.** Real defects, a/b/c above all, plus an inconsistent product. Each gap is the kind of thing the "port it to mobile" step leaves out.
- **Risk.** Low. Each fix has a nearby test (`real-store.test.ts`, `topics.test.ts`, `format.test.ts`). Fix b changes user-visible behaviour, so Julio checks it on the emulator.
- **Recommendation.** One small task each, done the shared way where it is cheap: for c and d, move the web function into chat-core and delete the mobile copy (see F3). For a, add `isAi` to the mobile `ChatEntry` and read it in `summaryFor`. Then fold the fix into F6. Ask Julio which side wins for b, d, e and i (section 5).

### F2. Web store subscription re-renders everything (S, perf)

- **Evidence.** `apps/web/src/store/ChatStoreProvider.tsx:49-50`: `useChatStore()` returns `useAtomValue(useChatStoreApi().atom)`, the whole state. There are 34 call sites, including `components/MessageBubble.tsx:239`, which reads only `mediaTrustedHosts`, `canPin` and `pinFor`, plus `ChatListItem.tsx:33`, `MessageList.tsx:41` and `Composer`. Every `set()` (typing, every draft-stream chunk, ticks, presence) re-renders every visible bubble and row; `memo` cannot stop a hook-driven render. Mobile solved this with `useSyncExternalStore(subscribe, () => selector(getState()))` (`apps/mobile/src/store/chat-store-provider.tsx:76-86`) and its selector-stability tests.
- **Impact.** Render cost during AI draft streaming and typing; likely the largest cheap web performance win in the chat view. Size UNVERIFIED: measure with the React Profiler during a streamed AI reply.
- **Risk.** Selectors that build new arrays or objects loop or over-render; mobile already learned this (`EMPTY_MESSAGES`, `real-store.ts:220`, and `selector-stability.test.ts`). Detect with a ported selector-stability test.
- **Recommendation.** Ship the selector hook (shared, see F4) and migrate the 34 call sites in 3-4 small tasks, `MessageBubble`, `ChatListItem` and `MessageList` first.

### F3. Verbatim pure helpers belong in chat-core (S-M, about 1.0-1.2k lines)

- **Evidence.** 56 non-store function pairs are at least 95% alike (598 / 600 lines). Examples:
  - `applyChatPrefs`, `mutedUntilFor`: `web lib/chatPrefs.ts:53,19` = `mobile lib/chat-prefs.ts:61,27`
  - routines formatting: `web lib/routines.ts:25-130` = `mobile lib/routines-format.ts:26-131`
  - `cleanFilename`, `formatFileSize`, `trustedMediaHosts`, `gifBlobType`: `web lib/attachments.ts:43,59,125,290` = `mobile lib/attachments.ts:64,80,122`, `lib/gifs.ts:40`
  - `sanitizeIncomingAttachment`: `web realStore.ts:128` = `mobile lib/attachments.ts:205`
  - `typingLabel`, `replyRef`, `formatLastSeen`, `chatSubtitle`: `web lib/format.ts` = `mobile lib/format.ts`, `lib/chat.ts`
  - AI form logic: `web components/ais/{limits,aiForm,templates,models,errors}.ts` = `mobile components/ais/{limits,form,templates,models,errors}.ts`, plus `activity-format.ts` (39 of 39 lines copied from `AiActivity.tsx`)
  - handles: `web lib/handles.ts:70,81` = `mobile components/settings/profile-logic.ts:133,168`
  - stickers and smooth text: `fitStickerSize`, `commonPrefixLength`, `safeCut`
  - the chat-list model: two different rule sets (`web store.ts:428-571` `visibleChats`/`groupChats` vs `mobile lib/chat-list.ts` + `filter.ts` + `topics.ts`)
  - 114 identical user-facing sentences.

  The root cause is spelled out in a mobile comment: "`chat-core` has no equivalent, so it stays mobile-specific" (`mobile lib/format.ts:31-33`). Copying was the default instead of adding to chat-core.
- **Impact.** About 1.0-1.2k lines removed (one side of each pair plus the duplicate unit tests), and one rule for each behaviour (fixes F1 c and d by construction).
- **Risk.** Low: these functions are pure, and the tests move with them. Watch name clashes in `chat-core/src/index.ts` (it re-exports with `export *`).
- **Recommendation.** 6 to 8 tasks by domain: format and money, attachments and media trust, chat prefs and the chat-list model, routines, AI form, handles, stickers and smooth text, and a `copy.ts` for the shared error sentences. Keep chat-core pure (no Effect services, no I/O), which matches its current role (`docs/audit/effect-100-plan.md:198-200`).

### F4. Shared React and Effect glue (S, about 0.3k lines)

- **Evidence.** `use-action.ts` and `use-query.ts` are identical except for the runtime name (`webAtomRuntime`/`mobileAtomRuntime`, diff = comments plus one identifier). Both runtimes are `FetchHttpClient.layer` (`lib/effect/runtime.ts:9-19` in both apps). `api-effect.ts` is identical. `errors.ts` differs only in how it recognises an API error. `atomStore.ts` is identical, with mobile adding `createBoundStore` (`mobile store/atomStore.ts:82-101`). The mobile files say "It mirrors `apps/web/src/lib/effect/use-action.ts` and has the same API" (`mobile use-action.ts:2`).
- **Recommendation.** Put `client-core/react` in a package: `createAtomStore`, `useStoreSelector(store, selector)`, `useAction`/`useQuery` taking the atom runtime as an argument, and `ApiFailure` built on the shared error from F5. Both apps use the same `@effect/atom-react` 4.0.2 and `effect` ^4.0.2 (`package.json:15,25` / `:16,28`), and RN already runs AtomRegistry, so there is no platform risk.

### F5. One wire contract and one transport (M-L, about 6-7k lines; about 10k with HttpApiClient)

- **Evidence.** There are three definitions of each response type (Pin: server `pins/api.ts:96`, web `api.ts:1021`, mobile `pins-api.ts:23` interface + `:85` schema). They drift (F1 g, h). Mobile has 25 copies of transport plus error classes (`pins-api.ts:48-209` is about 160 lines before the first endpoint), and 43% of the mobile API code lines are repeated. Web has one 2.7k-line monolith. Auth is the only real platform difference: cookie with `credentials: 'same-origin'` (`web api.ts:253-254`) vs bearer token from SecureStore (`mobile pins-api.ts:140`).
- **Root cause.** The server's HttpApi definitions live next to their handlers, together with pino, db and rate-limit imports (`apps/server/src/pins/api.ts:6-41`), so clients cannot import them. Each client wrote its own.
- **Recommendation.** Two stages:
  1. `client-core/api`: shared Schema definitions per domain (start from the web schemas: they are the most complete); one `makeHttp({ baseUrl, auth: CookieAuth | BearerAuth(getToken) })`; one `ApiError` with `{status, code, message, detail}`. Keep the per-domain module layout (mobile's split is the better structure) and the factory style `createPinsApi(http)` (good for tests). Migrate one domain per task: mobile file N becomes `export … from '@zilar/client-core/api/pins'` plus thin aliases, and web `api.ts` shrinks by the same domain. This is about 30 S tasks, each covered by the existing `*-api.test.ts` (mobile lib tests are 12.8k lines).
  2. Optional, later (L, touches the server): move each server endpoint *declaration* (schemas + `HttpApiEndpoint`/`HttpApiGroup`) into a shared package, with the handlers staying in `apps/server`, and generate clients with `HttpApiClient.make(api, { baseUrl, transformClient })` (exists in `effect/dist/http-api/HttpApiClient.d.ts:153`). This removes hand-written client code entirely, and server and client can no longer drift. Risks: error responses use the custom envelope (`withErrorEnvelope`), not declared `error` schemas, so client errors need a `transformClient` mapper. `AtomHttpApi` exists but is marked `@stability unstable` (`effect/dist/reactivity/AtomHttpApi.d.ts:9`), so do not build on it yet.
- **Risk.** Response leniency differs: mobile uses lenient decoders (`chat-api.ts` `LenientNullStringSchema`, `pins-api.ts` `LenientPinKindSchema`) and drops bad rows; web fails the call. Pick lenient for list rows, explicitly, and test it.

### F6. A platform-free store core (L, about 5k lines; the main prize)

**Evidence.**
- Same concern split on both sides: `effects/{lifecycle,polling,history,send,groups,pins}` exist in both; web adds `incoming`, `messageActions`, `prefs`, `reads` and `chatRows`, while mobile has `events`.
- Same kernel: 35 of 43 helpers share a name.
- Store functions at or above 0.6 similarity: about 2.4k lines a side. Examples: `withEdits` 0.89, `openHistory` 0.88, `editMessage` 0.92, `forwardMessages` 0.90, `sendText` 0.86, `loadOlderPage` 0.88, `deleteForEveryone` 0.89.
- At or above 0.95 similarity: about 760 lines a side, including the whole message ledger: `aliasRoot`, `linkMessageIds`, `migrateEditTargets`, `migrateReactionTargets`, `resolvePendingEdits`, `refreshEdits`, `refreshReactions`, `applyReactionUpdate`, `reactionChips`, `setChatMessage`, `updateMessageStatus`, `withReplyQuote`, `senderNameFor` (`web realStore.ts:290-1330` ↔ `mobile real-store.ts:373-1740`).
- The two conversions made different designs for the same job:
  - **Lifetimes.** Web uses store Scope plus session `Fibers` with `FiberSet`/`FiberMap` (`web effects/runtime.ts:59-118`). Mobile uses session plus generation Scopes with `Effect.forkIn` (`mobile effects/runtime.ts:94-118,284-302`).
  - **Typing.** Web uses a keyed fiber (`web effects/incoming.ts:184-196`). Mobile keeps a hand-kept `Map<chatId, Fiber>` (`mobile effects/events.ts:60-110`).
- Neither store uses `XmppCoreEffect`; both still call the Promise core (no import in either app).

**What the core holds** (from the web store, which is the more complete side, F1 b and f):

| Module | Content | Approx. lines |
|---|---|---|
| `ledger` | ids, aliases, origin ids, authors, base texts, edits, reactions, mentions, `withEdits`, previews | 700 |
| `rows` | `summariesFor`, `summaryForTopic`, sort, move-to-top, prefs merge, painted cache merge | 350 |
| `incoming` | message, typing, displayed, occupants, presence, invited, roster | 400 |
| `history` | first page, older pages, open-at-message, previews, waits | 500 |
| `send` | optimistic message, echo signatures, timeout and failure, retry, forward; bytes through a port | 650 |
| `actions` | edit, delete, react, typing | 200 |
| `groups` | groups, topics, channels, roles, invite links, members (union of both surfaces) | 900 |
| `pins`, `prefs`, `folders` | | 450 |
| `polling` | topics and pins polls, draft-stream events | 250 |
| `lifecycle` + `lifetime` | boot, reconnect with backoff, resume, sign-out; one Scope design | 500 |
| `ports` | the Ports service, live-layer helper, test layer | 200 |
| `state` | `ChatStoreState`, selectors (`historyStateFor`, `chatsListView`, `groupChats`) | 300 |

That is about 5.4k lines in core. App adapters stay small. **Web, about 0.7k:** ports for cookie API, `EventSource`, `document.visibilityState`, `localStorage`, `File`/`Blob` attachments and voice, push badge, `goToLogin`. **Mobile, about 0.9k:** bearer API, XHR SSE, `AppState`, `PickedFile` plus `statSize` plus upload progress and cancel, voice-native, async storage. The total goes from about 12k to about 7k lines, so about 5k are removed. Store tests can then collapse onto the core (40+ identical titles today; the saving is UNVERIFIED).

**Ports** (the platform seams that already exist, unified):

| Port | Web impl | Mobile impl |
|---|---|---|
| `Api` | F5 client, cookie | F5 client, bearer |
| `Xmpp` | `createXmppCore` | same |
| `OutgoingBytes` (classify, size, upload with progress, cancel) | `File` + canvas sizing (`lib/attachments.ts`) | `PickedFile` + expo-file-system (`lib/attachment-native.ts`) |
| `Voice` (convert, upload) | `lib/voice.ts` | `lib/voice.ts` + `voice-native.ts` |
| `KeyValue` | `localStorage` | async storage (an Effect-returning API covers both) |
| `Visibility` | `document` | `AppState` |
| `DraftStream` | `EventSource` | XHR bearer SSE; the event Schema itself moves to `protocol` (two hand-made copies today: `web lib/drafts.ts:4-17` vs `mobile lib/drafts.ts:23-115`) |
| `Notifications` | push dismiss and badge | expo |
| `Navigation` | `goToLogin` | router |
| `Clock` | `now` | `now` |

`UiMessage` needs an optional `upload?: { localUri; progress }` field, replacing mobile's cast-based `MobileMessage` (`mobile lib/types.ts`, `real-store.ts:690-705`).

**Migration, each step behind unchanged app facades** (`createRealChatStore(deps)`, `StoreApi`, every export), so the existing store tests are the net. Run `pnpm phone:smoke` on each mobile step. Use one worker per same-file chain.
1. Ledger: extract `createMessageLedger({ get, set })` from web, then switch mobile to it (2 tasks). This is the verbatim part, so the risk is lowest.
2. Rows, incoming and actions (2-3 tasks).
3. History and paging (2 tasks); the `openAtMessage` read-after-set hazard is already tested.
4. One lifetime: pick web's `Lifetime` (the FiberMap keyed runner is simpler than the manual typing map). 1 task per app; this is where reconnect risk sits, so Julio checks it live.
5. Send pipeline with the `OutgoingBytes` and `Voice` ports. Mobile gains the web timeout and failure semantics (F1 b; this changes behaviour).
6. Groups, topics, pins, prefs, folders and roles: needs F5 first.
7. State-name unification through selectors (`chatsLoad` ↔ `chatsState` …), then delete the aliases.

**Should the shared store use `@effect/atom` more?** No, not now. Keep the `StoreApi` contract (one `Atom.writable` in an `AtomRegistry`, synchronous `getState`/`setState`/`subscribe`) and add one selector hook. Reasons:
- The 16k lines of store tests and the documented hazards depend on synchronous read-after-set: "single-update draft tests, the synchronous read-after-set in `openAtMessage` and `react`, stable empty selectors" (`work/T-0836-mobile-store.md`, "Verified facts").
- The slice-by-slice atom split (W2-W10, M2-M6) was planned and explicitly superseded (`docs/audit/effect-100-plan.md:227`).
- A selector hook gives most of the render win (F2) at S cost.
- Revisit `Atom.family` per chat (`effect/dist/reactivity/Atom.d.ts:692`) only if the Profiler shows selector evaluation dominating with long histories.

**Risk.** High for steps 4-5 (connect, reconnect, send). Detect with the existing store suites run 3 times each, `phone:smoke`, and Julio's live check, as T-0836 did. The gate's scope check needs full paths in Allowed files for both apps and the package.

### F7. The mock stores duplicate the store again (M-L, optional, about 1.5-2.5k lines)

- **Evidence.** `web store/mockStore.ts` (1,294 lines) and `mobile store/chat-store.ts` (1,595 lines) re-implement send, sticker, voice and retry in memory (fuzzy pairs `sendSticker` 0.81, `mockMediaItems` 0.67). Web also mocks at the API layer (`lib/api.ts:4-5` imports `mockRequest`).
- **Recommendation.** After F6, the mock becomes "core + in-memory Api and Xmpp ports" in `client-core/testing`. Demos and tests then exercise the real logic. Do it last; demo fixtures stay per app.

### F8. Two Markdown engines (S-M, optional)

- **Evidence.** Web renders with `react-markdown` + `remark-gfm` (`apps/web/package.json:30,32`). Mobile has its own pure parser (`apps/mobile/src/lib/markdown.ts`, 410 lines, "the counterpart of the web's react-markdown safe subset"). Two sets of semantics for the same AI output.
- **Recommendation.** Move the mobile parser to chat-core and write a small DOM renderer on web. This gives one behaviour and drops two web dependencies; the bundle gain is UNVERIFIED and should be measured. Lower priority than F1-F6.

### Why the duplication exists (root causes)

1. **The workflow is web first, then port.** 149 of 839 tasks are mobile tasks, and 163 mobile comments name a web file as the source. A port copies the code as it was that day, and later web fixes do not flow over (F1).
2. **There is no home for stateful client logic.** chat-core is pure by rule, and no package exists for Effect plus ports code, so anything with I/O or state was copied.
3. **The contract is not exported.** Server schemas sit next to their handlers, so each client re-declared them.
4. **Parallel conversions.** T-0835 and T-0836 converted the same design on two branches with two workers, which produced two lifetime models.

The structure that makes this impossible: client logic lives once in `client-core` behind ports, apps hold only adapters and JSX, and the contract has one source.

## 4. Things that look bad but should stay

- **The UI trees (JSX) stay per platform.** Fuzzy matches in components (2,457 mobile lines) are mostly structural noise: View/Text vs div, sheets vs dialogs, gestures, haptics, keyboard. Share the logic beside them (F3), never the components.
- **Bytes, recording and on-device transcription.** `voice-native.ts`, the `whistle-*` files, `attachment-native.ts` and expo-file-system on mobile vs `MediaRecorder`, `Blob` and canvas on web. These are real platform differences; they become port implementations.
- **Push.** `apps/web/src/lib/push.ts` (service worker) vs expo notifications are different OS APIs.
- **Auth and session storage.** Cookie vs bearer token from SecureStore. Shared transport, separate `Auth` port.
- **SSE transport.** `EventSource` vs XHR with bearer and backoff (`mobile lib/drafts.ts`). Keep the transports and share the event Schema.
- **Routing and navigation.** react-router vs expo-router.
- **Mobile's per-domain API files and `createXApi(getToken, fetch, url)` factories.** This is the better layout; the shared client should copy it rather than web's monolith.
- **The single-atom `StoreApi`.** It looks like "zustand inside Effect", but it is the right platform-free contract today (F6).
- **chat-core staying pure.** Putting Effect services into it would blur the one rule that made its 60 web and 57 mobile importers safe. The new code goes in `client-core`.

## 5. Open questions for the owner

1. **Where the apps disagree, which side wins?** Mobile text sends failing after 60 s with Not sent + Retry (F1 b; the web rule). Pinned topics first (web). "€0.02" vs "EUR 0.02". 250 vs 300 ms search debounce, and paging on web. Should last-read survive an app restart on mobile?
2. **May the server's endpoint declarations move into a shared package** (37 `api.ts` files) so clients can be generated with `HttpApiClient`? Or should I stop at shared schemas plus one hand-written transport (F5 stage 1)?
3. **Package layout.** Should `client-core` (Effect, ports, store, api, react glue) be a new package next to a still-pure `chat-core`, or one package with subpaths?
4. **Pace.** Store-core steps 4-5 change mobile connect and send behaviour. Is one live check per step on web and the emulator acceptable, like T-0836?
5. **After the core lands, should the two mock stores be replaced** by core + in-memory ports (F7), or kept as standalone demo stores?
6. **Should mobile paint the cached chat list on cold start like web does** (needs an async storage port)?
