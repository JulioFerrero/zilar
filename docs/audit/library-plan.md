# Library audit: hand-rolled UI that a library or the platform does better

Date: 2026-10-13. Scope: `apps/mobile/src` (Expo SDK 57, expo-router, RNGH ~2.32.0,
reanimated 4.5.1), `apps/web/src` (React 19, Vite, Tailwind 4) and the shared UI in
`packages/*`. Read-only audit: no code changed by T-1342.

Why: the hand-rolled photo viewer gestures failed twice on Julio's Android phone
(T-1338), and the swap to `react-native-zoom-toolkit`'s `Gallery` (T-1341) was
"perfect" on the first try. This plan finds the other places where we re-implement
something a mature library or the platform does better, ranks them by
user-visible benefit ÷ effort, and names the swaps.

Every version, publish date and peer list below was read from `npm view <pkg>
version time.modified peerDependencies` on 2026-10-13 (never from memory). The
app's current pins are `react-native-gesture-handler` ~2.32.0 and
`react-native-reanimated` 4.5.1 (`apps/mobile/package.json:63-64`); web is
React 19.3 with the `radix-ui` umbrella already a dependency
(`apps/web/package.json:30`).

Line counts are whole files at this revision and are labelled; the `file:line`
citations are the ones a follow-up spec can quote directly.

---

## 1. Summary table (ranked by benefit ÷ effort)

