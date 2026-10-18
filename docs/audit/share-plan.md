# Share plan: web and phone twin logic (read-only)

T-2015, 2026-10-18. Input: `docs/audit/reduce-scan.md` §1 (clusters across `apps/web` and `apps/mobile`), §3 (non-UI logic pairs) and §4 (hand-rolled helpers). No code was changed.

How to read this:
- "web" is `apps/web/src`, "mobile" is `apps/mobile/src`, "chat-core" is `packages/chat-core/src`, "client-core" is `packages/client-core/src`.
- Line counts are `wc -l`. Every "net" figure is old lines in both apps minus new shared and adapter lines. These are conservative estimates, not measurements.
- Verdicts: **(a)** same logic, move it behind a small API with thin adapters. **(b)** partly the same. **(c)** different on purpose, keep both.
- chat-core has no `effect` and no `react` dependency (`packages/chat-core/package.json`). client-core has `effect` v4, `@effect/atom-react` and `react` as peers (`packages/client-core/package.json`). So pure functions go to chat-core, and Effect code or plain-`react` hooks go to client-core. Neither may import `react-dom` or `react-native`.

---

## 1. Summary

| § | Pair | Verdict | Net lines | Risk | Tests (Julio's rule) |
| --- | --- | --- | ---: | --- | --- |
| 2.1 | Composer drafts | (a) | ~95 | med | yes: no draft leak across accounts |
| 2.2 | Chat-list cache | (a), codec only | ~120 | low–med | yes: first paint |
| 2.3 | Offline message cache (cross-name twin) | (b), codec shared, I/O stays | ~200 | **high** | **yes: message pipeline**. Fixes a mobile bug |
| 2.4 | Draft stream (`lib/drafts.ts`) | (b), events and backoff shared, transport stays | ~65 | med | **yes: message pipeline** |
| 2.5 | People search | (a), prefix search | ~85 | low | no |
| 2.6 | Message search | (b), pure helpers now, controller later | ~40 (+~90 later) | low | no |
| 2.7 | Contact requests | (a) | ~40 | low | no |
| 2.8 | Delayed value + debounce | (a), one shared hook | ~55 | low | no |
| 2.9 | Client version (cross-name twin) | (a) | ~55 | low | no |
| 2.10 | API client | (c) transports; abortable call shared in 2.11 | 0 | — | — |
| 2.11 | Effect errors | (b) `toApiFailure` shared | ~40 | med | **yes: every API call, including auth** |
| 2.12 | `use-action` / `use-query` | already shared (`makeUseAction`, `makeUseQuery`); app files are runtime bindings | 0 | — | — |
| 2.13 | Person links | (a), and fixes drift | ~12 | low–med | yes: pure resolver |
| 2.14 | Format | (a), delete both shims | ~25 | low | no |
| 2.15 | Topics | (b), API and pure helpers | ~165 | med | yes: permissions (`mayCreateTopic`) |
| 2.16 | Groups | (b), API clients and `joinGroups` | ~170 | med–high | yes: permissions (roles, owner transfer, delete) |
| 2.17 | Smooth streaming text | (a) | ~210 | med | yes: pure reveal class |
| 2.18 | Media retry | (a), and fixes mobile drift | ~130 | med | yes: pure reducer |
| 2.19 | Attachments | (b), rules only | ~20 | med–high | **yes: upload path, SVG rule** |
| 2.20 | Stickers | (b), recents and URL check now, API later | ~45 (+~70 later) | low–med | yes: token-bearing URL check |
| 2.21 | Push badge | (b), close to (c) | ~2 | low | no |
| 2.22 | Auth | (c), except the invite header | ~6 | med | **yes: auth** |
| 2.23 | Voice convert (cross-name twin) | (b) | ~40 | **high** | **yes: message pipeline**. Likely mobile bug first |
| 3.1 | Markdown (mobile parser) | (b), one parser (mdast) in chat-core | ~300 | med | yes: AST mapper. **Needs Julio: new deps** |
| 3.2 | Hand-rolled helpers | swap to existing code | ~30 | low | no |
| 4 | Store adapters, 7 pairs | mostly wiring; ~5 real moves | ~200 | high (history, send, lifecycle) | **yes: message pipeline** |

**Total: about 2,150 net lines now, plus about 160 in the optional later steps.** The duplicated copies also hide behaviour drift and four likely bugs, listed in §6. Fixing those is worth more than the line count.

---

## 2. The non-UI pairs

### 2.1 Composer drafts — (a)
`apps/web/src/lib/composer-drafts.ts` (174) and `apps/mobile/src/lib/composer-drafts.ts` (260).

**The same on both sides:**
- Caps of 200 drafts and 4,000 characters (web:12-13, mobile:17-18).
- Decoding drops empty text, keeps the last 200 and truncates (web:60-63, mobile:93-98).
- Debounced persist that captures the user and a copy of the map, so an account switch still writes the old user's drafts (web:80-108, mobile:118-160).
- `scopeToUser` (web:113-122, mobile:169-177).
- `getDraft`, `setDraft` and `subscribe` (web:45-49,125-164, mobile:77-81,204-243).
- The `useSyncExternalStore` hook (web:167-174, mobile:246-253).
- jscpd clone: mobile:200-246 ↔ web:121-167.

**Platform-specific:**
- Storage: web uses synchronous `localStorage` with one key per user (web:26-34,51-75). Mobile uses one async JSON file read through `expo-file-system/legacy` (mobile:33-57,84-113).
- Mobile has to merge text typed while the file loads (`loadScopedDrafts`, mobile:185-201).

**Drift:**
- The write delay is 300 ms on web (web:14) and 500 ms on mobile (mobile:19).
- Mobile keeps drafts for every user who ever signed in, with no cap (mobile:65,134).

**Shared API:** `packages/client-core/src/composer-drafts.ts`
- `createComposerDrafts(storage: DraftStorage, opts?: { writeDelayMs?: number })` returns `{ getDraft, setDraft, subscribe, scopeToUser, hydrate }`.
- `useComposerDraft(drafts, userId, chatId?)`, using plain `react`.
- Adapter: `interface DraftStorage { load(userId): Map<string,string> | Promise<Map<string,string>>; save(userId, drafts): void }`. On web, `load` is synchronous.
- `apps/*/src/lib/composer-drafts.ts` stay as about 20-line (web) and 55-line (mobile) adapters, so their four importers do not change.

**Net:** web −150, mobile −190, shared +170, adapters +75 → **~95**.

### 2.2 Chat-list cache — (a), codec only
`apps/web/src/store/chatListCache.ts` (151) and `apps/mobile/src/lib/chat-list-cache.ts` (191).

**The same on both sides** (jscpd clones mobile:18-59 ↔ web:9-53 and mobile:161-181 ↔ web:118-138):
- Version and the 200-chat cap (web:10-11, mobile:19-20).
- Schemas copied byte for byte (web:15-48, mobile:24-57).
- `rehydrateDate` (web:53-59) and `parseCachedDate` (mobile:107-113) are the same function.
- Decode (web:74-107, mobile:128-150).
- Encode (web:121-139, mobile:164-182).

**Platform-specific:** web uses synchronous storage under `zilar:chatList` (web:9,70,139). Mobile writes an async file (mobile:18,64-100).

**Drift:** mobile always assigns `createdAt`/`pinnedAt`, even when the value is `undefined` (mobile:137-138). Web assigns them only when valid (web:88-95).

**Shared API:** `packages/client-core/src/store/chat-list-cache.ts` with `encodeChatListCache(userId, chats): string` and `decodeChatListCache(raw, userId?)`. Each app keeps its read/write/clear wrappers. Web's `StorageLike` becomes the core `KeyValue` (`packages/client-core/src/store/ports.ts:11-15`).

**Net:** web −115, mobile −110, shared +105 → **~120**.

### 2.3 Offline message cache — (b)
`apps/web/src/store/messageCache.ts` (306) and `apps/mobile/src/store/offline-cache.ts` (369), plus `apps/mobile/src/store/offline-cache-pins.ts` (53).

**The same on both sides:**
- Version, 50 messages per chat and the 2 s write delay (web:13,15,21, mobile:24,26,29).
- Schemas (web:25-46, mobile:66-89).
- `isCacheable` (web:69-73, mobile:107-111).
- `stripLocalFields` (web:76-88, mobile:114-131).
- Pin decoding (web:122-143 ↔ `offline-cache-pins.ts:31-53`).
- Encode and decode with the owner check (web:145-218, mobile:139-189).

**Platform-specific:**
- Local URL prefixes: `blob:`/`data:` on web (web:59-61), `file://`/`data:` on mobile (mobile:96-98).
- Web reads synchronously at `prepareStart` (`apps/web/src/store/effects/lifecycle.ts:179-196`) and caps the cache at 1.5 MB (web:18,264-293).
- Mobile uses an async ordered file queue (mobile:243-355).

**Drift and bugs:**
- **Bug (verified):** mobile encodes only `createdAt` (mobile:134-137) and decodes only `createdAt` (mobile:153-159). After a cold start, an edited message's `editedAt` is a string, while its type is `Date` (`packages/chat-core/src/types.ts:110`).
  - `formatTime` calls `date.getHours()` (`packages/chat-core/src/format.ts:18-19`), and `ledger-edits.ts:164` calls `editedAt?.getTime()`. Both would throw.
  - Web handles it (web:96, 103-112).
- Mobile keeps the open chat when it falls outside the chat cap (mobile:196-209); web does not.
- The chat cap is 30 on web and 50 on mobile (web:14, mobile:25). Partly on purpose, because of web's storage quota.

**Shared API:** `packages/client-core/src/store/message-cache.ts`
- `encodeMessageCache(snapshot, { localUrlPrefixes, maxBytes? })`
- `decodeMessageCache(raw, userId)`
- `selectCachedChats(chats, activeChatId, max)`

Delete `offline-cache-pins.ts`. Web keeps its synchronous `KeyValue` read; mobile keeps `createOfflineCache`.

**Net:** web −240, mobile −173, shared +210 → **~200**.

### 2.4 Draft stream (AI drafts) — (b)
`apps/web/src/lib/drafts.ts` (159) and `apps/mobile/src/lib/drafts.ts` (334).

**The same on both sides:**
- Event types are redefined in both apps (web:28-35, mobile:23-42), although client-core already exports them (`packages/client-core/src/store/ports.ts:87-102`, through `store/index.ts:21`).
- Event validation is the same contract, written as an effect `Schema` on web (web:14-26,58-73) and as a hand-written UUID regex on mobile (mobile:74-112).
- Backoff constants and jitter are identical (web:49-50,104-107, mobile:20-21,222-225).

**Platform-specific, on purpose:**
- Web uses `EventSource` with a cookie (web:38,142-149).
- Mobile uses XHR with its own SSE frame parser, a bearer token and `AppState` (mobile:115-150,197-216,251-301). React Native has no `EventSource` and its `fetch` does not stream (mobile:3-5).

**Drift:** web resets backoff on every frame (web:129,136); mobile resets it on the first bytes (mobile:283), which is better.

**Shared API:** `packages/client-core/src/store/draft-events.ts` with:
- `decodeDraftEvent(type, data): DraftHubEvent | undefined`
- `draftReconnectDelay(attempt, random, base = 1000, max = 30000): number`

Both apps import the types from `@zilar/client-core/store`. Library note: `Schedule.exponential` plus `Schedule.jittered` would change the jitter range, and the reset is event-driven, not `Effect.retry`-driven. So keep a pure delay function, and use mobile's `Effect.sleep` fiber for the timer on web too (mobile:226-235 vs web:108).

**Net:** web −50, mobile −60, shared +45 → **~65**.

### 2.5 People search — (a)
`apps/web/src/lib/usePeopleSearch.ts` (179) and `apps/mobile/src/components/contacts/use-people-prefix-search.ts` (109). `use-people-search.ts` (71) is the exact `@handle` lookup and has no web twin.

**The same on both sides** (a copy, with jscpd clones mobile:62-95 ↔ web:65-98 and mobile:76-89 ↔ web:153-165):
- Query normalisation (web:34-38, mobile:33-37).
- Constants (web:7-11, mobile:9-14).
- State type (web:14-19, mobile:16-21).
- The debounce step (web:24-28,86-89, mobile:23-27,82-86).
- "Only the latest query writes" and 429 → `rate_limited` (web:56-83, mobile:53-80).
- The effect wiring (web:91-109, mobile:88-106).

**Platform-specific:** only the result shape. Web gets `{entries}` (web:58,65); mobile gets an array (mobile:55,62).

**Drift:**
- Web's local `PEOPLE_SEARCH_DEBOUNCE_MS = 300` (web:8) has the same name as chat-core's 900 ms constant (`packages/chat-core/src/search.ts:8`).
- On mobile, text starting with `@` runs the exact handle lookup. On web, `@` is just stripped (web:36). This is a product decision (§7, Q4).

**Shared API:**
- In `packages/chat-core/src/search.ts`: `normalizePeopleQuery`, `PEOPLE_PREFIX_DEBOUNCE_MS = 300`, `USER_SEARCH_MAX_LENGTH`.
- New `packages/client-core/src/people-search.ts` with `makeUsePeopleSearch(runtime)`, which returns `usePeopleSearch(search: (q) => Promise<readonly P[]>, query)`.
- Web keeps `useGroupSearch` (web:134-179).

**Net:** web −95, mobile −100, shared +90, adapters +8 → **~85**.

### 2.6 Message search — (b)
`apps/web/src/lib/useMessageSearch.ts` (97) and `apps/mobile/src/components/chat/use-message-search.ts` (41), with `message-search.ts` (343) and `message-search-format.ts` (112) beside it.

**The same on both sides:**
- Active query (web:66-67, mobile `message-search-format.ts:10-13`).
- 501 → `unavailable` (web:54-55, mobile `message-search.ts:116-118`).
- Page size 20.
- Snippet highlighting (web `components/MessageSearchResult.tsx:17-35` ↔ `message-search-format.ts:49-70`).
- Group by chat (web `components/MessageSearchResults.tsx:285-309` ↔ format:83-100).
- `Group › Topic` title (web `MessageSearchResult.tsx:91` ↔ format:107-109).

**Different:** only mobile has paging, Retry and a 429 message (`message-search.ts:142-233,320-327`). Web is behind.

**Step 1:** move the pure helpers into `packages/chat-core/src/search.ts`: `activeQuery`, `snippetParts`, `groupSearchByChat(results, titles: Map)`, `searchResultTitle`, `MESSAGE_SEARCH_LIMIT`. **Net ~40.**

**Step 2 (optional, changes web behaviour):** move `MessageSearchController` (plain TS and Effect) to `client-core/src/message-search.ts` and give web paging. About 90 more lines.

### 2.7 Contact requests — (a)
`apps/web/src/lib/useContactRequests.ts` (62) and `apps/mobile/src/lib/use-contact-requests.ts` (59).

**The same on both sides:**
- 60 s refresh (web:13, mobile:16).
- A failure keeps the old list (web:20, mobile:36).
- `{requests, reload}` (web:24-27, mobile:21-24).
- Repeating is written differently: `Effect.repeat` + `Schedule.fixed` on web (web:43), hand-written `setInterval` on mobile (mobile:46).

**Platform-specific:** the "came back" signal. Web uses window `focus` (web:44-47); mobile uses `AppState` (mobile:47-51).

**Shared API:** `packages/client-core/src/contact-requests.ts` with `makeUseContactRequests(runtime)`, which returns `useContactRequests(list, enabled, onForeground)`. Each app gets a 12-line `lib/foreground.ts` (`onForeground(cb) => unsubscribe`), and the version check (§2.9) reuses it. Mobile's `setInterval` becomes `Schedule.fixed(Duration.minutes(1))`.

**Net ~40.**

### 2.8 Delayed value and debounce — (a)
`apps/web/src/lib/useDelayed.ts` (26) and `apps/mobile/src/lib/use-delayed.ts` (31).

**The same on both sides:** the contract and doc comment (web:5-10, mobile:5-10) and clearing at once (web:15-16, mobile:16-23). Web runs a timer through `useQuery`, which is heavy for a timer (web:17). Mobile uses `runLater`/`interruptFiber` from `apps/mobile/src/lib/effect/timers.ts:5-14`.

**Shared API:**
- `packages/client-core/src/use-debounced.ts`: `useDebouncedValue<T>(value, delayMs, opts?: { immediate?: (v: T) => boolean }): T`, built on `Effect.runFork(Effect.sleep(Duration.millis(ms)))` plus `Fiber.interrupt`.
- `runLater`/`interruptFiber` move into it.
- `packages/client-core/src/use-delayed.ts` holds `useDelayed` as a 5-line wrapper.
- This one hook replaces the debounce sites the scan listed in §4: web `useMessageSearch.ts:34`, web `usePeopleSearch.ts:87`, mobile `use-people-prefix-search.ts:84`, and both `useDelayed`. Mobile `message-search.ts` keeps its injectable clock but uses the shared `runLater`.

**Net ~55**, including ~30 from the debounce sites.

### 2.9 Client version — (a)
`apps/web/src/lib/useClientVersionCheck.ts` (86) and `apps/mobile/src/lib/use-client-version.ts` (76). jscpd clones: mobile:30-67 ↔ web:34-71, and mobile:6-24 ↔ web:6-22.

**The same on both sides:** the 10-minute gap (web:9, mobile:9), `readMinClientProtocol` (web:12-18, mobile:12-18), fetch and parse (web:31-44, mobile:24-40), and the throttle and check (web:52-67, mobile:48-63).

**Platform-specific:**
- The `/health` request: same-origin with mock mode on web (web:22-25), `${API_URL}` on mobile (mobile:28).
- Triggers: focus and visibility on web (web:71-82), `AppState` on mobile (mobile:67-72).

**Shared API:** `packages/client-core/src/client-version.ts` with `readMinClientProtocol(raw)` and `useClientVersionCheck(health: () => Promise<Response>, onForeground)`.

**Net:** web −70, mobile −62, shared +55, adapters +10 → **~55**.

### 2.10 API client — (c)
`apps/web/src/lib/effect/api-client.ts` (84) and `apps/mobile/src/lib/effect/api-client.ts` (44).

Both build the contract `ZilarClient` (`packages/api-contract/src/client.ts`; web:13-38). The transports differ on purpose:
- Web uses a same-origin cookie, a path rewrite and mock mode (web:23-34).
- Mobile uses a bearer token, `credentials: 'omit'`, a timeout and `baseUrl` (mobile:20-43).

The one real copy is the cancellable call: web `api-client.ts:57-84` ↔ mobile `lib/search-api.ts:61-91`. It moves under §2.11.

### 2.11 Effect errors — (b)
`apps/web/src/lib/effect/errors.ts` (29) and `apps/mobile/src/lib/effect/errors.ts` (38).

**The same on both sides:** `isApiFailureCode` (web:26-29, mobile:35-38). `toApiFailure` does the same job two ways: `instanceof ApiError` on web (web:14), a shape check on mobile (mobile:18-30). Mobile's version accepts everything web's does.

**Shared API:**
- `packages/client-core/src/errors.ts`: `toApiFailure`, `isApiFailureCode`, and a ready `fromApi = makeFromApi(toApiFailure)`.
- `packages/client-core/src/api-effect.ts`: `runApiAbortable(effect, signal?)`.
- Web `errors.ts` stays as a 2-line re-export, because it has 61 importers.

**Net ~40.** This sits under every API call on both apps, auth included, so it **needs tests**.

### 2.12 `use-action` / `use-query` — already shared
App files (web and mobile `lib/effect/use-action.ts` 9, `use-query.ts` 6) only bind `makeUseAction`/`makeUseQuery` (`packages/client-core/src/use-action.ts`, `use-query.ts`) to each app's runtime (`apps/*/src/lib/effect/runtime.ts`). Nothing to move.

### 2.13 Person links — (a)
`apps/web/src/components/personLink.tsx` (142) and `apps/mobile/src/lib/person-link.ts` (68).

**The same rules on both sides:**
- A full JID is an occupant (web:38, mobile:40-41).
- Self check (web:42-48, mobile:43-46).
- Match a contact (web:50-54, mobile:47-51).
- Match a DM chat (web:71, mobile:56-58).
- Fall back to the handle (web:77-80, mobile:63-66).

**Drift (verified at web:36-40, mobile:38-42):**
- A full JID makes web return nothing at all; mobile only drops the JID and still tries the userId and handle.
- Web compares userIds case-sensitively (web:53); mobile lowercases them (mobile:50).
- Only web falls back to group-member handles (web:77,91-100).

**Shared API:** `packages/chat-core/src/person-link.ts` with `resolvePerson(target, { contacts, chats, currentUserId, members? })`, which returns `{kind:'chat', id} | {kind:'profile', handle} | undefined`, using structural types. App files stay as route adapters (about 15 lines on web, 8 on mobile). **Net ~12.** The value is one set of rules; it needs a decision on the drift (§7, Q3).

### 2.14 Format — (a)
`apps/web/src/lib/format.ts` (1) and `apps/mobile/src/lib/format.ts` (31).

Both re-export chat-core labels (web:1, mobile:9). Mobile's `previewParts` (mobile:22-31) is web's inline `ChatListItem.tsx:75-77`. Move `previewParts` to `packages/chat-core/src/messages.ts`, delete both shims, and import from `@zilar/chat-core`. **Net ~25.**

### 2.15 Topics — (b)
`apps/web/src/store/effects/topics.ts` (188) + `apps/web/src/lib/api/topics.ts` (142) vs `apps/mobile/src/lib/topics.ts` (243) + `apps/mobile/src/lib/topics-api.ts` (230).

The effects are **already shared**: both call client-core `createTopic`/`changeTopic`/`leaveTopic` (web `topics.ts:44,67-151,175`, mobile `store/effects/group-actions.ts:65,84-130`).

**Duplicated:**
- The API calls and input types (web `api/topics.ts:33-131` ↔ mobile `topics-api.ts:80-213`; jscpd mobile:80-103 ↔ web:33-55).
- "https only" link rule (web `components/topic/TopicLinkRow.tsx:18-27` ↔ mobile `topics.ts:150-163`).
- `mayCreateTopic` (web `components/NewChatButton.tsx:101-105` ↔ mobile `topics.ts:200-209`).
- A third copy of `chatEntryTopics` (web `lib/api/chats.ts:40`, `packages/client-core/src/store/topic-rows.ts:27`).

**Drift:**
- Mobile hand-types `Topic` (mobile `topics-api.ts:29-78`); web re-exports the contract types (web `api/topics.ts:31`).
- Possible dead code in mobile `parseTopicVisibility`, `chatEntryTopics` and `glyphForTopicName` (`topics.ts:132,158,227`).

**Shared API:**
- `packages/client-core/src/api/topics.ts`: `makeTopicsApi(getClient: () => ZilarClient)`.
- In `packages/chat-core/src/topics.ts`: `httpsTopicUrl`, `topicLinkText`, `mayCreateTopic`.

**Net ~165.**

### 2.16 Groups — (b)
The scan's pair is not a true twin.
- `apps/web/src/lib/api/groups.ts` (324) is an API client. Its twins are mobile `lib/groups-api.ts` (175), `lib/roles-api.ts` (69) and `lib/invite-links-api.ts` (175).
- `apps/mobile/src/store/effects/groups.ts` (314) is a store adapter. Its twins are web `store/effects/groupMembers.ts`, `groupShared.ts` and `groupSettings.ts`.

**Duplicated:**
- Roles API (web:69-101 ↔ `roles-api.ts:54-67`).
- Invite links (web:217-259 ↔ `invite-links-api.ts:82-97`).
- Members (web:53-59,157-200 ↔ `groups-api.ts:131-167`).
- `joinGroups` (web `groupMembers.ts:144-168` ↔ mobile `groups.ts:204-235`; jscpd mobile:210-219 ↔ web:151-160).

Create, leave and change already go through client-core (`packages/client-core/src/store/group-actions.ts:44-311`).

**Drift:**
- Web refreshes with `refreshChatsOrThrow` after a write that already succeeded (`groupShared.ts:43`), so a failed refresh reports the write as failed. Mobile refreshes quietly (`groups.ts:273-275`).
- Web sends the handle untrimmed (`groupCreate.ts:104-105`); mobile trims it (`group-actions.ts:202-203`).
- Mobile throws away the returned group detail and re-fetches it (`groups-api.ts:148-149`).

**Shared API:**
- `packages/client-core/src/api/groups.ts`: `makeGroupsApi`, `makeRolesApi`, `makeInviteLinksApi`, each taking `getClient`.
- In `packages/client-core/src/store/groups.ts`: `joinGroupRooms(chats, join, before)`.

**Net ~170.**

### 2.17 Smooth streaming text — (a)
`apps/web/src/lib/useSmoothText.ts` (186) and `apps/mobile/src/lib/use-smooth-text.ts` (254). Both already import `commonPrefixLength`/`safeCut` from `packages/chat-core/src/smooth-text.ts` (17).

**The same on both sides:**
- Constants (web:37-43, mobile:41-47).
- Speed formula (web:122-125, mobile:193).
- Frame step (web:128-148, mobile:198-218).
- Resume at the common prefix (web:105-110, mobile:149-154).
- Snap when coming back (web:168-181, mobile:159-172).

Mobile already wrote it as a plain class, `SmoothTextReveal` (mobile:76-226), with a thin hook (mobile:235-254).

**Platform-specific:** visibility and `matchMedia` on web (web:21-49). Mobile gets `AppState` and Reanimated's reduce-motion flag passed in by the caller (`components/chat/use-bubble-reveal.ts:26-31`).

**Drift:** web reads reduced motion once (web:79); mobile updates it (mobile:116-134).

**Shared API:**
- Move `SmoothTextReveal`, `FrameScheduler` and `ActiveSource` into `packages/chat-core/src/smooth-text.ts`. The class is pure TS and uses a guarded `globalThis.requestAnimationFrame`.
- `packages/client-core/src/use-smooth-text.ts` holds the hook.
- Web keeps a ~25-line adapter for visibility and reduced motion.

**Net ~210.**

### 2.18 Media retry — (a)
`apps/web/src/lib/media-retry.ts` (163) and `apps/mobile/src/lib/media-retry.ts` (155).

**The same on both sides:**
- Delays of 1/2/4/8 s (web:10, mobile:11).
- `RetryState` (web:20-35, mobile:21-36).
- The `Effect.sleep` fiber (web:89-108, mobile:86-105).
- `onError`, retry and restart (web:125-152, mobile:117-144).

**Drift (verified at mobile:48-55):**
- Mobile's `atUrl` rebuilds the preview from the current `localUri`, against its own comment ("keeps the captured local preview"). Web keeps it (web:52).
- Mobile clears the preview on a local load (mobile:113); web keeps it (web:120).
- Mobile returns raw `failed` (mobile:150); web returns `failed && no preview` (web:158).

**Shared API:**
- `packages/client-core/src/use-media-retry.ts`: `useMediaRetry({ url, preview?, retryable })` and `MEDIA_RETRY_DELAYS_MS`.
- `withMediaRetry(url, n)` goes into `packages/chat-core/src/media.ts`.

**Library:** `Effect.retry` doesn't fit, because the image element's `onError` drives the retries. Keep the fiber. **Net ~130.**

### 2.19 Attachments — (b)
`apps/web/src/lib/attachments.ts` (224) and `apps/mobile/src/lib/attachments.ts` (226).

**The same on both sides:**
- 50 MB cap (web:7, mobile:25).
- Image MIME set (web:10-15, mobile:28-33).
- Classification (web:41-43, mobile:60-63; mobile lowercases).
- `safeHttpUrl` (web:46-51, mobile:66-72).
- `application/octet-stream` fallback (web:181, mobile:92-95,224-226).

**Platform-specific:** web uses `File`/`Image` and a `fetch` PUT (web:78-205). Mobile uses picked assets and `mimeForFileName` (mobile:40-221).

**Shared API:** `packages/chat-core/src/attachment-rules.ts` with `MAX_ATTACHMENT_BYTES`, `classifyMime`, `safeHttpUrl`, `mimeOrOctetStream` and `attachmentSizeError`. **Net ~20.** It is small in lines, but it puts the SVG/image rule in one place.

### 2.20 Stickers — (b)
`apps/web/src/lib/stickers.ts` (136) + `apps/web/src/lib/api/stickers.ts` (267, of which ~150 lines are stickers) vs `apps/mobile/src/lib/stickers.ts` (259). The real API twin is `apps/mobile/src/lib/stickers-api.ts` (326).

**The same on both sides:**
- Recents key and cap of 30 (web:8-9, mobile `stickers-storage.ts:15`, mobile `stickers.ts:67`).
- Entry validation (web:29-69, mobile:161-204).
- "Remember" (web:77-78, mobile:251-259).
- The `/api/stickers/…/file` URL rule (web:107-126, mobile:79-103).

**Possible bug:** mobile checks a relative path as a raw string (mobile:88-89), so `/api/stickers/../auth/file` passes, and `stickerImageSource` then adds the bearer token (mobile:121-131). Web parses through `URL`, which normalises `..` (web:113,120). The token still only goes to the API origin.

**Shared API:** `packages/chat-core/src/sticker-recents.ts` with:
- `parseRecentStickers`, `addRecentSticker`, `removeRecentSticker`
- `isStickerFileUrl(url, apiOrigin)`, which always resolves with `new URL`

**Net ~45.** A later step, `client-core/src/api/stickers.ts`, would save about 70 more.

### 2.21 Push badge — (b), close to (c)
`apps/web/src/lib/push/badge.ts` (99) and `apps/mobile/src/lib/push/badge.ts` (83).

Only the unread sum that skips muted chats is shared (web:13-17, mobile:36-38). Badge and dismiss APIs are platform-specific (`navigator.setAppBadge` vs `expo-notifications`). Move `totalBadgeUnread(chats)` to `packages/chat-core/src/chat-labels.ts`. **Net ~2.**

Side note: web `Effect.promise` on `getRegistration` (web:82) is outside `Effect.ignore` (web:97), so a rejection becomes a defect.

### 2.22 Auth — (c), except the invite header
`apps/web/src/lib/auth.ts` (41) and `apps/mobile/src/lib/auth.ts` (143).

The calls are the same (web:15-41, mobile:71-143), but the transports differ on purpose:
- Web uses a same-origin cookie (web:11-13).
- Mobile uses a bearer token, captures `set-auth-token` and reads `EXPO_PUBLIC_ZILAR_API_URL` (mobile:12-62,117-122).

Moving the calls would pull better-auth types into shared code. Only `INVITE_HEADER` and `inviteFetchOptions` move (`packages/client-core/src/invite.ts`). **Net ~6.** It touches auth, so the existing `apps/mobile/src/lib/auth.test.ts` must stay green.

### 2.23 Voice convert — (b)
`apps/web/src/lib/voice/convert.ts` (134) and `apps/mobile/src/lib/voice.ts` (338).

**The same on both sides:**
- `VoiceError` and the caps (web `voice/recorder.ts:5-13`, mobile:16-33).
- Empty and too-large guards (web:42-49, mobile:89-94).
- Error-code parsing (web:21-31, mobile:115-121).
- Duration header (web:67-70, mobile:192-195).
- Slot request (web:100-106, mobile:269-275).
- `UploadSlotRequester`, defined twice (web:76-82, mobile:231-237).
- jscpd clone: mobile:182-196 ↔ web:57-71.

**Likely bug (read at mobile:186-198, 268-282):** after a server conversion, mobile reads the converted bytes only to measure them, then returns `uri: file.uri`, the original recording, together with the converted `size`. `uploadVoice` then requests a slot for that size and PUTs the original file as `audio/mp4`. This only bites when conversion runs, which mobile skips for M4A (mobile:36-43). Verify on Android before the move.

**Drift:** `VOICE_MIN_MS` is 500 on web (`recorder.ts:7`) and 1000 on mobile (mobile:18).

**Shared API:** `packages/client-core/src/voice.ts` with `VoiceError`, the constants, `validateVoiceSize`, `voiceErrorCode`, `readVoiceDuration`, `requestVoiceSlot` and `UploadSlotRequester`. **Net ~40.**

---

## 3. Libraries

### 3.1 Mobile Markdown parser

**Today:**
- Web renders with `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 (`apps/web/package.json`; `apps/web/src/components/MarkdownText.tsx`, 62 lines). It allows only http/https/mailto URLs (MarkdownText.tsx:6-19,56) and renders images as alt text (:32-35).
- Mobile hand-rolls a parser:
  - `apps/mobile/src/lib/markdown-blocks.ts` (198), `markdown-inline.ts` (182), `markdown.ts` (14)
  - table parsing in `apps/mobile/src/components/chat/markdown-table.tsx:1-208` (`splitMarkdownTables` at :120)
  - renderer in `components/chat/markdown-text.tsx` (285)

**What the mobile parser cannot do that web does:**

| Feature | Mobile behaviour | Source |
| --- | --- | --- |
| Nested lists | merged into the parent item | `markdown-blocks.ts:92-101` |
| Nested inline styles | not supported; node values are plain strings | `markdown-inline.ts:11-17` |
| Task lists | `[ ]` shows literally | — |
| Block quotes | flattened | `markdown-blocks.ts:112-124` |
| `www.` and email autolinks | not linked | `markdown-inline.ts:101-117` |
| Escapes, reference links, setext headings, indented code | not supported | — |
| `mailto:` links | parsed (`markdown-inline.ts:33`) but never opened (`markdown-text.tsx:74`) | — |

So the same AI reply renders differently on the two apps. No mobile Markdown tests exist.

**Recommendation:** parse once in chat-core with the same micromark/mdast stack web already runs inside react-markdown, then map the result to a small, safe AST that both apps can render. Versions from `npm view <pkg> version` on 2026-10-18:

| Package | Latest | Already in `pnpm-lock.yaml` (through react-markdown) |
| --- | --- | --- |
| `mdast-util-from-markdown` | 2.1.0 | 2.0.3 |
| `mdast-util-gfm` | 3.1.0 | 3.1.0 |
| `micromark-extension-gfm` | 3.0.0 | 3.0.0 |

Pin the versions in the lockfile so pnpm adds no second copy.

**RN/Expo compatibility** (Expo 57, RN 0.86.3, Hermes):
- The packages are pure ESM JS with no DOM use.
- `decode-named-character-reference@1.3.0` exports a `"react-native"` condition pointing to its non-DOM `index.js`, checked in its `package.json`. Metro honours package `exports`.
- `micromark-util-character@2.1.1` uses a Unicode property regex, `/\p{P}|\p{S}/u` (`index.js:200`). Recent Hermes supports `\p{…}`, but **test on a device** before merging.

**Rejected alternatives:**
- `react-native-markdown-display` 7.0.2: last published 2023-12-11; depends on `markdown-it` ^10, `prop-types` and `react-native-fit-image`. It would be unmaintained, would do nothing for web, and brings its own styling.
- `marked` 18.1.1: a third parser, so web and phone would still differ.

**Shared API:** `packages/chat-core/src/markdown-ast.ts`
- `parseMessageMarkdown(text): MdBlock[]`
- `MdBlock`: paragraph, heading, code, quote with children, list with `checked?`, table, hr
- `MdInline`: text, strong, em, del, code, link with children
- `safeMarkdownUrl`
- Keep the 20k-character cap (`markdown-blocks.ts:12,135-137`).

`packages/chat-core/src/markdown.ts:37-46` (`markdownToPlain`) could later walk the same AST.

**Net:** mobile −564 (blocks, inline, barrel and table parsing), shared +170, renderer +80 → **~300**. Adding dependencies needs Julio's OK (AGENTS.md, Coding rules); see §7, Q1.

### 3.2 Hand-rolled helpers (`reduce-scan.md` §4), checked against what the repo already has

| Helper | Site | Replace with | Net |
| --- | --- | --- | ---: |
| Debounce (5 sites) | web `lib/useMessageSearch.ts:34`, web `lib/usePeopleSearch.ts:87`, mobile `components/contacts/use-people-prefix-search.ts:84`, both `useDelayed` | the one `useDebouncedValue` in client-core (§2.8), on `Effect.sleep` + `Fiber.interrupt` | in §2.8 |
| Retry with backoff | web/mobile `lib/drafts.ts` (web:104-107, mobile:222-225) | a pure `draftReconnectDelay`. `Schedule.exponential` + `Schedule.jittered` would change the jitter, and the reset is event-driven (§2.4) | in §2.4 |
| Retry with backoff | web/mobile `lib/media-retry.ts` | keep the `Effect.sleep` fiber. The retry is driven by `onError`, so `Effect.retry` does not fit (§2.18) | in §2.18 |
| Interval polling | mobile `lib/use-contact-requests.ts:46` (`setInterval`) | `Effect.repeat(…, Schedule.fixed(Duration.minutes(1)))`, as web does at `useContactRequests.ts:43` | in §2.7 |
| Byte size | mobile `components/chat/file-bubble.tsx:148` `formatSize` | `formatFileSize` (`packages/chat-core/src/media.ts:27`). The bodies are line-for-line the same | ~15 |
| `formatMs` | mobile `app/dev/whistle.tsx:290` | `formatClock` (`packages/chat-core/src/format-duration.ts:6`) | ~8 |
| `withTimeout` | mobile `lib/push/native.ts:96-106` (`Promise.race` + `setTimeout`) | `Effect.timeout(Duration.millis(ms))` at the call site, or `Effect.timeoutOrElse` | ~8 |
| Gallery `formatDuration` | mobile `components/chat/attach/gallery-grid.tsx:14` | keep: it adds an hours field that `formatDuration` (`chat-core/src/format.ts:63`) lacks | 0 |
| Clipboard wrapper | 9 mobile files call `Clipboard.setStringAsync` (`app/me.tsx`, `app/stickers/[packId].tsx`, `components/chat/message-bubble-actions.tsx`, `selection-bar.tsx`, `use-group-invite-links.ts`, `use-channel-invites.ts`, `new-chat-button.tsx`, `components/profile/use-profile-dm.ts`, `components/machines/add-machine-sheet.tsx`) | keep `expo-clipboard`. A 10-line `apps/mobile/src/lib/clipboard.ts` like web `lib/clipboard.ts:11` is optional and outside this plan's pairs | — |
| LRU/TTL caches, `sleep` | server and devtools sites | out of scope (not web/phone twins). `effect` `Cache` covers TTL and capacity | — |

---

## 4. Store-effect adapters (`apps/*/src/store/effects` ↔ `packages/client-core/src/store`)

The scan called these "platform wiring, not duplicated logic". That holds for most of web. For example, web `send.ts:31-109` and `groupActions.ts:85-158` are pass-throughs. **It does not hold for mobile history, pins and group actions**, and the copies hide drift.

| Pair (web / mobile lines) | What is duplicated logic | What moves | Net |
| --- | --- | --- | ---: |
| history (311 / 314 + `history-ctx.ts` 106) | Several blocks: the chat-list merge, the open-row-gone check, the adopt step and the `openChat` tail (detail below) | new `client-core/src/store/chat-list.ts`: `mergeChatList`, `adoptNewRows`, `openChatHistory`, which includes `pruneInactiveChats` | ~20 core, +~40 in mobile |
| ports (285+122+128 / 285+117) | only `inertPort` (web:232-241, mobile:246-251). Web `StorageLike` (`portTypes.ts:124-128`) repeats core `KeyValue` | not worth a task | ~8 |
| send (109+3 / 206) | cancel attachment and cancel voice are the same 6 steps twice inside mobile (mobile:148-159,192-204). `markLocalUri` guesses core's `local-${sequence}` id (mobile:97-110 vs `send/context.ts:54-57`) | `cancelSend(ctx, chatId, messageId, kind)` in `client-core/src/store/send/pipeline.ts`; `sendAttachment`/`sendVoice` return the minted id | ~10 |
| group actions (159 / 326) | "topicIdFor → topics API" 4× in mobile (mobile:94-102,145-165); `transferGroupOwner` and role changes written by hand (mobile:262-292) where core `changeGroup` fits | `withTopic(ctx, store, chatId, call)` in `client-core/src/store/group-actions.ts`; mobile uses `changeGroup` | ~20 |
| pins (118 / 218) | media sanitising (untrusted host drops `url`) (web:41-61, mobile:134-151); `loadChatMedia` request shape (web:64-80, mobile:188-203); seeding cached pins (web `lifecycle.ts:196-206`, mobile:163-170) | `sanitizeMediaItems(items, isTrusted, resolve?)`, `loadChatMedia`, `missingPins` in `client-core/src/store/pins.ts`. Mobile passes its relative-URL resolver (AGENTS.md pitfall) | ~35 |
| locals (86 / 111) | 13 `HistoryCtx` bookkeeping fields (web:14-58, mobile:18-42, matching `history-core.ts:60-78`) | `HistoryLocals` + `createHistoryLocals()` in `history-core.ts`; mobile `history-ctx.ts:67-103` spreads them | ~10 (+~30) |
| lifecycle (267 / 351 + `session-check.ts` 73) | the `historyLoad`↔`historyState` mapper, written twice inside mobile (`history-ctx.ts:16-61` and `lifecycle.ts:46-81,249-261`); `finishDraftTurn` twice (mobile:140-143,346-349) | `finishDraftTurn` into core; mobile reuses one mapper | ~15 (+~45) |

**history detail:**
- The chat-list merge is near line-for-line, comments included: `applyChatDelivery`, fresh/kept split, `mergeUnread`, presence carry-over, `orderChatRows`, `applyChatPrefs`, `rememberGroupIds` (web:199-235, mobile:98-134).
- The open-row-gone detection (web:241-282 vs mobile:137-148).
- Adopting new rows: join, load members, `loadPreview` (web:285-310, mobile:157-195).
- The `openChat` tail (web:134-138, mobile:307-311).

**Drift found:**
- **Phone never prunes inactive chats.** Web calls `pruneInactiveChats` in `openChat` (verified: `apps/web/src/store/effects/history.ts:109`). Mobile `store/effects` has no call. The PERF-3 memory cap (`packages/client-core/src/store/prune.ts:20-51`) is web-only.
- **A prefs failure wipes prefs on web.** Web turns a `listChatPrefs` failure into `[]` (verified: `history.ts:183-185`), so pins, mutes and archives drop for one refresh. Mobile keeps the last rows (verified: `apps/mobile/src/store/effects/history.ts:63-72`). Mobile is right.
- Mobile dedupes group detail loads on adopt (T-0147, mobile `history.ts:157-195`); web loads per row (web:285-310).
- **Leaving the last seat in a topic fails on the phone.** Mobile hard-codes `isNotFound: () => false` for `leaveTopic` (verified: `apps/mobile/src/store/effects/group-actions.ts:138`), while core treats that 404 as success (`packages/client-core/src/store/group-actions.ts:105,125-130`).
- Mobile `applyBoot` ignores `previousChats`/`sameUser` (mobile `lifecycle.ts:208-218`); web merges the painted previews (web `lifecycle.ts:220-234`).
- Mobile `history-ctx.ts:86` copies `lastReadUserId` by value, but core boot writes it onto the lifecycle ctx (mobile `lifecycle.ts:235,295`). Verify before the locals slice.

**Answer to step 4:** about 250 app lines of real logic can move into `client-core/store`, for a net cut of roughly 120–150 lines, plus about 80 more removed inside mobile (the mapper, the double cancel, `finishDraftTurn`). The value is fixing the four drifts above, not the line count.

---

## 5. Worker slices

**Rules for every slice:**
- Each slice is ≤ ~400 changed lines and lists its exact files.
- Keep the app module paths (`apps/*/src/lib/<name>.ts`) as thin adapters wherever the table says "adapter", so their importers do not change.
- New shared code must not import `react-dom` or `react-native`.
- **Barrel files** (`packages/chat-core/src/index.ts`, `packages/client-core/src/index.ts`, `packages/client-core/src/store/index.ts`) are touched by many slices. Add ONE export line at the end and never reorder (same rule as the AGENTS.md registry pitfall). These are the only files that parallel slices share, and the lead resolves their trivial merge conflicts.
- **Tests marked "needed"** follow Julio's rule: the message pipeline, auth and money. Permissions and security rules are marked too.

Within a wave, slices touch disjoint files (barrels aside) and can run in parallel. A later wave depends on files or helpers from an earlier one.

### Wave 1 (parallel)

| Slice | Files | Net | Tests | Check on web | Check on phone |
| --- | --- | ---: | --- | --- | --- |
| **W1-a Format shims + badge sum** | `packages/chat-core/src/messages.ts`, `packages/chat-core/src/chat-labels.ts`; delete `apps/web/src/lib/format.ts`, `apps/mobile/src/lib/format.ts`; edit `apps/web/src/components/{ChatListItem,ChatHeader,TopicRow,ContactPanel}.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/mobile/src/components/chat/{topic-row,chat-header,group-list-item,chat-list-item}.tsx`, `apps/mobile/src/components/chat/use-chat-screen.ts`, `apps/web/src/lib/push/badge.ts`, `apps/mobile/src/lib/push/badge.ts` | ~27 | no | chat-list previews ("Dani: ok!", photo and voice icons); PWA badge drops on read | chat, group and topic row previews; icon badge clears |
| **W1-b Small helper swaps** | `apps/mobile/src/components/chat/file-bubble.tsx`, `apps/mobile/src/app/dev/whistle.tsx`, `apps/mobile/src/lib/push/native.ts` | ~30 | no | — | file bubble size text; push registration still times out cleanly offline |
| **W1-c Effect errors + abortable call** | `packages/client-core/src/errors.ts`, `packages/client-core/src/api-effect.ts`, new `packages/client-core/src/errors.test.ts`; `apps/web/src/lib/effect/errors.ts` (re-export), `apps/mobile/src/lib/effect/errors.ts`, `apps/web/src/lib/effect/api-client.ts`, `apps/mobile/src/lib/search-api.ts` | ~40 | **needed** (`toApiFailure`: ApiError, look-alike, `Error`, `null`; `runApiAbortable`: abort before, during, after) | wrong OTP shows the fixed error; search cancels cleanly | the same; a 401 when signed out |
| **W1-d Foreground + client version + contact requests** | new `packages/client-core/src/client-version.ts`, `packages/client-core/src/contact-requests.ts`, new `apps/web/src/lib/foreground.ts`, `apps/mobile/src/lib/foreground.ts`; delete `apps/web/src/lib/{useClientVersionCheck,useContactRequests}.ts`, `apps/mobile/src/lib/{use-client-version,use-contact-requests}.ts`; edit `apps/web/src/components/ClientVersionBanner.tsx`, `apps/web/src/components/chatList/RequestRows.tsx`, `apps/mobile/src/components/client-version-banner.tsx`, `apps/mobile/src/components/chat/request-rows.tsx` | ~95 | no | banner after raising `minClientProtocol` and refocusing the tab; a request from a 2nd account appears within 60 s and on focus | the same after coming back from the background |
| **W1-e Composer drafts** | new `packages/client-core/src/composer-drafts.ts` + `composer-drafts.test.ts`; `apps/web/src/lib/composer-drafts.ts`, `apps/mobile/src/lib/composer-drafts.ts` (adapters) | ~95 | **needed** (account switch never leaks a draft; async hydrate keeps typed text) | type, switch chats, reload: the draft is back; sign in as another user: no leak | type, kill the app, cold start: the draft is back; switch account: no leak |
| **W1-f Chat-list cache codec** | new `packages/client-core/src/store/chat-list-cache.ts` + `chat-list-cache.test.ts`; `apps/web/src/store/chatListCache.ts`, `apps/mobile/src/lib/chat-list-cache.ts` | ~120 | **needed** (round trip with dates; drops live fields) | reload paints the list at once in the right order, with no stale "online" | cold start paints before `/api/chats`; sign out and in as another user: no old list |
| **W1-g Message cache codec, mobile side (fixes `editedAt`)** | new `packages/client-core/src/store/message-cache.ts` + `message-cache.test.ts`; `apps/mobile/src/store/offline-cache.ts`, delete `apps/mobile/src/store/offline-cache-pins.ts`, `apps/mobile/src/store/offline-cache.test.ts` | ~110 | **needed: message pipeline** (`editedAt` round trip, owner check, byte cap, open chat kept) | — | edit a message, kill the app, cold start offline: "edited HH:mm" shows, no crash; sign out removes the file |
| **W1-h Draft-stream events + delay** | new `packages/client-core/src/store/draft-events.ts` + `draft-events.test.ts`; `apps/web/src/lib/drafts.ts`, `apps/mobile/src/lib/drafts.ts` | ~65 | **needed: message pipeline** (decode valid and invalid events; delay bounds) | an AI reply streams; a server restart reconnects within ~30 s | an AI reply streams; background and foreground reopen it; no requests when signed out |
| **W1-i Smooth text** | `packages/chat-core/src/smooth-text.ts` + new `smooth-text.test.ts`, new `packages/client-core/src/use-smooth-text.ts`; `apps/web/src/lib/useSmoothText.ts`, `apps/mobile/src/lib/use-smooth-text.ts` (adapters) | ~210 | **needed** (streamed replies: restart at common prefix, snap on resume, reduced motion) | a streamed reply grows smoothly; hiding the tab mid-reply snaps to full | the same with the app backgrounded; Reduce Motion shows at once |
| **W1-j Media retry** | new `packages/client-core/src/use-media-retry.ts` + test, `packages/chat-core/src/media.ts` (`withMediaRetry`); `apps/web/src/lib/media-retry.ts`, `apps/mobile/src/lib/media-retry.ts` (adapters) | ~130 | needed (preview kept across URL swap; `unavailable` rule) | send a photo: the blob preview stays until the remote image loads; Retry works | send a photo: the `file://` preview never flashes "Couldn't load" |
| **W1-k Attachment rules** | new `packages/chat-core/src/attachment-rules.ts` + test; `apps/web/src/lib/attachments.ts`, `apps/mobile/src/lib/attachments.ts`, `apps/mobile/src/lib/attachments.test.ts` | ~20 | **needed: upload path, SVG rule** | SVG and PNG upload; 0-byte and >50 MB files are refused | HEIC, JPEG and PDF send with the right kind |
| **W1-l Sticker recents + URL check** | new `packages/chat-core/src/sticker-recents.ts` + test; `apps/web/src/lib/stickers.ts`, `apps/mobile/src/lib/stickers.ts`, `apps/mobile/src/lib/stickers-storage.ts` | ~45 | **needed** (token-bearing URL: `..`, foreign host, relative) | send a sticker, reload, recents kept; a hostile URL shows the placeholder | recents survive; images load with auth; a foreign host shows the emoji |
| **W1-m Pins media sanitise** | `packages/client-core/src/store/pins.ts` + new `pins.test.ts`; `apps/web/src/store/effects/pins.ts`, `apps/mobile/src/store/effects/pins.ts` | ~35 | needed (security rule: tracker images) | media panel: a foreign-host image shows as a file row; cached pins on reload | the same; relative `/api/media/…` URLs load |
| **W1-n Markdown AST in chat-core** — *blocked on Q1* | `packages/chat-core/package.json` (3 deps), `pnpm-lock.yaml`, new `packages/chat-core/src/markdown-ast.ts` + test | +170 (net in W2-f) | **needed** (URL allow-list, HTML dropped, images become alt, 20k cap) | none (web unchanged) | none yet |

### Wave 2 (after wave 1 merges)

| Slice | Depends on | Files | Net | Tests | Check on web | Check on phone |
| --- | --- | --- | ---: | --- | --- | --- |
| **W2-a Debounce hook + `useDelayed`** | W1-a (mobile `chat-header.tsx`) | new `packages/client-core/src/use-debounced.ts`, `use-delayed.ts`; `apps/mobile/src/lib/effect/timers.ts` (re-export); delete `apps/web/src/lib/useDelayed.ts`, `apps/mobile/src/lib/use-delayed.ts`; edit `apps/web/src/components/{ChatList,Skeleton}.tsx`, `apps/web/src/components/ais/AiActivity.tsx`, `apps/web/src/components/machines/MachineListSkeleton.tsx`, `apps/web/src/components/approvals/ApprovalsListSkeleton.tsx`, `apps/web/src/routes/{JoinPage,AppRoutes}.tsx`, `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/components/chat/chat-header.tsx` | ~25 | no | fast connection: no skeleton flash; slow: it shows after the delay | "Connecting…" never flashes on a fast connection |
| **W2-b Web message cache codec** | W1-g | `apps/web/src/store/messageCache.ts`, `apps/web/src/store/messageCache.test.ts` | ~90 | **needed: message pipeline** (existing test kept and passing; byte cap) | open a chat, reload offline: rows and pin banner paint; sign out removes `zilar:messages` | — |
| **W2-c Voice helpers (after the bug check)** | Q2 | new `packages/client-core/src/voice.ts` + test; `apps/web/src/lib/voice/convert.ts`, `apps/web/src/lib/voice/recorder.ts`, `apps/mobile/src/lib/voice.ts` | ~40 | **needed: message pipeline** (converted URI uploaded, size matches, error codes) | record and send; plays back with the right duration | send on iOS and Android; the server has real M4A bytes |
| **W2-d Topics API + helpers** | — | new `packages/client-core/src/api/topics.ts` + test; `packages/chat-core/src/topics.ts`; `apps/web/src/lib/api/topics.ts`, `apps/mobile/src/lib/topics-api.ts` (adapters), `apps/mobile/src/lib/topics.ts`, `apps/web/src/lib/api/chats.ts`, `apps/web/src/components/topic/TopicLinkRow.tsx`, `apps/web/src/components/NewChatButton.tsx` | ~165 | **needed: permissions** (`mayCreateTopic`, `httpsTopicUrl`) | create, rename, archive and leave a topic; only https link chips open | the same; "new topic" hidden for a plain member when the switch is off |
| **W2-e History chat-list merge** | Q5 | new `packages/client-core/src/store/chat-list.ts`, `packages/client-core/src/store/history.test.ts` (+ `prune.test.ts`); `apps/web/src/store/effects/history.ts`, `apps/mobile/src/store/effects/history.ts` | ~20 | **needed: message pipeline** (merge, prefs failure keeps rows, mobile prunes) | reload on `/c/<jid>`; block `/api/chat-prefs`: pins and mutes survive; a removed topic lands on General | pull-to-refresh error and retry; open 5+ long chats: older ones prune and page back |
| **W2-f Mobile Markdown renderer** | W1-n | `apps/mobile/src/components/chat/markdown-text.tsx`, `apps/mobile/src/components/chat/markdown-table.tsx` (render only); delete `apps/mobile/src/lib/{markdown,markdown-blocks,markdown-inline}.ts` | ~300 incl. W1-n | covered by W1-n | — | an AI reply with nested lists, task boxes, mailto, a table and code; a long stream stays smooth on Hermes |
| **W2-g People search** | W2-a only if it uses the hook; otherwise none | `packages/chat-core/src/search.ts`, new `packages/client-core/src/people-search.ts`; `apps/web/src/lib/usePeopleSearch.ts`, `apps/web/src/components/chatList/ChatListBody.tsx`; delete `apps/mobile/src/components/contacts/use-people-prefix-search.ts`, edit `apps/mobile/src/components/contacts/people-list-section.tsx` | ~85 | no | `ab` idle, `abc` sends one request after 300 ms; a 429 shows the rate-limit line | the same; `@handle` still runs the exact lookup |

### Wave 3 (after wave 2)

| Slice | Depends on | Files | Net | Tests | Check on web | Check on phone |
| --- | --- | --- | ---: | --- | --- | --- |
| **W3-a Message-search helpers** | W2-g (`chat-core/src/search.ts`) | `packages/chat-core/src/search.ts` + test; `apps/mobile/src/components/chat/message-search-format.ts`, `apps/mobile/src/components/chat/message-search.ts`; `apps/web/src/components/MessageSearchResult.tsx`, `apps/web/src/components/MessageSearchResults.tsx`, `apps/web/src/lib/useMessageSearch.ts` | ~40 | no | highlights, grouping and `Group › Topic` titles unchanged | the same; paging still works |
| **W3-b Groups, roles, invite-links API** | W2-d (`client-core/src/api/`) | new `packages/client-core/src/api/groups.ts` + test, `packages/client-core/src/store/groups.ts` (`joinGroupRooms`); `apps/web/src/lib/api/groups.ts`, `apps/web/src/store/effects/groupMembers.ts`, `apps/mobile/src/lib/{groups-api,roles-api,invite-links-api}.ts`, `apps/mobile/src/store/effects/groups.ts` | ~170 | **needed: permissions** (roles, owner transfer, delete mapping) | create a group or channel, transfer ownership, change roles, create/revoke an invite link | the same, plus Settings toggles and adding/removing an AI in group info |
| **W3-c Group actions** (`withTopic`, last-seat leave) | W3-b, Q6 | `packages/client-core/src/store/group-actions.ts` + new `group-actions.test.ts`; `apps/mobile/src/store/effects/group-actions.ts` | ~20 | needed: permissions | leave a topic, transfer, promote (unchanged) | leave a topic as its last member: succeeds; transfer; promote and demote |
| **W3-d Person-link resolver** | Q3 | new `packages/chat-core/src/person-link.ts` + test; `apps/web/src/components/personLink.tsx`, `apps/mobile/src/lib/person-link.ts` (adapters) | ~12 | needed (each drift case) | tapping a group sender opens their DM or profile; self opens nothing | the same, including a handle with no chat |
| **W3-e Send cancel helper** | — | `packages/client-core/src/store/send/pipeline.ts`, `packages/client-core/src/store/send.test.ts`; `apps/mobile/src/store/effects/send.ts`, `apps/mobile/src/store/effects/ports-media.ts` | ~10 | **needed: message pipeline** | attachment and voice still send | cancel a slow image and a voice upload mid-PUT: the bubble goes, a later Retry does nothing |
| **W3-f Locals + mobile ctx mapper + `finishDraftTurn`** | W2-e | `packages/client-core/src/store/history-core.ts`, `packages/client-core/src/store/lifecycle.ts`; `apps/web/src/store/effects/locals.ts`, `apps/mobile/src/store/effects/{locals,history-ctx,lifecycle}.ts` | ~85 | **needed: message pipeline** (`history.test.ts`, `lifecycle.test.ts`, mobile `real-store.lifecycle.test.ts`) | open a chat cold and during connect; switch user | background >10 s and return; cold start offline; sign out and in as another user: no leak |
| **W3-g Invite header** (optional) | — | new `packages/client-core/src/invite.ts`; `apps/web/src/lib/auth.ts`, `apps/mobile/src/lib/auth.ts` | ~6 | **needed: auth** (`apps/mobile/src/lib/auth.test.ts` stays green) | sign up with an invite link | OTP sign-in; an invite sign-up is credited |

**Optional later slices** (they change behaviour, so each needs its own go-ahead):
- Mobile `MessageSearchController` into client-core, giving web paging and Retry (~90).
- Sticker API into `client-core/src/api/stickers.ts` (~70).

---

## 6. Bugs and drift found (fix during the matching slice, or as their own small task)

| Finding | Where | Slice |
| --- | --- | --- |
| Mobile offline cache drops `editedAt` as a `Date`; a cold start can throw in `formatTime` | `apps/mobile/src/store/offline-cache.ts:134-137,153-159` | W1-g |
| Mobile voice uploads the original recording with the converted size after a server conversion | `apps/mobile/src/lib/voice.ts:196-198`, `:268-282` | W2-c (Q2) |
| Mobile media retry rebuilds the preview on a URL change, against its comment | `apps/mobile/src/lib/media-retry.ts:48-55` | W1-j |
| Mobile sticker URL check accepts `..` in relative paths before adding the bearer token | `apps/mobile/src/lib/stickers.ts:88-89,121-131` | W1-l |
| Phone never prunes inactive chats (PERF-3) | web `store/effects/history.ts:109` only | W2-e |
| Web drops chat prefs on a transient prefs failure | `apps/web/src/store/effects/history.ts:183-185` | W2-e |
| Leaving the last seat in a topic errors on the phone | `apps/mobile/src/store/effects/group-actions.ts:138` | W3-c |
| Web treats a failed refresh after a successful group write as a failed write | `apps/web/src/store/effects/groupShared.ts:43` | W3-b |
| Mailto links parse but never open on the phone | `apps/mobile/src/lib/markdown-inline.ts:33`, `components/chat/markdown-text.tsx:74` | W2-f |
| Web `dismissChatNotifications` can reject outside `Effect.ignore` | `apps/web/src/lib/push/badge.ts:82,97` | W1-a |

---

## 7. Decisions for Julio

1. **Markdown dependencies (blocks W1-n/W2-f).** Should `mdast-util-from-markdown`, `mdast-util-gfm` and `micromark-extension-gfm` be added as direct dependencies of `packages/chat-core`, pinned to the versions already in the lockfile? They add no new code to the install, but AGENTS.md requires your OK for any new dependency. If not: keep the mobile parser and only fix mailto (~2 lines).
2. **Voice conversion (W2-c).** Confirm on an Android phone whether converted voice notes arrive as real M4A. If not, the fix comes before the shared move.
3. **Person links (W3-d).** Which rules win?
   - (a) A full JID opens nothing (web) or still tries the userId and handle (mobile).
   - (b) Compare userIds case-insensitively, as mobile does.
   - (c) Fall back to group-member handles, as web does.
4. **People search.** Should web also treat `@handle` as the exact lookup, as the phone does?
5. **History (W2-e).** Adopt mobile's "keep the last prefs on failure" on web, and turn on PERF-3 pruning for the phone?
6. **Topics (W3-c).** Should the phone treat the last-seat 404 as success, as core and web do?

---

## Method and limits

- Each pair was read on both sides by read-only sub-agents in this session, and the shared-package files they import were checked. I re-read these claims myself:
  - the mobile `editedAt` encode/decode
  - the mobile voice return value
  - mobile `atUrl`
  - mobile `isNotFound: () => false`
  - web `pruneInactiveChats` with no mobile call
  - the web/mobile prefs-failure handling
  - person-link full-JID handling
  - `formatSize` ↔ `formatFileSize`
  - `withTimeout`
  - the importer lists in §5 (by grep)
- Other `file:line` citations come from the sub-agent reads and were not each re-opened.
- Library versions are from `npm view` on 2026-10-18, and the lockfile versions are from `pnpm-lock.yaml`. Hermes support for `\p{…}` regexes was not tested on a device.
- Line savings are estimates for planning. Each slice's real diff decides.
- Not read: web `store/effects/groupCreate.ts`, `realStore.ts` (`canPin`), `lib/api/sessionGone.ts`, and mobile `events.ts`, `user-state.ts`, `runtime.ts`. The group-create input rules and the session-check classification may be duplicated too. Unverified.
