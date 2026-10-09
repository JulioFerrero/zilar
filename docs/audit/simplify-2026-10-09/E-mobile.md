# E-mobile: audit of apps/mobile (Expo / React Native)

## 1. Summary
- Mobile source (no tests) is 63.5k lines vs web 50.8k. Tests add 59.1k more. The bulk is not screens: `src/lib` is 14.8k, of which the 25 `*-api.ts` clients are 7,985 lines (web has one `api.ts`, 2,690 lines). Each client re-writes the same fetch + bearer token + error-mapping skeleton (24 files define their own `requestEffect`, 25 their own `*NetworkError`, 25 their own `*ApiError`). A shared `makeApiClient` core could remove roughly 2.5-3.5k lines (estimate, see F1).
- The chat message list renders every message at once: `initialNumToRender={Math.max(entries.length, 1)}` (`components/chat/message-list.tsx:289`). `MessageBubble` is not `memo`ised and the list rows get 20+ props. Streaming AI drafts re-render all of history. This is the biggest runtime cost (F2).
- A mock layer ships in the production bundle: `store/chat-store.ts` (1,595), `src/mock/*` (2,973), 16 `use-*-api.ts` hooks (505) all statically imported from the real-path providers, plus the `/dev/kit` and `/dev/whistle` screens. About 5.1k lines (8% of source) are not needed in a release build (F3).
- The app is dark-only (`app/_layout.tsx` forces dark, decision D24) but 155 `[scheme]` palette lookups and 135 `asColorScheme(useColorScheme()...)` calls remain, each subscribing a component to the colour scheme for a branch that cannot run (F4).
- Android JS bundle (measured): 13.0 MB Hermes bytecode (4,623 modules), 131 s to bundle; 63 asset files, 4.4 MB. 37 are Geist/GeistMono `.ttf` (all weights and italics, 18+18+) although the app loads 5 fonts (F5).
- Dead code is low: 5 unreferenced files in non-route code (`components/chat/use-invites-api.ts` 37 lines, `lib/whistle-last-voice.ts` 17 test-only, 2 guard/scan test helpers, 2 `.d.ts`). The mobile app is clean on that axis.
- Biggest files are justified in principle (real-store 1,928 lines, chat/[id] 1,117) but the two stores duplicate one contract (mock 1,595 + real 1,928, F6). Native module zilar-whistle (~1.2k lines Kotlin/C++/TS) is justified: on-device STT, Android arm64 only, but its two debug screens ship (F3).

## 2. Measurements
- `find src -name '*.ts*' ! -name '*.test.*' | xargs cat | wc -l` = 63,505 (mobile); web `src` = 50,841. Tests: 59,055.
- Dirs (non-test lines): lib 14,799; components/chat 14,490; app/settings 5,294; store 4,230 + store/effects 3,524; components/ais 3,413; mock 2,973; contacts 1,516; stickers 1,391; app/(tabs) 1,391; app/chat 1,117; ui kit 1,071 (+ 512 line kit test).
- `wc -l src/lib/*-api.ts` = 7,985 (25 clients). Mock + store tests 3,629 incl. tests. Web `apps/web/src/lib/api.ts` = 2,690. `*.effect.test.ts` + `*-api.test.ts` = 5,331 lines (tests exist twice: 12 `.effect.test` next to 24 `-api.test`).
- `grep -l "const requestEffect" src/lib/*-api.ts | wc -l` = 24; `NetworkError') {}` in 25; `"No session"/"Could not reach the server"` strings 53; `Effect.runPromise` calls in api files 52.
- Largest non-test files: real-store.ts 1928, chat-store.ts 1595, app/chat/[id].tsx 1117, settings/sticker-pack.tsx 862, group/[id].tsx 836, ais/tool-detail-sheet.tsx 812, composer.tsx 792, message-bubble.tsx 754, settings/integrations.tsx 751, settings/machines.tsx 721, store/effects/send.ts 716, settings/stickers.tsx 695.
- Bundle: `CI=1 npx expo export --platform android --output-dir <scratch>/mobile-export` took 2:13, 4,623 modules, `entry-*.hbc` = 12,991,123 bytes; total export 17 MB, assets 4.4 MB (63 files). Font files listed: 18 Geist + 18 GeistMono + 1 MaterialSymbols (967 KB, pulled by a dependency, not used in src: `grep MaterialSymbols src` = 0, UNVERIFIED who imports it, probably expo-router/vector-icons).
- Lucide: `from 'lucide-react-native'` in 64 files; package has 3,710 icon files. Whether Metro tree-shakes it could not be verified from Hermes bytecode (icon name strings not found, UNVERIFIED). If not shaken it would be 1+ MB of the 13 MB.
- Lists: FlatList used in 4 places only (`explore.tsx:273`, `group/[id].tsx:661`, `(tabs)/index.tsx:426`, `message-list.tsx:284`); none has `getItemLayout`, `windowSize`, `removeClippedSubviews`; no FlashList. `ScrollView` is used for 30+ places, several holding lists (new-group-sheet, sticker-panel, gif-panel, emoji-tab, message-search-list:175, requests, blocked, approvals, machines, connections).
- `memo(` usage in components: 2 (`MarkdownText`, `MessageSearchHit`). `ChatListItem` and `MessageBubble` are not memoised; each row subscribes to the store (`chat-list-item.tsx:52-56`, 4 selectors incl. `state.messages(chat.id)`).
- Orphan files (script `audit/orph2.sh`): see Summary.

