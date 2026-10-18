---
id: T-2051
title: "Share W1-a: delete the web and phone lib/format.ts shims (callers import the labels from @zilar/chat-core, previewParts moves into chat-core messages.ts and web's chat row uses it too), the unread badge sum lives once in chat-core, and web's notification dismiss no longer turns a getRegistration rejection into a defect"
status: merged
milestone: M5
branch: task/T-2051-format-shims-and-badge
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2051: Format shims and the badge sum (share plan W1-a)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone. `docs/audit/share-plan.md` §2.14 and §2.21 found:
- two `lib/format.ts` shims that only re-export chat-core;
- a phone-only `previewParts` that web writes inline;
- the unread badge sum written twice;
- a small web bug in notification dismissal (§6, the last row).

### Facts (read by the lead on 2026-10-18 at `13819b0fd`)
- **The shims.**
  - `apps/web/src/lib/format.ts` (1 line) re-exports `chatSubtitle`, `formatLastSeen`, `formatMoney`, `replyRef` and `typingLabel` from `@zilar/chat-core`.
  - `apps/mobile/src/lib/format.ts` (31 lines) re-exports `formatLastSeen`, `replyRef` and `typingLabel`. It also defines `PreviewOptions` and `previewParts(lastMessage, options)` → `{ prefix: previewPrefix(…), body: previewBody(…), kind: previewKind(…) }`.
- **Importers of `@/lib/format`** (these are the only ones):
  - web: `apps/web/src/components/ChatHeader.tsx:25`, `apps/web/src/components/ChatListItem.tsx:34`, `apps/web/src/components/ContactPanel.tsx:25`, `apps/web/src/routes/ChatView.tsx:30`, `apps/web/src/components/TopicRow.tsx:31`;
  - phone: `apps/mobile/src/components/chat/chat-header.tsx:25`, `apps/mobile/src/components/chat/chat-list-item.tsx:19`, `apps/mobile/src/components/chat/group-list-item.tsx:14`, `apps/mobile/src/components/chat/topic-row.tsx:16`, `apps/mobile/src/components/chat/use-chat-screen.ts:6`.
- **Web's inline copy.** `apps/web/src/components/ChatListItem.tsx:72-75` computes the same three parts inline.
- **Chat-core.** `packages/chat-core/src/messages.ts` (374 lines) already exports `PreviewOptions` (`:6`), `previewPrefix` (`:146`), `previewKind` (`:164`) and `previewBody` (`:190`). `packages/chat-core/src/chat-labels.ts` is 100 lines. The chat-core barrel exports both with `export *`, so there's no barrel edit.
- **The badge sum.**
  - Web `totalBadgeUnread(chats)` is at `apps/web/src/lib/push/badge.ts:13-17`. It's re-exported by `apps/web/src/lib/push.ts:246` and used in `apps/web/src/store/effects/badge.ts:5,12` and `portAdapters.ts:16,73`.
  - The phone's `badgeUnread(chats)` (`apps/mobile/src/lib/push/badge.ts:36-38`) is the same sum.
- **The dismiss bug.** In `apps/web/src/lib/push/badge.ts:76-99`, `dismissChatNotificationsEffect` awaits `getRegistration` with `Effect.promise` (`:82`), outside the `Effect.ignore` (`:97`). A rejection becomes a defect, not a best-effort no-op.

### Steps
1. **Chat-core.**
   - Add `previewParts` to `packages/chat-core/src/messages.ts`, next to `previewText`. It must stay at or under 400 lines.
   - Add `totalBadgeUnread` to `packages/chat-core/src/chat-labels.ts`.
2. **Delete the shims.** Delete both `lib/format.ts` files, and point every importer listed above at `@zilar/chat-core`.
   - Web `ChatListItem.tsx` uses `previewParts` instead of its three inline calls.
3. **The badge sum.**
   - Web `badge.ts` re-exports `totalBadgeUnread` from chat-core (`push.ts:246` keeps working) and deletes its body.
   - The phone `badge.ts` uses it for `badgeUnread`. Keep the phone name as a re-export, or update callers: `git grep` them.
