---
id: T-1551
title: "AI work in topics (phone; twin of web T-1537): one status line above a topic's composer, 'Dev-1 · Running the tests +1', from the topic's activity and the AI's newest live card; liveStage moves to chat-core so web and phone share it"
status: merged
milestone: M5
branch: task/T-1551-mobile-ai-status-line
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1551: Phone status line above the topic composer

## Spec (written by Claude, do not edit)

### Why
The approved board `docs/design/mockups/ai-work/Phone.dc.html` shows one quiet line above the composer (`role="status"`): the first AI at work with its picture and what it does, then "+1" in mono for the others. Web shipped this as T-1537.

### Facts (the lead read them on main, 2026-10-15)
- **Web `apps/web/src/components/topic/AiStatusLine.tsx`** has a pure `liveStage(messages, jid)` (`:15-38`): it returns the newest progress card of that JID, giving its `stage` only while the card is `working` or has no state.
- **The shared data:**
  - activity entries carry `jid` since T-1537 (`TopicAiActivity.jid?` in `packages/chat-core/src/types.ts`);
  - `topicActivityView(activity, doneAt)` is in `packages/chat-core/src/topic-activity.ts` (`active` lists working, then waiting).
- **The phone composer:** `apps/mobile/src/components/chat/chat-composer-dock.tsx` (186 lines) renders `<Composer …/>` in its `variant === 'composer'` branch (`:151-160`). `chat.topic` is set for topics.
- **Phone messages:** `useChatStore((state) => state.messagesByChat[chatId])` (see `apps/mobile/src/components/chat/attachment-body.tsx:53`).
- **The avatar:** `EntityAvatar` is at `apps/mobile/src/components/chat/entity-avatar.tsx` (`person`, `size`, `ai`).

### Steps
1. **chat-core:**
   - move `liveStage` into `packages/chat-core/src/topic-activity.ts` as an exported `liveStageFor(messages, jid)`, unchanged;
   - web `AiStatusLine.tsx` imports it and drops its local copy;
   - add one test case for it to `packages/chat-core/src/topic-activity.test.ts`: a newer finished card returns `undefined`, and a working card returns its stage.
2. **New `apps/mobile/src/components/chat/ai-status-line.tsx`:** shown only for a topic whose `topicActivityView(...).active` is not empty. One row, `accessibilityRole` = text with a live region, 13 px muted, above the composer with 6 px vertical padding. It holds:
   - the first active AI's 16 px `EntityAvatar` (`ai`) and its name in the foreground colour;
   - then " · <stage>" when it is working with a live card, " is working" when it is working without one, or " is waiting for you" when it is waiting;
   - then " +N" in mono when more AIs are active.
   
   One line only, truncated with an ellipsis.
3. **`chat-composer-dock.tsx`:** render `<AiStatusLine chat={chat} />` just before `<Composer` in the composer branch (not for channels or selection), in at most 3 added lines.
4. **Every file stays under 400 lines.**

### Tests
The one chat-core case above (message pipeline helper).