## 3. Findings (ranked value / effort)

### F2. Message list is not virtualised and rows are not memoised (perf, high value, effort S-M)
Evidence: `message-list.tsx:289` `initialNumToRender={Math.max(entries.length, 1)}` renders all loaded entries on mount. The list is non-inverted, so mount needs timers (`message-list.tsx` ~line 230: scroll again at 80/200/400/700 ms) to settle, `onContentSizeChange` scrollToEnd, `scrollEventThrottle={16}` with a handler that writes a ref (cheap) and triggers `loadOlder` at `y<=24`. `renderItem` is an inline closure creating `MessageBubble` with ~25 props (`:322-360`); `MessageBubble` (`message-bubble.tsx`, 754 lines) is a plain function component with 2 store selectors (`:284,287`) and is not `memo`. The list subscribes to 15 `useChatStore` selectors (`:108-132`) including `drafts` and `finishedDraftMessages`, so every streaming draft token re-renders `MessageList`, rebuilds `entries` (useMemo deps include `draft`) and re-renders all bubbles.
Impact: chat open time and streaming smoothness scale linearly with history length (history pages load in 30-50 at a time, many pages after scroll-back). Gain: first render of N bubbles drops to ~15-20; per-token render drops from N bubbles to 1.
Risk: the scroll-to-index / jump code (`startJumpScroll`, `scrollToIndex` failures) relies on all rows being measured; that is probably why `initialNumToRender` was set to all. Needs `getItemLayout` impossible (variable heights), so use `onScrollToIndexFailed` (already there) or FlashList/LegendList. Detect with the existing `message-list.test.tsx`, `jump-scroll.test.ts` plus an emulator check of search-jump on old messages.
Recommendation: (1) wrap `MessageBubble` in `memo` with stable callbacks (pass the handler bag once via context or `useCallback`), (2) take the draft out of `entries` (render the draft bubble as a separate footer item or isolate it behind its own selector), (3) after that, drop the `initialNumToRender` override and let `windowSize` default; evaluate FlashList only if jump-to-message still fails. Do (1) and (2) first; they carry no scroll risk.

