---
id: T-0971
title: "Size split T25: apps/web/src/components/MessageBubble.tsx (846 lines) into components/message/{SendFailure,MessageMeta,BigEmoji,AttachmentBody,MessageTextBody,MessageMenu}.tsx; one MessageMenu for both bubbles"
status: todo
milestone: M5
branch: task/T-0971-split-web-message-bubble
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0971: Split `MessageBubble.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/MessageBubble.tsx` is 846 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #21 (task T25): `components/message/SendFailure.tsx`, `message/MessageMeta.tsx`, `message/BigEmoji.tsx`, `message/AttachmentBody.tsx`, `message/MessageTextBody.tsx`, `message/MessageMenu.tsx`, under `apps/web/src/`. `MessageBubble.tsx` keeps the `MessageBubble` component and every export it has today.

- **In scope:** the in-file Dedup. The `MessageActionsMenu` block (sticker bubble 450–494, normal bubble 775–826) and the `ConfirmDialog` (495–506, 828–839) are verbatim copies, so they become one `MessageMenu` used by both bubbles. Its props must cover both uses exactly.
- **Out of scope:** any visual change.

The lead checks in Chrome in mock mode: a text bubble, a sticker bubble, the actions menu on each (react, reply, edit, delete with confirm), a failed send, and the AI markdown.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #21, and `apps/web/src/components/MessageBubble.tsx`.

### Allowed files
`apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/message/SendFailure.tsx`, `apps/web/src/components/message/MessageMeta.tsx`, `apps/web/src/components/message/BigEmoji.tsx`, `apps/web/src/components/message/AttachmentBody.tsx`, `apps/web/src/components/message/MessageTextBody.tsx`, `apps/web/src/components/message/MessageMenu.tsx`, `work/T-0971-split-web-message-bubble.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's Chrome check passes.

---

## Report (written by the worker when done)

## Review (written by Claude)
