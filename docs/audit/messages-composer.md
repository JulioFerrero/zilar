# Messages core C: the composer (rewrite map)

Read-only audit of the composer on web and phone. It changes no code.

**Measured scope** (`wc -l`, this worktree, 2026-10-19):

| File | Lines |
| --- | ---: |
| `apps/mobile/src/components/chat/chat-composer-dock.tsx` | 676 |
| `apps/mobile/src/components/chat/composer.tsx` | 643 |
| `apps/web/src/components/composer/ComposerControls.tsx` | 579 |
| `apps/web/src/components/Composer.tsx` | 563 |
| `apps/mobile/src/lib/drafts.ts` | 242 |
| `apps/web/src/components/composer/useMentions.ts` | 224 |
| `apps/mobile/src/components/chat/composer-picked-strip.tsx` | 208 |
| `apps/mobile/src/components/chat/composer-sheet.ts` | 199 |
| `packages/chat-core/src/mentions.ts` | 193 |
| `packages/client-core/src/composer-drafts.ts` | 180 |
| `apps/server/src/drafts/hub.ts` | 172 |
| `apps/mobile/src/components/chat/composer-mentions.ts` | 152 |
| `apps/web/src/components/composer/useRecordingLifecycle.ts` | 148 |
| `apps/mobile/src/lib/composer-drafts.ts` | 84 |
| `apps/web/src/components/composer/useComposerFocus.ts` | 78 |
| `apps/web/src/components/composer/composerShared.ts` | 50 |
| `apps/web/src/lib/composer-drafts.ts` | 39 |
| `apps/server/src/drafts/events.ts` | 24 |
| **Total** | **4,454** |

Adjacent files were read only to follow a call, and are **not** in the count: `apps/web/src/components/composer/useComposerAttachments.ts` (339), `useVoiceRecorder.ts` (357), `apps/mobile/src/components/chat/composer-media.ts` (377), `voice-recorder.tsx` (570), `attach-sheet.tsx` (724), `apps/web/src/lib/voice/recorder.ts` (182), `packages/client-core/src/store/draft-stream.ts` (130) and `draft-events.ts` (52).

**Method note.** The spec names `docs/LEAN_CODE.md` and asks part 3 to walk its rules. That file is on `main` (commit `354a0f19f`, "docs: lean code rules for feature rewrites") but not on this task branch; part 3 uses its rule headings and order, quoted below. Every finding stands on its own `file:line`.

---

## 1. Behaviour list

Every behaviour a user sees or relies on. "Shared" means `packages/chat-core` or `packages/client-core` owns the rule today. Platform-only entries say so.

