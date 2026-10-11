---
id: T-1145
title: "Web: in-tab notifications — while a Zilar tab is open but hidden, an incoming unread message in an unmuted chat shows a browser notification (Telegram-style); works without Web Push (Helium); same tag as the service worker; friendly text when the browser has no push service"
status: merged
milestone: M5
branch: task/T-1145-web-in-tab-notifications
model: auto
effort: default
depends_on: [T-1144]
estimate: 0.3 day
---

# T-1145: In-tab notifications on web

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: in Helium, "Enable" on Settings → Notifications fails with the browser error "Registration failed - push service error". Chromium forks without Google's push service can't do Web Push (`PushManager.subscribe`). Telegram Web still notifies there, because it shows notifications from the open page itself. Julio chose that ("i will like 1"): **notify while a Zilar tab is open**, in every browser, with real Web Push on top where the browser supports it.

**What the lead read:**
- **Today web notifications only come from the service worker:** `apps/web/public/sw.js:71-85` (`push`, then `showNotification`). Its tag is the payload's `messageId`, falling back to `chatId`, with `renotify: true` (`sw.js:23-29`). The click focuses or opens `clickUrlFor(chatId)` (`sw.js:88-108`). No page code calls `new Notification` or `showNotification`.
- **Incoming messages** go through `packages/client-core/src/store/incoming.ts`:
  - outgoing echoes return early (`:122-125`);
  - `isRead = activeChatId === chatId && ports.isVisible()` (`:127-128`);
  - for unread messages it calls `ctx.fx.syncBadge()` (`:162-164`).
  - The hooks interface is `CoreHooks` in `packages/client-core/src/store/ctx.ts:56-67`.
- **The web hooks** (`fx`) are built in `apps/web/src/store/effects/storeContext.ts`. The notifications port, with badge and dismiss, is in `apps/web/src/store/effects/portAdapters.ts:49-58` and `apps/web/src/lib/push.ts:268`.
- **Chat rows** carry `muted` (`packages/client-core/src/store/chat-rows.ts:65`). The previews setting comes from `getPushSettings()` (`apps/web/src/lib/api.ts:174`, `{ showPreviews }`).
- **The settings page** is `apps/web/src/routes/NotificationsPage.tsx` (150 lines), with logic in `apps/web/src/lib/push/usePushEnable.ts`.

### What to build
1. **The core hook:** add an optional `notifyIncoming?: (chatId: string, message: UiMessage) => void` to `CoreHooks` (`ctx.ts`). In `incoming.ts`, call `ctx.fx.notifyIncoming?.(chatId, ui)` inside the existing `if (!isRead)` block (`:162`). Mobile doesn't set it, so nothing changes there.
2. **A new `apps/web/src/lib/push/inTab.ts`:**
   - **The decision, pure and tested:** `inTabNotification({ chat, message, permission, hidden, showPreviews })` returns `{ title, body, tag, chatId }` or `undefined`.
     - It returns `undefined` unless the permission is `'granted'`, the tab is hidden (`document.visibilityState !== 'visible'` or `!document.hasFocus()`), and the chat exists and isn't `muted`.
     - Title: the sender's display name. In a group or topic, use `"<sender> · <chat title>"`, following the chat row's title.
     - Body: the message text when `showPreviews`, or a short label for media and stickers, the same words the chat list preview uses. Otherwise `'New message'`.
     - Tag: the message's origin id when the `UiMessage` has one (check `toUiMessage`; it must be the same id the server puts in the Web Push `messageId`), else the `chatId`. That way a real push and an in-tab notification for one message collapse into one.
   - **Showing it:** use `navigator.serviceWorker.ready.then(r => r.showNotification(title, { body, tag, renotify: true, data: { chatId }, icon }))`, the same icon the service worker uses. The service worker's `notificationclick` already focuses the tab and opens the chat.
     - **If there is no service worker registration,** fall back to `new Notification(title, { body, tag })`. Its `onclick` focuses the window and navigates to the chat route used by `clickUrlFor`.
   - **`showPreviews`:** read it once with `getPushSettings()` after the store starts and cache it in the module. Refresh it when the Notifications page saves the setting. If the read fails, use `false` (no text).
   - **Logs:** never the message text.
