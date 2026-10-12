---
id: T-1250
title: "TG-12 sessions mobile: Settings → Devices lists your signed-in sessions from GET /api/me/sessions (This device first), Sign out one with an in-screen confirm (DELETE /api/me/sessions/:id), Sign out all other devices; the user-agent parser moves from web to chat-core so both apps share it"
status: merged
milestone: M5
branch: task/T-1250-mobile-devices-screen
model: auto
effort: default
depends_on: [T-1235]
estimate: 0.3 day
---

# T-1250: Your devices (mobile)

## Spec (written by Claude, do not edit)

### Why
It's item 12 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4). T-1235 (merged and live: the lead's GET returned 2 sessions, 1 marked `current`, and no token or IP) added:
- **the contract:** `listSessions` = GET `/me/sessions` and `revokeSession` = DELETE `/me/sessions/:id` (`packages/api-contract/src/auth.ts:97,115-121`);
- **the web page:** `apps/web/src/routes/DevicesPage.tsx`, with its client calls in `apps/web/src/lib/api/devices.ts:12-18` and the user-agent parser in `apps/web/src/lib/user-agent.ts`. Mobile must behave the same; read the page.

Mobile has no devices screen. Its auth calls live in `apps/mobile/src/lib/auth-api.ts` (86 lines, `runApi(clientFor(...).auth.me())` at `:39`), and its settings rows in `apps/mobile/src/lib/settings-items.ts` (Blocked people at `:88-95`, icons mapped in `apps/mobile/src/app/(tabs)/settings.tsx:52-53`).

### What to build
1. **Shared parser:** move `apps/web/src/lib/user-agent.ts` to `packages/chat-core/src/user-agent.ts` (export it from the chat-core index), and make the web import it from there. No behaviour change.
2. **Mobile API:** `listSessions()` and `revokeSession(id)` in `auth-api.ts`, following `fetchMe`'s shape. If the mock backend lacks the routes, add them to `packages/mock-backend/src/domains/me/` (two fake sessions, one `current`).
3. **The new screen `apps/mobile/src/app/settings/devices.tsx`,** copying `apps/mobile/src/app/settings/blocked.tsx`'s layout:
   - "This device" first, without a Sign out button;
   - other rows show the device line from the shared parser, "Last active" and "Signed in";
   - Sign out per row behind an in-screen confirm (no `Alert.alert`), and "Sign out all other devices" when there are others;
   - a failure shows one line ("Could not sign out. Try again.") and keeps the row;
   - no IP address and no token anywhere.
4. **Settings:** a "Devices" row (subtitle "Where you are signed in.") after Blocked people in the `account` group, with the lucide `MonitorSmartphone` icon mapped in `settings.tsx`. Add `'devices'` to `SETTINGS_PAGES` (`apps/mobile/src/lib/web-link.ts:16-27`).
5. **No tests** (UI; the server routes are tested in T-1235).

### Read first
`AGENTS.md`, `work/T-1235-web-devices-page.md` (the Report and the Review), `apps/web/src/routes/DevicesPage.tsx`, `apps/web/src/lib/user-agent.ts`, `apps/mobile/src/lib/auth-api.ts`, `apps/mobile/src/app/settings/blocked.tsx`, `apps/mobile/src/lib/settings-items.ts` and `apps/mobile/src/app/(tabs)/settings.tsx`.