| # | Area | Platform | Hand-rolled (files / LOC) | Candidate (version, published, peers) | LOC out/in | Benefit | Effort | Risk | Verdict |
| - | ---- | -------- | ------------------------- | ------------------------------------- | ---------- | ------- | ------ | ---- | ------- |
| 1 | Photo viewer (pinch/pan/swipe/double-tap/dismiss) | mobile | `photo-pager.tsx` 209 + `image-viewer.tsx` 144 | **react-native-zoom-toolkit** 5.1.1, 2026-08-30, peers `react *`, `react-native *` (dev'd against reanimated ~4.1.1, RNGH ~2.28.0) | −353 / +40 | High | Low | Low | Swap — already specified as **T-1341** |
| 2 | Photo viewer (wheel/pinch/drag/double-click) | web | `media/MediaViewer.tsx` 209, `useZoomPan.ts` 384, `zoomGeometry.ts` 60, `ViewerArrows.tsx` 45 | **yet-another-react-lightbox** 3.32.2, 2026-07-30, peers `react`/`react-dom` `^16.8‖^17‖^18‖^19` | −600 / +60 | High | Medium | Medium | Swap — twin of #1 |
| 3 | Dialog / menu / popover / focus trap | web | `ui/dialog.tsx` 83, `ui/sheet.tsx` 56, `ui/menu.tsx` 230, `ui/use-modal.ts` 95, `ui/toast.tsx` 72, `ConfirmDialog.tsx` 61 | **radix-ui** 1.8.1, 2026-10-13 (already a dep; only `Slot` used), peers `react`/`react-dom` `^19`; `@radix-ui/react-dialog` 1.3.1, 2026-10-13; `@radix-ui/react-dropdown-menu` 2.2.1, 2026-10-13 | −400 / +150 | High | Medium | Medium | Swap |
| 4 | Keyboard avoidance | mobile | `lib/use-keyboard-height.ts` 55 + 8 `KeyboardAvoidingView` sites | **react-native-keyboard-controller** 1.22.7, 2026-10-12, peers `react`/`react-native *`, `reanimated >=3.0.0` | −40 / +30 | High | Medium | Medium | Swap |
| 5 | Message + chat list DOM (virtualisation) | web | `MessageList.tsx` 392, `useMessageWindow.ts` 122, `useScrollMemory.ts` 143, `ChatList.tsx` 203 | **@tanstack/react-virtual** 3.14.19, 2026-10-13, peers `react`/`react-dom` `^16.8‖^17‖^18‖^19` | −200 / +150 | Medium-high | Medium-high | Medium-high | Swap, carefully |
| 6 | Markdown rendering | mobile | `chat/markdown-text.tsx` 285, `chat/markdown-table.tsx` 282, `lib/markdown-blocks.ts` 198, `lib/markdown-inline.ts` 182 | **@ronradtke/react-native-markdown-display** 9.0.3, 2026-06-29, peers `react >=16.2.0`, `react-native >=0.50.4` | −400 / +80 | Medium | Medium-high | Medium-high | Swap, if parity holds |
| 7 | Bottom sheets / action sheets | mobile | `ui/bottom-sheet.tsx` 73, `ui/action-sheet.tsx` 130 (12 + 8 call sites) | **@gorhom/bottom-sheet** 5.2.14, 2026-05-09, peers `gesture-handler >=2.16.1`, `reanimated >=3.16.0‖>=4.0.0-` | −150 / +120 | Medium | High | Medium | Consider later |
| 8 | Message + chat list perf | mobile | `chat/message-list.tsx` 367, `use-message-list-scroll.ts` 193 | **@shopify/flash-list** 2.3.3, 2026-10-01, peers `react *`, `react-native *`, `@babel/runtime *` (or **@legendapp/list** 3.6.0, 2026-09-29) | −60 / +40 | Medium | Medium | High | Keep FlatList for now |
| 9 | Avatar cropper | web | `avatar/CropDialog.tsx` 146, `lib/avatar-crop.ts` 116 (+ part of `AvatarUploader.tsx` 266) | **react-easy-crop** 6.2.4, 2026-10-06, peers `react`/`react-dom` `>=16.4.0` | −140 / +60 | Low-medium | Low | Low | Swap |
| 10 | Folder / sticker reorder | web | `routes/FoldersPage.tsx` 226 (DnD 109-115), `sticker/PackEditorItems.tsx`, `sticker/PackEditorForm.tsx`, `folder/FolderHideSection.tsx` 65 | **@dnd-kit/core** 6.3.1, 2024-12-05, peers `react`/`react-dom` `>=16.8.0` | −80 / +60 | Low | Low-medium | Low | Swap if touched again |

Everything else checked in §3 stays hand-rolled; nothing found that is already on a
library and worth re-filing (those are listed as "already a library" and skipped).

---

## 2. Rows

### Row 1 — Mobile photo viewer → `react-native-zoom-toolkit` (already T-1341)

- **Files.** `apps/mobile/src/components/chat/photo-pager.tsx` (209), `apps/mobile/src/components/chat/image-viewer.tsx`
  (`AttachmentViewer`, 144); opened from `media-bubble.tsx` and `attachment-body.tsx`
  with `ViewerPhoto[]` from `packages/chat-core/src/photos.ts`. T-1341 also deletes
  `photo-pager.tsx`.
- **What it does.** `photo-pager.tsx:45-134` hand-rolls RNGH `Pinch`/`Pan`/`Tap`
  composed in `Gesture.Exclusive`, clamped pan (`clampPan` `:39`), a drag-axis
  discriminator (`axis` `:34,89-97`), horizontal swipe between photos
  (`:103-111`) and vertical pull-to-dismiss with a fading backdrop (`:112-117`).
  `image-viewer.tsx` supplies the counter / Save / Close overlay.
- **Known bugs / fragility.** T-1338 tried this twice and both failed on Julio's
  Android phone; T-1256 built the current pager; MUX-13 records the earlier
  `setState`-per-frame jank. The gesture composition is the exact class of code
  that failed.
- **Candidate.** `react-native-zoom-toolkit` 5.1.1 (2026-08-30); peers `react *`,
  `react-native *`; its own dev dependencies are reanimated ~4.1.1 and RNGH
  ~2.28.0, so it is built for reanimated 4 and works with the app's 4.5.1 / ~2.32.0.
  `Gallery` gives the carousel, per-item pinch/pan/double-tap and `onVerticalPull`.
- **Lines.** −353 (both files) with ~+40 of `renderItem`/`onIndexChange` wiring;
  net about −300.
- **Risk.** Low: already trialled, already spec'd.
- **Parity.** Mobile only. Web is Row 2.

### Row 2 — Web photo viewer → `yet-another-react-lightbox`

- **Files.** `apps/web/src/components/media/MediaViewer.tsx` (209),
  `media/useZoomPan.ts` (384), `media/zoomGeometry.ts` (60),
  `media/ViewerArrows.tsx` (45), `media/trusted-media.ts` (17).
- **What it does.** `useZoomPan.ts` re-implements wheel + trackpad-pinch zoom
  toward the cursor (`:183-209`), pointer-capture pan and two-finger pinch
  (`:225-337`), double-click zoom (`:339-367`) and a horizontal swipe at 1x.
  `zoomGeometry.ts` re-derives the painted image rect to decide what counts as a
  click on the photo. `MediaViewer.tsx` adds the counter, arrows, keyboard
  `←`/`→` and its own `useModal` focus trap.
- **Known bugs / fragility.** Two fix rounds already: T-1339 (gestures) and
  T-1340 (double-click and click-outside were retargeted by pointer capture,
  fixed with `zoomGeometry.ts`). `MediaViewer.tsx:44-56` documents the
  hand-rolled scope. This is the same surface that failed on mobile.
- **Candidate.** `yet-another-react-lightbox` 3.32.2 (2026-07-30); peers
  `react`/`react-dom` `^16.8‖^17‖^18‖^19` (React 19 OK). Its Zoom plugin gives
  wheel/trackpad/pinch/double-click, drag-pan, swipe between slides,
  thumbnails/captions, focus trap, Escape and arrows — the whole of
  `MediaViewer.tsx` + `useZoomPan.ts` + `zoomGeometry.ts` + `ViewerArrows.tsx`.
  Alternative if the current shell must stay: `react-zoom-pan-pinch` 4.2.0
  (2026-09-03, peers `react`/`react-dom *`), which replaces only the hook and
  geometry (~−450).
- **Lines.** −600 (viewer + hook + geometry + arrows) with ~+60 wiring; keep
  `trusted-media.ts` and `mediaSrc` for source resolution.
- **Risk.** Medium: carry over the album scoping (`MediaViewer.tsx:76-93`) and
  the trusted-host source rule; the lightbox portals itself, so the local
  `useModal` trap goes away.
- **Parity.** Web. Twin of Row 1.

### Row 3 — Web dialogs / menus / popovers / focus trap → ~~Radix~~ **Base UI**

> **Lead, 2026-10-14:** Julio chose Base UI (`@base-ui/react`) over Radix ("instead of radix, use base ui").
> - T-1344 shipped the dialogs on Radix first; T-1350 moves them, and `Button`'s `Slot`, to Base UI and removes `radix-ui`.
> - T-1349 builds the menus on Base UI `Menu`.
> - Read "Radix" below as the original audit text.

- **Files.** `apps/web/src/components/ui/dialog.tsx` (83),
  `ui/sheet.tsx` (56), `ui/menu.tsx` (230), `ui/use-modal.ts` (95),
  `ui/toast.tsx` (72), `components/ConfirmDialog.tsx` (61); menus are
  `position: absolute` (`ui/menu.tsx:146-149`).
- **What it does.** `use-modal.ts` hand-rolls focus-in/return, an Escape
  "only the topmost `[role=dialog]`" rule (`:54-69`) and a manual Tab trap
  (`:74-94`). `menu.tsx:88-130` hand-rolls roving focus, Home/End and wrap.
  `dialog.tsx`/`sheet.tsx` are plain divs with `role="dialog"`.
- **Known bugs / fragility.** Seven kit fix rounds already:
  T-0282 (Escape at the topmost overlay, layout-effect listener), T-0318
  (Menu keyboard support), T-0319/T-0320 (menus on the kit, Escape no longer
  leaves the chat), T-0359 (aria-label), T-0401 (radio items). This is a lot of
  a11y logic to keep correct by hand.
- **Candidate.** Radix is already installed as the umbrella `radix-ui` 1.6.7
  (`apps/web/package.json:30`), used only for `Slot` (`ui/button.tsx:2`); latest
  umbrella 1.8.1 (2026-10-13). `@radix-ui/react-dialog` 1.3.1 and
  `@radix-ui/react-dropdown-menu` 2.2.1 (both 2026-10-13), plus Popover/Tooltip/
  FocusScope, give portalled, collision-aware positioning, full keyboard and
  ARIA for free. (Note: `docs/audit/simplify-2026-10-09/D-web.md:93` already flags
  the umbrella as over-installed; this row finally uses it, or switches to the
  per-primitive packages.)
- **Lines.** −400 hand-rolled, +150 wrapping Radix round the same Tailwind
  classes.
- **Risk.** Medium: many call sites; keep the current look by passing the same
  class names. No mobile twin — mobile uses its own RN kit and native sheets.
- **Parity.** Web.

### Row 4 — Mobile keyboard handling → `react-native-keyboard-controller`

- **Files.** `apps/mobile/src/lib/use-keyboard-height.ts` (55) plus
  `KeyboardAvoidingView` at `app/chat/[id].tsx:110,150,244`,
  `components/ui/bottom-sheet.tsx:40`, `chat/new-chat-button.tsx:249`,
  `stickers/telegram-import-sheet.tsx:139`, `ais/[id].tsx:254`, `ais/new.tsx:198`,
  `ais/tool-detail-sheet.tsx:40`.
- **What it does.** RN's `KeyboardAvoidingView` (`behavior="padding"` on iOS
  only) plus a manual `keyboardDidShow` height (`use-keyboard-height.ts:42-55`)
  that pads Android sheets because edge-to-edge no longer resizes the window.