3. **The web hook:** in `apps/web/src/store/effects/storeContext.ts`, set `fx.notifyIncoming`. It finds the chat row in `get().chats` and calls `inTab.ts`.
4. **The settings page** (`NotificationsPage.tsx` and `usePushEnable.ts`):
   - When `PushManager.subscribe` fails with the browser's push-service error (an `AbortError`, or a message containing "push service"), show this plain line instead of the raw error:
     > This browser can't receive notifications when Zilar is closed. You'll still get them while a Zilar tab is open.
   - Keep the permission, so in-tab notifications work.
   - Show the device state as "Only while open" in that case.
   - Asking for permission alone, without a successful subscribe, is enough for in-tab notifications.
5. **No change** to `sw.js` behaviour, Web Push, or mobile.
6. **Tests** (the message pipeline), in a new `apps/web/src/lib/push/inTab.test.ts`, with at most 4, for the pure decision:
   - a hidden tab, an unmuted chat and granted permission give the title and body;
   - previews off gives `'New message'`;
   - a muted chat gives `undefined`;
   - a permission that isn't `'granted'` gives `undefined`.

### Read first
`AGENTS.md`, `apps/web/public/sw.js`, `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/ctx.ts`, `apps/web/src/store/effects/storeContext.ts`, `apps/web/src/store/effects/portAdapters.ts`, `apps/web/src/lib/push.ts`, `apps/web/src/lib/push/usePushEnable.ts` and `apps/web/src/routes/NotificationsPage.tsx`.

### Allowed files
`packages/client-core/src/store/ctx.ts`, `packages/client-core/src/store/incoming.ts`, `apps/web/src/lib/push/inTab.ts`, `apps/web/src/lib/push/inTab.test.ts`, `apps/web/src/store/effects/storeContext.ts`, `apps/web/src/lib/push/usePushEnable.ts`, `apps/web/src/routes/NotificationsPage.tsx`, `work/T-1145-web-in-tab-notifications.md`.

