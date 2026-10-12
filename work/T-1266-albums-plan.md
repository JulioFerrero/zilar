---
id: T-1266
title: "Audit (docs only): albums — several photos sent together show as one bubble/grid in both apps, like Telegram's grouped_id; design the wire marker, the client grouping, send/receive/reply/delete/forward rules, then split it into tasks"
status: merged
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

### What I did

Wrote `docs/audit/albums-plan.md` (docs only, no code), following the spec's five points.
It cites `file:line` for every claim. The key findings:

- **The wire today:** attachments are **not** XEP-0066 OOB (T-0065 forbade it,
  `work/T-0065-attachments-web.md:36`; a repo-wide grep for `oob` finds no producer/parser).
  The attachment is a JSON payload in `<agent xmlns='urn:zilar:agent:0'>`
  (`packages/xmpp-core/src/stanza/build-outgoing.ts:99-101`, decoded at `decode.ts:82-89`),
  and the payload union holds **one** attachment (`packages/protocol/src/payload.ts:40-44`).
  So one message = one attachment = one bubble.
- **Recommendation (Option A):** one message per photo, each carrying
  `<album xmlns='urn:zilar:album:0' id index count/>`, a new namespace in
  `namespaces.ts:1-28`. Rejected Option B (one message with several OOB URLs): it breaks
  non-Zilar clients and every `message.attachment` reader, and destroys per-photo actions.
  Weighed the fallback, MAM/page splits (`history.ts:12`), push, unread and previews.
- **Grouping:** a new album render item in `packages/chat-core/src/messages.ts`
  (`groupMessages`, `:35-75`) consumed by web (`MessageList.tsx:116-122`, `:338-383`) and
  mobile (`message-list.tsx:154-160`, `:165-188`, `message-list-row.tsx:84-115`); the task's
  "client-core grouping" is really `chat-core`.
- **Rules:** reply/reaction/delete/forward/edits map to one message id today
  (`actions.ts:22-173`, `forward.ts:102-171`, `build-outgoing.ts:140-176`); "whole album" is
  a client-side loop over the album ids; the viewer (`photos.ts:18-32`, `MediaViewer.tsx`,
  `attachment-body.tsx:49-54`) gets scoped to the album when opened on a tile; cap 10.
- **Sending:** mobile already loops (`composer-media.ts:187-195`); web's picker is single
  (`useComposerAttachments.ts:70-81`, `Composer.tsx:264-265`); an `album` field on
  `SendAttachmentOptions` (`send/context.ts:37-40`); parallel uploads, ordered render.
- **Push:** one push per album via the existing scan (`archive-scan.ts:85-111`, `:100-104`)
  plus an `albumCount` on `ResolvedPushMessage` (`payload.ts:24-33`) and a "3 photos"
  preview (`:106-112`); the Web Push summary's `message-count` is not usable
  (`notification.ts:57-83`, `protocol.ts:23`).
- **Open decisions** (8, each with a recommendation) and a **4-5 task split**, each with
  Allowed files and the ≤400-line rule noted (`MessageList.tsx` and `MessageBubble.tsx` are
  each exactly 400 lines; `build-outgoing.ts` is 380).

### Files changed

- `docs/audit/albums-plan.md` (new).
- `work/T-1266-albums-plan.md` (this report).

Both are in Allowed files.

### Commands I ran

- `pnpm install` → `Done in 11.2s using pnpm v10.32.1` (1181 packages; the known
  `@types/react-dom` peer warning in `apps/mobile` only).
- `pnpm gate` (from the repo root), real output:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No test file was run: this task changes no code, and the spec ends "No code." The gate's
  changed set was the two docs above and it found no source files.

### Deviations / interpretation

- The spec's split phrase says "xmpp-core marker + client-core grouping with tests"; the
  message-list grouping helpers actually live in **`packages/chat-core`** (`groupMessages`,
  `messages.ts:35`), and `client-core` owns the store/unread layer. I named Task 1
  "xmpp-core marker + chat-core grouping" and put the store-level unread collapse in an
  optional Task 5.
- The spec's read list says "XEP-0066 OOB plus our own elements"; the code does not use
  XEP-0066 (grep), and I documented that as the starting fact.
- `docs/audit/albums-plan.md` is 433 lines (`wc -l`); it does not count against the
  400-line code rule, which the task applies to code files.

### Open questions

None that block; the eight design decisions are in `docs/audit/albums-plan.md` §8, each
with a recommendation.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (4 nits).**
- **The plan** (`docs/audit/albums-plan.md`, 433 lines):
  - Option A on the wire: one message per photo with `<album xmlns='urn:zilar:album:0' id index count/>`, so other XMPP clients still see each photo;
  - a chat-core album render item;
  - per-app grids;
  - per-photo actions, with album-wide actions as client loops;
  - a cap of 10;
  - one push per album;
  - 8 open decisions, each with a recommendation, and a 5-task split with Allowed files.
- **Next:** the lead starts Task 1 (marker + grouping, with tests) on the recommendations, because they're reversible product defaults. The decisions go to Julio in NOW.md.