- **Known bugs / fragility.** MUX-7 (the keyboard hides the latest messages;
  `mobile-ux-audit.md:37`), MUX-20 (auth cards can be covered;
  `:53`), and three Android-specific fix rounds: T-0254, T-0310, T-0313.
- **Candidate.** `react-native-keyboard-controller` 1.22.7 (2026-10-12); peers
  `react`/`react-native *` and `reanimated >=3.0.0` (4.5.1 OK). `KeyboardAvoidingView`
  / `KeyboardStickyView` replace the manual height plumbing on both platforms and
  fix the "scroll the last message above the keyboard" behaviour natively.
- **Lines.** −~55 (the height hook) plus swapping the wrappers; net about −40.
- **Risk.** Medium: a native module (needs a dev-client / prebuild) — verify on
  Julio's Android phone.
- **Parity.** Mobile only (web has no keyboard-avoidance problem).

### Row 5 — Web message and chat lists → `@tanstack/react-virtual`

- **Files.** `apps/web/src/components/MessageList.tsx` (392),
  `components/useMessageWindow.ts` (122), `components/useScrollMemory.ts` (143),
  `components/ChatList.tsx` (203).
- **What it does.** `useMessageWindow.ts:50-122` renders only the newest
  `WINDOW = 150` items, growing the window on scroll and on a jump
  (`start`/`floor`, `:65-89`). `MessageList.tsx` hand-rolls the scroll anchor:
  prepend compensation (`:158-190`), an `atBottom` ref, a `ResizeObserver` pin
  (`:233-249`) and a jump-to-bottom button.
