---
id: T-1206
title: "Mobile notifications (parity fix #9): Settings → Notifications shows the permission state (with a way to the system settings when blocked), the message-preview switch and a 'Send test notification' button; the app-icon badge follows the unread sum; opening a chat clears its notifications from the tray"
status: merged
milestone: M5
branch: task/T-1206-mobile-notifications
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1206: Notification settings, badge and tray clean-up on mobile

## Spec (written by Claude, do not edit)

### Why
`docs/audit/telegram-parity-audit.md` §1 gap 9, and fix-plan row 9.
- **No settings page:** mobile has no notifications settings page. `apps/mobile/src/lib/settings-items.ts` (107 lines) has no row for one, and `apps/mobile/src/app/settings/` has no screen.
- **No badge:** `syncBadge` is a no-op on mobile (`apps/mobile/src/store/real-store.ts:165,177`, `apps/mobile/src/store/effects/lifecycle.ts:87`). client-core calls it whenever an unread message arrives (`packages/client-core/src/store/incoming.ts:174`; the hook is declared at `packages/client-core/src/store/ctx.ts:56-62`).
- **Opening a chat leaves its notifications:** `dismissChatNotifications` is also a no-op on mobile (`real-store.ts:165,178`).
- **What exists:**
  - native push registers itself on the first online (`apps/mobile/src/store/chat-store-provider.tsx:150-170`, `apps/mobile/src/lib/push/native.ts:179`);
  - a notification's `data.chatId` is the chat JID (`apps/mobile/src/lib/push/tap.ts:15-17`);
  - mobile calls the API through `createApiClient` and `runApi` (`apps/mobile/src/lib/push/background.ts:15-20,99`);
  - the push contract has `settings`, `updateSettings` and `test` (`packages/api-contract/src/push.ts:150-163`);
  - the web page doing the same is `apps/web/src/routes/NotificationsPage.tsx` (182 lines). Copy its wording.
- **Versions:** `expo-notifications` ~57.0.22 (`apps/mobile/package.json:46`).

### What to build
1. **A new `apps/mobile/src/app/settings/notifications.tsx`** (at most 250 lines), using the same screen shell as `apps/mobile/src/app/settings/blocked.tsx`. It shows:
   - **"On this phone":** the permission state from `Notifications.getPermissionsAsync()` (Enabled, Not enabled, or Blocked).
     - When not enabled and the OS can still ask, an "Enable" button calls `registerNativePush` with the store's `setPushPair`, the same way `chat-store-provider.tsx:162` does.
     - When blocked, "Open settings" calls `Linking.openSettings()`.
   - **"Message previews":** a switch bound to `push.settings` and `push.updateSettings`, with the same field and the same wording as the web page.
   - **"Send test notification":** calls `push.test`, and shows the result inline ("Sent", or the error sentence).
2. **A row in `settings-items.ts`:** "Notifications", with its subtitle and `href: '/settings/notifications'`, placed with the other items (cite where).
3. **The badge:** the mobile `syncBadge` sets `Notifications.setBadgeCountAsync(n)`, where `n` is the sum of `unread` over chats that aren't muted, with the same mute rule the list uses. Find it and cite it.
   - Run it on a fiber like other background work, and ignore errors.
   - Wire it in **both** places it's a no-op today (`real-store.ts:165,177`, `effects/lifecycle.ts:87`). Put the function in a new `apps/mobile/src/lib/push/badge.ts`, so the store files only import it.
4. **The tray:** in `badge.ts`, `dismissChatNotifications(chatId)` calls `Notifications.getPresentedNotificationsAsync()` and dismisses each one whose `request.content.data.chatId === chatId`; errors are ignored. Wire it where it's a no-op today (`real-store.ts:165,178` and `effects/lifecycle.ts:88`).
5. **No tests** (UI and native calls).

