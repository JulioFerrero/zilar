---
id: T-0395
title: "Web kit: the full-pane \"Couldn't load chats\" and \"Couldn't load messages\" errors use StateMessage with a Retry action"
status: todo
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

## Review (written by Claude)
