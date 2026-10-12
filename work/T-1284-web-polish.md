---
id: T-1284
title: "Web polish batch: offline line in the chat (WUX-14), sticky date pills (WUX-31), badge cap in folder tabs (WUX-25), FAB padding on narrow (WUX-24), reduced motion on sending bubbles (WUX-36), a live region for new messages (WUX-35), token greys instead of literals (WUX-22), icons instead of emoji in UI chrome (WUX-42)"
status: merged
milestone: M5
branch: task/T-1284-web-polish
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1284: Web polish batch

## Spec (written by Claude, do not edit)

### Why
The audit's "Polish batch" (`docs/audit/web-ux-audit.md:189`), from these findings:
- **WUX-14** (P2, `:127`): offline, the composer stays enabled and the only hint is a small line in the list header.
- **WUX-31** (`:97`): date separators aren't sticky.
- **WUX-25** (`:69`): folder tab badges print the raw count, where `Badge` caps at 99+.
- **WUX-24** (`:67`): on narrow screens the New chat FAB covers the last row.
- **WUX-36** (`:119`): no reduced-motion opt-out on the sending animation.
- **WUX-35** (`:117`): no `aria-live` for new messages.
- **WUX-22** (`:63`): hardcoded greys in list rows.
- **WUX-42** (`:147`): emoji glyphs in UI chrome. Julio wants icons, not emoji, in the app.

**First recheck each finding on main** (files moved since the audit). For any already fixed, say so with `file:line` and skip it.