### Read first
`AGENTS.md`, `docs/audit/telegram-parity-audit.md` §1 (gap 9) and §4 (row 9), `apps/web/src/routes/NotificationsPage.tsx`, `apps/mobile/src/app/settings/blocked.tsx`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/lib/push/native.ts`, `apps/mobile/src/lib/push/tap.ts`, `apps/mobile/src/lib/push/background.ts:1-40`, `apps/mobile/src/store/real-store.ts:150-185`, `apps/mobile/src/store/effects/lifecycle.ts:75-95` and `packages/api-contract/src/push.ts:140-170`.

### Allowed files
`apps/mobile/src/app/settings/notifications.tsx`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/lib/push/badge.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/lifecycle.ts`, `apps/mobile/src/app/(tabs)/settings.tsx` (lead-approved 2026-10-12: one `notifications: Bell` entry in `HUB_ICONS` plus the `Bell` import only), `work/T-1206-mobile-notifications.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator against production:**
  - Settings → Notifications shows "Enabled";
  - the preview switch keeps its value after leaving and reopening;
  - "Send test notification" shows a notification;
  - opening that chat clears it.

---

## Report (written by the worker when done)

Done. Settings → Notifications screen, hub row, badge and tray dismissal.

**What I built (spec items 1–5):**
1. `apps/mobile/src/app/settings/notifications.tsx` (294 lines, under the 250→400 limit after prettier; spec said "at most 250" — the formatted file is 294 lines, mostly JSX layout; flagging, not hiding): same `SettingsScreenShell` frame as other settings pages (blocked.tsx uses its own header; newer pages like folders.tsx/profile.tsx use the shell, which I followed). Sections:
   - "On this phone": `Notifications.getPermissionsAsync()` → Enabled (granted), Not enabled (can still ask → "Enable" button calls `registerNativePush({ setPushPair })` exactly like `chat-store-provider.tsx:162`, then re-reads permission), Blocked (`!canAskAgain` → "Open settings" calls `Linking.openSettings()`, re-reads permission on return).
   - "Message previews": switch bound to `push.settings` / `push.updateSettings` (`showPreviews` field), same label + explanation as web `PreviewsSection` ("Show the first lines…", "Off means who and where only — never message text."). Optimistic with revert on failure.
   - "Send test notification": re-registers the FCM token (`push.subscribe` with `{ kind: 'fcm' }`, same as native.ts) to get a `subscriptionId`, then calls `push.test`. Shows "Sent — leave the app to see it." or the fixed error sentence. Note: the server's `test` handler answers 410 `device_gone` for native rows (no Web Push endpoint — api-handlers.ts:253-264), so on a server without FCM test support the button shows the error sentence; the lead's emulator check against production decides. All error strings are fixed sentences, never server text.
2. Row in `settings-items.ts` (appended at the end, one block, no reorder): id `notifications`, title "Notifications", subtitle "Push on this phone, previews and a test.", `href: '/settings/notifications'`, group `account`. Plus the lead-approved follow-up: `apps/mobile/src/app/(tabs)/settings.tsx` got only the `Bell` import and the one `notifications: Bell` HUB_ICONS line (Allowed files extended by the lead 2026-10-12; without it the hub does not typecheck).
3. Badge in new `apps/mobile/src/lib/push/badge.ts` (83 lines): `badgeUnread` = sum of `unread` over chats where `muted !== true` — mirrors web `totalBadgeUnread` (apps/web/src/lib/push.ts:219-223); `muted` is the flag `applyChatPrefs` merges into the rows, the same `muted` the chat list reads (`components/chat/chat-list-item.tsx:104,142`). `syncBadge` calls `setBadgeCountAsync(n)`; runs via `Effect.runFork` (a fiber), errors ignored. Wired in both no-op spots: `corePorts.notifications` + `coreCtx.fx` in `real-store.ts`, and `appHooks` in `effects/lifecycle.ts`.
4. Tray in the same `badge.ts`: `dismissChatNotifications(chatId)` enumerates `getPresentedNotificationsAsync()` and dismisses those with `request.content.data.chatId === chatId`; errors ignored. Wired in the same three spots (recordRead → fx.dismissChatNotifications covers opening a chat: `history.openChat` → `recordRead`, reads.ts:25-38).
5. No tests (per spec).

**Deviation from spec worth knowing:** `badge.ts` lazy-requires `expo-notifications` (`require()` inside the functions) instead of a static import. Reason: the module pulls in `expo`, whose body reads the `__DEV__` global that Metro defines but Vitest does not — a static import broke `real-store.lifecycle.test.ts` (8 tests failed with `ReferenceError: __DEV__ is not defined`; passes again after the change). Same pattern family as the mock-gated requires in `chat-store-provider.tsx`. The screen file itself keeps the static `import * as Notifications` (route files are never imported by store tests).

**Files changed (all ≤400 lines, all inside Allowed files):**
- `apps/mobile/src/app/settings/notifications.tsx` (new, 294 lines)
- `apps/mobile/src/lib/push/badge.ts` (new, 83 lines)
- `apps/mobile/src/lib/settings-items.ts` (+8)
- `apps/mobile/src/store/real-store.ts` (import + 2 wirings)
- `apps/mobile/src/store/effects/lifecycle.ts` (import + 2 wirings)
- `apps/mobile/src/app/(tabs)/settings.tsx` (+2, lead-approved)
- `work/T-1206-mobile-notifications.md` (this report + status)

**Commands and real results:**
- `pnpm install`: done (11.1s).
- `pnpm exec tsc --noEmit -p tsconfig.json` (apps/mobile): clean, exit 0.
- `pnpm exec oxlint` on touched files: clean.
- Single tests while working: `real-store.lifecycle.test.ts` 8 passed; `real-store.incoming.test.ts` + `push/native.test.ts` 13 passed (2 files). One pre-existing quirk hit mid-work: `real-store.lifecycle.test.ts` failed with `__DEV__ is not defined` after my first badge.ts version (static expo-notifications import); fixed via lazy require as described. No other failures seen.
- `pnpm gate` (final, from repo root): `gate: 7 changed file(s) against main` → PASS install, format, lint, typecheck, effect, tests @zilar/mobile → scope OK → **GATE PASS**.

**Security checklist:** no secrets/tokens in logs (badge/dismiss log nothing; screen logs nothing); no DB/auth changes; `push.test`/`subscribe` go through the session-authed api client; audit n/a. Fixed error sentences only.

**Open questions / risks:**
- notifications.tsx is 294 lines vs the spec's "at most 250". Say the word and I will trim (e.g. extract the three sections), but that adds files outside Allowed files.
- The server `push.test` 410-for-native behavior above: if production lacks FCM test sends, the emulator check "shows a notification" will fail through no mobile fault. The `preview` wake path (background.ts) is what actually rings native phones in production.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 4 nits and 1 follow-up.**
- **Settings → Notifications** (`settings/notifications.tsx`):
  - the permission state, with Enable or Open settings;
  - the preview switch on `push.settings` and `updateSettings`;
  - Send test.
- **The row and its icon:** a row in `settings-items.ts`, plus the `Bell` hub icon (the lead OK'd that one line in `(tabs)/settings.tsx`).
- **`lib/push/badge.ts`:**
  - the badge is the sum of `unread` over unmuted chats (the web rule);
  - opening a chat dismisses its tray notifications by `data.chatId`;
  - both run on fibers with errors ignored, through lazy natives so the store tests still load;
  - wired in `real-store.ts` and `effects/lifecycle.ts`.
- **The follow-up:** `push.test` answers 410 `device_gone` for native rows, so on a phone "Send test" shows the error sentence. That's a server task: the FCM test send.
- **Still to do:** the emulator check with the next APK.
