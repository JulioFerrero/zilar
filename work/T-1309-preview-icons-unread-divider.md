---
id: T-1309
title: "Chat previews use icons instead of emoji (photo, album, voice, file, card) on web and mobile; the mobile 'Unread messages' divider sits above the first unread message"
status: merged
milestone: M5
branch: task/T-1309-preview-icons-unread-divider
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1309: Preview icons and the unread divider

## Spec (written by Claude, do not edit)

### Why
- **Emoji in previews:** Julio's rule is icons, not emoji, in the app. `previewBody` (`packages/chat-core/src/messages.ts:149-175`) returns "🖼 Photo", "🖼 3 photos", "🎤 Voice message (…)", "📎 name" and "📎 Attachment". Seen in the mobile chat list on 2026-10-13. Callers:
  - `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/TopicRow.tsx`, `apps/web/src/lib/push/inTab.ts`;
  - `apps/mobile/src/lib/format.ts`, `apps/mobile/src/components/chat/message-bubble.tsx`;
  - `packages/chat-core/src/chat-labels.ts`.
- **The divider:** on the live APK, the Julio DM had one unread "hello?" (13:45, the newest message), but the "Unread messages" divider (`apps/mobile/src/components/chat/unread-divider.tsx`, placed by `apps/mobile/src/components/chat/message-list.tsx`, 351 lines) sat above an older "hello" from October 11, with six read messages between it and the unread one.

### What to build
1. **Previews:**
   - add `previewKind(lastMessage)` in chat-core, returning `'photo' | 'album' | 'voice' | 'file' | 'card' | undefined`;
   - make `previewBody` return plain text with no emoji ("Photo", "3 photos", "Voice message (0:12)", the file name, "Attachment");
   - the web and mobile chat rows render a small lucide icon (Image, Images, Mic, Paperclip, File) before the text, from `previewKind`, in the muted colour;
   - notifications (`inTab.ts`) and any other plain-text caller just use the text.
2. **Divider:** find why it's placed above an older message. Check how `message-list.tsx` picks the divider position: the first message newer than the last-read marker, or a count of unread from the end. Fix it so the divider sits right above the **first unread** message, using the same rule as web (cite web's divider logic). Remember the mobile list is inverted (T-1276).
3. **Tests** (the message pipeline), up to 2, in chat-core or client-core:
   - `previewBody` and `previewKind` for a photo, album and voice message;
   - the divider index helper, if the fix lives in a pure function.

### Read first
`AGENTS.md`, `packages/chat-core/src/messages.ts`, the callers above, `apps/mobile/src/components/chat/message-list.tsx` and `apps/mobile/src/components/chat/unread-divider.tsx`.