### F1. 25 hand-rolled API clients (clarity/lines, high value, effort M-L)
Evidence: `lib/pins-api.ts:80-175` and `lib/ais-api.ts` both define `XNetworkError`, `XRequestError`, `XUnauthorized`, `XInvalidResponse` tagged errors, a `requestEffect` (bearer token, `fetch`, `response.json().catch(()=>null)`, `errorFieldsOf`), a `withToken` wrapper with `Effect.catchTags` mapping to a legacy `XApiError extends Error {status, code}` class, and `Effect.runPromise` at the edge. Docs comment says "the recipe for the other 24 `*-api.ts` files". `api-error-body.ts` (47 lines) is the only shared piece. Then each feature adds a `use-X-api.ts` hook (16 files, 505 lines), a `mock/X.ts` (2,973 total) and two test files (5,331 lines) that re-test the same transport.
Root cause: tasks were done per feature by independent workers following a recipe in a comment, so the recipe was copied, not extracted. The `Promise`-returning `XApi` interface exists only because stores/screens were written before Effect and were converted at the edge (T-0506).
Impact: estimate 90-140 lines of transport + error boilerplate per client x 24 = 2.2-3.4k lines, plus about 1.5k lines of duplicated transport tests. Method: pins-api lines 80-175 are about 95 lines of pure transport; sample ais-api shows the same.
Risk: error codes/messages are surfaced to UI strings (`describeRolesError`, `DirectoryApiError` checks in `app/group/[id].tsx:52-55`), so the `XApiError` classes must keep `status`/`code`. Detect via the existing 24 `-api.test.ts`.
Recommendation: add `lib/api-core.ts` with `makeRequester({getToken, fetch, apiUrl}) => (path, init, schema)` returning `Effect<A, ApiError>`, one tagged `ApiError {status, code, message}` class (subclass per feature only where tests check `instanceof`). Convert clients one at a time (smallest first: pins, blocked, search, audit). Longer term, share the Schema definitions and HttpApi-derived client with web (see the web-vs-mobile auditor); do not start that before F1 core exists.

### F3. Mock layer and dev screens in the release bundle (bundle/startup, medium, effort S)
Evidence: `store/chat-store-provider.tsx:19-20` imports `createChatStore` (mock, 1,595 lines) and `mock/gate`; 16 files import `@/mock` (list in measurements); each `use-X-api.ts` imports `createMockXApi` statically (`components/ais/use-ais-api.ts:6`). `?mock=` is gated at run time by `__DEV__ || EXPO_PUBLIC_ZILAR_MOCK`, but the code is bundled either way. `app/dev/kit.tsx` and `app/dev/whistle.tsx` (574 lines) are routes in the file router, always bundled.
Impact: about 5.1k lines of JS (store 1,595 + mock 2,973 + hooks/dev 574) parsed as part of 13 MB bytecode. Hermes loads bytecode lazily but module registration and inline requires still touch them when the providers evaluate; startup gain modest (tens of ms, UNVERIFIED), bundle gain roughly 300-500 KB bytecode (estimate: 8% of lines).
Risk: tests rely on the mock store (`chat-store.test.ts`, `selector-stability.test.ts`); keep it in the repo, just not in the app import graph.
Recommendation: put the mock selection behind `if (__DEV__ || ENV_MOCK)` with `require()` inside the branch (Metro dead-code-eliminates `__DEV__ === false` in release), or move dev screens to `src/app/(dev)` guarded by a `+not-found`-style redirect when not `__DEV__`. Verify with a second `expo export` and compare `.hbc` size.

### F4. Dead light-theme branch in a dark-only app (clarity, medium, effort M)
Evidence: `app/_layout.tsx:56-58` `colorScheme.set('dark')`, comment "D24 is dark only". `grep '\[scheme\]'` = 155 hits; `asColorScheme(useColorScheme().colorScheme)` = 135 (74 `useColorScheme().colorScheme` call sites). `lib/colors.ts:10,18,33,38,43` keep `light:` values for each token; `lib/color-scheme.ts:3` defaults to `'light'` when null.
Impact: every one of those components subscribes to a context that never changes, and each needs a `scheme` variable and a two-key lookup; removing it deletes about 300-450 lines and one hook per component (estimate: 2-3 lines per site).
Risk: Julio may want light mode later; then the tailwind `dark:` classes (only 1 `dark:` in `global.css`) are the cheaper path (CSS vars). Detect with `tokens-drift.test.ts` and screenshot smoke.
Recommendation: first ask the owner (Open question 1). If dark-only stays: replace `ICON[scheme]` style lookups by constants (`ICON.default`) and delete `asColorScheme` usages mechanically; do per directory.

