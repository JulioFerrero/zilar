---
id: T-0395
title: "Web kit: the full-pane \"Couldn't load chats\" and \"Couldn't load messages\" errors use StateMessage with a Retry action"
status: merged
milestone: M5
branch: task/T-0395-web-chat-message-list-errors-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0395: chat and message list errors on the kit

## Spec (written by Claude, do not edit)

### Why
The two main panes still hand-build their full-pane error with a Retry button.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/state-message.tsx`:**
  - `kind="error"` renders `role="alert"`, a `CircleAlert` icon, the title, and an optional `action` as a kit `Button` (`{ label, onClick }`).
- **`apps/web/src/components/ChatList.tsx:315-320`:**
  - `<div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">` holding `<p className="text-[15px] text-muted-foreground">{"Couldn't load chats"}</p>` and `<Button type="button" size="lg" className="rounded-full px-5" onClick={retryChats}>Retry</Button>`;
  - leave the smaller banner below it (lines ~323-335, "Retrying…"/"Couldn't load chats" with a `sm` Button) alone.
- **`apps/web/src/components/MessageList.tsx:189-198`:**
  - `<div className="chat-background flex h-full flex-col items-center justify-center gap-3 p-8 text-center">` holding `<p …>{"Couldn't load messages"}</p>` and a `size="lg"` Retry `Button` with `onClick={() => storeApi.getState().retryHistory(chat.id)}`.
- **Tests:**
  - `apps/web/src/components/ChatList.test.tsx`, `apps/web/src/components/MessageList.test.tsx` and `apps/web/src/store/realStore.test.tsx` match these texts;
  - `apps/web/src/components/InstallMenu.test.tsx` and `apps/web/src/store/reload.test.tsx` render the lists.

  Keep the texts and the "Retry" button name.

### What to build
1. **ChatList:** keep the outer `div` for centering (drop `gap-3` and `text-center` if they become redundant) and put `<StateMessage kind="error" title="Couldn't load chats" action={{ label: 'Retry', onClick: retryChats }} />` inside it.
2. **MessageList:** keep `chat-background flex h-full … items-center justify-center p-8` and put `<StateMessage kind="error" title="Couldn't load messages" action={{ label: 'Retry', onClick: () => storeApi.getState().retryHistory(chat.id) }} />` inside it.
3. Import `StateMessage`. Drop the `Button` import only if it becomes unused.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/state-message.tsx`, `apps/web/src/components/ChatList.tsx:300-340` and `apps/web/src/components/MessageList.tsx:180-200`.

### Allowed files
`apps/web/src/components/ChatList.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/ChatList.test.tsx`, `apps/web/src/components/MessageList.test.tsx`, `apps/web/src/store/realStore.test.tsx`, `apps/web/src/components/InstallMenu.test.tsx`, `apps/web/src/store/reload.test.tsx`, `work/T-0395-web-chat-message-list-errors-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatList MessageList realStore InstallMenu reload
pnpm gate
```

### Acceptance
- Both full-pane errors are `StateMessage`s with a Retry action.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- **ChatList:** replaced the hand-built full-pane error with
  `<StateMessage kind="error" title="Couldn't load chats" action={{ label: 'Retry', onClick: retryChats }} />`,
  keeping the outer centering `div` (dropped the now-redundant `gap-3` and `text-center`). The smaller inline
  banner below it still uses the kit `Button`, untouched.
- **MessageList:** replaced the hand-built full-pane error with
  `<StateMessage kind="error" title="Couldn't load messages" action={{ label: 'Retry', onClick: () => storeApi.getState().retryHistory(chat.id) }} />`,
  keeping `chat-background flex h-full flex-col items-center justify-center p-8`. Dropped the now-unused
  `Button` import.
- Added the `StateMessage` import in both files. Kept the texts and the "Retry" button name.

### Files changed
- `apps/web/src/components/ChatList.tsx`
- `apps/web/src/components/MessageList.tsx`
- `work/T-0395-web-chat-message-list-errors-kit.md` (front matter status only)

No test file needed a change: the existing assertions match the kit's `title` text and `Retry` button.

### Commands (real results)
- `pnpm install` → Done in 15.6s.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatList MessageList realStore InstallMenu reload`
  → Test Files 8 passed (8), Tests 218 passed (218), Duration 17.68s.
- `pnpm gate` →
  - gate: 3 changed file(s) against main
  - PASS install (frozen) (2.3s)
  - PASS format (30.0s)
  - PASS lint (1.9s)
  - PASS typecheck (18.3s)
  - PASS tests @zilar/web (56.5s)
  - scope: every changed file is inside the Allowed files
  - GATE PASS

### Problems / deviations
- None. The spec was implemented as written.

## Review (written by Claude)

Approved (lead, 2026-10-06). Both full-pane errors are StateMessage errors (role alert, icon) with a Retry action and the same texts; centering wrappers kept; the unused Button import in MessageList dropped. Pre-review clean (0 findings).
