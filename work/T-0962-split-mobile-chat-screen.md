---
id: T-0962
title: "Size split T15: apps/mobile/src/app/chat/[id].tsx (1,118 lines) into components/chat/{use-chat-screen,chat-header-bar,chat-thread,chat-composer-dock,chat-overlays,topic-info-host} + lib/effect/run-in-background.ts"
status: merged
milestone: M5
branch: task/T-0962-split-mobile-chat-screen
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0962: Split the mobile chat screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/chat/[id].tsx` is 1,118 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #11 (task T15). The new files:
- `lib/effect/run-in-background.ts`;
- `components/chat/use-chat-screen.ts`;
- `components/chat/chat-header-bar.tsx`, `components/chat/chat-thread.tsx`, `components/chat/chat-composer-dock.tsx`, `components/chat/chat-overlays.tsx`, `components/chat/topic-info-host.tsx`;

all under `apps/mobile/src/`.

The route file `app/chat/[id].tsx` stays the screen: Expo Router needs its default export there. The entry's in-file Dedup applies: the `MessageList` and `DismissBanner` stack repeated at about 728–769 and 949–990 becomes one `chat-thread.tsx`.

There are no mobile UI tests (Julio's rule). The lead runs a phone smoke of the chat screen.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #11, and `apps/mobile/src/app/chat/[id].tsx`.

### Allowed files
`apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/lib/effect/run-in-background.ts`, `apps/mobile/src/components/chat/use-chat-screen.ts`, `apps/mobile/src/components/chat/chat-header-bar.tsx`, `apps/mobile/src/components/chat/chat-thread.tsx`, `apps/mobile/src/components/chat/chat-composer-dock.tsx`, `apps/mobile/src/components/chat/chat-overlays.tsx`, `apps/mobile/src/components/chat/topic-info-host.tsx`, `work/T-0962-split-mobile-chat-screen.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's phone smoke passes.

---

## Report (written by the worker when done)

### What I did

Split `apps/mobile/src/app/chat/[id].tsx` (1,118 lines, main `a64ac2b6`) per `docs/audit/size-plan.md` §2.1 #11 (task T15) and `docs/audit/split-rules.md`. The route stays the screen (`RequireAuth` + the three branch bodies) for Expo Router's default export. New files: `lib/effect/run-in-background.ts`; `components/chat/use-chat-screen.ts`, `chat-header-bar.tsx`, `chat-thread.tsx`, `chat-composer-dock.tsx`, `chat-overlays.tsx`, `topic-info-host.tsx`.

### Files and sizes (`wc -l`)

- old `apps/mobile/src/app/chat/[id].tsx`: **1118**
- new:
  - `apps/mobile/src/app/chat/[id].tsx`: **251**
  - `apps/mobile/src/lib/effect/run-in-background.ts`: **24**
  - `apps/mobile/src/components/chat/use-chat-screen.ts`: **345**
  - `apps/mobile/src/components/chat/chat-header-bar.tsx`: **42**
  - `apps/mobile/src/components/chat/chat-thread.tsx`: **147**
  - `apps/mobile/src/components/chat/chat-composer-dock.tsx`: **177**
  - `apps/mobile/src/components/chat/chat-overlays.tsx`: **58**
  - `apps/mobile/src/components/chat/topic-info-host.tsx`: **123**

Every file is under the 400-line limit.

### Export list, before → after

Before (`git show main:apps/mobile/src/app/chat/[id].tsx | grep -E "^export"`) there was exactly one export:

```
71:export default function ChatScreen() {
```

After:

```
apps/mobile/src/app/chat/[id].tsx:19:export default function ChatScreen() {
apps/mobile/src/lib/effect/run-in-background.ts:16:export function runInBackground<A>(...)
apps/mobile/src/components/chat/use-chat-screen.ts:21:export function useChatScreen() {
apps/mobile/src/components/chat/use-chat-screen.ts:345:export type ChatScreen = ReturnType<typeof useChatScreen>;
apps/mobile/src/components/chat/chat-header-bar.tsx:20:export function ChatHeaderBar(
apps/mobile/src/components/chat/chat-thread.tsx:25:export function ChatThread(
apps/mobile/src/components/chat/chat-composer-dock.tsx:29:export function ChatComposerDock(
apps/mobile/src/components/chat/chat-overlays.tsx:18:export function ChatOverlays(
apps/mobile/src/components/chat/topic-info-host.tsx:15:export function TopicInfoHost(
```