### F5. Fonts and icon assets (bundle size, medium, effort S)
Evidence: `_layout.tsx:4-5` imports named weights from `@expo-google-fonts/geist` and `geist-mono`; Metro still emits all 36 TTFs (18+18, 91-105 KB each, ~3.5 MB of the 4.4 MB assets) because the package index requires every font file. The app loads 5 (`:33-39`).
Impact: about 3 MB less in the APK/IPA (36 files * ~100 KB minus 5), no JS change; also faster install.
Recommendation: import from the weight files (`@expo-google-fonts/geist/400Regular`) or use the `expo-font` config plugin with just the 5 files in `app.json`. Check the result with `expo export`. Also check who pulls `MaterialSymbols_400Regular.ttf` (967 KB) in; likely `@expo/vector-icons` via expo-router; it can be excluded with a Metro `assetExts`/resolver stub if truly unused.

### F6. Two store implementations of one contract (clarity, medium, effort L)
Evidence: `store/chat-store.ts:519` and `real-store.ts:1899` both implement `messages: (chatId) => ...` of `ChatStoreState` (`types.ts`, 507 lines); real-store is 1,928 lines plus `store/effects/*` 3,524. 
Impact: every new store action has to be written twice (mock + real) plus a mock fixture; mock is 1,595 lines and 3 test files. The real store has its own test double layer (`real-store*.test.ts` 5k+ lines).
Recommendation: keep the mock only as a thin adapter over the real store with a fake transport (XMPP + REST fakes already exist in tests), so one implementation remains. This is a medium-term simplification; do F3 first.

### F7. Screen duplication (settings/AI) (lines, low-medium, effort M)
Evidence: `components/ais/screen-shell.tsx` (85 lines) and `components/settings/screen-shell.tsx` (68) are near twins; each screen repeats a `RequireAuth` wrapper + `useColorScheme` + `useXApi` + `useState<'loading'|'ready'|'error'>` + `useAction` load pattern (`settings/blocked.tsx:19-60`, `requests.tsx`, `machines.tsx`, `connections.tsx`, `approvals.tsx`). The `call()`/`rawCall()`/`callStore()`/`runInBackground()` helpers (`machines.tsx:55`, `group/[id].tsx:54`, `channel-screen.tsx:43`, `chat/[id].tsx:61`) are the same `Effect.tryPromise({try: call, catch})` wrapper, 16 occurrences across files.
Impact: about 600-900 lines with a `useLoad(api.method)` hook returning `{status, data, error, reload}`, plus one shell. Settings screens (integrations 751, machines 721, approvals 533, connections 529, profile 521) each contain 2-3 cards/forms in a single file; splitting is a clarity win, not a line win.
Recommendation: extract `useLoadedResource`, merge the shells, then split files above 600 lines by card/section.

### F8. Large screens and sheets (clarity, effort M each)
- `app/chat/[id].tsx` 1,117 lines, 47 `useChatStore` calls and 82 hooks (state/effect/store) in one component: re-renders on every one of them. Split into container + sub-components (header, banners, sheet host); sheets already separate in `components/chat`.
- `app/group/[id].tsx` 836 (it is the topic list for a group) and `channel-screen.tsx` 408: share the group detail loading + role messages; extract a `useGroupDetail`.
- 15 sheets in `components/chat/*sheet*.tsx` total 3.8k lines (media-sheet 491, topic-sheets 450, invite-links-sheet 381 ...). They already use `ui/bottom-sheet.tsx` (73 lines) and `action-sheet.tsx`; the kit is small (1,071 lines), so most per-sheet bulk is form markup and state, fine.
- `ais/tool-detail-sheet.tsx` 812 lines is one of the top files; its `ScrollView horizontal` at `:276` and `:779` hold lists and need a read for split points.

### F9. Lists inside ScrollView (perf, low-medium, effort S per screen)
Evidence: `settings/requests.tsx:133`, `blocked.tsx:119`, `approvals.tsx:366`, `machines.tsx:342`, `connections.tsx:204`, `message-search-list.tsx:175` (search results, can be hundreds), `new-group-sheet.tsx:205` (member picker over the whole directory), `emoji-tab.tsx:74,114` (emoji grid; `lib/emoji-data.ts` 443 lines). These render all rows. Fine for the small ones (blocked, machines), real cost for search results and emoji grid.
Recommendation: `FlatList` (or `SectionList` for emoji) for message-search-list and emoji-tab; leave the others.

