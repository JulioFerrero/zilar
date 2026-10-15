---
id: T-1549
title: "Split apps/web/src/components/MessageBubble.tsx (399 lines): the bubble's derived flags (own, sticker, bigEmoji, showSender, mediaTop, gifVideo, attachmentFile, sendFailed, imageOnly, canForward, canEdit, canDelete, canPin) move to a pure function in components/message/bubbleFlags.ts; MessageBubble keeps its hooks and JSX; no behaviour change"
status: merged
milestone: M5
branch: task/T-1549-split-message-bubble
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1549: Split MessageBubble.tsx

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/components/MessageBubble.tsx` is 399 lines, and nearly every message feature touches it. **Follow `docs/audit/split-rules.md`.** The earlier splits already moved `SendFailure`, `MessageMeta`, `BigEmoji`, `AttachmentBody`, `MessageTextBody` and `MessageMenu` into `apps/web/src/components/message/`. What is left is one component whose body starts with about 90 lines of derived flags.

### Facts (the lead read them on main, 2026-10-15)
- **Exports:** `SendFailure` (re-export, `:31`), `MessageBubbleProps` (`:36`) and `MessageBubble` (`memo`, `:65`).
- **Inside the component:**
  - **hooks:** `menuOpen` and `menuPoint` state, the menu button ref, `useChatStoreApi`, the `useChatSelector` reads (`mediaTrustedHosts`, `canPin`, `pinFor`), `useSmoothText` and `useAction` (the quote opener);
  - **derived flags,** about `:91-145` and `:166-172`: `own`, `deleted`, `markdown`, `hasText`, `beyondDraft`, `animate`, `generating`, `transitioning`, `isSending`, `canForward`, `sticker`, `bigEmoji`, `showSender`, `mediaTop`, `attachmentImage`, `gifVideo`, `attachmentFile`, `failed`, `sendFailed`, `imageOnly`, `canEdit`, `canDelete` and `canPin`;
  - the tombstone early return (`:174-185`), then the JSX.

### Steps
1. **New `apps/web/src/components/message/bubbleFlags.ts`:** one pure function `bubbleFlags(input)`.
   - It takes plain values: `message`, `chat`, `currentUserId`, `firstInGroup`, `draft`, `revealTurnId`, `done` (from `useSmoothText`), `mediaHosts`, `chatCanPin` and `now: Date`.
   - It returns every derived flag the component uses, computed exactly as today, with each comment moved alongside its flag.
   - It calls no hooks.
2. **`MessageBubble.tsx`:**
   - keep every hook call in the same order;
   - call `bubbleFlags` once after `useSmoothText` and destructure the flags;
   - remove the moved lines and any imports only they used;
   - `useSmoothText` still needs `animate`, which depends on `draft` and `revealTurnId`. Compute `beyondDraft` and `animate` before the hook as today (or have `bubbleFlags` export a tiny helper for them), so the hook order stays the same.
3. **No behaviour change.** The JSX is untouched apart from where the flags come from. `MessageBubble.tsx` ends under about 320 lines.

### Tests
None new (UI). The gate must pass.

### Allowed files
- `apps/web/src/components/MessageBubble.tsx`
- `apps/web/src/components/message/bubbleFlags.ts` (new)
- `work/T-1549-split-message-bubble.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of both files;
  - the export list of `MessageBubble.tsx` before and after (identical);
  - the gate summary.
- In the web mock, the Dev-1 DM and the Dev team General chat render exactly as on main (the lead checks headless).

---

## Report (written by the worker when done)

### What I did

Moved every derived flag out of `MessageBubble` into a new pure function, `bubbleFlags(input)` in `apps/web/src/components/message/bubbleFlags.ts`:

