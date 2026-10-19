---
id: T-2214
title: "Apply the ARCHITECTURE import rule everywhere: delete the ~51 pass-through re-export lines outside package index files and the import rename aliases that hide no clash; importers use the defining module under its own name; no behaviour change"
status: merged
milestone: M5
branch: task/T-2214-no-reexports
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2214: No pass-through re-exports, no needless aliases

## Spec (written by Claude, do not edit)

### Why
`docs/ARCHITECTURE.md:74`: "Import from the module that defines the name, under its own name: no pass-through re-export lines and no rename aliases. Only a package's `src/index.ts` re-exports." The code still breaks this in many places, so readers (AIs and people) follow names through extra hops.

### Facts (the lead counted on 2026-10-19)
1. **Re-exports:** 51 lines matching `^export (type )?\{[^}]*\} from '` outside `index.ts` and tests. The most are in:
   - `packages/devtools/src/lead/watch.ts` (9), `packages/client-core/src/store/send.ts` (8), `apps/web/src/store/realStore.ts` (6);
   - `packages/client-core/src/store/lifecycle.ts` (3), `packages/devtools/src/lead/policy.ts` (2), `apps/web/src/store/effects/constants.ts` (2), `apps/web/src/lib/api/settings.ts` (2);
   - 1 each in about 10 other files.

   List them all:
   `git grep -nE "^export (type )?\{[^}]*\} from '" -- 'apps/*/src/**/*.ts' 'apps/*/src/**/*.tsx' 'packages/*/src/**/*.ts' ':!**/index.ts' ':!*.test.ts'`
2. **Aliases:** about 34 import aliases (`x as y`). Find them with:
   `git grep -nE "^\s+[a-zA-Z_]+ as [a-zA-Z_]+,?$|import \{[^}]* as [a-z]" -- 'apps/*/src/**/*.ts' 'apps/*/src/**/*.tsx' 'packages/*/src/**/*.ts' ':!*.test.ts' ':!*.test.tsx'`
3. **Allowed by the rule:** `apps/web/src/lib/api.ts` with `export *`, and every package `src/index.ts`.