### F10. Chat list rows (perf, low, effort S)
`ChatListItem` selects `typing`, `drafts`, `messages(chat.id)` and `currentUserId` per row (`chat-list-item.tsx:52-56`) and is not memoised; the parent passes new `onPress`/`onLongPress` closures (`(tabs)/index.tsx:432-436`). With 50-200 chats a store update (new message anywhere) re-runs every row's selectors (cheap) and re-renders those whose result is new reference. `messages(chat.id)` returns a stable array per chat when unchanged, so re-renders are limited; low severity. Fix: `memo(ChatListItem)` and pass `chatId` + a stable `onOpen(chatId)`; add `getItemLayout` if rows have fixed height.

### F11. Startup path (low, effort S)
`_layout.tsx`: polyfills (2 shims, 60 lines, justified), `global.css`, five fonts, `SessionBootstrap`, `ChatStoreProvider` creating the whole real store (`createRealChatStore`) eagerly during first render even on the login screen, `void mobileRuntime` to force-bundle the Effect runtime, `Effect.runFork` for splash calls. Fonts block first render (`return null` until `fontsReady`), which is normal with the splash. The store is only `start()`ed when authenticated, so the XMPP connection is not opened on cold login; cost is object creation only. No change needed beyond F3/F5. The app loads 4,623 modules with expo-router's eager route map; `unstable_lazy`/async routes are not enabled (UNVERIFIED benefit on Hermes where bytecode is mmapped).

### F12. Dead files (tiny)
`components/chat/use-invites-api.ts` (37, no importer and no test), `lib/whistle-last-voice.ts` (17, test-only), `lib/hooks-guard.ts` (20) and `lib/native-pitfalls-scan.ts` (87) are test-only helpers (live under `src/lib` so they are in the bundle graph only if imported; they are not). `src/types/*.d.ts` are type shims. Delete the first, move the test-only ones next to their tests. About 150 lines.

## 4. Looks bad but should stay
- `lib/polyfills.ts`: two shims xmpp.js needs on Hermes, small and documented.
- `metro.config.js` stubs for `@xmpp/tcp`/`tls` and `node:*`: required for the WebSocket-only XMPP client; guarded by a startup check.
- `zilar-whistle` native module (Kotlin 532 + JNI 117 + TS ~700): on-device Whistle STT through Cactus Needle, Android arm64 only, engine fetched at build time with sha256 checks, model downloaded on demand; offline voice transcription cannot be done in JS. Keep. The cost is a native build step and ~40 MB model download (user-initiated); the `/dev/whistle` screen can go (F3).
- Custom `atomStore` (zustand-shaped over Effect atoms): a thin 100-line adapter that kept 47+ screens untouched during the zustand to atom migration. Fine; removing the zustand shape is a later cleanup.
- Tests are 59k lines (93% of source): mobile tests per screen under `components/screens` are slow-ish but they are the safety net for the workers; keep, but dedupe the `.effect.test` / `-api.test` pair when F1 lands.
- Own `ui/` kit (1,071 lines, 20 components): small, used everywhere, has Cosmos/kit catalog.
- Direct `ios/` project present and git-ignored: no repo cost.

## 5. Open questions for the owner
1. Is mobile dark-only permanent? If yes, F4 removes about 400 lines and 135 hook subscriptions.
2. Is `?mock=` mode still used for demos/emulator QA, or can the mock store leave the app graph (F3/F6)?
3. Should the chat history on mobile be bounded (virtual window) or is full-history scrollback with jump-to-message a requirement? That decides F2 (memo only vs FlashList).
4. Do you want one shared typed API client for web and mobile (Effect HttpApi client from the server definition)? It would supersede F1 and remove the `*-api.ts` copies on both sides; larger task, needs the web auditor's view.
5. Are the always-bundled `/dev/kit` and `/dev/whistle` routes wanted in release builds?
