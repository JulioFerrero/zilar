---
id: T-1302
title: "Mobile batch 4: notification channels per chat kind with grouping per chat (MUX-23); double-tap a bubble to react with the first quick reaction (MUX-21, the double-tap part); the profile tab fallback uses an icon instead of '?' (MUX-33)"
status: todo
milestone: M5
branch: task/T-1302-mobile-notify-react
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1302: Mobile batch 4

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md`:
- **MUX-23** (P3, `:125`):
  - one notification channel, "Messages" (`apps/mobile/src/lib/push/native.ts`);
  - notifications post with no grouping (`apps/mobile/src/lib/push/background.ts`).
  - Telegram has separate channels for private chats, groups and channels.
- **MUX-21** (P3, `:127`): there's no double-tap to react on a bubble (`apps/mobile/src/components/chat/message-bubble.tsx`). The anchored-menu part of this finding is **out of scope**.
- **MUX-33** (P3, `:117`): the profile tab shows a literal "?" as its fallback (`apps/mobile/src/components/nav/floating-tab-bar.tsx`).

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **MUX-23:**
   - **channels:** three Android channels, "Direct messages", "Groups" and "Channels", created where "Messages" is today. The existing channel id keeps working, or is migrated: say which;
   - **routing:** each notification posts on the channel for its chat kind, read from the push payload (cite the field). If the payload has no chat kind, use "Direct messages" for DMs and "Groups" otherwise, and list in the Report what the server would need to send;
   - **grouping:** group notifications per chat (Android `groupKey` / iOS `threadIdentifier`, whichever `expo-notifications` exposes; cite it).
   - **Out of scope:** inline reply.
2. **MUX-21:**
   - a double-tap on a bubble adds the first quick reaction (`QUICK_REACTIONS[0]` in `packages/chat-core/src/reactions.ts`), or removes it if I already reacted with it;
   - use `react-native-gesture-handler`'s `Gesture.Tap().numberOfTaps(2)` composed with the existing long-press so the long-press still opens the menu, with a Light haptic;
   - disabled for messages that can't be reacted to yet (no wire id; use the selector T-1287 adds if it's merged, otherwise the existing checks).
3. **MUX-33:** the "?" fallback becomes the lucide `UserRound` icon.
4. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (`:117-127`), `apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/components/chat/message-bubble.tsx` and `apps/mobile/src/components/nav/floating-tab-bar.tsx`.

### Allowed files
`apps/mobile/src/lib/push/*.ts`, `apps/mobile/src/components/chat/*.tsx`, `apps/mobile/src/components/chat/*.ts`, `apps/mobile/src/components/nav/floating-tab-bar.tsx`, `work/T-1302-mobile-notify-react.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator:**
  - a double-tap on Marta's message adds 👍 (or the first quick reaction), and a long-press still opens the menu;
  - Settings → Apps → Zilar → Notifications lists the three channels.

---

## Report (written by the worker when done)

## Review (written by Claude)