- The new file takes plain values (`message`, `chat`, `currentUserId`, `firstInGroup`, `draft`, `revealTurnId`, `done`, `mediaHosts`, `chatCanPin`, `now`) and returns `own`, `deleted`, `markdown`, `hasText`, `beyondDraft`, `animate`, `generating`, `transitioning`, `isSending`, `canForward`, `sticker`, `bigEmoji`, `showSender`, `mediaTop`, `attachmentImage`, `gifVideo`, `attachmentFile`, `failed`, `sendFailed`, `imageOnly`, `canEdit`, `canDelete`, `canPin`. Each flag and its comment was moved unchanged. It calls no hooks.
- Because `useSmoothText` needs `animate` before the flags exist, `bubbleFlags.ts` also exports a tiny `draftAnimates(draft, revealTurnId)` holding the same `beyondDraft`/`animate` expressions; the component calls it before the hook. `bubbleFlags` still returns `animate`/`beyondDraft` for completeness, but the component takes `animate` from the helper to keep hook order.
- `canEdit` now uses the passed `now: Date` instead of calling `new Date()` inline (still `new Date()` at the one call site in the component), so the function stays pure.
- `MessageBubble.tsx`: all hooks stay in the same order (`useState`, `useState`, `useRef`, `useChatStoreApi`, three `useChatSelector`, `useSmoothText`, then `useAction`). `bubbleFlags` is called once, right after `useSmoothText`, and its result is destructured. The moved lines and the imports only they used (`canEditMessage`, `canDeleteMessage`, `isBigEmoji`, `shouldRenderMarkdown` from `@zilar/chat-core`, and `isGifVideoAttachment` from `./GifMessage`) were removed. The JSX is unchanged apart from reading the flags from the destructured values.
- No behaviour change intended. No new tests (UI).

### Checks run

`pnpm install` → done in 15.4s (peer-dependency warning only).

`pnpm gate` (from repo root) → exit 0:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (1.3s)
PASS  lint  (1.3s)
PASS  typecheck  (3.6s)
PASS  effect  (0.9s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test file exists near this component, so none was run separately; the gate reports `SKIP tests @zilar/web (no nearby test files)`.

Acceptance numbers:

- `wc -l`: `MessageBubble.tsx` = 367, `apps/web/src/components/message/bubbleFlags.ts` = 133 (old `MessageBubble.tsx` on main = 399).
- Export list of `MessageBubble.tsx`, before (main) vs after: identical.
  - `export { SendFailure } from './message/SendFailure';`
  - `export interface MessageBubbleProps {`
  - `export const MessageBubble = memo(function MessageBubble({`
- New exports in `bubbleFlags.ts`: `BubbleFlagsInput`, `draftAnimates`, `bubbleFlags`.
- No `effect-plain` marker was needed: the new file has none of the ratchet's signals and the effect step passed.

### Notes for the lead

- **Deviation:** `MessageBubble.tsx` is 367 lines, not "under about 320". The flags block is ~70 lines (~55 at `:91-144` plus 7 at `:166-172`), not the ~90 the spec's Why estimated. Removing it and its imports is ~73 lines, but prettier breaks the 23-name destructure onto 24 lines and the 10-field call onto 12 (printWidth 100, one property per line). That puts the floor for this exact split at ~345 lines. Getting to 320 would need moving more of the component (JSX or a hook), which the spec forbids. Both files are well under the 400-line limit and the `max-lines` warning is gone.
- `canEditMessage` receives the `now` passed by `bubbleFlags`; the component still builds it as `new Date()` at the call site, so the 48 h window is evaluated at render time exactly as before.
- Nothing outside the Allowed files changed; `git status` shows only the two source files plus this task file.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 2 nits.
- **Same render, checked:** the same headless script ran on main and on this branch, for the Dev-1 DM (8 bubbles) and Dev team General (32 bubbles). The output was identical (sides, text, order and count), apart from the mock's relative clock times between the two runs. 0 page errors.
- **Sizes:** `MessageBubble.tsx` 367 lines (was 399; the spec hoped for about 320) and `bubbleFlags.ts` 133. That leaves 33 lines of room, so the next bubble feature should move the sticker-bubble branch out first.