- **Known bugs / fragility.** PERF-3 (T-1278) built the window; T-1199 and T-1297
  fixed viewport drift and scroll memory. `docs/audit/simplify-plan.md:26` and
  `performance-audit.md:48` both record "no virtualisation". The anchoring logic
  is delicate and has its own regression history.
- **Candidate.** `@tanstack/react-virtual` 3.14.19 (2026-10-13); peers
  `react`/`react-dom` `^16.8‖^17‖^18‖^19` (React 19 OK). Virtualises both lists
  with measured rows and `scrollToIndex`, replacing the manual window + anchor
  bookkeeping.
- **Lines.** −~200 (window hook + anchor code) / +~150.
- **Risk.** Medium-high: the jump-to-message, unread divider and reply-quote
  scroll all depend on the current anchors; do the chat list first (simpler), the
  message list second, behind the existing tests.
- **Parity.** Web.

### Row 6 — Mobile markdown → `@ronradtke/react-native-markdown-display`

- **Files.** `apps/mobile/src/components/chat/markdown-text.tsx` (285),
  `chat/markdown-table.tsx` (282), `lib/markdown-blocks.ts` (198),
  `lib/markdown-inline.ts` (182); the shared parsers in
  `packages/chat-core/src/markdown.ts` / `light-markdown.ts` also feed previews.
- **What it does.** A hand-written tokeniser + block/inline renderer for AI
  replies and (lighter) human messages, with a custom table renderer.
- **Known bugs / fragility.** Repeated layout fixes: T-0337 (lists/code blocks),
  T-0338 (tick wrapping), T-1227 (light markdown), T-1328 (tables); T-1040 split
  a 410-line file just to stay under the size cap. Web renders the same content
  with `react-markdown` 10.1 + `remark-gfm` (`MarkdownText.tsx:2-3`), so the two
  platforms never fully match.
- **Candidate.** `@ronradtke/react-native-markdown-display` 9.0.3 (2026-06-29);
  peers `react >=16.2.0`, `react-native >=0.50.4`. It is the maintained fork of
  `react-native-markdown-display` (7.0.2, last published 2023-12-11). Gives GFM
  tables, lists, code blocks, links out of the box.
- **Lines.** −~400 if the chat-bubble renderer switches and the shared parsers
  stay for list previews; more if previews move too.
- **Risk.** Medium-high: styling/AI-token parity with web, and the core parsers
  must remain for `previewBody`. Prototype one bubble type first.
- **Parity.** Mobile only (web is already `react-markdown`, skipped).

### Row 7 — Mobile bottom sheets / action sheets → `@gorhom/bottom-sheet`