### What to build
1. **WUX-14:** while offline or reconnecting, show a one-line notice inside the open chat, above the composer ("Waiting for network…" or "Connecting…"), from the existing connection status (cite the store field). Don't disable sending: failed sends already show "Not sent".
2. **WUX-31:** date separators are `sticky top-2` inside the message scroller.
3. **WUX-25:** `FolderTabs.tsx` uses `Badge` (99+ cap).
4. **WUX-24:** give the chat-list `nav` bottom padding, so the last row clears the FAB at about 390 px.
5. **WUX-36:** add `motion-reduce:animate-none` to the sending bubble's entrance animation.
6. **WUX-35:** a visually hidden `aria-live="polite"` region that announces "New message from {name}" for incoming messages in the open chat (not my own, and not history loads).
7. **WUX-22:** replace the listed hex greys with the existing theme tokens (cite the token for each).
8. **WUX-42:** replace emoji used as UI chrome with lucide icons (the sticker fallback, warnings, placeholders). Emoji as message content and reactions stay.
9. **No tests** (UI). Keep every file at most 400 lines (`MessageBubble.tsx` is 400: don't grow it).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (`:63-69`, `:97`, `:117-127`, `:145-149`, `:189`).

### Allowed files
`apps/web/src/components/**/*.tsx`, `apps/web/src/routes/**/*.tsx`, `apps/web/src/index.css`, `work/T-1284-web-polish.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:**
  - the date pill sticks while scrolling;
  - the folder badge shows 99+ for a large count (if the mock has one);
  - no emoji in chrome;
  - at 390 px the last chat row is reachable.

---

## Report (written by the worker when done)

**Status:** review. All eight findings were rechecked on the current tree; none were already fixed, so all eight were implemented. `pnpm gate` ends with `GATE PASS` and every changed file is inside the Allowed files.

### What I did (per finding)

1. **WUX-14** — `apps/web/src/routes/ChatView.tsx:51,251-258`: reads the connection status from the store field `s.status` (`ChatView.tsx:51`) and maps it with the existing `statusLabel` (`apps/web/src/components/chatList/rowsSelector.ts:59`, which returns "Connecting…" for `connecting`/`reconnecting` and "Waiting for network…" for `offline`). It renders one line above the footer/composer as `role="status"`. Sending is not disabled. No delay: it shows for as long as the status is offline/reconnecting.
2. **WUX-31** — `apps/web/src/components/DateSeparator.tsx:5`: wrapper is now `sticky top-2 z-10` (z-10 so the pill stays over the bubbles).
3. **WUX-25** — `apps/web/src/components/FolderTabs.tsx:83-87`: the raw-count `<span>` is replaced by the shared `Badge` (`count={tab.unread}`, `muted={!active}`), so a large count caps at 99+.
4. **WUX-24** — `apps/web/src/components/chatList/ChatListBody.tsx:66`: the narrow branch of the list `nav` gains `pb-20`, so the last row clears the FAB.
5. **WUX-36** — `apps/web/src/components/MessageBubble.tsx:226`: `motion-reduce:animate-none` added to the sending bubble's entrance animation.
6. **WUX-35** — new `apps/web/src/components/MessageAnnouncer.tsx`, rendered from `apps/web/src/components/MessageList.tsx:338`. It is a visually hidden `role="status" aria-live="polite"` region that announces `New message from {name}`. It announces only when a message is appended to an already-loaded list (`last.id` changed, the previous last message is still present, so history prepends and deletes are skipped), and skips my own sends (`last.senderId !== meId`).
7. **WUX-22** — literals replaced with tokens: `border-[#1a1a1a]` → `border-border` (`--border`, `#1f1f1f`) at `ChatListItem.tsx:99` and `TopicRow.tsx:88`; `text-[#d4d4d4]` → `text-foreground` (`--foreground`, `#ededed`) at `ChatListItem.tsx:152`, `TopicRow.tsx:127` and `MessageSearchResult.tsx:96`.
8. **WUX-42** — chrome emoji replaced with lucide icons: sticker fallback `🙂` → `Smile` (`StickerMessage.tsx:49`); warning `⚠️` → `CircleAlert` (`sticker/PackEditorItems.tsx:71`); emoji placeholder `🐱` → text "Emoji" (`sticker/PackEditorItems.tsx:93`). I also replaced the two other sticker-fallback emoji in chrome that the audit's categories cover: `sticker/StickerThumb.tsx:24` and `sticker/PackThumbs.tsx:14` (both `Smile`). Message content and reactions were left alone.

### Files changed (15)

Modified: `ChatListItem.tsx`, `DateSeparator.tsx`, `FolderTabs.tsx`, `MessageBubble.tsx`, `MessageList.tsx`, `MessageSearchResult.tsx`, `StickerMessage.tsx`, `TopicRow.tsx`, `chatList/ChatListBody.tsx`, `sticker/PackEditorItems.tsx`, `sticker/PackThumbs.tsx`, `sticker/StickerThumb.tsx`, `routes/ChatView.tsx`, `work/T-1284-web-polish.md`.
Added: `components/MessageAnnouncer.tsx`.

### Commands and results

- `pnpm install` — done (1m 23s, ok).
- `pnpm gate` — final run:
  ```
  gate: 15 changed file(s) against main
  PASS  install (frozen)  (3.5s)
  PASS  format  (3.1s)
  PASS  lint  (2.2s)
  PASS  typecheck  (7.8s)
  PASS  effect  (1.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test file was run: every change is UI-only and the spec says "No tests"; the gate reported `SKIP tests @zilar/web (no nearby test files)`.

### Deviations

- **MessageBubble line budget:** adding `motion-reduce:animate-none` made the `isSending` line longer than Prettier's 100-column limit, so Prettier wrapped it and the file grew to 401 lines. To keep `MessageBubble.tsx` at 400 (spec: "don't grow it") I dropped `duration-150` from that class list. It is redundant: tw-animate-css's `animate-in` already defaults to `0.15s` (`--tw-animation-duration, var(--tw-duration, .15s)`), so the sending animation duration is unchanged.
- **Two extra emoji fixes** in `StickerThumb.tsx` and `PackThumbs.tsx` (see WUX-42 above); they are the same chrome category and inside the Allowed files. Flag if you wanted only the three audit-cited lines.

### Blocked / needs a decision

None. No open questions.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (3 nits).**
- **Lead's check on the web mock:**
  - the date separator renders `sticky top-2`, and one `aria-live` region is on the page;
  - the sticker fallback is the lucide `Smile`, not 🙂;
  - narrow chat-list padding is `pb-20`, clearing the FAB.
- **Nits, accepted:**
  - the TopicRow gradient keeps two hex stops;
  - a batched append announces only the newest message;
  - the active folder badge now uses Badge's style.
- **Lead's checks after the rebase:** web tsc: 0 errors. The largest touched files are `MessageList.tsx` (390 lines) and `MessageBubble.tsx` (394).
