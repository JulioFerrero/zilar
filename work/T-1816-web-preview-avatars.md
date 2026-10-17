---
id: T-1816
title: "Web Join preview rows show the sender's avatar like the thread (34px, items-end, gap-1.5) — the board PhoneJoin and the phone preview have it, web doesn't"
status: merged
milestone: M5
branch: task/T-1816-web-preview-avatars
model: auto
effort: default
depends_on: [T-1811]
estimate: 15 min
---

# T-1816: Avatars in the web Join preview

## Spec (written by Claude, do not edit)

### Why
**Web mock mode on 2026-10-17** ("Dev team › Ideas", `?mock=1`): the Join preview shows the messages, the standalone card and the Join key, but **no sender avatars**. The board draws each row with its avatar beside the bubble (`docs/design/mockups/topic-people/PhoneJoin.dc.html`), the phone preview does too (`apps/mobile/src/components/chat/topic-join-view.tsx`, `EntityAvatar` size 28), and the web thread does too.

### Facts (read by the lead on 2026-10-17)
- **The web thread row** (`apps/web/src/components/MessageBubble.tsx:209`, and the same layout in `apps/web/src/components/message/MessageTombstone.tsx:28-38`):
  - an `items-end gap-1.5` row;
  - `<EntityAvatar person={{ id, name }} size={34} />` for an incoming group message;
  - `EntityAvatar` is imported from `@/components/EntityAvatar` (`MessageBubble.tsx:4` imports `./EntityAvatar`).
- **`apps/web/src/components/topic/TopicJoinView.tsx`:**
  - `PreviewRow` renders a text bubble or a standalone card;
  - a preview message has `{ id, at, nick, body, payload? }` (no sender id), so use `{ id: nick, name: nick }` as the phone does. The orb is seeded by name anyway (memory "orb by name").

### Steps
1. In `PreviewRow`, wrap each row in `flex items-end gap-1.5` with `<EntityAvatar person={{ id: message.nick, name: message.nick }} size={34} />` before the bubble or card, as the thread draws an incoming group message. Keep the row's max width.
2. **No tests** (UI). Keep the file at most 400 lines.

### Allowed files
- `apps/web/src/components/topic/TopicJoinView.tsx`
- `work/T-1816-web-preview-avatars.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In web mock mode, every "Ideas" preview row has its sender's avatar beside it, as in the thread.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- In `apps/web/src/components/topic/TopicJoinView.tsx`, each `PreviewRow` now renders as an
  `items-end gap-1.5` row with `<EntityAvatar person={{ id: message.nick, name: message.nick }} size={34} />`
  before the bubble or the standalone card, the same way `MessageBubble` draws an incoming
  group message in the thread.
- The previous `max-w-[min(560px,100%)]` and `self-start` moved to the row wrapper, so the row
  keeps its max width; the bubble/card column is now the row's second child with
  `min-w-0`.
- Imported `EntityAvatar` from `@/components/EntityAvatar`.
- No tests added (UI, per the spec). The file is 170 lines (limit 400).

### Checks run

- `pnpm install`: done, "Done in 14.9s using pnpm v10.32.1".
- Single tests: none run — the gate reported `SKIP tests @zilar/web (no nearby test files)`.
- `pnpm gate`: ended with `GATE PASS`. Its summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- I did not open web mock mode myself; the avatar placement was written to match the thread's
  `items-end gap-1.5` row and `EntityAvatar size={34}`, and the gate (typecheck/format/lint)
  passed. A visual check in `?mock=1` on "Dev team › Ideas" is still worth doing.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `10f9a303b`.
- `PreviewRow` wraps each row in an `items-end gap-1.5` row with `EntityAvatar size={34}` (seeded by the nick), as the thread draws an incoming group message. The card rows stay standalone.
- **The lead checks it** in local web mock mode on main right after this merge.