- **Files.** `apps/mobile/src/components/ui/bottom-sheet.tsx` (73),
  `ui/action-sheet.tsx` (130); 12 files render a `BottomSheet` and 8 render an
  `ActionSheet` (chat sheets, emoji sheet 162, media sheet 198, topic sheets,
  create sheets, sticker import…).
- **What it does.** A fade-in RN `Modal` with a tappable backdrop, a rounded
  panel and a `KeyboardAvoidingView` + `sheetBottomPadding` fix for Android
  (`bottom-sheet.tsx:40-70`).
- **Known bugs / fragility.** Works, but no drag-to-dismiss or snap points;
  every sheet re-implements its own scroll/padding. The Android keyboard padding
  was fixed three times (T-0254/T-0310/T-0313).
- **Candidate.** `@gorhom/bottom-sheet` 5.2.14 (2026-05-09); peers
  `react-native-gesture-handler >=2.16.1` and `reanimated >=3.16.0‖>=4.0.0-`
  (app has 2.32.0 / 4.5.1). Gives gesture-driven dismissal, snap points, a
  built-in backdrop and a keyboard-aware content container.
- **Lines.** −150 / +120, but the real cost is the ~20 call-site migrations.
- **Risk.** Medium, **effort high**. Do it only after the viewer and keyboard
  work lands, and probably sheet-by-sheet.
- **Parity.** Mobile only.

### Row 8 — Mobile message/chat list → `@shopify/flash-list` (keep FlatList for now)

- **Files.** `apps/mobile/src/components/chat/message-list.tsx` (367),
  `chat/use-message-list-scroll.ts` (193); the chat list and other lists use
  `FlatList` too.
- **What it does.** RN `FlatList` (which already virtualises) with an inverted
  data model, `maintainVisibleContentPosition`, an unread-divider scroll and a
  hand-rolled follow/jump/#unseen model (`use-message-list-scroll.ts:47-190`).
- **Known bugs / fragility.** None open, but the scroll model is the most
  carefully fixed part of the app (MUX-1/2/7/8 shipped together —
  `mobile-ux-audit.md:33-39`).
- **Candidate.** `@shopify/flash-list` 2.3.3 (2026-10-01; v2 is react-native-
  new-architecture only, which the app is) or `@legendapp/list` 3.6.0
  (2026-09-29, peers `react *`).
- **Verdict.** **Keep `FlatList` for now.** It already virtualises, the gain is
  performance-only on very long chats, and swapping it risks the jump-to-message
  and scroll-anchor behaviour that took several rounds to get right. Revisit only
  if a profile (not a guess) shows the list is the bottleneck.
- **Parity.** Mobile.

### Row 9 — Web avatar cropper → `react-easy-crop`

- **Files.** `apps/web/src/components/avatar/CropDialog.tsx` (146),
  `lib/avatar-crop.ts` (116), plus the crop phase of
  `components/AvatarUploader.tsx` (266).
- **What it does.** Pointer-drag under a circular mask, a zoom range input, and
  clamping maths in `avatar-crop.ts`; exports 256×256.
- **Known bugs / fragility.** None open; T-1007 was a size split, not a fix.
- **Candidate.** `react-easy-crop` 6.2.4 (2026-10-06); peers `react`/`react-dom`
  `>=16.4.0`. Handles drag, wheel/pinch zoom, bounds and the mask.
- **Lines.** −140 / +60.
- **Risk.** Low. Benefit low-medium (the cropper is reached only when a user
  changes their picture). Good "whenever this file is touched" swap.
- **Parity.** Web only; mobile already uses the native system cropper
  (`allowsEditing: true`, `components/settings/avatar-native.ts:152-161`) — keep.

### Row 10 — Web folder / sticker reorder → `@dnd-kit/core`

- **Files.** `apps/web/src/routes/FoldersPage.tsx` (226; native HTML5 DnD at
  `:109-115`), `components/sticker/PackEditorItems.tsx` (`draggable` at `:40-44`),
  `components/sticker/PackEditorForm.tsx` (`:96`),
  `components/folder/FolderHideSection.tsx` (65).
- **What it does.** Native `draggable`/`onDragStart`/`onDragOver` handlers with a
  `dragId` state; no keyboard/touch drag.
- **Known bugs / fragility.** None open, but native HTML5 DnD does not work on
  touch and has no keyboard path (an a11y gap).