| # | Behaviour | Web | Phone | Shared |
| --- | --- | --- | --- | --- |
| 1 | **Text is the chat's draft.** Typing writes the draft for that user and chat; re-entering the chat restores it. | `apps/web/src/lib/composer-drafts.ts:36-39`, `Composer.tsx:75-88,296` | `apps/mobile/src/lib/composer-drafts.ts:78-84`, `composer.tsx:190-205,266-269` | `packages/client-core/src/composer-drafts.ts:169-180` |
| 2 | **Draft persistence.** Web writes `localStorage` after 300 ms; phone writes one JSON file after 500 ms. Both keep only non-empty drafts, drop the oldest past 200, truncate each at 4,000 chars, and scope the map to the signed-in user. Drafts are **per device, not synced across devices**. | `apps/web/src/lib/composer-drafts.ts:6-33` | `apps/mobile/src/lib/composer-drafts.ts:6-74` | `packages/client-core/src/composer-drafts.ts:5-6,20-23,44-167` |
| 3 | **User switch.** The leaving user's last 300/500 ms of typing is flushed, the map is re-scoped, and one account's draft cannot appear in another's composer. | via shared hook | via shared hook | `packages/client-core/src/composer-drafts.ts:107-130` |
| 4 | **Empty text deletes the draft**, and sending clears the stored entry. | `Composer.tsx:437`, shared `setDraft` | `composer.tsx:411-415` | `packages/client-core/src/composer-drafts.ts:136-153` |
| 5 | **Enter sends, Shift+Enter is a newline** (web-only; on the phone Enter inserts a newline because the input is multiline and has no key handler). | `Composer.tsx:508-515` | `composer.tsx:509-538` (no key handling) | — |
| 6 | **Send button.** Enabled when trimmed text is non-empty or an attachment is staged; shows a disabled save button while editing empty text; otherwise shows the mic. | `Composer.tsx:320`, `ComposerControls.tsx:530-563` | `composer.tsx:435-456,552-580`; `composer-media.ts:249` | — |
| 7 | **Sending clears** text, mentions, picker, and reply; phone also stops typing and may raise haptics. | `Composer.tsx:420-441` | `composer.tsx:435-456,557-559`; `chat-composer-dock.tsx:579-594` | — |
| 8 | **Reply.** A reply bar shows sender and text; X or Escape cancels; the sent message carries `replyTo`; sending clears it. | `Composer.tsx:283-290,502-507`; `ComposerControls.tsx:400-424` | `composer.tsx:161-188,480-482`; `chat-composer-dock.tsx:579-594` | — |
| 9 | **Edit.** The composer prefills the message text and mentions, caret at end. Save (web also Enter) sends the correction, unchanged text cancels, empty text cannot save, X or Escape cancels. Leaving edit restores the draft that was there before. | `Composer.tsx:32-73,300-310,337-366,443-453,496-501`; `ComposerControls.tsx:37-58,398-399` | `composer.tsx:257-281,442-449,478-479,118-143` | `canEditMessage`, `packages/chat-core/src/edits.ts:8` |
| 10 | **ArrowUp on an empty, non-reply, non-edit composer edits the last editable message** (web-only). | `Composer.tsx:455-463,483-494` | — | `canEditMessage` |
| 11 | **Markdown shortcuts** Cmd/Ctrl+B, I and E wrap/toggle `**`, `_`, `` ` `` and keep the selection (web-only). | `Composer.tsx:168-279,318` | — | — |
| 12 | **Mention query.** In a group, the picker opens on `@` at the start or after whitespace, with no space between `@` and the caret. It filters handle-prefix first, then any name word prefix, case- and accent-insensitively; AIs rank before people and only 6 rows show. In a topic it offers members of that topic only; old chats without `memberIds` are not filtered. DMs never show it. | `useMentions.ts:69-90,121-136`; `ComposerControls.tsx:86-133` | `chat-composer-dock.tsx:491-508`; `composer-mentions.ts:28-40`; `composer.tsx:71-116` | `packages/chat-core/src/mentions.ts:15-29,141-167`, `mentionInTopic` |
| 13 | **Mention keyboard navigation** (web-only): ArrowUp/Down wrap, Enter/Tab pick, Escape closes, focus stays in the textarea and `aria-activedescendant` tracks the row. Phone rows are tapped. | `useMentions.ts:154-180`; `ComposerControls.tsx:78-133,482-485` | `composer.tsx:92-111` | — |
| 14 | **Picking a mention** replaces `@query` with `@handle ` (or `@Name `) and puts the caret after the space; the stored range excludes the trailing space. | `useMentions.ts:138-152` | `composer.tsx:359-370`; `composer-mentions.ts:111-129` | `packages/chat-core/src/mentions.ts:38-60` |
| 15 | **Mentions rebase on every edit.** Text before a range keeps it, text after shifts it, an edit touching it drops it. Backspace with the caret inside a mention (or right after its last character) deletes the whole token: web in the key handler, phone by detecting a single-character delete. | `useMentions.ts:121-136,182-199` | `composer.tsx:324-341`; `composer-mentions.ts:87-103,133-152` | `packages/chat-core/src/mentions.ts:72-94` |
| 16 | **Mentions never leak across chats.** Switching chat resets mentions and picker but keeps the draft. | `Composer.tsx:297,328-333` | `composer.tsx:304-314`; `composer-mentions.ts:55-65` | — |
| 17 | **Mentions are trimmed on send**: leading whitespace shifts the recorded ranges, out-of-range ranges are dropped, and the store sends the XEP-0372 references. | `Composer.tsx:432-435` | `chat-composer-dock.tsx:579-594`; `composer.tsx:450` | `packages/chat-core/src/mentions.ts:177-193`; `client-core/src/store/send/text.ts:20` |
| 18 | **"Not in topic" rows.** After sending mentions of people or AIs outside the open topic, a centred row says "X isn't in Topic" with Add; Add shows busy, then failed ("Couldn't add") or removes the row; rows reset on chat switch. | `Composer.tsx:90-166,298,370-418,523-538` | `chat-composer-dock.tsx:160-243,520-568,625-640` | `mentionInTopic` only; the derivation and state are copied |
| 19 | **Typing indicator.** A non-empty change sends composing (web throttles to one per 2 s); empty text or a send sends paused. | `useMentions.ts:64-67,101-136` | `composer.tsx:270,292-298,354-356,392-398`; `chat-composer-dock.tsx:651-652` | core `sendTyping`/`stopTyping` |
| 20 | **Attachments.** Pick photo/video or file, cap at 10 files / 50 MB / non-empty, preview one item as a row and several as a horizontal strip, remove any, send with a caption. Web also accepts paste and drag/drop (document listeners in the hook); web shows a send dialog for several files. | `ComposerControls.tsx:139-311,425-431,565-576`; `Composer.tsx:520`; `useComposerAttachments.ts:154-175` | `composer.tsx:417-433,495,631-640`; `composer-picked-strip.tsx` | size/format helpers in `chat-core`; the pickers are platform code |
| 21 | **Stickers, GIFs and emoji.** The smile panel switches Emoji/Stickers/GIFs, inserts emoji at the caret, sends a sticker or GIF, persists emoji and sticker recents, hides the GIF tab when the server answers 501; web also links to sticker settings. | `ComposerControls.tsx:488-518` | `composer-sheet.ts:53-198`; `composer.tsx:469-474,582-630` | `gifsAvailability`, `insertEmojiAtCaret`, sticker recents |
| 22 | **Voice.** The mic replaces Send while the composer is empty. Hold to record and release to send; a quick tap locks the recorder (then Send or the button sends); sliding left cancels; the timer ticks every 100 ms; Escape or the trash cancels; changing chat cancels and releases the microphone; too-short and save errors are fixed sentences. | `useRecordingLifecycle.ts:27-147`; `ComposerControls.tsx:448-463,521-529,554-562`; `useVoiceRecorder.ts` | `composer.tsx:500,572-580`; `voice-recorder.tsx` | — (platform recorder) |
| 23 | **Auto-growing input.** Web grows from one to six 22 px lines. Phone grows from 36 px to 132 px and ignores the padding Android already counted. | `ComposerControls.tsx:60-62,374-385` | `composer.tsx:145-159,525-531` | — |
| 24 | **Focus rules.** Web focuses the composer on a chat switch only on wide screens (≥900 px) and when focus is not in an editable element or a dialog; a narrow↔wide resize must not steal focus. Reply and edit refocus. `focusComposer()` is called after certain navigation actions. Phone focuses on reply and edit only. | `useComposerFocus.ts:1-78`; callers `ChatView.tsx:439`, `ContactPanel.tsx:122` | `composer.tsx:283-290` | — |
| 25 | **Placeholder** is `composerPlaceholder(title)`; phone says "Add a caption" once files are staged. | `Composer.tsx:335`; `ComposerControls.tsx:478` | `composer.tsx:427` | `packages/chat-core/src/text.ts:20` |
| 26 | **Channel read-only bar.** Subscribers see "Only admins can post here" and Mute/Unmute with a fixed error sentence; an unknown role reads as subscriber. Admins get the normal composer. | `ChatView.tsx:62-100,579-581` | `chat-composer-dock.tsx:61-158` | `canPostTo` exists, but the role rule is per app (`ChatView.tsx:76-78`, `mobile/lib/channels.ts:9-23`) |
| 27 | **Selection mode bar** (phone-only): "N selected", Cancel, Delete (with per-message rules and a DM/all-mine confirm), Copy, Forward; Android back leaves the mode or closes the confirm. | — (web bar is elsewhere) | `chat-composer-dock.tsx:245-447` | `deleteActionFor`, `canAct` |
| 28 | **Escape/back layering.** Escape cancels recording first, then the mention picker, then a staged attachment (only when text is empty), then edit, then reply. Android back closes the emoji sheet, the edit/reply bar and selection mode. | `Composer.tsx:465-507`; `useMentions.ts:174-179` | `use-back-cancel` in `composer.tsx:119,162`; `composer-sheet.ts:123-133`; `chat-composer-dock.tsx:364-370` | — || 29 | **Errors** are fixed sentences, shown above the input: store action error for send/edit, voice error, attachment error (phone's is also dismissable). | `Composer.tsx:311-314`; `ComposerControls.tsx:432-447` | `composer.tsx:483-493` | store text in `client-core` |
| 30 | **Chat switch** keeps the draft but drops ephemeral state: mentions, staged attachment, picker and not-in-topic rows; an active recording is cancelled. | `Composer.tsx:328-333`; `useRecordingLifecycle.ts:43-62` | `composer.tsx:304-314`; `chat-composer-dock.tsx:521-523` | — |
| 31 | **Live AI drafts** (not composer drafts). While an AI turn runs, the server streams cumulative draft text for that turn; the owner's other devices show it in the chat. The latest draft per AI chat is replayed on connect, the first draft of a quiet turn is immediate and later ones are throttled at 150 ms, nothing over 8,000 chars is sent, and `end` flushes the latest text then reports `sent`/`failed`. Drafts never cross users or servers. | transport `apps/web/src/store/effects/ports.ts:139-215` (EventSource) | transport `apps/mobile/src/lib/drafts.ts:75-242` (XHR) | producer `apps/server/src/drafts/hub.ts:29-169`, `events.ts:1-24`; store `client-core/src/store/draft-stream.ts:1-130`, `draft-events.ts:1-52` |
| 32 | **Draft-stream reconnection.** Web reopens an EventSource that closed on a non-2xx with jittered 1 s→30 s backoff. Phone reads SSE from `XMLHttpRequest.responseText`, reconnects only while the app is active, retries a missing token, resets the attempt after the first partial response, and drops malformed frames silently. | `apps/web/src/store/effects/ports.ts:139-215` | `apps/mobile/src/lib/drafts.ts:90-234` | backoff + decoding `packages/client-core/src/store/draft-events.ts:8-52` |

---

## 2. Twin logic

Rules web and phone implement separately today. "Lines" is the size of the duplicated unit, read from the ranges; the target column says where the one copy goes.

| Rule | Web | Phone | Lines (web / phone) | One copy goes to |
| --- | --- | --- | ---: | --- |
| Mention state machine (query → candidates → insert → rebase → backspace → reset) | `useMentions.ts:60-207` | `composer-mentions.ts:24-152` + `composer.tsx:300-390` | 148 / 220 | `client-core/composer/mention-state.ts` |
| Member list for the picker (group members minus me, topic filter, AI map) | `useMentions.ts:69-82` | `chat-composer-dock.tsx:491-508` | 14 / 18 | same module, as `mentionMembers(chat, detail, meJid)` |
| Candidate ordering (AIs first, 6-row cap) | `useMentions.ts:83-90` | `composer-mentions.ts:28-40` | 8 / 13 | same module |
| Draft storage adapter envelope (decode/encode/error swallow; the cap itself is already shared) | `lib/composer-drafts.ts:1-39` | `lib/composer-drafts.ts:32-74` | 39 / 84 | `client-core/composer/drafts.ts`; the thin adapters stay |
| Topic "not in topic" derivation (mentions → missing people/AIs → row data) | `Composer.tsx:370-418` | `chat-composer-dock.tsx:525-565` | 49 / 41 | `client-core/composer/topic-not-in.ts` |
| Topic "not in topic" row + per-row Add action state | `Composer.tsx:90-166` | `chat-composer-dock.tsx:160-243` | 77 / 84 | `client-core/composer/topic-not-in.ts` (hook included); markup per app |
| Channel read-only rule (role → can post, unknown = subscriber) | `ChatView.tsx:76-78` | `mobile/src/lib/channels.ts:9-23` | 3 / 15 | `chat-core/src/channels.ts` |
| Read-only bar (copy, Mute/Unmute, fixed error) | `ChatView.tsx:62-100` | `chat-composer-dock.tsx:61-158` | 39 / 98 | logic shared, markup per app |
| Draft SSE frame parsing + reconnect policy | `store/effects/ports.ts:139-215` (EventSource, no parsing) | `lib/drafts.ts:36-65,90-234` | ~77 / ~175 | `client-core/composer/sse.ts` (parser + retry), transport adapter per app |
| Draft wire schema | consumer `client-core/store/draft-events.ts:14-26` | producer `server/src/drafts/events.ts:6-21` | 13 / 16 | `packages/api-contract/src/drafts.ts` |
| Edit-draft set-aside | `Composer.tsx:32-73,337-366` | none (separate `editText`, `composer.tsx:267-281`) | 70 / 0 | delete; keep the draft and use a separate edit value in both |
| `formatPreviewSize` (file size plus "sending with your message") | shared `formatFileSize` | `composer-picked-strip.tsx:180-196` | 0 / 17 | call `formatFileSize` + one suffix |
| `isImageName` (extension list) | — | `composer-picked-strip.tsx:198-203` | 0 / 6 | `classifyMobileFile` already imported in the same file |
| `clamp` | — | `composer.tsx:157-159` | 0 / 3 | inline `Math.min/Math.max` |
| Auto-grow rule | DOM scroll height, 1–6 lines (`ComposerControls.tsx:374-385`) | RN content height, 36–132 px (`composer.tsx:145-159,525-531`) | 12 / 15 | platform-only, but one constant table in `chat-core` |
| `canSend` rule | `Composer.tsx:320` | `composer-media.ts:249` | 1 / 1 | move to the shared mention/composer state |
| Draft typing throttle (2 s on web, every change on phone) | `useMentions.ts:126-135` | `composer.tsx:354-356` | 10 / 3 | `chat-core` helper `shouldSendComposing(lastAt, now)` |

**Total twin cost.** About **450 web lines and 600 phone lines** in this table are duplicated logic or state; the rest of the line counts are the markup around it. Roughly 470 of those lines disappear outright and 105 become the one shared mention-state module (the shared schemas and SSE parser replace another ~105). The markup twins (bars, picker rows, preview tiles) are not shareable across DOM and React Native and are handled inside each app under part 3, "One home per piece of logic".

---

## 3. Slop by rule

Part 3 walks the rules in `docs/LEAN_CODE.md` by their own headings and in their order. Rules with no finding in scope are named so the walk is complete.

### One home per piece of logic

Logic both apps need (state, derived values, actions, formatting, rules) lives once in `chat-core` or `client-core`; each app keeps only markup, platform APIs and gestures. The same home rule applies to logic and markup copied inside one app.

| Where | Break | Cost |
| --- | --- | ---: |
| `apps/web/src/components/composer/useMentions.ts:60-207` vs `apps/mobile/src/components/chat/composer-mentions.ts:24-152` + `composer.tsx:300-390` | The mention state machine is written twice. `chat-core/mentions.ts` has only the primitives (`findMentionQuery`, `insertMention`, `rebaseMentions`, `filterMentionMembers`); everything that sequences them is copied. | ~230 |
| `apps/web/src/components/Composer.tsx:370-418` vs `apps/mobile/src/components/chat/chat-composer-dock.tsx:525-565` | Same "which mentions are not in this topic" derivation, including the AI-id map and the person-id fallback. | ~45 |
| `apps/web/src/components/Composer.tsx:90-166` vs `apps/mobile/src/components/chat/chat-composer-dock.tsx:160-243` | Same Add-to-topic row state machine (`idle/busy/failed`, one call per row, drop on success). | ~70 |
| `apps/web/src/routes/ChatView.tsx:76-78` vs `apps/mobile/src/lib/channels.ts:9-23` | Same owner/admin-or-subscriber rule, different wording. | ~15 |
| `apps/mobile/src/lib/drafts.ts:36-65` | SSE framing (comment lines, `event:`, multi-line `data:`) is transport-neutral and exists only on the phone; web uses `EventSource`. | ~30 |
| `apps/server/src/drafts/events.ts:6-21` vs `packages/client-core/src/store/draft-events.ts:14-26` | The same two Effect schemas, one for the producer and one for the consumer. | ~16 |
| `apps/web/src/lib/composer-drafts.ts:1-39` vs `apps/mobile/src/lib/composer-drafts.ts:1-84` | Two storage adapters repeat the decode/encode and swallowed-error envelope around the shared store; the cap itself is already shared in `capStoredDrafts`. | ~25 |
| `apps/mobile/src/components/chat/composer-sheet.ts:53-151` | Three `useAction` blocks repeat "set loading → step(promise) → set state / catch tag" for packs, emoji recents and sticker recents. One small `usePanelLoad` wrapper removes the boilerplate. | ~30 |
| `apps/web/src/components/composer/ComposerControls.tsx:37-58` vs `:400-424` | Edit bar and reply bar repeat the stripe + content + close-button chrome with different copy. | ~15 |
| `apps/mobile/src/components/chat/composer.tsx:118-143` vs `:161-188` | Same two bars in React Native, again copied. | ~15 |
| `apps/web/src/components/composer/ComposerControls.tsx:214-246` vs `:270-311` | Single attachment preview and multi-file tile both render the image/file body and the remove button. | ~15 |
| `apps/mobile/src/components/chat/composer-picked-strip.tsx:21-41` vs `:43-62` | `PreviewThumb` and `PhotoTile` both do the failed-image fallback and the 64/72 px image. | ~18 |
| `apps/web/src/components/composer/ComposerControls.tsx:484` | `optionId()` exists but one call site still builds `mention-option-${jid}` by hand; `:100` already uses the helper. | 3 |

### Trust the types and the contract

Pass the decoded payload through instead of copying fields one by one, and don't guard states the types make impossible.

| Where | Break | Cost |
| --- | --- | ---: |
| `apps/web/src/components/composer/ComposerControls.tsx:332-372` | 30 lines unpack `mentions`, `attachments`, `voice` and `editor` into locals, only for JSX below. Passing the objects through and reading at the use site removes most of it. | ~20 |
| `apps/web/src/components/Composer.tsx:539-560` | A 12-field `ComposerEditor` object is built each render and then unpacked; the child already has the hooks. | ~10 |
| `apps/mobile/src/components/chat/composer.tsx:428-433` | `pickedPreviews` copies `media.picks` field by field into the same shape `PickedStrip` accepts. | 6 |
| `apps/mobile/src/components/chat/composer-picked-strip.tsx:162` | `onRemove?:` in the public props is an impossible state: the composer always passes it. Same path as the `onRemove` row in "No speculative code". | counted there |

### No layers that do nothing

| Where | Break | Cost |
| --- | --- | ---: |
| `apps/mobile/src/components/chat/composer.tsx:157-159` | `clamp` is a local three-line helper used once; inline `Math.min`/`Math.max` at the call site. | 3 |

### Data over branches

No finding in scope: no `switch` or table-shaped `if` chain maps one value to another here.

### Use the platform and the libraries we have before writing our own

| Where | Break | Cost |
| --- | --- | ---: |
| `apps/mobile/src/components/chat/composer-picked-strip.tsx:180-196` | `formatPreviewSize` re-implements `formatFileSize` (already imported at line 1) and appends a suffix. | 17 |
| `apps/mobile/src/components/chat/composer-picked-strip.tsx:198-208` | `isImageName` re-implements the image branch of `classifyMobileFile` (imported at line 7) for the fallback icon. | 6 |

### No speculative code

No options nobody passes, no future parameters, no generic machinery for one use, no defensive defaults. The scope has dead props, props with one value, unread returns and exports used in one place.

| Where | Break | Cost |
| --- | --- | ---: |
| `apps/server/src/drafts/hub.ts:22,91-93` | `listenerCount` has no caller: `git grep -n listenerCount -- apps packages` returns only this file, and `git grep -n listenerCount -- '*.test.*'` returns nothing. | 4 |
| `apps/mobile/src/components/chat/composer.tsx:233-234,253-254,421-422` | `picker` and `gifDownloader` props are never passed: the only two `<Composer` callers are `chat-composer-dock.tsx:112` and `:641`, and neither passes them. | 6 |
| `apps/mobile/src/components/chat/composer-picked-strip.tsx:106-115,125,140-150,162` | `onRemove` is optional and every caller passes it (`composer.tsx:495` is the only `<PickedStrip`); the "no remove" branches are dead. | 14 |
| `apps/mobile/src/components/chat/composer-picked-strip.tsx:89-90,95,169-174` | `iconColor` is always `ICON` from the only caller; the prop and its pass-through are dead. | 3 |
| `apps/web/src/components/composer/useMentions.ts:34,216` | `pickerActive` is returned but no consumer reads it (`git grep -n pickerActive -- apps/web` shows only this file); `pickerOpen` already carries the public answer. | 2 |
| `apps/web/src/components/composer/useComposerFocus.ts:31,41` | `focusComposer` returns a boolean that neither caller reads (`ChatView.tsx:439`, `ContactPanel.tsx:122`) and the internal call at `:76` ignores. | 2 |
| `apps/mobile/src/components/chat/composer-picked-strip.tsx:11-16,200-208` | `PickedPreview`, `isImageName` and `PreviewFallbackIcon` are exported for other files but used only inside this file. | 0 (API only) |
| `apps/mobile/src/components/chat/composer-mentions.ts:12,24` | `MENTION_MAX_ROWS` and `emptyMentionState` are exported but used only in the same file. | 0 (API only) |
| `packages/chat-core/src/mentions.ts:31` | `InsertMentionResult` is exported but appears only in its own file's return type. | 0 (API only) |
| `apps/server/src/drafts/events.ts:6,13` | `DraftEventSchema` and `DraftEndEventSchema` are exported but only used to build the union in the same file. | 0 (API only) |
| `apps/web/src/components/Composer.tsx:100` | `TopicNotInRow` is exported only for `components/topic/TopicNotInRow.fixture.tsx:1`; production uses it in the same file. | 0 (API only) |

### Comments

| Where | Break | Cost |
| --- | --- | ---: |
| `apps/mobile/src/components/chat/composer-sheet.ts:81-82` | The comment claims the tab fallback is here; it is `resolveSheetTab` in `composer.tsx:209-217`. | 2 |
| `apps/mobile/src/components/chat/composer-picked-strip.tsx:205` | `PreviewFallbackIcon` is documented as a shared seam but nothing imports it (see "No speculative code"). | 1 |
| `apps/web/src/components/Composer.tsx:32-35` | Explains the set-aside map, which the rewrite deletes (derive the value instead). | 4 |

### Tests

No finding: the map keeps the message-pipeline tests and deletes only tests of deleted code (part 5.4).

### Smells a reviewer rejects

**A component over 300 lines that mixes data loading, state and markup; split the state into a client-core view model.**

| Where | Break | Cost |
| --- | --- | ---: |
| `chat-composer-dock.tsx` (676), `composer.tsx` (643), `ComposerControls.tsx` (579), `Composer.tsx` (563) | Four files over the 400-line soft limit, each mixing a feature (selection, channel bar, mentions, voice, attachments, markup) that can stand alone. | no direct lines; the split is in part 5 |
| `apps/mobile/src/components/chat/chat-composer-dock.tsx:245-447` | Message-selection UI lives in the composer dock although it replaces the composer; it is not composer logic. | ~200 moved out |

**`useEffect` that copies props into state; derive the value instead.**

| Where | Break | Cost |
| --- | --- | ---: |
| `apps/web/src/components/Composer.tsx:32-73,337-366` | A module-level `Map` plus a user id holds the "draft set aside while editing". The phone keeps the draft untouched and uses a separate edit value (`composer.tsx:267-281`), which needs no stash. | ~60 |
| `apps/web/src/components/composer/useMentions.ts:61,88-90` | `picker` is stored, although it is `findMentionQuery(value, caret)` and is recomputed on every change anyway; `pickerActive`/`pickerOpen` follow from it. | ~10 |
| `apps/mobile/src/components/chat/composer.tsx:275-281` | `seededFor` plus `setState` during render seeds the edit text; a key or an effect does it without an extra render and a guard. | ~6 |
| `apps/mobile/src/components/chat/composer.tsx:305-314` | `trackedChatKey` exists only to reset mention state on a chat switch; the shared mention state can own that reset. | ~10 |
| `apps/web/src/components/Composer.tsx:297,328-333` | The same `trackedChatId` reset, copied. | ~6 |

**Slop total.** The findings above name about **720 lines** that disappear for a stated reason. The remaining ~1,070 of the 1,789-line cut is the structural result in part 5: collapsing four monolithic composer files into cohesive modules and rewriting their markup at the smaller shape. No line in the budget is "trim a comment" padding.

---

## 4. Dead code

Proved with `git grep` in this worktree. Each row is the exact query and its result.

| Symbol | Query | Result | Verdict |
| --- | --- | --- | --- |
| `DraftHub.listenerCount` | `git grep -n listenerCount -- apps packages` | `apps/server/src/drafts/hub.ts:22,91-93` only; no test hit | Dead in production and tests; delete the interface method and body (4 lines) |
| `Composer.picker` / `Composer.gifDownloader` (phone) | `git grep -n "<Composer\\b" -- apps/mobile/src` | only `chat-composer-dock.tsx:112` and `:641`; neither passes either prop | Delete both props and the two media arguments that read them (`composer.tsx:233-234,253-254,421-422`) |
| `PickedStrip.onRemove` optional | `git grep -n "<PickedStrip" -- apps/mobile/src` | only `composer.tsx:495`, always passes `media.removePick` | Make it required and delete the three "undefined" branches (14 lines) |
| `PickedPreviewRow.iconColor` | `git grep -n iconColor -- apps/mobile/src/components/chat/composer-picked-strip.tsx` | only `PickedStrip` passes it, always `ICON` (line 169) | Delete the prop (3 lines) |
| `Mentions.pickerActive` | `git grep -n pickerActive -- apps/web` | only `useMentions.ts:34,88,89,155,216` | Delete the returned field (2 lines) |
| `focusComposer` return | `git grep -n "focusComposer()" -- apps/web/src` | `ChatView.tsx:439`, `ContactPanel.tsx:122`, `useComposerFocus.ts:76`; no caller reads the result | Return `void` (2 lines) |
| `PickedPreview` type/export | `git grep -n PickedPreview -- apps` | only `composer-picked-strip.tsx` | Make local (0 lines) |
| `isImageName` / `PreviewFallbackIcon` exports | `git grep -n "isImageName\\|PreviewFallbackIcon" -- apps` | only `composer-picked-strip.tsx:26,200,205-206` | Make local, then delete `PreviewFallbackIcon` under "Use the platform and the libraries we have" / "One home per piece of logic" |
| `emptyMentionState` / `MENTION_MAX_ROWS` exports | `git grep -n "emptyMentionState\\|MENTION_MAX_ROWS" -- apps packages` | only `composer-mentions.ts:12,24,39,64` (and the web private constant at `useMentions.ts:25`) | Un-export; the module is deleted in part 5 |
| `InsertMentionResult` export | `git grep -n InsertMentionResult -- apps packages` | only `packages/chat-core/src/mentions.ts:31` | Un-export (0 lines) |
| `DraftEventSchema` / `DraftEndEventSchema` exports | `git grep -n "DraftEventSchema\\|DraftEndEventSchema" -- apps packages` | only `apps/server/src/drafts/events.ts:6,13,21` | Un-export or move to the shared contract |
| `TopicNotInRow` export | `git grep -n TopicNotInRow -- apps/web/src` | `Composer.tsx:100,158` and `topic/TopicNotInRow.fixture.tsx:1` | Keep one export for the fixture, or make the fixture import the new shared row |
| `ComposerDrafts` / `DraftStorage` exports | `git grep -ln "ComposerDrafts\\|DraftStorage" -- apps packages` | shared module, its test, `client-core/src/index.ts`, and the two adapters | Live API; keep |

No dead branch was found by reading the server draft hub's `push`/`flush`/`end` paths, but the only hub test (`apps/server/src/drafts/hub.test.ts:12-22`) checks owner isolation and replay, not throttle, flush or end. A rewrite that touches those paths needs tests for them first. The dead code in this feature is in the UI and the test-only interface method, not in the message pipeline.

---

## 5. Lean target structure

### 5.1 Modules, homes, ownership, budgets

Shared logic first. These files hold no markup.

| New/kept file | Home | Owns | Budget |
| --- | --- | --- | ---: |
| `packages/chat-core/src/mentions.ts` | `chat-core` | `findMentionQuery`, `insertMention`, `rebaseMentions`, `splitMentions`, `filterMentionMembers`, `isMentionOfMe`, `mentionsForTrimmedText`. Keep, trim dead exports. | 190 |
| `packages/client-core/src/composer/mention-state.ts` | `client-core` | The whole platform-neutral mention state machine: state `{mentions, query}`, `membersFor(chat, detail, meJid)`, `candidates(state, members)`, `onTextChange`, `pick`, `backspace`, `resetForChat`. A pure reducer plus tiny selectors; no React. | 105 |
| `packages/client-core/src/composer/topic-not-in.ts` | `client-core` | `missingMentions(mentions, topic, groupDetail)` → `{jid, name, kind, id, avatarUrl}[]`, deduped and in send order, plus `useAddToTopicRow` for the idle/busy/failed state. | 40 |
| `packages/client-core/src/composer/drafts.ts` | `client-core` | Moves `composer-drafts.ts` here: per-user map, cap 200/4,000, debounce, hydrate/merge/clear, `useComposerDraft`. Standardise `DraftStorage.load` on `Promise` so the sync branch and its casts go. | 140 |
| `packages/client-core/src/composer/sse.ts` | `client-core` | Incremental SSE frame parser (comment, `event`, multi-line `data`), `parseDraftFrame` calling `decodeDraftEvent`, and the retry scheduler (`draftReconnectDelay`). Transport is injected. | 75 |
| `packages/api-contract/src/drafts.ts` | `api-contract` | The two draft event schemas and their types, imported by the server producer and the client decoder. | 25 |
| `packages/chat-core/src/channels.ts` (or add to `topics.ts`) | `chat-core` | `channelViewerRole(role)` and `mayPostInChannel(role)`; unknown role is a subscriber. | 20 |

Shared subtotal **595** (includes the 20-line channel module).

Server:

| File | Owns | Budget |
| --- | --- | ---: |
| `apps/server/src/drafts/hub.ts` | In-process per-owner hub: subscribe/replay, latest per chat, `publishTurn` throttle 150 ms, 8,000-char cap, flush-then-end. Delete `listenerCount`. | 145 |

Web (`apps/web/src/components/composer/` unless noted):

| File | Owns | Budget |
| --- | --- | ---: |
| `Composer.tsx` | Orchestrator: draft value, reply/edit wiring, send/save, topic rows, renders controls. No format or key tables inline. | 180 |
| `useComposerKeys.ts` | Escape layering (recording → picker → attachment → edit → reply), Enter send, ArrowUp edit-last. Pure key → action mapping. | 40 |
| `format-shortcut.ts` | `markerFor` and `applyFormat` plus the selection result. Pure, testable. | 55 |
| `useMentions.ts` | Web adapter over `mention-state`: store selectors, typing throttle, keyboard navigation, caret restore. | 65 |
| `ComposerControls.tsx` | The well, input, attach button, send/mic switch, error rows; composes the pieces below. | 115 |
| `ComposerBars.tsx` | One bar component for edit and reply (icon, title, body, close). | 60 |
| `AttachmentStrip.tsx` | One preview row for one file and one tile component for many; both reuse a `TileBody`. | 65 |
| `AttachMenu.tsx` | Photo/video and file inputs plus the menu. | 45 |
| `MentionPicker.tsx` | Listbox rows, avatars, AI badge, handle, `aria-activedescendant` ids. | 50 |
| `useRecordingLifecycle.ts` | Ticker, chat-switch cancel, Escape backstop, document pointer up/move, hold-vs-lock state. | 110 |
| `composerShared.ts` | `PressState`, `ComposerFailure`, `fork`, `stopTimer`, `VoiceRecorderController`. Types and three helpers only. | 30 |
| `useComposerFocus.ts` | `focusComposer`, wide-only autofocus, editable/dialog guards. Return `void`. | 45 |
| `apps/web/src/lib/composer-drafts.ts` | `localStorage` adapter and `useComposerDraft` selector. | 30 |

Web subtotal **890**.

Phone (`apps/mobile/src/components/chat/` unless noted):

| File | Owns | Budget |
| --- | --- | ---: |
| `composer.tsx` | Orchestrator + markup: reply/edit bars, picker, picked strip, input, send/mic, sheet, attach sheet. Uses the shared mention reducer and topic helper. | 300 |
| `composer-picked-strip.tsx` | One `PickedTile` (image/file/failed) and a single-row strip; one `formatFileSize` call. | 120 |
| `composer-sheet.ts` | Panel open/close, tabs, packs/recents/hydrate through one `usePanelLoad`, GIF probe, emoji/sticker pick. | 140 |
| `chat-composer-dock.tsx` | Chooses selection bar / channel bar / composer; owns send handlers, reply clearing, mention members, topic rows. | 190 |
| `selection-bar.tsx` | The selection-mode bar and delete confirm (moved out of the dock). | 120 |
| `apps/mobile/src/lib/drafts.ts` | XHR SSE transport only: open, pump, app-state lifecycle, auth header; uses `client-core/composer/sse.ts` for frames and retry. | 110 |
| `apps/mobile/src/lib/composer-drafts.ts` | One JSON file, 5-user cap, `expo-file-system` read/write, `useComposerDraft` selector. | 55 |

Phone subtotal **1,035**.

### 5.2 Files to delete

- `apps/mobile/src/components/chat/composer-mentions.ts` (152) — every pure function moves to `client-core/composer/mention-state.ts`; `composerBarFor` is inlined in the dock's branch (it already knows the chat kind).
- `apps/server/src/drafts/events.ts` (24) — schemas move to `packages/api-contract/src/drafts.ts`.
- `apps/web/src/components/Composer.tsx` (563) — replaced by `composer/Composer.tsx` + `useComposerKeys.ts` + `format-shortcut.ts`.
- `apps/web/src/components/composer/useMentions.ts` is kept but shrinks from 224 to 65 (not deleted: it is the web keyboard/typing adapter).
- `apps/web/src/lib/composer-drafts.ts` and `apps/mobile/src/lib/composer-drafts.ts` stay as the only platform storage adapters.

### 5.3 Budget against 4,454

| Old file | Lines | New files | Lines | Delta |
| --- | ---: | --- | ---: | ---: |
| `chat-composer-dock.tsx` | 676 | `chat-composer-dock.tsx` 190 + `selection-bar.tsx` 120 | 310 | −366 |
| `composer.tsx` | 643 | `composer.tsx` | 300 | −343 |
| `ComposerControls.tsx` | 579 | `ComposerControls.tsx` 115 + `ComposerBars.tsx` 60 + `AttachmentStrip.tsx` 65 + `AttachMenu.tsx` 45 + `MentionPicker.tsx` 50 | 335 | −244 |
| `apps/web/.../Composer.tsx` | 563 | `composer/Composer.tsx` 180 + `useComposerKeys.ts` 40 + `format-shortcut.ts` 55 | 275 | −288 |
| `apps/mobile/src/lib/drafts.ts` | 242 | `lib/drafts.ts` 110 + `client-core/composer/sse.ts` 75 | 185 | −57 |
| `useMentions.ts` | 224 | `useMentions.ts` 65 + `client-core/composer/mention-state.ts` 105 | 170 | −54 |
| `composer-picked-strip.tsx` | 208 | `composer-picked-strip.tsx` | 120 | −88 |
| `composer-sheet.ts` | 199 | `composer-sheet.ts` | 140 | −59 |
| `packages/chat-core/src/mentions.ts` | 193 | same | 190 | −3 |
| `client-core/src/composer-drafts.ts` | 180 | `client-core/src/composer/drafts.ts` | 140 | −40 |
| `apps/server/src/drafts/hub.ts` | 172 | same | 145 | −27 |
| `composer-mentions.ts` | 152 | deleted; logic in the shared module above | 0 | −152 |
| `useRecordingLifecycle.ts` | 148 | same | 110 | −38 |
| `apps/mobile/src/lib/composer-drafts.ts` | 84 | same | 55 | −29 |
| `useComposerFocus.ts` | 78 | same | 45 | −33 |
| `composerShared.ts` | 50 | same | 30 | −20 |
| `apps/web/src/lib/composer-drafts.ts` | 39 | same | 30 | −9 |
| `apps/server/src/drafts/events.ts` | 24 | `api-contract/src/drafts.ts` | 25 | +1 |
| — | 0 | `client-core/composer/topic-not-in.ts` | 40 | +40 |
| — | 0 | `chat-core/src/channels.ts` (or `topics.ts`) | 20 | +20 |
| **Total** | **4,454** | | **2,665** | **−1,789 (−40.2%)** |

The target keeps every behaviour in part 1. The adjacent, uncounted hooks (`useComposerAttachments.ts` 339, `useVoiceRecorder.ts` 357, `composer-media.ts` 377, `voice-recorder.tsx` 570, `attach-sheet.tsx` 724, `web/src/lib/voice/recorder.ts` 182) are called by the new modules as they are today; a later feature task can shrink them, but this map does not spend their lines to reach the 40%.

### 5.4 Write order for the rewrite

1. `chat-core/mentions.ts` trim + `client-core/composer/mention-state.ts` with tests for query, rebase, backspace, candidates and reset. Port web's `useMentions` onto it; port phone's `composer-mentions` onto it; delete the phone module.
2. `client-core/composer/drafts.ts`: move the store, make storage async, point both adapters at it.
3. `client-core/composer/topic-not-in.ts`; replace both `surfaceNotInTopic` bodies and both Add rows.
4. `api-contract/src/drafts.ts` + `client-core/composer/sse.ts`; shrink the phone transport, keep the web EventSource.
5. Split the web controls (`MentionPicker`, `ComposerBars`, `AttachmentStrip`, `AttachMenu`), then `Composer.tsx` / `useComposerKeys` / `format-shortcut`.
6. Move the phone selection bar out of the dock, then shrink the composer.
7. Server hub: delete `listenerCount` and the duplicated schema.

---

## 6. Risks

Behaviours a rewrite loses quietly. Each row names the cheapest check.

| # | Risk | Why it is easy to lose | Check |
| --- | --- | --- | --- |
| 1 | Edit restores the in-progress draft (web) | The set-aside map is the only thing that does it; a naive "edit uses the draft" rewrite overwrites it. | Web mock: type "draft", edit a message, press Escape, composer still shows "draft". |
| 2 | Draft caps and user isolation | 200 entries / 4,000 chars / empty deletion are enforced in three places; a shared rewrite can drop one. | Web mock: sign in as A, type, switch to B, no A text; reload restores A's draft; paste 5,000 chars and reload. Phone emulator: restart the app, same draft. |
| 3 | Mention ranges under UTF-16 and emoji | Offsets are UTF-16 in the client and code points on the wire; edits near an emoji shift them. | Both: type `@` + pick a member, insert an emoji before it, send; the mention reference must still cover the name. |
| 4 | Backspace deletes the whole mention | Web uses a key handler, phone a single-character diff; a shared reducer can miss the phone's caret signal. | Phone emulator: place the caret after a mention and press backspace once; the whole token goes and the caret lands at its start. |
| 5 | Mention query rules | "At start or after whitespace", no spaces in the query, handle-before-name, accent folding, AIs first, 6-row cap. | Both: `@` mid-word opens nothing; `@jos` finds José; more than 6 matches still shows an AI. |
| 6 | Topic filtering and old chats | Members only for a topic; chats without `memberIds` must not be filtered. | Web mock with a topic and an old-shape chat; compare the member list to the group panel. |
| 7 | "Not in topic" rows | The post-send derivation, per-row busy/failed, and reset on chat switch are currently copied. | Web mock: mention a non-member, send, Add from the row; switch chat and back, no stale row. |
| 8 | Enter vs Shift+Enter and picker Enter | Enter must send normally, but pick a mention while the picker is open. | Web: type a mention, press Enter (picks), press Enter again (sends); Shift+Enter inserts a newline. |
| 9 | Escape/back order | Recording > picker > attachment > edit > reply; Android back also closes the sheet. | Web mock: stage an attachment with empty text, Escape removes it; phone emulator: back closes the sheet before the chat. |
| 10 | Voice gesture and the mic indicator | Hold/slide/lock, the 100 ms timer, chat-switch cancel and microphone release. | Phone emulator + real device: hold and release (sends); tap and release (locks, then Send); switch chat mid-recording and check the OS mic indicator goes off. |
| 11 | Attachment rules | 10 files, 50 MB, empty file, caption, album order, paste/drop on web. | Web mock: paste 11 files (refused with the fixed sentence), drop a 60 MB file, send 3 images (one album). Phone: pick 10, remove one, send. |
| 12 | Channel read-only bar | Role can be unknown, and the moderator still enforces posting; a rewrite can show the composer to subscribers. | Web mock and phone emulator as a subscriber: no input, "Only admins can post here", Mute/Unmute with the fixed error. |
| 13 | Live AI draft | Producer throttle/replay and consumer end/fallback timers are separate; a rewrite can leave a ghost draft. | Live: start an AI turn, watch text stream; end the turn and confirm it clears; kill the draft connection and reconnect mid-turn. |
| 14 | Draft stream mobile reconnect | XHR-only path, app-active gate, missing-token retry, first-partial reset. | Phone emulator: background the app mid-turn, foreground it; the draft resumes. |
| 15 | Optimistic send and error text | The composer clears immediately; a send failure is a message state plus a fixed action error, not raw server text. | Web mock with the API forced to 500: the failed message stays, the composer shows the fixed sentence. |
| 16 | Focus rules | Wide-only autofocus, no steal from another input/dialog, no steal on resize. | Web mock: narrow window, switch chat (no focus); wide window, switch chat (focus); open a dialog and press the focus shortcut. |
| 17 | Markdown shortcuts | Selection and caret after wrapping/unwrapping, including empty selection. | Web: Cmd/Ctrl+B on a word, on an empty caret, and on already-bold text; selection stays on the word. |
| 18 | Auto-grow heights | Web 6 × 22 px; phone 132 px and the Android padding quirk. | Web mock and phone emulator: paste 10 lines, the input stops at the cap and scrolls. |
| 19 | Accessibility contract | `role=listbox/option`, `aria-activedescendant`, labels on every icon, phone `accessibilityLabel` on rows and buttons. | Web: keyboard only; phone: TalkBack/VoiceOver reads "Mention X @handle", "Send message", "Record voice message". |
| 20 | Selection bar rules (phone) | Delete-for-everyone only when every deletable message is mine; DM copy wording; back closes the confirm first. | Phone emulator: select a peer's DM message and mine, Delete offers only "Delete for me"; back closes the confirm, then leaves selection. |

**Not a risk, but worth stating:** user drafts are local to the device today (`localStorage` on web, one JSON file on phone). Any rewrite that promises cross-device draft sync is a new feature, not this rewrite.
