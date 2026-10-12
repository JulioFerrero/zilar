---
id: T-1266
title: "Audit (docs only): albums — several photos sent together show as one bubble/grid in both apps, like Telegram's grouped_id; design the wire marker, the client grouping, send/receive/reply/delete/forward rules, then split it into tasks"
status: todo
milestone: M5
branch: task/T-1266-albums-plan
model: auto
effort: default
depends_on: [T-1246]
estimate: 0.3 day
---

# T-1266: Plan albums

## Spec (written by Claude, do not edit)

### Why
TG-10 albums (Telegram parity plan wave 5): Telegram sends several photos picked together as one album, a grid in one bubble.
- **What we send today:** mobile sends each picked photo as its own message (T-1246: `apps/mobile/src/components/chat/composer-picked-strip.tsx`, with the caption and reply on the first). The web sends one file at a time (`apps/web/src/components/composer/useComposerAttachments.ts`).
- **What we show:** each message renders as its own bubble (web `apps/web/src/components/message/AttachmentBody.tsx`, mobile `apps/mobile/src/components/chat/attachment-body.tsx`).
- **No design exists.** This task changes **no code**.

### What to do
1. **The wire marker.** Read how a message's attachment travels: XEP-0066 OOB plus our own elements. Read `packages/xmpp-core/src/stanza/build-outgoing.ts` and `decode.ts`, and the namespaces in `packages/xmpp-core/src/namespaces.ts`.
   - Propose how an album is marked: for example a `<group xmlns='urn:zilar:album:0' id=… index=… count=…/>` child on each message (one message per photo, like Telegram), versus one message carrying several OOB URLs. Recommend one, weighing:
     - other XMPP clients (a non-Zilar client still sees each photo);
     - the archive (MAM) and history pages that split an album;
     - push (one push per album, not N: read `apps/server/src/push/` candidates);
     - unread counts and previews ("3 photos").
2. **Client grouping:** where `client-core` / `chat-core` would group consecutive messages with the same album id from the same sender into one list item (read `packages/chat-core` for message-list helpers), and how web and mobile render the grid (2, 3, 4 and 5+ layouts, the caption under the grid).
3. **The rules:**
   - reply to one photo or the whole album;
   - delete for everyone and delete for me (one photo or all);
   - forward;
   - reactions;
   - the viewer (T-1232 web, T-1256 mobile) steps through the album first;
   - edits (the caption only);
   - the max album size (Telegram: 10).
4. **Sending:**
   - mobile T-1246 already sends N messages: what changes;
   - web multi-select in the file picker;
   - uploads in parallel with ordered send.
5. **Write `docs/audit/albums-plan.md`** with:
   - 1-4 above, citing `file:line`;
   - the recommendation;
   - open decisions for Julio, each with a recommendation;
   - a split into 3-5 tasks (xmpp-core marker + client-core grouping with tests; web render + send; mobile render + send; push collapse), each with its Allowed files and every file kept at most 400 lines.
6. **No code.**

### Read first
`AGENTS.md`, `docs/audit/telegram-parity-audit.md` (TG-10), `work/T-1246-mobile-multi-photo-downscale.md`, `packages/xmpp-core/src/stanza/`, `packages/xmpp-core/src/namespaces.ts`, `packages/chat-core/src/`, `packages/client-core/src/store/`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx` and `apps/server/src/push/candidates.ts`.

### Allowed files
`docs/audit/albums-plan.md`, `work/T-1266-albums-plan.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The doc exists, cites `file:line` for every claim, and ends with the task split and the open decisions.

---

## Report (written by the worker when done)

## Review (written by Claude)
