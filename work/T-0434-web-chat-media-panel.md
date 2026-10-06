---
id: T-0434
title: "Media gallery 2 (web): 'Media, files and links' in the chat menu opens a panel with Media / Files / Links / Voice tabs from GET /api/media"
status: todo
milestone: M5
branch: task/T-0434-web-chat-media-panel
model: auto
effort: low
depends_on: [T-0431]
estimate: 0.5 day
---

# T-0434: chat media panel (web)

## Spec (written by Claude, do not edit)

### Why
This is Task 2 of `docs/audit/media-gallery-plan.md` §4. Julio accepted every §5 recommendation on 2026-10-06. T-0431 (merged) serves `GET /api/media?chat&type&before&limit`, which returns `{ items: MediaItem[], next: string | null }` (see `apps/server/src/media/routes.ts`).

To keep `GroupPanel` untouched, the lead chose a standalone panel opened from the chat menu, the same way as Pinned messages. It works the same for DMs, groups and topics.

### Verified facts (do not re-derive)
- **Server item shape** (`apps/server/src/media/routes.ts`): `messageId`, `chat`, `at` (ISO), `senderName`, `kind` (`image|file|gif|voice|link`), plus optional `url`, `name`, `size`, `mime`, `width`, `height`, `durationMs`, `waveform`, `linkUrl` and `linkHost`.
  - `type` is `media` (image and gif), `files`, `links` or `voice`. `limit` is at most 100. `before` is the `next` value.
- **API pattern:** `apps/web/src/lib/api.ts:907-911`. `listPins` builds `URLSearchParams` and calls `request(path, zodSchema)`. Add `MediaItem`, `MediaPage` and `listChatMedia({ chat, type, before?, limit? })` the same way, with a zod schema.
- **Store:**
  - the interface is `apps/web/src/store/store.ts` (`openAtMessage` at line 300, `loadPins` at 260);
  - the mock store implementation is in the same file (`loadPins` at line 996, `openAtMessage` at 1132);
  - the real store is `apps/web/src/store/realStore.ts` (`loadPins` at 3751, `openAtMessage` at 3851).
- **Trusted media:**
  - the real store keeps `mediaToken` (`realStore.ts:796`, set at `:3103`);
  - `sanitizeIncomingAttachment(attachment, token)` (`realStore.ts:450-480`) downgrades images from untrusted hosts, using `trustedMediaHosts` and `isTrustedMediaUrl` from `apps/web/src/lib/attachments.ts:95-130`.
  - **The panel must never auto-load an image from an untrusted host.**
- **Jump pattern:** `apps/web/src/components/PinsPanel.tsx:34-49`. It calls `openAtMessage(chatId, messageId)`, then `onClose()`, then scrolls to `[data-message-id=…]`; on failure it shows "Message not found". Its frame is `<Sheet open onClose ariaLabel=…>` (line 67).
- **Kit:**
  - `Sheet` (`components/ui/sheet.tsx`: `open`, `onClose`, `ariaLabel`, `children`);
  - `SegmentedControl` (`components/ui/segmented-control.tsx`: `options [{value,label}]`, `value`, `onChange`, `ariaLabel`);
  - `StateMessage` (`components/ui/state-message.tsx`: `kind`, `title`, `hint?`, `action? {label,onClick}`, `size?`);
  - `Button` and `ListRow` (`components/ui/`).
- **Menu:** `apps/web/src/components/ChatHeader.tsx` has two menus. The topic menu has "Pinned messages" at lines 188-195; the other menu has it at about 228-235. Both use `storeApi.getState().setPinsPanel(chat.id)`.
- **Mounting:** `apps/web/src/routes/ChatView.tsx` mounts the panels at lines 136-148 and keeps `panel` state at line 44.
- **Mock data:** `apps/web/src/mock/messages.ts` has image and file attachments in the Ana chat (around lines 236-262), plus links in message texts.