### Allowed files
- `packages/chat-core/src/topic-activity.ts`
- `packages/chat-core/src/topic-activity.test.ts`
- `apps/web/src/components/topic/AiStatusLine.tsx`
- `apps/mobile/src/components/chat/ai-status-line.tsx` (new)
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `work/T-1551-mobile-ai-status-line.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/topic-activity.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Phone mock `/chat/t-devteam-bug@rooms.zilar.test`:** above the composer, "Dev-1 is working +1" with Dev-1's picture.
- General and idle topics show no line.
- The web status line is unchanged (same headless output as before).

---

## Report (written by the worker when done)

### What I did
- **chat-core:** moved web's `liveStage` into `packages/chat-core/src/topic-activity.ts` as the exported `liveStageFor(messages, jid)` (body unchanged; already re-exported through `index.ts`'s `export * from './topic-activity'`).
- **web:** `apps/web/src/components/topic/AiStatusLine.tsx` now imports `liveStageFor` from `@zilar/chat-core`, and the local `liveStage` copy is deleted. Its headless output is unchanged.
- **chat-core test:** added one case to `packages/chat-core/src/topic-activity.test.ts`: a live `progress` card returns its stage, and a newer finished card returns `undefined`.
- **new mobile component** `apps/mobile/src/components/chat/ai-status-line.tsx`: one 13 px muted row with `accessibilityRole="text"` and `accessibilityLiveRegion="polite"`, 6 px vertical padding. It shows the first active AI's 16 px `EntityAvatar` (`ai`) with its name in the foreground colour, then `· <stage>` (working with a live card) / `is working` / `is waiting for you`, then `+N` in mono for the rest. `numberOfLines={1}` truncates. It returns `null` for a non-topic chat or when `topicActivityView(topic.activity, topic.doneAt).active` is empty. Activity + stage come from `topicActivityView` and `liveStageFor(messagesByChat[chat.id], entry.jid)`.
- **`chat-composer-dock.tsx`:** imported `AiStatusLine` and rendered it just before `<Composer>` inside the `variant === 'composer'` branch (3 added render lines, plus the import). Wrapping the branch in a fragment made Prettier re-indent the existing `<Composer>` block (that re-indent is the rest of the diff in this file). Channels and the selection bar are untouched.

### Files changed
- `packages/chat-core/src/topic-activity.ts`
- `packages/chat-core/src/topic-activity.test.ts`
- `apps/web/src/components/topic/AiStatusLine.tsx`
- `apps/mobile/src/components/chat/ai-status-line.tsx` (new)
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `work/T-1551-mobile-ai-status-line.md`

### Checks run
- `pnpm --filter @zilar/chat-core exec vitest run src/topic-activity.test.ts --reporter=dot` → `Test Files 1 passed (1)`, `Tests 7 passed (7)`.
- `pnpm gate` → `GATE PASS`. Summary lines:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.6s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/chat-core  (0.7s)
  PASS  tests @zilar/mobile  (1.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  Two earlier gate runs failed and were fixed inside scope: format flagged `ai-status-line.tsx` and `topic-activity.test.ts` (fixed with `pnpm exec prettier --write` on those two files), and typecheck rejected the new test fixture under `exactOptionalPropertyTypes` (fixed by typing the card as `NonNullable<UiMessage['card']>`).

### Notes for the lead
- Fix round: the phone smoke showed "+1" alone at the right edge. The status text no longer grows (`flex-1` → `shrink`), so the mono "+N" now sits right after the text with the 6 px gap while the text still truncates when long.
- No deviations from the spec. The mobile line reuses `topicActivityLine` for the `is working` / `is waiting for you` wording instead of duplicating web's `entryText`; the strings are identical.
- I could not run the phone app from here, so the mock acceptance is **unverified by me**; it needs your phone smoke. In the current mock seed (`packages/mock-backend/src/domains/topics/seed.ts:55-58`) `t-devteam-bug` has Dev-1 `working` and QA-1 `waiting` and no `jid`/live card, so `liveStageFor` returns `undefined` and the row reads "Dev-1 is working +1" with Dev-1's picture. `t-devteam-general` has only a `done` entry, so it shows no line.
- Web's `AiStatusLine` renders the same markup as before (`liveStageFor` is the same body, only its home changed).

## Review (written by Claude)

**Approved and merged after one fix round.**

- **Pre-review:** clean.
- **Phone smoke** (`/chat/t-devteam-bug@rooms.zilar.test`, mock), first round: PASS. The line showed Dev-1's picture and "Dev-1 is working", but "+1" sat alone at the right edge.
- **The lead's fix round:** "+1" right after the text, as on `Phone.dc.html`. The second smoke shows "Dev-1 is working +1" together above the composer.
- **`liveStageFor` now lives in chat-core,** with a test, and web and phone share it. The web line is unchanged: the same body, and the web headless check earlier today showed the same output.