### Steps
1. **For each re-export line:**
   - find its importers by the re-exporting module's path (`git grep -n "from '<that module path>'"`, including relative forms);
   - point each importer at the defining module (inside a package, its relative file; across packages, the package's public path such as `@zilar/client-core/store`);
   - delete the line.

   If a name is not exported by the target package's `index.ts` and an app needs it, add it to that `index.ts`.
2. **For each alias:** keep it only when the file has another binding with the same name, a real clash such as `request` from both `node:http` and `node:https`, or a local function with the same name. Otherwise import the name as itself and rename its uses in that file.
3. Tests may change only their import lines.
4. No behaviour change: names, types and runtime stay the same. Do not move code between files.
5. In the Report, list every file changed with what moved, and each alias kept and why (the clashing binding).

### Allowed files
- Any `.ts` / `.tsx` file under `apps/*/src` and `packages/*/src` that holds one of the lines from facts 1–2, or imports a name from one of them (imports only)
- The `src/index.ts` of a package, to export a name an app now imports from it
- `work/T-2214-no-reexports.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The fact 1 command prints nothing.
- Every alias left from the fact 2 command is listed in the Report with its clash.
- Net lines go down.

---

## Report (written by the worker when done)

**Status:** done — ready for review.

### What I did

Deleted 61 one-line pass-through re-export lines, pointed every importer at the defining module, and exported the needed names from the package indexes. Renamed the needless import aliases; kept only those with a real same-scope clash. No code moved, no runtime or type behaviour changed, and tests changed import lines only.

The task's two fact commands use a git pathspec glob (`apps/*/src/**/*.ts`) that silently skips some nested files. I ran the same regex over every `src` file as well, which found 11 more one-line re-exports in `packages/xmpp-core` and `packages/chat-core`; those are fixed too. Multi-line re-exports (e.g. `export {\n  X,\n} from ...`) were never in scope and are untouched.

### Re-export lines deleted (file → names)

- `apps/mobile/src/lib/attachments.ts` → `isTrustedMediaUrl`, `MAX_ATTACHMENT_BYTES`, `MediaTokenShape`
- `apps/mobile/src/lib/drafts.ts` → `OpenDraftStream`
- `apps/mobile/src/lib/effect/use-action.ts` → `isWaiting`
- `apps/mobile/src/lib/pins-api.ts` → `Pin`
- `apps/mobile/src/lib/roles-api.ts` → `GroupRole as CustomGroupRole`
- `apps/mobile/src/store/effects/events.ts` → `TYPING_CLEAR_MS`
- `apps/mobile/src/store/real-store.ts` → `AppStateLike`, `RealStoreDeps`
- `apps/web/src/lib/api.ts` → `API_BASE`, `ApiError` (now `export * from './api/http'`, the allowed barrel form)
- `apps/web/src/lib/api/ais.ts` → `ApprovalDecision`, `ApprovalStatus`
- `apps/web/src/lib/api/settings.ts` → `AuditScope`, `ListAuditInput`, `ListAuditPage`, `SaveEmailSettingsInput`, `SaveVoiceTranscriptionInput`
- `apps/web/src/lib/push.ts` → `totalBadgeUnread`
- `apps/web/src/store/effects/constants.ts` → `CONNECT_RETRY_DELAYS_MS`, `FINISHED_TURNS_MAX`
- `apps/web/src/store/effects/history.ts` → `loadOlder`, `openHistory`
- `apps/web/src/store/effects/lifecycle.ts` → `CONNECT_RETRY_DELAYS_MS`, `readLastRead`
- `apps/web/src/store/effects/ports.ts` → `ApiClient`, `StorageLike`
- `apps/web/src/store/effects/reads.ts` → `persistLastRead`, `recordRead`
- `apps/web/src/store/realStore.ts` → `CONNECT_RETRY_DELAYS_MS`, `TOPIC_REFRESH_INTERVAL_MS`, `mergeWithPainted`, `summariesFor`, `SEND_TIMEOUT_MS`, `sendFailureReasonFor`, `DRAFT_END_FALLBACK_MS`, `DRAFT_IDLE_MS`, `ApiClient`, `RealStoreDeps`, `StorageLike`
- `apps/web/src/store/store.ts` → `matchesFolder`, `visibleChats`
- `packages/chat-core/src/ai.ts` → `isAiJid`
- `packages/chat-core/src/emoji.ts` → `EMOJI_BY_CATEGORY`
- `packages/client-core/src/store/actions.ts` → `SendStickerInput`, `SendTextOptions`
- `packages/client-core/src/store/chat-rows.ts` → `ServerRowFields`
- `packages/client-core/src/store/lifecycle.ts` → `flushOnline`, `onAuthFailed`, `SessionCheck`, `CONNECT_RETRY_DELAYS_MS`
- `packages/client-core/src/store/send.ts` → `forwardMessages`, `createTextOutbox`, `flushOutbox`, `TextOutbox`, `disarmSend`, `SEND_TIMEOUT_MS`, `retrySticker`, `sendSticker`, `ackText`, `sendText`, `unackText`, `retryText`, `retryAttachment`, `sendAttachment`, `retryVoice`, `sendVoice`
- `packages/devtools/src/lead/free-pause.ts` → `isFreeListing`
- `packages/devtools/src/lead/policy.ts` → `allowAllEnabled`, `classifyPermission`, `extractCommands`, `tmpdir`, `Classification`, `PermissionRequest`, `PolicyContext`, `Verdict` (file became empty and was deleted)
- `packages/devtools/src/lead/watch.ts` → `ChangedFile`, `FileKind`, `parseChangedFiles`, `liveStep`, `SessionSpeed`, `sessionSpeed`, `WatchEntry`, `WatchView`, `parseWatchView`, `BoardTaskFacts`, `boardModelFor`, `boardTaskEntry`, `buildView`, `collectFiles`
- `packages/xmpp-core/src/client.ts` → `ClientFactory`, `ClientOptions`, `CoreDependencies`
- `packages/xmpp-core/src/core-effect.ts` → `ClientFactory`, `ClientOptions`, `CoreDependencies`
- `packages/xmpp-core/src/stanza.ts` → `sanitizeReactions`, `ReplyRef`, `resolveSender`, `albumElement`, `parseAlbum`, `ALBUM_ID_MAX`, `ALBUM_MAX`
- `packages/xmpp-core/src/types.ts` → `MessageAlbum`, `StreamAckEvent`, `DeliveredMarkEvent`, `WakeOutcome`

Package indexes that now export the moved names directly from the defining module:

- `packages/client-core/src/store/index.ts`: `SessionCheck`, `onAuthFailed`, `CONNECT_RETRY_DELAYS_MS`, `flushOnline`, the eight `send/*` modules' names, `SendStickerInput`, `SendTextOptions`
- `packages/chat-core/src/index.ts`: `isAiJid` from `@zilar/protocol`, `EMOJI_BY_CATEGORY` from `./emoji-table.generated`
- `packages/xmpp-core/src/index.ts`: `MessageAlbum` from `./stanza/album`, `DeliveredMarkEvent` from `./types-delivered`

### Importers repointed (file → new source)

`isWaiting` → `@zilar/client-core` (33 mobile files):

`app/ais/[id].tsx`, `app/chat/[id].tsx`, `app/group-info/[id].tsx`, `app/group/[id].tsx`, `app/group/new.tsx`, `app/me.tsx`, `app/settings/approvals.tsx`, `app/settings/blocked.tsx`, `app/settings/contacts.tsx`, `app/settings/folder/[id].tsx`, `app/settings/folders.tsx`, `app/settings/notifications.tsx`, `app/settings/requests.tsx`, `app/settings/routines.tsx`, `app/stickers/[packId].tsx`, `app/u/[handle].tsx`, `app/welcome/name.tsx`, `auth/AuthFlow.tsx`, `components/ais/tool-detail-loader.tsx`, `components/chat/attach-sheet.tsx`, `components/chat/channel-screen.tsx`, `components/chat/chat-composer-dock.tsx`, `components/chat/composer-media.ts`, `components/chat/new-chat-button.tsx`, `components/chat/payload-card.tsx`, `components/chat/topic-info-sheet.tsx`, `components/chat/use-group-new-topic.ts`, `components/chat/use-group-visibility.ts`, `components/group-info/ais-list.tsx`, `components/group-info/allowed-page.tsx`, `components/group-info/info-keys.tsx`, `components/group-info/members-page.tsx`, `components/group-info/settings-page.tsx` (all under `apps/mobile/src/`)

`MAX_ATTACHMENT_BYTES` → `@zilar/chat-core`: `apps/mobile/src/lib/attachment-opener.ts`, `apps/mobile/src/lib/attachment-picker.ts`, `apps/mobile/src/app/share.tsx`, `apps/mobile/src/components/chat/composer-media.ts`, `apps/mobile/src/store/effects/send.ts`; `isTrustedMediaUrl` → `@zilar/chat-core`: `apps/mobile/src/store/effects/pins.ts`

`OpenDraftStream` → `@zilar/client-core/store`: `apps/mobile/src/store/effects/ports.ts`

`Pin` → `@zilar/api-contract`: `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/effects/pins.ts`, `apps/mobile/src/store/real-store.lifecycle.test.ts`

`GroupRole as CustomGroupRole` → `@zilar/api-contract`: `apps/mobile/src/lib/roles.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/effects/locals.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/effects/group-roles-actions.ts`, `apps/mobile/src/app/group-info/[id].tsx`, `apps/mobile/src/components/chat/topic-info-sheet.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/group-info/members-page.tsx`

`AppStateLike` / `RealStoreDeps` → `apps/mobile/src/store/effects/ports.ts`: `apps/mobile/src/lib/drafts.ts`, `apps/mobile/src/store/test-support.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/store/real-store.send.test.ts`, `real-store.ledger.test.ts`, `real-store.incoming.test.ts`, `real-store.lifecycle.test.ts`, `offline-cache.test.ts`, `real-store.history.test.ts` (store tests under `apps/mobile/src/store/`)

`totalBadgeUnread` → `@zilar/chat-core`: `apps/web/src/store/effects/badge.ts`, `apps/web/src/store/effects/ports.ts`

`openHistory` / `loadOlder` → `@zilar/client-core/store`: `apps/web/src/store/effects/groupCreate.ts`, `apps/web/src/store/effects/topics.ts`, `apps/web/src/store/effects/chatActions.ts`; `recordRead` → same path: `apps/web/src/store/effects/chatActions.ts`

`ApiClient` → `./portTypes`: `apps/web/src/store/effects/groupCreate.ts`, `apps/web/src/test/storeHarness.ts`; `StorageLike` → `./portTypes` (or `./effects/portTypes`): `apps/web/src/store/chatListCache.ts`, `messageCache.ts`, `messageCache.test.ts`, `realStore.lifecycle.test.tsx`, `realStore.incoming.test.tsx`, `realStore.send.test.tsx`, `realStore.history.test.tsx`, `effects/history.test.ts`; `RealStoreDeps` → `./effects/ports`: the same four `realStore.*.test.tsx` files and `effects/history.test.ts`

`CONNECT_RETRY_DELAYS_MS` → `@zilar/client-core/store`: `apps/web/src/store/realStore.lifecycle.test.tsx`

`visibleChats` → `../../store/selectors`: `apps/web/src/components/chatList/rowsSelector.ts`

`AuditScope` → `@zilar/client-core`: `apps/web/src/components/ais/AiActivity.tsx`; `ApprovalDecision`, `ApprovalStatus` → `@zilar/api-contract`: `apps/web/src/components/ApprovalCard.tsx`

`isAiJid` → `@zilar/protocol`: `packages/chat-core/src/markdown.ts`

`ClientOptions` → `./core-effect/config`: `packages/xmpp-core/src/connection-resilience.test.ts`; `CoreDependencies` → `./core-effect/config`: `packages/xmpp-core/src/client.ts`; `sanitizeReactions` → `./stanza/reactions`: `packages/xmpp-core/src/stanza.test.ts`; `MessageAlbum` → `./album`: `packages/xmpp-core/src/stanza/build-outgoing.ts`; `DeliveredMarkEvent` → `./types-delivered`: `packages/xmpp-core/src/stanza.ts`

`isFreeListing` → `./models.js`: `packages/devtools/src/lead/state.ts`, `fresh-session.ts`, `launch.ts`, `task-file.ts`, `free-pause.test.ts`; policy names → `./policy/classify.js` / `./policy/types.js`: `packages/devtools/src/lead/decide.ts`, `session.ts`, `autopilot.ts`; watch names → `./watch/changed-files.js`, `./watch/speed.js`, `./watch/view.js`: `packages/devtools/src/lead/watch-app.tsx`

`flushOutbox` → `./send/outbox`, `ackText` / `unackText` → `./send/text`: `packages/client-core/src/store/online.ts`, `connect.ts`; `send.test.ts` now imports each send name from its own module.

Alias-only changes: `apps/server/src/connections/base-url.ts`, `apps/server/src/gifs/api.ts`, `giphy.ts`, `routes.ts`, `apps/server/src/sandbox/host-fetch.ts`, `apps/server/src/web-tools/guarded-fetch.ts` (`dnsLookup`→`lookup`, `httpsRequest`→`request` where free), `packages/desk/src/egress/proxy.ts` (`dnsLookup`→`lookup`, `netConnect`→`connect`), `packages/devtools/src/lead/watch.ts` (`renderInk`→`render`), `apps/mobile/src/store/effects/group-roles-actions.ts` (`changeTopicCore`→`changeTopic`), `apps/web/src/store/effects/chatActions.ts` (dropped four aliases).

### Aliases kept, and the binding they clash with

All 22 lines the fact-2 command still prints:

- `apps/mobile/src/app/_layout.tsx` — `useClientVersionCheck as useSharedClientVersionCheck`: local `function useClientVersionCheck` at line 162.
- `apps/mobile/src/components/chat/message-bubble.tsx` — `tap as tapHaptic`: local `const tap: TapGesture` at line 325.
- `apps/mobile/src/lib/groups-api.ts` — `makeGroupsApi as makeSharedGroupsApi`: local `export function makeGroupsApi` at line 64.
- `apps/mobile/src/lib/media-retry.ts` — `useMediaRetry as useSharedMediaRetry`: local `export function useMediaRetry` at line 16.
- `apps/mobile/src/lib/stickers-api.ts` — `makeStickersApi as makeSharedStickersApi`: local `export function makeStickersApi` at line 71.
- `apps/mobile/src/store/effects/chat-rows.ts` — `summariesFor as coreSummariesFor`: local `export function summariesFor` at line 21.
- `apps/server/src/connections/pinned-fetch.ts` — `request as httpRequest` and `request as httpsRequest`: two bindings named `request`, from `node:http` and `node:https`.
- `apps/server/src/files/internal-fetch.ts` — same two `request` bindings.
- `apps/server/src/sandbox/host-fetch.ts` — `request as httpsRequest`: the module's parameters are named `request` (`ValidatedFetchRequest`), which would shadow the import.
- `apps/server/src/tools/routes.ts` — `withServiceErrors as withServiceErrorsMapped`: local `export const withServiceErrors` at line 512.
- `apps/web/src/components/GifMessage.tsx` — `isGifVideoAttachment as isSharedGifVideoAttachment`: local `export function isGifVideoAttachment` at line 66.
- `apps/web/src/components/media/mediaModel.ts` — `formatDuration as formatDurationMs`: local `export function formatDuration` at line 25.
- `apps/web/src/lib/composer-drafts.ts` — `useComposerDraft as useShared`: local `export function useComposerDraft` at line 36.
- `apps/web/src/lib/media-retry.ts` — `useMediaRetry as useSharedMediaRetry`: local `export function useMediaRetry` at line 6.
- `apps/web/src/lib/useSmoothText.ts` — `useSmoothText as useCoreSmoothText`: local `export function useSmoothText` at line 54.
- `apps/web/src/store/effects/runtime.ts` — `makeLifetime as makeCoreLifetime`: local `export function makeLifetime` at line 14.
- `apps/web/src/store/effects/storeContext.ts` — `saveChatList as saveChatListHook`: local `function saveChatList` at line 61.
- `packages/client-core/src/store/ledger-identity.ts` — `userLocalpartOf as sharedUserLocalpartOf`: local `function userLocalpartOf` at line 22.
- `packages/desk/src/agent/docker-args.ts` — `execFile as execFileCallback`: local `export function execFile` at line 14.
- `packages/desk/src/agent/workspace.ts` — `execFile as execFileCallback`: local `function execFile` at line 34.
- Outside the fact-2 command's glob, also kept for the same reason: `apps/web/src/main.tsx` (local `useClientVersionCheck`), `packages/devtools/src/xmpp-e2e.ts` (local `connect`).

### Commands run and results

- `pnpm install` → `Done in 13.5s using pnpm v10.32.1`.
- `pnpm gate` (after two intermediate runs that failed on format and then on four test imports; both fixed) → exit 0:

```
PASS  install (frozen)  (1.3s)
PASS  format  (2.6s)
PASS  lint  (1.1s)
PASS  typecheck  (9.9s)
PASS  effect  (3.7s)
PASS  build @zilar/server  (0.6s)
PASS  tests @zilar/chat-core  (1.9s)
PASS  tests @zilar/client-core  (9.1s)
PASS  tests @zilar/desk  (0.6s)
PASS  tests @zilar/devtools  (18.4s)
PASS  tests @zilar/mobile  (6.4s)
PASS  tests @zilar/server  (6.2s)
PASS  tests @zilar/web  (6.8s)
PASS  tests @zilar/xmpp-core  (1.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```

- I ran no separate test files; `pnpm gate` ran every touched package's suite once, and all passed.
- `git diff --numstat` totals: 225 insertions, 257 deletions (`-32` net).
- The task's fact-1 command now prints one line, the framework exception below. The same regex over every `src` file prints only that same line.

### Deviations and open questions

1. **`ErrorBoundary` is kept.** `apps/mobile/src/app/_layout.tsx:191` exports Expo Router's own error boundary. It is the router's required convention for the root layout; deleting it changes the runtime error screen, which step 4 forbids. The fact-1 command therefore prints this one line. Please either exempt it (like the `api.ts` exception) or tell me to remove it.
2. **Fact command globs miss files.** The fact-1 pathspec missed 11 one-line re-exports in `packages/xmpp-core` and `packages/chat-core`; they are fixed. The fact-2 pathspec only catches single-line imports and misses nested paths; I fixed the 34 it found and the four `chatActions` aliases that the re-export work already touched, but the many multi-line aliases elsewhere (e.g. `sendText as sendTextCore`) are untouched because they were outside the task's counted set.
3. `apps/web/src/lib/api.ts`'s explicit `API_BASE`/`ApiError` re-export became `export * from './api/http'` so the one allowed barrel keeps working.
4. `packages/devtools/src/lead/policy.ts` was only those two re-export lines; after repointing its three importers the file was deleted rather than left empty.
5. Tests changed import lines only (`send.test.ts`, `stanza.test.ts`, `connection-resilience.test.ts`, `free-pause.test.ts`, the mobile and web store tests).

### Round 1 (fix review finding)

- Fixed finding 1 (should-fix): dropped the nine needless `GroupRole as CustomGroupRole` aliases and imported `GroupRole` under its own name in `apps/mobile/src/lib/roles-api.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/effects/locals.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/effects/group-roles-actions.ts`, `apps/mobile/src/app/group-info/[id].tsx`, `apps/mobile/src/components/chat/topic-info-sheet.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/group-info/members-page.tsx`, renaming the uses in each file. The alias is kept only in `apps/mobile/src/lib/roles.ts`, which also imports `GroupRole` from `./chat-api` (real clash).
- Tests added: none. This is an import/type rename with no behaviour change, and the finding names no test; the affected files are mobile UI and store types.
- `pnpm gate`: `GATE PASS` (install, format, lint, typecheck, effect, build @zilar/server and tests for chat-core, client-core, desk, devtools, mobile, server, web, xmpp-core all passed; every changed file is inside the Allowed files). The first run failed on `format` for `apps/mobile/src/store/types.ts`; running Prettier on that file fixed it.


## Review (written by Claude)

Approved; clean after 1 auto round. One nit: a redundant explicit re-export in `client-core/src/store/index.ts:26`. Net −36 over 126 files.

**What changed:**
- Pass-through re-exports outside package index files are gone; importers point at the defining module.
- Rename aliases that hide no clash are gone. The fix round dropped the new `GroupRole as CustomGroupRole` aliases.

**Exemption, accepted:** `apps/mobile/src/app/_layout.tsx` keeps `export { ErrorBoundary } from 'expo-router'`. Expo Router reads that export as the root error screen, so it is not a pass-through.

**Lead checks:**
- Web mock: identical to main except the Dev-1 preview, because the branch predates T-2215 and the rebase brings it.
- Phone emulator smoke passes: the chat list, Ana's DM and Settings › Connections.
