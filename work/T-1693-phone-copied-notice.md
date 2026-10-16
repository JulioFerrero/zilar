---
id: T-1693
title: "Phone: show a short 'Copied' notice after copying a message or a selection, like web's MessageMenu and SelectionBar (parity gap 6) — through the chat thread's existing toast, skipped on Android 13+ where the system already confirms a copy"
status: merged
milestone: M5
branch: task/T-1693-phone-copied-notice
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1693: "Copied" on the phone

## Spec (written by Claude, do not edit)

### Why
On web, copying a message or a selection shows "Copied":
- `apps/web/src/components/message/MessageMenu.tsx:201-205` (`show('Copied')`);
- `apps/web/src/components/SelectionBar.tsx:88`.

On the phone, the copy is silent (`docs/audit/parity-2026-10-16.md`, gap 6). Android 13 and later show their own clipboard confirmation, so the phone should only add one where the system doesn't (iOS, and Android 12 and older). Web shows nothing on a successful pin, so pin doesn't change.

### Facts (the lead read them on 2026-10-16)
- **`apps/mobile/src/components/chat/chat-thread.tsx`** (190 lines):
  - owns the screen's one toast: `showToast(text, tone)` (`:52-55`) and `<Toast …/>` (`:187`);
  - shows `screen.jumpMissed` once through an effect (`:142-147`: `if (screen.jumpMissed) { showToast('Message not found', 'notice'); screen.setJumpMissed(false); }`);
  - wraps `MessageList` in `ChatJumpProvider` (`:163-186`).
- **`apps/mobile/src/components/chat/use-chat-screen.ts`** (329 lines): `const [jumpMissed, setJumpMissed] = useState(…)` (`:70`), returned at `:281-282`; `export type ChatScreen = ReturnType<typeof useChatScreen>` (`:329`).
- **The context pattern to copy** is `apps/mobile/src/components/chat/chat-jump-context.tsx` (`ChatJumpProvider` + `useChatJump`).
- **Single-message copy:** `apps/mobile/src/components/chat/message-bubble-actions.tsx` (192 lines), `copyMessageText(text)` (`:41-43`), called from `onCopy` (`:143-146`).
- **Selection copy:** `apps/mobile/src/components/chat/selection-bar.tsx`, `copySelected` (`:87-96`).
  - It's rendered by `apps/mobile/src/components/chat/chat-composer-dock.tsx:147-152` (`<SelectionBar chat selectedIds onCancel onForward />`), which has `screen`.
  - The dock is a sibling of `ChatThread`, not inside it.
- **The folder `apps/mobile/src/components/chat/`** has no `chat-notice-context.tsx`.

### Steps
1. **`use-chat-screen.ts`:** add `const [notice, setNotice] = useState<string | null>(null);` and return `notice` and `setNotice`.
2. **`chat-thread.tsx`:**
   - an effect like the `jumpMissed` one: when `screen.notice !== null`, call `showToast(screen.notice, 'notice')` and `screen.setNotice(null)`;
   - wrap the list (inside or around `ChatJumpProvider`) in the new `ChatNoticeProvider notify={screen.setNotice}`.
3. **New `apps/mobile/src/components/chat/chat-notice-context.tsx`** (same shape as `chat-jump-context.tsx`):
   - `ChatNoticeProvider` and `useChatNotice(): (text: string) => void` (a no-op with no provider);
   - `export function systemConfirmsCopy(): boolean` returns `Platform.OS === 'android' && Number(Platform.Version) >= 33`.
