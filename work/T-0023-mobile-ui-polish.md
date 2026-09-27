---
id: T-0023
title: Mobile UI polish — Telegram additions, swipe-to-reply, haptics, switch to @galena/chat-core
status: todo
milestone: M1
branch: task/T-0023-mobile-ui-polish
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0019, T-0022]
estimate: 1–2 days
---

# T-0023: Mobile UI polish

## Spec (written by Claude, do not edit)

### Goal
Bring the mobile app to the same Telegram level as the web app after T-0022. Implement **every item** in `docs/design/ui-style.md` §4, under "Added after the first screenshots (2026-09-27)", **including the mobile-only ones**: swipe right to reply, and a light haptic on long-press. Also fix T-0019's review findings, and **switch to the shared `@galena/chat-core`** instead of the duplicated helpers. Still mock data.

### Read first
- `AGENTS.md` (mandatory)
- `docs/design/ui-style.md`: the new subsection and the `--online` token
- `work/T-0019-mobile-chat-shell.md`: the Review findings 1–3
- `work/T-0022-web-ui-polish.md`: its Report, for how the web did each item. Match the behavior.
- `packages/chat-core/src/**` (shared: `isBigEmoji`, `splitLinks`, `unreadDividerIndex`, `groupMessages`, `initials`, etc.)
- `apps/mobile/**`

### Allowed files
- `apps/mobile/**`
- `pnpm-lock.yaml`

**Not allowed:** `packages/**` (use `chat-core` as it is; if it's missing something, ask in the Report) and `apps/web/**`.

### Allowed dependencies
- `expo-haptics`, `expo-clipboard` (install with `npx expo install`)
- `react-native-gesture-handler` and `react-native-reanimated`, already present with Expo, for the swipe gesture

### What to build
1. **Use `@galena/chat-core`:**
   - Add it as a workspace dependency.
   - Delete the duplicated helpers in `src/lib/` that it replaces, and their tests (chat-core has its own). Keep only mobile-specific code.
   - Move the mobile store to chat-core's `ChatSummary` / `UiMessage` types.
2. **The T-0019 findings:**
   - the green online dot (the `--online` token)
   - mute icon spacing
3. **The new-chat button menu** ("New group" / "New message" → a "Coming soon" sheet), with the existing floating pencil button.
4. **Unread divider** in Ana's chat. Opening it scrolls to the divider.
5. **Typing** in the list and the header, with mock timings like the web (Ana, and "Luis is typing…" in Viernes).
6. **Long-press** a bubble → a light haptic → an action sheet or menu with Reply, Copy (expo-clipboard) and Delete (disabled).
7. **Swipe right on a bubble to reply:**
   - A reply arrow icon appears as you drag.
   - Past about 60 px, a light haptic, and releasing sets the reply.
   - Use `react-native-gesture-handler` + reanimated.
8. **The reply bar** above the composer, with `×` to cancel. The sent bubble shows the quote.
9. **Big emoji:** no bubble, about 48 px, a time pill. **Hide the sender name** above big emoji (Telegram style, from the T-0022 review).
10. **Safe links:** http/https only, through `splitLinks`, opened with `Linking.openURL`. Other schemes stay plain text.

### Tests (Vitest, pure logic)
- The store: typing timers (fake timers), reply state, unread divider position through chat-core.
- A test that the link-opening helper refuses non-http(s) URLs.

### Visual check (iOS simulator)
- Build with `npx expo run:ios --no-bundler`. Start Metro in the background, and **stop it** at the end.
- Screenshots in `apps/mobile/screenshots/` (replace the old ones where relevant):
  - `chats-light.png` (typing in the list, green dot, mute spacing)
  - `chat-ana-light.png` (unread divider)
  - `chat-viernes-dark.png` (typing header, big emoji)
  - `chat-reply-light.png` (reply bar active)

  To get the reply-bar screenshot you may add a **dev-only** mock flag. Remove any temporary redirect hacks before committing.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass for the whole repo.
- [ ] No duplicated helpers left in `apps/mobile/src/lib` that chat-core provides.
- [ ] Every screenshot committed. No Metro left running.
- [ ] Only allowed files touched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Real data (mobile wiring comes after T-0024), push notifications, voice recording.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Screenshots
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-