4. **Fix the dismiss.** Make the registration await a `tryPromise` that falls back to `undefined`, so any failure is a quiet no-op.
5. **No tests** (labels and UI). Report the line counts.

### Allowed files
- `packages/chat-core/src/messages.ts`
- `packages/chat-core/src/chat-labels.ts`
- `apps/web/src/lib/format.ts`
- `apps/mobile/src/lib/format.ts`
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/components/ChatListItem.tsx`
- `apps/web/src/components/ContactPanel.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/components/TopicRow.tsx`
- `apps/mobile/src/components/chat/chat-header.tsx`
- `apps/mobile/src/components/chat/chat-list-item.tsx`
- `apps/mobile/src/components/chat/group-list-item.tsx`
- `apps/mobile/src/components/chat/topic-row.tsx`
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/web/src/lib/push/badge.ts`
- `apps/mobile/src/lib/push/badge.ts`
- `work/T-2051-format-shims-and-badge.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and product lines go down.
- **Lead check, web mock:** chat-list previews are unchanged ("Dani: …", the photo and voice icons).

---

## Report (written by the worker when done)

### What I did

- **chat-core:** added `previewParts` to `packages/chat-core/src/messages.ts` (next to `previewText`, returns the same `{ prefix, body, kind }` the phone shim had) and `totalBadgeUnread` to `packages/chat-core/src/chat-labels.ts`.
- **shims:** deleted `apps/web/src/lib/format.ts` and `apps/mobile/src/lib/format.ts`; all nine importers now import the labels from `@zilar/chat-core` (merged into their existing chat-core imports). Web `ChatListItem.tsx` calls `previewParts` instead of its three inline calls.
- **badge:** `apps/web/src/lib/push/badge.ts` re-exports `totalBadgeUnread` from chat-core and its own copy is gone (so `push.ts:246` is unchanged). `apps/mobile/src/lib/push/badge.ts` uses `totalBadgeUnread` in `syncBadge`; `git grep` found no caller of `badgeUnread` outside that file, so the local function is gone rather than re-exported.
- **dismiss bug:** the `getRegistration()` await is now `Effect.tryPromise(...).pipe(Effect.orElseSucceed(() => undefined))`, so a rejection is a quiet no-op instead of a defect.
- **Line counts:** `packages/chat-core/src/messages.ts` 374 → 391 (limit 400); `packages/chat-core/src/chat-labels.ts` 100 → 107; product diff vs `main` is +55 / −68 (`net −13`, 16 files).

### Checks run

`pnpm gate` from the repo root, full output summary:

```
gate: 17 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (1.1s)
PASS  lint  (1.3s)
PASS  typecheck  (8.0s)
PASS  effect  (1.4s)
PASS  build @zilar/server  (0.6s)
PASS  tests @zilar/chat-core  (2.8s)
PASS  tests @zilar/mobile  (7.7s)
PASS  tests @zilar/web  (17.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The first gate run failed only on Prettier formatting of `apps/mobile/src/components/chat/topic-row.tsx` (one long import line); I ran `pnpm exec prettier --write` on that file and the second run above is all green. No single test files were run separately; no tests were added (labels and UI, per the spec).

### Notes for the lead

- Web chat-list preview text is byte-identical by construction: `previewParts` returns the same `previewPrefix` / `previewBody` / `previewKind` results the row computed inline, so the "Dani: …" prefix, the markdown/light conversion and the photo/voice icons are unchanged. Not verified visually (web mock) — that is your check.
- The phone keeps the same `PreviewOptions` shape; it now comes from chat-core instead of the local shim.
- No deviations from the spec.

## Review (written by Claude)

Approved; the pre-review was clean, with 1 nit about import placement.
- **What changed.**
  - Both `lib/format.ts` shims are gone, and callers import from `@zilar/chat-core`.
  - `previewParts` lives in chat-core, and web's chat row uses it.
  - `totalBadgeUnread` exists once.
  - The web notification dismiss now swallows a `getRegistration` rejection.
- **Size.** −13 product lines.
- **Lead Playwright check** (web mock, :5193): the previews are unchanged ("Dev-1: Tests pass. Merge?", the attachment icon, "Sofía: Hello? 😅"), with no console errors.
