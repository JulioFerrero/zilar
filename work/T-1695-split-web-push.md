---
id: T-1695
title: "Size split of apps/web/src/lib/push.ts (388 lines): move the app badge and notification-dismiss block (totalBadgeUnread … dismissChatNotificationsEffect) into a new lib/push/badge.ts and re-export its three public functions from push.ts so no importer changes — a pure move"
status: merged
milestone: M5
branch: task/T-1695-split-web-push
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1695: Split the badge code out of the web push.ts

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/lib/push.ts` is 388 of 400 lines, so no web push change can land. The app badge and the notification dismissal form a self-contained block, and the `lib/push/` folder already holds push helpers.

### Facts (the lead read them on 2026-10-16)
- **`push.ts`:**
  - imports `:1-3` (`Effect`; `useEffect`, `useState`; `runWeb` from `@/lib/effect/runtime`);
  - `export interface ServiceWorkerRegistrationLike :65`;
  - **the block to move** runs from the comment `// The app badge shows the total unread excluding muted chats, …` (`:244`) through:
    - `export function totalBadgeUnread :247`;
    - `interface BadgeSurface :252` and `function badgeCall :258`;
    - `export function updateAppBadge :268` and `const updateAppBadgeEffect :272`;
    - `export function dismissChatNotifications :296`;
    - `type NotifyingRegistration :303` (it extends `ServiceWorkerRegistrationLike`);
    - `const canListNotifications :306` and `const dismissChatNotificationsEffect :310`;
    - to the end of that effect, just before `// --- Install prompt ---` (about `:335`).
- **Importers of the three public functions:**
  - `apps/web/src/store/effects/badge.ts:5` and `apps/web/src/store/effects/portAdapters.ts:16` (`import { dismissChatNotifications, totalBadgeUnread, updateAppBadge } from '@/lib/push';`).
  - Other files import other names from `@/lib/push`, which stay.
- **The folder `apps/web/src/lib/push/`** holds `deviceStorage.ts`, `inTab.ts`, `inTab.test.ts`, `pageActions.ts`, `sessionEnable.ts`, `sessionEnable.test.ts` and `usePushEnable.ts`; there's no `badge.ts`.

### Steps
1. **Create `apps/web/src/lib/push/badge.ts`** with the block moved **word for word**, comments included.
   - Import `type ServiceWorkerRegistrationLike` from `@/lib/push` (type only, so no runtime cycle), plus `Effect` and `runWeb` if the block uses them.
   - Export `totalBadgeUnread`, `updateAppBadge` and `dismissChatNotifications`.
2. **`push.ts`:**
   - delete the block;
   - add `export { dismissChatNotifications, totalBadgeUnread, updateAppBadge } from './push/badge';` so every importer keeps working unchanged;
   - drop imports it no longer uses;
   - update the file's header comment so it no longer lists the badge and dismissal, or says they live in `push/badge.ts`.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/web/src/lib/push/badge.ts`
- `apps/web/src/lib/push.ts`
- `work/T-1695-split-web-push.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`push.ts` is about 300 lines,** and `push/badge.ts` holds the block unchanged.
- **The web typecheck, build and the `lib/push` tests pass.**

---

## Report (written by the worker when done)

### What I did

Moved the app badge and notification-dismissal block out of `apps/web/src/lib/push.ts` into the new `apps/web/src/lib/push/badge.ts`, word for word (comments included), and re-exported the three public functions from `push.ts` so no importer changed.

- **`apps/web/src/lib/push/badge.ts` (new, 99 lines):** the moved block — `totalBadgeUnread`, `BadgeSurface`, `badgeCall`, `updateAppBadge`, `updateAppBadgeEffect`, `dismissChatNotifications`, `NotifyingRegistration`, `canListNotifications`, `dismissChatNotificationsEffect`. It imports `Effect` from `effect`, `runWeb` from `@/lib/effect/runtime`, and `type ServiceWorkerRegistrationLike` from `@/lib/push` (type-only, so no runtime cycle).
- **`apps/web/src/lib/push.ts` (388 → 301 lines):** the block is deleted and replaced in the same spot by `export { dismissChatNotifications, totalBadgeUnread, updateAppBadge } from './push/badge';`. The header comment now says the badge and dismissal live in `./push/badge.ts`. No imports were dropped: `Effect`, `useEffect`/`useState` and `runWeb` are all still used elsewhere in the file.
- No behaviour change, no new tests.

### Checks run

- `pnpm --filter web test --maxWorkers=2 --reporter=dot src/lib/push`: 2 test files passed, 6 tests passed.
- `pnpm gate`, from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (7.0s)
  PASS  format  (4.5s)
  PASS  lint  (6.0s)
  PASS  typecheck  (20.2s)
  PASS  effect  (3.8s)
  PASS  tests @zilar/web  (69.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- Gate's "3 changed file(s)" are `apps/web/src/lib/push.ts`, the new `apps/web/src/lib/push/badge.ts` and `work/T-1695-split-web-push.md`; all inside the Allowed files.
- The re-export keeps `apps/web/src/store/effects/badge.ts:5` and `apps/web/src/store/effects/portAdapters.ts:16` working unchanged; no importer was touched.
- The moved block is byte-identical to the original, so this is a pure move.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean.
- **The lead's check:** the removed lines equal `push/badge.ts` apart from the two header comments.
- **The re-export:** it keeps both store importers unchanged.
- **Result:** web `lib/push.ts` drops from 388 to 301 lines.