### Allowed files
`packages/chat-core/src/user-agent.ts`, `packages/chat-core/src/index.ts`, `apps/web/src/lib/user-agent.ts`, `apps/web/src/routes/DevicesPage.tsx`, `apps/mobile/src/lib/auth-api.ts`, `apps/mobile/src/app/settings/devices.tsx`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/lib/web-link.ts`, `packages/mock-backend/src/domains/me/**`, `work/T-1250-mobile-devices-screen.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every touched file stays at most 400 lines.
- **The lead's check on the emulator (mock build):** Settings shows Devices, This device is first, and Sign out asks first.

---

## Report (written by the worker when done)

### What I built

- **Shared parser (moved):** `packages/chat-core/src/user-agent.ts` (new, 57 lines) is the former `apps/web/src/lib/user-agent.ts`, re-exported from `packages/chat-core/src/index.ts` (`export * from './user-agent';`). The web `DevicesPage.tsx` now imports `describeUserAgent` from `@zilar/chat-core`, and the old `apps/web/src/lib/user-agent.ts` is deleted. No behaviour change; the function body is identical apart from the doc comment naming the shared use.
- **Mobile API `apps/mobile/src/lib/auth-api.ts`:** added `listSessions(apiUrl, token, fetchImpl?)` and `revokeSession(apiUrl, token, id, fetchImpl?)`, following `fetchMe`'s shape (the same `clientFor(...)` derived client). `listSessions` returns the contract's `AuthSessions`; `revokeSession` awaits the 204.
- **New screen `apps/mobile/src/app/settings/devices.tsx` (356 lines):** layout copied from `blocked.tsx` (SafeAreaView + header + ScrollView + `Card`). This device is first with a "This device" chip and no Sign out; other rows show the shared parser's device line, "Last active" (`formatListTime`) and "Signed in" (`formatShortDate`); "Sign out all other devices" is shown above the list when there is at least one other. Both sign-out paths go through the in-screen `ConfirmDialog` (no `Alert.alert`); one success drops the row, the bulk path runs `Promise.allSettled` then reloads. A failure shows the single line "Could not sign out. Try again." and keeps the row. No IP address and no token anywhere. It picks the real vs mock API with the same `?mock=`/env gate as `use-profile-api` (inlined because a new hook file is outside the Allowed files).
- **Mock backend `packages/mock-backend/src/domains/me/`:** `sessions.ts` (new, 45 lines) seeds two sessions (one `current`, the app on Android; one Chrome on macOS) and keeps them per `MockData` instance in a `WeakMap`, so `reset()` reseeds. `routes.ts` serves `GET /me/sessions` → `{ sessions }` and `DELETE /me/sessions/:id` → 204. Neither touches `state.ts`/`data/index.ts` (outside the Allowed files).
- **Settings:** one "Devices" row (`subtitle: 'Where you are signed in.'`) after Blocked people in the `account` group (`settings-items.ts`), the lucide `MonitorSmartphone` mapped in `HUB_ICONS` (`app/(tabs)/settings.tsx`), and `'devices'` added to `SETTINGS_PAGES` (`lib/web-link.ts`, alphabetical).

### Commands and real results

- `pnpm install`: done, no lock change.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/auth-api.test.ts`: **6 passed (6)**.
- `pnpm gate` (repo root, final run on the committed branch):
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/chat-core  (0.8s)
  PASS  tests @zilar/mobile  (1.0s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (The run just before the commit reported `12 changed file(s)` for the same content: 11 paths plus the deleted `apps/web/src/lib/user-agent.ts`, which git records as the rename `apps/web/src/lib/user-agent.ts -> packages/chat-core/src/user-agent.ts` after staging.)
- Two intermediate `pnpm gate` runs failed and were fixed within scope: the first on Prettier for `devices.tsx`; the second on TypeScript (`Effect.catchAll` does not exist in effect 4.0.2 — switched to `Effect.catch`, the form `blocked.tsx` already uses).

### Files changed (12; all in the Allowed files)

`packages/chat-core/src/user-agent.ts` (new, 57), `packages/chat-core/src/index.ts` (36), `apps/web/src/lib/user-agent.ts` (deleted), `apps/web/src/routes/DevicesPage.tsx` (242), `apps/mobile/src/lib/auth-api.ts` (108), `apps/mobile/src/app/settings/devices.tsx` (new, 356), `apps/mobile/src/lib/settings-items.ts` (131), `apps/mobile/src/app/(tabs)/settings.tsx` (257), `apps/mobile/src/lib/web-link.ts` (109), `packages/mock-backend/src/domains/me/sessions.ts` (new, 45), `packages/mock-backend/src/domains/me/routes.ts` (75), `work/T-1250-mobile-devices-screen.md`. Every touched file is ≤ 400 lines.

### Deviations / notes

- **Settings row placement.** The spec says "after Blocked people in the `account` group", so I inserted the row right after `blocked` instead of appending it at the end of `SETTINGS_ITEMS` (the file's own "append at the end" hint). No other row was reordered or reformatted; only one entry was added. The hub renders rows in registry order, so Devices shows right after Blocked people under Account.
- **Mock API selection inlined in the screen.** The existing pattern puts this in a `components/**/use-*-api.ts` hook, but no such file is in the Allowed files, so the same gate (`devicesMockActive` + `mockParamAllowed`) and the `require('@/mock/backend')` seam live inside `devices.tsx`. Behaviour matches `use-profile-api`.
- **`revokeSession` signature.** It is `(apiUrl, token, id, fetchImpl?)` rather than a bare `(id)`, because it needs the same client inputs as `fetchMe`; the screen's `DevicesApi.revoke(id)` wraps it.
- **Mock session persistence.** The mock rows persist per backend instance (and are dropped by `DELETE`), so a refresh after signing out does not resurrect the row; `reset()` reseeds.

### Security checklist

- The list and the screen render `id`, `createdAt`, `updatedAt`, `userAgent` and `current` only — never a token or `ip_address`, matching the server contract (`packages/api-contract/src/auth.ts`). The mock seeds likewise carry neither.
- The screen sends the bearer only through the derived contract client; no session token is logged, held in state or put in a URL.
- The mock delete is keyed by the id in the path; the real delete is the server's own scoped route (T-1235).
- No new route or write was added to the server; the mock routes are in-memory only.

### Not done

- No tests were added (spec item 5 and AGENTS.md: UI code gets no tests; the server routes are covered by T-1235).
- I did not run the emulator; the mock-build acceptance check is the lead's.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit).**
- **The change:**
  - the user-agent parser moved to chat-core (web imports it, no behaviour change);
  - mobile `listSessions` / `revokeSession` in `auth-api.ts`;
  - a new `settings/devices.tsx` (356 lines);
  - a Settings row;
  - mock sessions in `mock-backend/src/domains/me/`.
- **Lead's emulator check (mock build, SMOKE PASS):**
  - Devices shows "Signed in on 1 other device." with Sign out all other devices;
  - "Zilar on Android" is marked This device, and "Chrome on macOS" has Sign out;
  - Sign out opens the in-app confirm "Sign out this device? It will need a sign-in code to get back in.", and confirming removes the row;
  - no `Alert.` in the screen, and no token or IP is shown (the session token is only the auth header, as in `fetchMe`).