### Checks
```bash
pnpm --filter @zilar/web exec vitest run src/lib/push/inTab.test.ts src/store/effects/sendFailure.test.ts --reporter=dot
pnpm --filter @zilar/client-core exec vitest run src/store/incoming.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- **The lead's and Julio's check, in Helium:** allow notifications, put the Zilar tab in the background, and have another account send a message. A notification shows with the sender (and the text when previews are on), and clicking it opens the chat.

---

## Report (written by the worker when done)

### What I did

- **Core hook:** added optional `notifyIncoming?: (chatId, message: UiMessage) => void` to `CoreHooks` (`packages/client-core/src/store/ctx.ts`) and call `ctx.fx.notifyIncoming?.(chatId, ui)` inside the existing `if (!isRead)` block of `handleMessage` (`packages/client-core/src/store/incoming.ts`). Mobile leaves it unset.
- **`apps/web/src/lib/push/inTab.ts` (new):** the pure `inTabNotification({ chat, message, permission, hidden, showPreviews })` decision (returns title/body/tag/chatId or `undefined`), the module-cached `showPreviews` (`loadInTabPreviews` reads `getPushSettings()` once after boot; `setInTabPreviews` refreshes it when the page saves; a failure keeps the default `false`), and the show path. `showInTabNotification` reads permission/visibility, then shows through `navigator.serviceWorker.ready`/`showNotification` with `{ body, tag, renotify: true, data: { chatId }, icon }`, falling back to `new Notification(...)` with an `onclick` that focuses and opens `/c/<chatId>` (the sw.js `clickUrlFor` route) when there is no registration. Tag = the message's origin id (looked up in the ledger in `storeContext`) or the chat id. It runs through the shared web Effect runtime (`runWeb`), so no new raw Promise surface. No log line, ever, carries message text.
- **Web hook:** `apps/web/src/store/effects/storeContext.ts` sets `fx.notifyIncoming`: it finds the chat row in `get().chats`, resolves the origin id from `ctx.messageOriginIds`, and calls `showInTabNotification`. `applyBoot` also kicks off `loadInTabPreviews()` once the store has booted.
- **Settings page:** `usePushEnable.ts` catches a `PushManager.subscribe` failure that is an `AbortError` or mentions "push service", keeps the granted permission, sets a new `onlyWhileOpen` flag and shows the plain sentence instead of the raw error. `NotificationsPage.tsx` renders the device state as "Only while open" in that case.
- **Tests:** `apps/web/src/lib/push/inTab.test.ts` (new) — 4 tests for the pure decision.

### Files changed

- `packages/client-core/src/store/ctx.ts`, `packages/client-core/src/store/incoming.ts`
- `apps/web/src/lib/push/inTab.ts`, `apps/web/src/lib/push/inTab.test.ts`
- `apps/web/src/store/effects/storeContext.ts`
- `apps/web/src/lib/push/usePushEnable.ts`, `apps/web/src/routes/NotificationsPage.tsx`
- `work/T-1145-web-in-tab-notifications.md`

### Commands and results

- `pnpm install` → done.
- `pnpm --filter @zilar/web exec vitest run src/lib/push/inTab.test.ts src/store/effects/sendFailure.test.ts --reporter=dot` → 2 files passed, 8 tests passed.
- `pnpm --filter @zilar/client-core exec vitest run src/store/incoming.test.ts --reporter=dot` → 1 file passed, 15 tests passed.
- `pnpm gate` (run 3 times: fixed a `renotify` type, a formatting warning, and the Effect ratchet) → final run:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.5s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/client-core  (2.7s)
  PASS  tests @zilar/web  (2.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec / notes

- **`icon`:** `sw.js` calls `showNotification` with no `icon` (only `body`/`tag`/`renotify`/`data`), so there is no "icon the service worker uses". I used the app icon `/icons/icon-192.png` so the in-tab notification looks like the installed app; if the intent was literally to match the service worker, the option should be dropped.
- **"Only while open" card:** `ThisDeviceCard.tsx` narrows its `state` prop to `'Enabled' | 'Not enabled' | 'Blocked by the browser'` and is not in the Allowed files. To show the required state text I render a small **inline** "This device" card in `NotificationsPage.tsx` for the `onlyWhileOpen` case, and keep `ThisDeviceCard` for the other states. A follow-up could add `'Only while open'` to `ThisDeviceCard`'s union and drop the duplicated markup.
- **`onlyWhileOpen` lifetime:** it is page-session state set on the push-service error, so it resets on reload (the permission stays granted and in-tab notifications keep working; the page would show "Not enabled" again until Enable is pressed once more). Persisting it was not in scope.
- Tests: 4 as required; the first also asserts `tag` uses the message `originId`, so the "same tag as the service worker" collapse is covered.

### Not verified

- The live Helium check (allow notifications, background the tab, receive a message from another account, click) is Julio's check; I did not run a browser.
- I did not run `format`/`lint`/`typecheck`/whole suites separately; only `pnpm gate` at the end, plus the single test files above.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **The core:** an optional `CoreHooks.notifyIncoming` is called in the unread branch of `incoming.ts`. Mobile doesn't set it.
- **The web:** `lib/push/inTab.ts` has the pure decision.
  - It notifies only when permission is granted, the tab is hidden or unfocused, and the chat isn't muted.
  - Title: the sender, or "sender · group" in a group. Body: the text when previews are on, else "New message".
  - The tag is the archive origin id, so a real push of the same message collapses into one (the pre-review checked `candidates.ts:101`).
  - It shows through the service worker registration (the click is handled by `sw.js`), or `new Notification` as a fallback.
  - Previews load at boot and default to off.
- **The settings page:** "push service error" now gives the plain "only while a Zilar tab is open" text and the "Only while open" state.
- **Tests:** the lead ran the branch tests: 8 web and 15 incoming.
- **Why the page change matters:** the lead had shown on the local stack that this browser can't Web Push at all. A freshly made valid VAPID key failed with the same AbortError.
- **Accepted nit:** "Only while open" isn't restored after a page reload.
- **Follow-up:** the card markup is duplicated, because `ThisDeviceCard` was outside the Allowed files.
- **To watch in Julio's Helium check:** after a reconnect, a burst of backlog messages could notify several times.