### What to build
1. **`api.ts`:** `MediaItem`, `MediaPage`, `MediaTab = 'media' | 'files' | 'links' | 'voice'`, and `listChatMedia(input)` → `GET /api/media`.
2. **Store:**
   - add to `store.ts`: `loadChatMedia: (chatId: string, tab: MediaTab, before?: string) => Promise<MediaPage>`;
   - **real store:** call `listChatMedia`, then for `image` and `gif` items, **drop `url`** unless `isTrustedMediaUrl(url, trustedMediaHosts(mediaToken))`. With no token, drop it. The panel then shows a file-style row instead of a thumbnail.
   - **mock store:** build the pages from the mock messages of that chat. Attachments of kind `image` go to media, kind `file` to files, voice to voice, and links found in text go to links (reuse `splitLinks` from chat-core if it is exported, else a simple `https?://` match). Newest first, a page size of 50, `next: null`.
3. **New `apps/web/src/components/ChatMediaPanel.tsx`:** `ChatMediaPanel({ chatId, onClose })` built on `Sheet`, with `ariaLabel` "Media, files and links in <title>".
   - A `SegmentedControl` with the tabs Media, Files, Links and Voice.
   - It loads the active tab on open and when the tab changes; "Load more" uses `next`.
   - **Media:** a 3-column grid of `<img loading="lazy">` thumbnails, only for items with a `url`. An item without a `url` (untrusted host) shows a file row instead.
   - **Files:** rows with name, size, sender and date.
   - **Links:** rows with host and URL, as `<a target="_blank" rel="noopener noreferrer">`.
   - **Voice:** rows with duration, sender and date.
   - Every item has a "Show in chat" action that jumps exactly like `PinsPanel.tsx:34-49`.
   - **States:** `StateMessage` loading; error with a Retry action; and an empty message per tab ("No media yet", "No files yet", "No links yet", "No voice messages yet").
4. **`ChatHeader.tsx`:** in both menus, right after "Pinned messages", add `<MenuItem>Media, files and links</MenuItem>`, which closes the menu and calls a new optional prop `onOpenMedia`.
5. **`ChatView.tsx`:** add `const [mediaOpen, setMediaOpen] = useState(false)`, pass `onOpenMedia={() => setMediaOpen(true)}` to `ChatHeader`, and render `<ChatMediaPanel chatId={chat.id} onClose={() => setMediaOpen(false)} />` while it is open. Reset the state when the chat changes, the way `panelChatId` does (lines 47-54).
6. **Tests:**
   - **new `apps/web/src/components/ChatMediaPanel.test.tsx`** (mock store):
     - the tabs switch and load;
     - the media grid renders images;
     - an item with no `url` shows no `<img>`;
     - the per-tab empty states;
     - the error state with Retry;
     - Load more appends;
     - Show in chat calls `openAtMessage` and closes.
   - **`apps/web/src/routes/ChatView.test.tsx`:** the menu item opens the panel, and Escape closes it.
   - **`apps/web/src/lib/api.test.ts`:** `listChatMedia` builds the query and parses the body.
   - **`apps/web/src/store/realStore.test.tsx`** (or a new `realStore.media.test.tsx`): an untrusted image URL is dropped.

### Read first
`AGENTS.md`, `docs/audit/media-gallery-plan.md` §3b and §3d and §4 Task 2, `apps/server/src/media/routes.ts`, `apps/web/src/components/PinsPanel.tsx`, `apps/web/src/components/ChatHeader.tsx:160-240`, `apps/web/src/routes/ChatView.tsx:40-150`, `apps/web/src/store/store.ts:250-305` and `:990-1000`, `apps/web/src/store/realStore.ts:440-480` and `:3745-3760`, `apps/web/src/lib/api.ts:890-925`, `apps/web/src/lib/attachments.ts:90-135`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.media.test.tsx`, `apps/web/src/components/ChatMediaPanel.tsx`, `apps/web/src/components/ChatMediaPanel.test.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `work/T-0434-web-chat-media-panel.md`.

If another test breaks because it builds a full store object, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ChatMediaPanel ChatView api.test realStore.media
pnpm gate
```

### Acceptance
- "Media, files and links" in the chat menu opens the panel in DMs, groups and topics.
- Each tab lists its items, pages with Load more, and jumps to the message.
- No image from an untrusted host is ever loaded.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