- **Candidate.** `@dnd-kit/core` 6.3.1 (2024-12-05); peers `react`/`react-dom`
  `>=16.8.0`. Adds pointer + keyboard sensors and accessible reordering.
- **Lines.** −80 / +60.
- **Risk.** Low. Benefit low (settings surface). Mobile already uses Up/Down
  buttons (`settings/folders.tsx`, `stickers/packs-tab.tsx`) — keep.
- **Parity.** Web only.

---

## 3. Keep hand-rolled (a library would be worse, or it is already a library)

| Area | Files | Why keep |
| ---- | ----- | -------- |
| Mobile emoji picker | `chat/emoji-tab.tsx` (156), `lib/emoji-data.ts` (435) | `rn-emoji-keyboard` is stale (1.7.0, 2024-05-09) and the current picker is Unicode-only, matching the "no emoji in chrome" rule; the weight is the data file, which a library still needs. |
| Toast (both platforms) | mobile `ui/toast.tsx` (62), web `ui/toast.tsx` (72) | Tiny, correct `role="status"`/`aria-live` regions; `sonner` 2.0.8 (2026-08-09) is a dependency for no behaviour gain. |
| Voice recorder / waveform | mobile `chat/voice-recorder.tsx` (362), `voice-message-bars.tsx` (232); web `lib/voice/waveform.ts` (57) | Deeply tied to `expo-audio`, `expo-haptics`, the Effect ports and on-device transcription; the available RN waveform libraries are immature. |
| Message menu / double-tap react | mobile `chat/bubble-gesture.tsx` (62), `message-bubble-actions.tsx` (192), `ui/action-sheet.tsx` | MUX-21 wants an **anchored reactions row above the bubble**; `@react-native-menu/menu` (2.0.0, 2025-09-10) and `zeego` (3.0.6, 2025-03-21, pinned to menu 1.2.2) render native menus that cannot draw that custom row. Custom stays. |
| Swipe-to-reply / chat-row swipe | `chat/swipe-to-reply.tsx` (74), `chat/chat-row-swipe.tsx` (108) | Already on RNGH `ReanimatedSwipeable` — a library, so skipped. |
| Pull-to-refresh | `chat/chat-list.tsx`, `chat/group-topic-list.tsx` | Native `RefreshControl` — already platform. |
| File / image pickers | mobile `lib/attachment-picker.ts` (Expo DocumentPicker/ImagePicker/MediaLibrary); web `<input type="file">` | Already platform libraries. |
| Video / audio players | `expo-video`, `expo-audio`; web native `<audio>` (`VoiceMessage.tsx`) | Already libraries / platform elements. |
| Date, time, money formatting | `packages/chat-core/src/format.ts`, `money.ts`, `chat-labels.ts` | Already `Intl.DateTimeFormat` / `Intl.NumberFormat`. |
| GIF panel, link previews | `chat/gif-panel.tsx` (283), `chat/link-preview-card.tsx` (175) | Presentational and small; no mature RN equivalent worth a dependency. |

---

## 4. Proposed tasks (one library each; twins named)

| Task | Row(s) | Library | Platforms | Twin |
| ---- | ------ | ------- | --------- | ---- |
| **T-1341** (already written) | 1 | `react-native-zoom-toolkit` | mobile | — |
| **New: web viewer on a lightbox** | 2 | `yet-another-react-lightbox` | web | twin of T-1341 |
| **New: web overlays on Radix** | 3 | `radix-ui` / `@radix-ui/react-*` | web | — (mobile keeps its RN kit) |
| **New: mobile keyboard on keyboard-controller** | 4 | `react-native-keyboard-controller` | mobile | — |
| **New: web lists on react-virtual** | 5 | `@tanstack/react-virtual` | web | — |
| **New: mobile markdown on markdown-display** | 6 | `@ronradtke/react-native-markdown-display` | mobile | — (web already `react-markdown`) |
| **New: mobile sheets on bottom-sheet** | 7 | `@gorhom/bottom-sheet` | mobile | — |
| **New: web cropper on react-easy-crop** | 9 | `react-easy-crop` | web | — (mobile uses the native cropper) |
| **New: web reorder on dnd-kit** | 10 | `@dnd-kit/core` | web | — (mobile uses Up/Down buttons) |

Row 8 (mobile `@shopify/flash-list`) is deliberately **not** turned into a task;
it stays a note to revisit after a profile.

Web + mobile twins in this plan: the two photo viewers (T-1341 and the new web
lightbox task). Markdown is also a near-twin, but web already runs
`react-markdown`, so only mobile changes.
