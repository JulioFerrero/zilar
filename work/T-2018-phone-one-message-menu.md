---
id: T-2018
title: "Chat perf W3a (phone): one message action sheet and one delete confirm per chat list instead of one per row — bubbles open the shared menu through context with their own flags and album members, so a long chat mounts 2 TrueSheets, not 2 per row"
status: merged
milestone: M5
branch: task/T-2018-phone-one-message-menu
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2018: One message menu per chat list (perf W3a)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: scrolling a chat on Android is janky. The scroll audit (`docs/audit/chat-scroll-perf.md` C2 and W3) found that every message row mounts its own `BubbleActionsSheet`: a native TrueSheet plus a delete confirm, and a set of store selectors. A 50-row window then mounts about 100 native sheet views.

W1 (T-2008) and W2 (T-2009) are merged. This is W3's first half: one menu per list. The second half, one gesture per row, is a later task. The UI has no tests (Julio's rule).

### Facts (read by the lead on 2026-10-18 on main `219ba0622`; paths under `apps/mobile/src/components/chat/`)
- **The bubble.** `message-bubble.tsx` (383 lines):
  - holds `const [menuOpen, setMenuOpen] = useState(false)` (`:66`) and `openMenu = () => openMessageMenu(setMenuOpen)` (`:153`);
  - wraps its content in `<MessageMenuProvider openMenu={...}>` (`:173`, `:208`) and passes `onLongPress={openMenu}` in several places (`:216-238`);
  - renders `<BubbleActionsSheet visible={menuOpen} confirmOpen={confirmOpen} message={message} canCopy=... canEdit=... canDelete canDeleteForMe isDm own senderName canForward canPin isPinned myReactions onReply onEdit onDelete onForward onStartSelect onPin onUnpin react setMenuOpen setConfirmOpen />` at the end of each row (`:349-376`).
- **The sheet.** `message-bubble-actions.tsx` (199 lines):
  - declares `BubbleActionsSheetProps` (`:11-40`) and exports `openMessageMenu` (`:48`) and `BubbleActionsSheet` (`:53`);
  - inside, it reads `retryText`, `deleteFailedMessage`, `deleteForMe` and `currentUserId` from the store (`:82-85`), plus `useChatNotice()`;
  - it gets album members through `useAlbumMembers()` (`:94-98`, T-1274), from the row's album provider;
  - it renders `<MessageActionsSheet ...>` (`:114`).
- **The open-menu context.** `message-menu-context.tsx` (27 lines) gives inner pressables the bubble's `openMenu` through `MessageMenuProvider` and `useOpenMessageMenu`. The callers are `attachment-video.tsx:63`, `mention-text.tsx:25`, `album-grid.tsx:118`, `person-pressable.tsx:39` and `reply-quote.tsx`.
- **The list.** `message-list.tsx` (373 lines) renders the rows and already receives the list-level handlers (reply, edit, delete, forward, select, pin and unpin) that it passes down.

### Steps
1. **Add `message-menu-host.tsx`.** It exports:
   - `MessageMenuHost`, a provider that wraps the list;
   - `useMessageMenu()`, which returns `open(target)`.

   A `target` holds the message, all the per-row flags `BubbleActionsSheetProps` has today (`canCopy` … `myReactions`), and the album members, resolved by the bubble from `useAlbumMembers()` when it opens.

   The host keeps `{ target, menuOpen, confirmOpen }` and renders **one** `BubbleActionsSheet`, using the list-level handlers. When it closes, keep the target until the sheet's close animation ends, so the content doesn't blank mid-animation.
2. **`BubbleActionsSheet` takes its album members as a prop** (`albumMembers?: UiMessage[]`) instead of calling `useAlbumMembers()`. Keep its store reads; they now run once per list.
3. **The bubble.** `message-bubble.tsx` drops `menuOpen`, `confirmOpen` and its `<BubbleActionsSheet>`. `openMenu` becomes `() => menu.open({ message, flags…, albumMembers })`. Keep `MessageMenuProvider` and `useOpenMessageMenu`, so inner tiles still forward long-presses. Keep the existing behaviour where a generating row opens nothing.
4. **The list.** `message-list.tsx` wraps its list in `MessageMenuHost` with the handlers it already has.
5. **Size.** `message-bubble.tsx` must get shorter. Every file stays at or under 400 lines.
6. **Keep behaviour exactly:**
   - long-press opens the menu, and so does long-press on a photo tile, video, mention or reply quote;
   - every menu action works: react, Reply, Copy, Edit, Forward, Select, Pin and Unpin, Delete with its confirm, delete-for-me in a DM, and Retry and Delete on a failed text;
   - album Delete removes every photo in the album;
   - the "Copied" toast still shows.

   No tests (UI).