4. **`message-bubble-actions.tsx`:** `onCopy` calls `notify('Copied')` after `copyMessageText`, unless `systemConfirmsCopy()`.
5. **`selection-bar.tsx`:** takes an optional `onCopied?: () => void` and calls it in `copySelected` (before `onCancel()`). `chat-composer-dock.tsx` passes `onCopied={() => { if (!systemConfirmsCopy()) screen.setNotice('Copied'); }}`.
6. **No tests** (UI). Keep every file under 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/chat-notice-context.tsx`
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/mobile/src/components/chat/chat-thread.tsx`
- `apps/mobile/src/components/chat/message-bubble-actions.tsx`
- `apps/mobile/src/components/chat/selection-bar.tsx`
- `apps/mobile/src/components/chat/chat-composer-dock.tsx`
- `work/T-1693-phone-copied-notice.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **iOS and Android 12 or older:** Copy from a message's long-press sheet, and Copy in select mode, each show a short "Copied" notice in the chat.
- **Android 13 and later:** no extra notice; the system's own clipboard confirmation is enough.
- **Nothing else changes:** failure toasts still show as before.

---

## Report (written by the worker when done)

### What I did

Followed the spec step by step.

1. **`apps/mobile/src/components/chat/use-chat-screen.ts`** — added
   `const [notice, setNotice] = useState<string | null>(null);` (next to the other
   transient notices) and returned `notice` and `setNotice` in the object.
2. **New `apps/mobile/src/components/chat/chat-notice-context.tsx`** — copies the
   `chat-jump-context.tsx` shape: `ChatNoticeProvider` (value `notify: (text: string) => void`),
   `useChatNotice()`, a module-level no-op default, and
   `systemConfirmsCopy()` returning `Platform.OS === 'android' && Number(Platform.Version) >= 33`.
3. **`apps/mobile/src/components/chat/chat-thread.tsx`** — imported `ChatNoticeProvider`,
   added an effect mirroring the `jumpMissed` one (`if (notice !== null) { showToast(notice, 'notice'); clearNotice(null); }`),
   and wrapped both `ChatJumpProvider` and `MessageList` in
   `<ChatNoticeProvider notify={screen.setNotice}>`.
4. **`apps/mobile/src/components/chat/message-bubble-actions.tsx`** — `BubbleActionsSheet`
   now reads `const notify = useChatNotice();` and `onCopy` calls `notify('Copied')`
   after `copyMessageText(...)`, skipped when `systemConfirmsCopy()`.
5. **`apps/mobile/src/components/chat/selection-bar.tsx`** — added the optional
   `onCopied?: () => void` prop, called in `copySelected` after the clipboard call and
   before `onCancel()`. **`chat-composer-dock.tsx`** passes
   `onCopied={() => { if (!systemConfirmsCopy()) screen.setNotice('Copied'); }}`.
6. No tests added (UI change), all files under 400 lines.

Deviations: none from the spec. Two small judgement calls, both within the letter of the
spec: the module-level `noopNotify` in the new context gives one stable default instead of
a fresh arrow each call, and the effect in `chat-thread.tsx` reads `screen.notice` /
`screen.setNotice` into local consts (`notice`, `clearNotice`) before the effect so the
dependency array is stable, matching the existing `partialNotice` pattern in that file.

### Checks run

- `pnpm install` from the repo root — done, "Done in 1m 7.1s" (one pre-existing peer-dep
  warning: `@types/react-dom` wants `@types/react@^19.3.0`, found `19.2.18`).
- `pnpm gate` from the repo root — ended with `GATE PASS`. Its summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (8.6s)
  PASS  format  (4.0s)
  PASS  lint  (7.1s)
  PASS  typecheck  (20.2s)
  PASS  effect  (4.2s)
  PASS  tests @zilar/mobile  (8.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No separate single-file test run: there are no tests next to the touched files (the
  `apps/mobile/src/components/chat/` folder has no `*.test.*` covering
  `chat-thread`, `selection-bar`, `message-bubble-actions`, `chat-composer-dock` or
  `use-chat-screen`), and the gate's mobile suite covers the package. The spec says
  "no tests (UI)".

### Notes for the lead

- The `onCopied` prop on `SelectionBar` is optional and passed only by
  `chat-composer-dock.tsx`; no other caller of `SelectionBar` was found, so nothing else
  changes.
- `BubbleActionsSheet` lives under `MessageList` (`message-bubble.tsx:331`), which is
  inside `ChatNoticeProvider`, so `useChatNotice()` there gets the real `notify`; the
  no-op default only applies to a sheet rendered without a thread around it.
- I did not run the app or the phone smoke; behaviour on iOS / Android 12 / Android 13+
  is from the code paths above, not a live device check.

## Review (written by Claude)

**Approved and merged.** This is parity gap 6, the copy half.

- **Pre-review:** clean; 1 nit, accepted: "Copied" shows even if the clipboard write fails. Web's `MessageMenu` does the same (`show('Copied')` then `void copyText(…)`).
- **The change:**
  - `screen.notice`/`setNotice` carry the notice;
  - `ChatThread` shows it through its one toast and clears it;
  - the bubble sheet reaches it through `ChatNoticeProvider`, and the selection bar through the dock's `onCopied`;
  - `systemConfirmsCopy()` skips the app's notice on Android 13+ (API 33).
- **Not checked live:** the lead's emulator is Android 13+, where no notice is expected. The iOS and Android 12 paths are checked by reading the code only.
- **Not a gap:** pin has no success toast on web either, so nothing changed there.

