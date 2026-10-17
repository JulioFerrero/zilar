---
id: T-1905
title: "Smooth app task 8: the topic AI status line ('Deepseek is working…') floats as a small pill just above the composer, over the bottom of the thread, instead of inserting a row that shrinks the thread; web + phone"
status: merged
milestone: M5
branch: task/T-1905-ai-status-no-resize
model: auto
effort: default
depends_on: [T-1901]
estimate: 30 min
---

# T-1905: The AI status line never moves the thread

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §4 W6/P6 and §5 task 8** (Julio, 2026-10-17: things that appear and move everything). In a topic, the "<AI> is working" line is inserted as a row above the composer. When an AI starts or stops, the thread shrinks or grows and every message jumps. T-1898 already made the connection line a floating pill; this line gets the same treatment.

### Facts (read by the lead on 2026-10-17)
- **Web:**
  - `apps/web/src/components/topic/AiStatusLine.tsx` (89 lines) returns `null` with no active AI. Otherwise it renders a `role="status"` row `flex … px-3 py-1.5 text-[13px] … wide:px-8` (`:52-55`), whose waiting entry is a button that opens the question (T-1586).
  - It is mounted in normal flow before `<Composer>` in `apps/web/src/routes/ChatView.tsx:297` (373 lines).
- **Phone:**
  - `apps/mobile/src/components/chat/ai-status-line.tsx` (73 lines) returns `null` with no active AI (`:24-27`); the waiting entry is tappable too.
  - It is mounted in normal flow inside `apps/mobile/src/components/chat/chat-composer-dock.tsx:249` (301 lines).
  - The screen renders `<ChatThread>` then `<ChatComposerDock … variant="composer">` inside a `KeyboardAvoidingView` (`apps/mobile/src/app/chat/[id].tsx:195-203`). `ChatThread`'s root is `<View className="flex-1">` (`apps/mobile/src/components/chat/chat-thread.tsx:174`).
- **Android touch caveat:** a child drawn outside its parent's bounds is not touchable. So on the phone, the overlay must sit **inside** the thread's area, not hang above the dock.

### Steps
1. **Web `ChatView.tsx`:** replace `<AiStatusLine chat={chat} />` at `:297` with a zero-height anchor:
   ```tsx
   <div className="relative z-10 h-0">
     <div className="absolute inset-x-0 bottom-1.5 flex justify-center px-3 wide:px-8">
       <AiStatusLine chat={chat} />
     </div>
   </div>
   ```
2. **Web `AiStatusLine.tsx`:** the row becomes a pill:
   - `max-w-full rounded-full border border-border bg-surface-raised/95 px-3 py-1 shadow-sm backdrop-blur`;
   - keep `role="status"`, truncation, the avatars and the question button;
   - drop the row's own `wide:px-8` padding, since the anchor has it.
3. **Phone `[id].tsx`:** at `:199-200`, wrap the thread:
   ```tsx
   <View className="flex-1">
     <ChatThread screen={screen} chat={chat} />
     <View pointerEvents="box-none" className="absolute bottom-1.5 left-0 right-0 items-center px-3">
       <AiStatusLine chat={chat} />
     </View>
   </View>
   ```
   Import `AiStatusLine` there. Keep the other `ChatComposerDock` uses (`:119`, `:159`) as they are.