### Allowed files
- `apps/mobile/src/components/chat/message-menu-host.tsx`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/message-bubble-actions.tsx`
- `apps/mobile/src/components/chat/message-menu-context.tsx`
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/message-list-row.tsx`
- `work/T-2018-phone-one-message-menu.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Lead mock smoke on the emulator:**
  - long-press opens the menu on a text, a photo album, a reply and a voice note;
  - Delete confirm works, and album Delete removes the whole album;
  - Pin works, and Copy shows "Copied";
  - `adb shell dumpsys activity top | grep -c TrueSheetView` stays small with 50+ rows mounted.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/chat/message-menu-host.tsx`: `MessageMenuHost`
  (provider) and `useMessageMenu()` (`open(target)`). The host keeps
  `{ target, menuOpen, confirmOpen }` and draws the list's only
  `BubbleActionsSheet` with the list-level handlers. `open` resets the delete
  confirm and stores the target; the target is never cleared on close, so the
  sheet content does not blank while it animates away (one object per list).
  The sheet mounts only after the first long-press: a list at rest mounts no
  sheet, and after one open it mounts one menu sheet plus its one delete
  confirm (two native sheets for the whole list, not two per row).
- `message-bubble-actions.tsx`: `BubbleActionsSheet` now takes
  `albumMembers?: UiMessage[]` as a prop instead of calling `useAlbumMembers()`;
  its store reads and the album/delete-confirm logic are unchanged.
  `openMessageMenu` now wraps the open callback, so the haptic still fires in
  the press handler before the sheet opens.
- `message-bubble.tsx`: dropped `menuOpen`/`confirmOpen` state and the
  per-row `<BubbleActionsSheet>`. `openMenu` now resolves the album members
  from `useAlbumMembers()` and calls `menu.open({ message, flags…, albumMembers })`.
  `MessageMenuProvider`/`useOpenMessageMenu` stay, including the existing
  `generating` guards, so inner photo/video/mention/quote long-presses still
  open the menu and a generating row opens nothing. Line count 383 → 374.
- `message-list.tsx`: wraps the list in `MessageMenuHost` with the handlers it
  already had. `message-list-row.tsx`: dropped the five handler props that
  only fed the old per-row sheet (`onEdit`, `onDelete`, `onPin`, `onUnpin`,
  `onStartSelect`) from its props, render and memo comparator; the host owns
  them now. `message-menu-context.tsx` needed no change.

Behaviour kept: long-press on a bubble, sticker, photo tile, video, mention
and reply quote; react/Reply/Copy/Edit/Forward/Select/Pin/Unpin/Delete and
its confirm; delete-for-me in a DM; Retry/Delete on a failed text; album
Delete over every member; the "Copied" toast (the host sits under
`ChatNoticeProvider` in `chat-thread.tsx`).

No tests were added: UI-only change, per the spec and AGENTS.md.

### Checks run

I ran no test files on their own (no test covers these components; the
change is UI-only). No format/lint/typecheck runs outside the gate.

`pnpm gate` (from the repo root):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (1.1s)
PASS  typecheck  (3.6s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (1.7s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into the Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

File sizes after the change: `message-bubble.tsx` 374,
`message-menu-host.tsx` 111, `message-list.tsx` 375,
`message-list-row.tsx` 182, `message-bubble-actions.tsx` 197.

### Notes for the lead

- Not phone-smoked here: I did not run the app or `adb`, so the long-press,
  Delete/Pin/Copy and TrueSheet-count checks are the lead's emulator smoke, as
  the spec says.
- The menu target is a snapshot taken when the row opens it (all flags and
  album members), so the sheet reflects the row as it was at open time rather
  than live store updates. That is what makes one sheet serve every row.
- Deviations: none from the spec. The row no longer receives five handlers
  that only fed the removed per-row sheet; passing them would have been dead
  props.

## Review (written by Claude)

Approved, with a clean pre-review and 2 nits.
- **One menu per list.** The new `message-menu-host.tsx` mounts one `BubbleActionsSheet` and one delete confirm per chat list. Bubbles open it through context, passing their own flags and album members.
- **Smaller bubble.** `message-bubble.tsx` no longer holds menu state.
- **The last target stays mounted.** That's a small object and avoids a blank sheet mid-close, so it's accepted.
- **Still to check.** This is phone-only and ships only in an APK. The lead merges it first so that one mock build of main serves as both:
  - its smoke: long-press on a text, an album, a reply and a voice note; Delete confirm and album Delete; Pin; Copy shows "Copied";
  - the third perf data point.
  
  Results go in NOW.md, and a failure there becomes a fix task before any APK.