### Allowed files
`packages/chat-core/src/**/*.ts`, `packages/client-core/src/**/*.ts`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/TopicRow.tsx`, `apps/web/src/lib/push/inTab.ts`, `apps/mobile/src/lib/format.ts`, `apps/mobile/src/components/chat/*.tsx`, `apps/mobile/src/components/chat/*.ts`, `work/T-1309-preview-icons-unread-divider.md`.

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines.
- **The lead's check:** web mock and emulator chat rows show icons, not emoji; the divider sits above the first unread message.

---

## Report (written by the worker when done)

### What I did

**Previews (icons, not emoji).**
- `packages/chat-core/src/messages.ts`: added `previewKind(lastMessage)` returning `'photo' | 'album' | 'voice' | 'file' | 'card' | undefined` (same priority order as `previewBody`), and made `previewBody` return plain text: `Photo`, `3 photos`, `Voice message (0:12)`, the file name, `Attachment` (a caption is still appended, e.g. `Photo, the stage!`). The new `PreviewKind` type is exported through the existing `export * from './messages'` in `packages/chat-core/src/index.ts` (no change needed there).
- Chat rows render a small lucide icon from `previewKind`, in the muted colour, before the text:
  - web: `apps/web/src/components/ChatListItem.tsx` and `apps/web/src/components/TopicRow.tsx`;
  - mobile: new `apps/mobile/src/components/chat/preview-icon.tsx` (`PreviewIcon`), used by `chat-list-item.tsx`, `topic-row.tsx` and `group-list-item.tsx`. `apps/mobile/src/lib/format.ts` `previewParts` now also returns `kind`.
- Plain-text callers are unchanged and now show no emoji: `apps/web/src/lib/push/inTab.ts` (uses `previewBody` directly) and `packages/chat-core/src/chat-labels.ts` (`replyRef`).

**Divider (mobile).**
- Root cause: `apps/mobile/src/components/chat/message-list.tsx` snapshotted the *index* with `useState(() => unreadDividerIndex(items, chat.unread))`. `items` is empty or partial on the first render (history loads after mount and older pages are prepended on scroll), so the index was computed against a different array; when older messages were prepended every position shifted and the divider landed above an older message with the read messages between it and the real first unread — the reported case.
- Web's rule (`apps/web/src/components/MessageList.tsx:122-123`): it snapshots only the anchor (`const [initialUnread] = useState(() => chat.unread)`) and recomputes `unreadDividerIndex(items, initialUnread)` on every render — a count of unread from the end of the loaded messages.
- Fix: mobile now does the same: it snapshots `initialUnread` and recomputes `dividerIndex` from the live `items` each render, then derives `reversedDividerIndex`. Because a newer item moves `dividerIndex` and `entries.length` together and an older page prepended moves both by the same amount, the reversed index stays on the same unread message, so the mount scroll does not re-run and yank the view.
- The mobile list is inverted (T-1276): the divider is inserted at `dividerIndex` in the chronological `entries`, and its reversed position is `entries.length - 1 - dividerIndex` (unchanged formula, now recomputed instead of snapshotted).

### Files changed
- `packages/chat-core/src/messages.ts`, `packages/chat-core/src/messages.test.ts`
- `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/TopicRow.tsx`
- `apps/mobile/src/lib/format.ts`
- `apps/mobile/src/components/chat/preview-icon.tsx` (new), `chat-list-item.tsx`, `topic-row.tsx`, `group-list-item.tsx`, `message-list.tsx`

### Commands and results
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/messages.test.ts` → 1 file passed, 25 tests passed.
- `pnpm gate` (repo root) → `GATE PASS`. Summary:
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (1.0s)`
  - `PASS  typecheck  (5.1s)`
  - `PASS  effect  (1.1s)`
  - `PASS  tests @zilar/chat-core  (0.9s)`
  - `PASS  tests @zilar/mobile  (1.9s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`
  - The first gate run `FAIL`ed on `format` for the new `preview-icon.tsx`; `prettier --write` on that one file fixed it and the second run passed.

### Tests added
Two tests in `packages/chat-core/src/messages.test.ts`: `previewKind` for a photo, album and voice message, and `undefined` for text/no message. The existing `previewBody`/`previewText` cases were updated to the plain text (album, voice, photo, image attachment, file attachment). No pure-function test for the divider: `unreadDividerIndex` was already correct and tested; the bug was in how the component used it (a UI snapshot), so the fix lives in UI code, which gets no tests.

### Deviations / notes
- Icon mapping follows the spec's list order: `photo→Image`, `album→Images`, `voice→Mic`, `file→Paperclip`, `card→File`.
- I also added the preview icon to the mobile group-header row (`group-list-item.tsx`), which shows the same last-topic preview, so it does not show a bare `Photo`/`3 photos` text.
- I did not touch `inTab.ts` or `chat-labels.ts`: they only use the (now emoji-free) text.
- The lead's live check (web mock + emulator) is still required.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (0 nits).**
- **Previews:** `previewKind` plus plain-text `previewBody`; the icons (`preview-icon.tsx` on mobile; web rows) were checked on the web mock (Ana: image icon, "3 photos") and on the emulator build (Julio: image icon, "Photo"). The only emoji left are in the emoji picker data.
- **Divider:**
  - the cause was the index snapshotted on a partial first render; it now snapshots the unread count and recomputes from the loaded items, as web does (`apps/web/src/components/MessageList.tsx:122-123`);
  - known side effect, shared with web: a message arriving while the chat is open moves the line down by one.
- **Lead's checks after the rebase:** chat-core: 71 tests pass; tsc: 0 errors on web and mobile; the largest file is 383 lines.
- **The live divider check is still to do,** on the next APK.
