---
id: T-2046
title: "Message pipeline (web + phone): the routine header above a bubble renders only when the message came from an AI (isCardAllowedFrom), like every other AI-only card — a forwarded or person-sent routine payload shows its body text only (T-2001 follow-up)"
status: merged
milestone: M5
branch: task/T-2046-routine-header-ai-gate
model: deepseek/deepseek-flash
effort: default
estimate: 15 min
---

# T-2046: Gate the routine header to AI senders (T-2001 follow-up)

## Spec (written by Claude, do not edit)

### Why
T-2001 (merged 2026-10-18) made every AI-only card render only when an AI sent it. The pre-review found one place left over: the **routine header** above a bubble still renders for any sender.
- **Example:** forward an AI's routine card. The forward echo keeps the card, and the sender becomes you.
- **Impact:** it's display only (no actions), but the rule should hold everywhere.

### Facts (read by the lead on 2026-10-18 at `15a37d398`)
- **The shared rule.** `packages/client-core/src/store/ai-cards.ts:26`: `isCardAllowedFrom(payload, senderId)` returns `!isAiOnlyCardType(payload.type) || isAiJid(senderId)`, and `'routine'` is in `AI_ONLY_CARD_TYPES` (`:11-17`). It's exported from `@zilar/client-core`; web `AttachmentBody.tsx:2,73` already uses it.
- **Web.** `apps/web/src/components/MessageBubble.tsx:332-336` has `{message.card?.type === 'routine' && (<div …><RoutineHeader routine={message.card.data} /></div>)}`. The file is 391 lines.
- **Phone.** `apps/mobile/src/components/chat/message-bubble-content.tsx:177-181` has `{message.card?.type === 'routine' ? (<View …><RoutineHeader routine={message.card.data} /></View>) : null}`. The file is 368 lines, and the sender is `message.senderId` (`:158`).

### Steps
1. **Both sites.** Add `&& isCardAllowedFrom(message.card, message.senderId)` to the routine condition on both. Keep each file at or under 400 lines; this adds at most an import line.
2. **No other change.** No tests: it's a UI condition, and the rule itself is tested in client-core.

### Allowed files
- `apps/web/src/components/MessageBubble.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `work/T-2046-routine-header-ai-gate.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The gate passes, and both files stay at or under 400 lines.

---

## Report (written by the worker when done)

### What I did
- Web: `apps/web/src/components/MessageBubble.tsx` — imported `isCardAllowedFrom` from `@zilar/client-core` and added `&& isCardAllowedFrom(message.card, message.senderId)` to the routine-header condition (now 393 lines).
- Phone: `apps/mobile/src/components/chat/message-bubble-content.tsx` — same import and the same extra `&& isCardAllowedFrom(message.card, message.senderId)` on the routine ternary (now 369 lines).
- A forwarded or person-sent `routine` payload no longer renders `RoutineHeader`; the bubble shows its body text as before. No other changes, no tests added (per spec).

### Checks run
- `pnpm install` — Done in 16.4s.
- `pnpm gate` (first run) — GATE FAIL: `format` flagged `apps/mobile/src/components/chat/message-bubble-content.tsx`.
- `pnpm exec prettier --write apps/mobile/src/components/chat/message-bubble-content.tsx` — reformatted the one condition onto a single line within the 100-char width.
- `pnpm gate` (second run) — summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (0.4s)
  PASS  lint  (1.0s)
  PASS  typecheck  (8.0s)
  PASS  effect  (1.4s)
  SKIP build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/mobile  (2.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run separately; the change is a UI condition and the rule itself is tested in client-core.

### Notes for the lead
- Both files stay under 400 lines (393 and 369).
- Files changed: `apps/web/src/components/MessageBubble.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `work/T-2046-routine-header-ai-gate.md`.

## Review (written by Claude)

Approved; the pre-review was clean. Both routine-header conditions now add `isCardAllowedFrom(message.card, message.senderId)`, so a routine payload from a non-AI sender, including a forward echo, shows no header. That closes the last AI-only card path from T-2001.