4. **Phone `chat-composer-dock.tsx`:** remove the `<AiStatusLine>` at `:249` and its import.
5. **Phone `ai-status-line.tsx`:** the row becomes a pill with `rounded-full border border-divider bg-surface-raised px-3 py-1`, keeping the text, the avatar, `+N` and the tap.
6. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/components/topic/AiStatusLine.tsx`
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `apps/mobile/src/components/chat/ai-status-line.tsx`
- `work/T-1905-ai-status-no-resize.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **When an AI starts or stops** in a topic, a small pill appears or disappears just above the composer, and the thread and composer never move.
- **Tapping a waiting AI's question** still opens it, on web and phone.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **Web `ChatView.tsx`:** replaced the in-flow `<AiStatusLine>` row with the zero-height anchor from the spec: `relative z-10 h-0` holding an absolute `bottom-1.5` centred container (`px-3 wide:px-8`). The status line now floats over the bottom of the thread and takes no space, so the thread and composer no longer move when an AI starts or stops.
- **Web `AiStatusLine.tsx`:** the row is now a pill: `flex min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-hidden rounded-full border border-border bg-surface-raised/95 px-3 py-1 text-[13px] whitespace-nowrap text-muted-foreground shadow-sm backdrop-blur`. `role="status"`, truncation, avatars, the waiting question button and `+N` are unchanged; the row's own `wide:px-8` and `shrink-0` are gone because the anchor positions and pads it.
- **Phone `[id].tsx`:** wrapped `<ChatThread>` in `<View className="flex-1">` and added the `AiStatusLine` overlay inside it: `pointerEvents="box-none"` + `absolute bottom-1.5 left-0 right-0 items-center px-3`. It sits inside the thread's area, so it stays touchable on Android. Imported `AiStatusLine`; the `:119`/`:159` dock uses are untouched.
- **Phone `chat-composer-dock.tsx`:** removed the in-flow `<AiStatusLine>` from the composer variant and its import.
- **Phone `ai-status-line.tsx`:** the row is now a pill: `max-w-full flex-row items-center gap-1.5 rounded-full border border-divider bg-surface-raised px-3 py-1`. Text truncation, avatar, `+N` and the waiting-AI tap are kept.
- **Fix round (lead):** topics now reserve a fixed gap at the newest end of the thread, so the pill never covers the newest message. Phone `chat/message-list.tsx`: `contentContainerStyle` is `{ paddingTop: chat.topic !== undefined ? 44 : 8, paddingBottom: 8 }` (the list is inverted, so `paddingTop` is the on-screen newest end). Web `components/MessageList.tsx`: topic columns use `pt-4 pb-14 wide:pt-6 wide:pb-14`, other chats keep `py-4 wide:py-6`. The gap is constant for a topic, so nothing moves when an AI starts or stops.
- No tests (UI, as the spec says). File lengths: ChatView 377, web AiStatusLine 89, mobile `[id].tsx` 218, chat-composer-dock 299, ai-status-line 73 — all ≤400. Fix-round files: mobile message-list and web MessageList also within 400 (gate size check passed).

### Checks run
- `pnpm install` → "Done in 29.1s".
- `pnpm gate` → summary:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (1.2s)
  PASS  lint  (1.3s)
  PASS  typecheck  (8.1s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/mobile  (3.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the change is UI-only and the spec says no tests.
- Fix round: `pnpm gate` → `gate: 8 changed file(s) against main`, `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck (4.8s)`, `PASS effect`, `PASS tests @zilar/mobile (1.9s)`, `SKIP tests @zilar/web`, and `GATE PASS`. The scope line lists the two fix-round files (`apps/mobile/src/components/chat/message-list.tsx`, `apps/web/src/components/MessageList.tsx`) as outside the task's original Allowed files, because the lead named them in the fix round; they were not added to the task's Spec Allowed files.

### Notes for the lead
- I did not open the app in a browser or on a phone, so "the pill appears and tapping still opens the question" is verified by code reading only; please cover it in the phone smoke / live check.
- No deviations from the spec, no new dependencies.

### Blocked / needs a decision
- Nothing.

## Review (written by Claude)

Merged on 2026-10-17 at HEAD `c250871c2`. The CLEAN packet (20:35) predates the lead's fix round `c250871c2` (20:45); the lead reviewed that two-line diff itself.
- **Web and phone:** the AI status line is a pill on a zero-height anchor (web) or an absolute overlay inside the thread's area (phone, so it stays tappable on Android). Nothing moves when an AI starts or stops.
- **Emulator** (mock topic `t-devteam-bug`): the first build's pill covered the QA-1 card's corner. After the fix round, topics keep a fixed 44 px gap at the newest end (web `pb-14`), and "Dev-1 is working +1" sits in its own space.