The route's own surface is unchanged (default `ChatScreen`), so no importer changed. `runInBackground` was module-private before and is now exported for the moved components.

### Dedup (as the plan entry asked)

- `chat-thread.tsx`: one `MessageList` + `DismissBanner` stack replaces the three identical blocks (old 561–602, 728–769, 949–990).
- `chat-composer-dock.tsx`: one `SelectionBar`/`Composer`/`ChannelComposerBar` wrapper replaces the three composer blocks (old 603–666, 770–833, 991–1022), chosen by a `variant` prop.
- `chat-header-bar.tsx` also folds the three identical `SafeAreaView > ChatHeader` wrappers (old 534–545, 701–712, 864–877).

### Deviation from the plan (per `split-rules.md` item 4)

`use-chat-screen.ts` would have exceeded 400 lines if it held every handler the entry lists, so the handlers that belong to a single moved component live in that component:

- `chat-thread.tsx`: `openAttachment`/opener/`openingId`/`openError`, `pin`/`unpin`/`pinError`, `voiceHost` (message-list-only).
- `chat-composer-dock.tsx`: `sendTextNow`/`sendAttachmentNow`/`sendVoiceNow`, the mock demo memos and the `@`-mention memo.
- `topic-info-host.tsx`: `saveTopicRoles`/`toggleTopicRole` and the retry handlers.
- `chat-overlays.tsx`: `sheetUnpin` and its local state.

The hook keeps every store subscription, the shared state, the effects and the cross-cutting handlers (`startReply`/`cancelReply`, `jumpTo`/`jumpToPin`, `patch`/`chooseStatus`, `openInfo`/`refreshInfoRoles`, `selection`/`forwardSelected`, `openGroup`).

### One behaviour-preserving code change (for lint)

`use-chat-screen.ts` replaces the old `useEffect(() => { setSelectedIds([]); }, [chatId])` (old 328–330) with React's derived-state pattern (adjust during render). oxlint's `react/set-state-in-effect` is `error` (correctness) and flags the effect in the new `.ts` file; the original `.tsx` only escaped it by accident, via an unrelated `react-hooks/exhaustive-deps` disable comment. The user-visible result is identical: selection is empty after switching chats, and now no frame ever shows the previous chat's checks. Everything else is moved unchanged.

### Commands and results

- `pnpm install`: done.
- `pnpm --filter @zilar/mobile typecheck`: passed (`tsc --noEmit`, no output).
- `pnpm gate` (repo root): **GATE PASS**.
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.9s)
  PASS  effect  (0.8s)
  SKIP  tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test file run: the mobile package has no test near these files.

### Effect ratchet

`apps/mobile/src/components/chat/chat-composer-dock.tsx` carries `// effect-plain: moved unchanged from apps/mobile/src/app/chat/[id].tsx (size split)` because the moved mock-mode memos read `process.env`. No other new file needed the marker.

### Open questions

- The phone smoke of the chat screen (spec: "the lead runs a phone smoke") has not run yet.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 2 nits.**
- **The split:** `app/chat/[id].tsx` (1,118 lines) is now 251 lines, plus `use-chat-screen.ts` (345), `chat-composer-dock.tsx` (177) and the other new files. The route file keeps its default export.
- **The lead's phone smoke** (mock build, emulator):
  - `/chat/dev-team@rooms.zilar.test` shows the header, topic chips, the history with the `@You` mention, and Dev-1's markdown;
  - `/chat/ai-dev-1@zilar.test` shows the Dev AI DM with headings, bold, a list and a code block.
- **Follow-ups, already on main and not caused by this task:**
  - "Could not load pins" (the pins domain is in mock wave 2);
  - an empty Dev-1 bubble in General;
  - markdown tables show as raw pipes on mobile.
- **Check:** the gate passed, and so did the mobile typecheck.
