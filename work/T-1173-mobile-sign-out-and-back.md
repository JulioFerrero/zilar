---
id: T-1173
title: "MUX-5 + MUX-6: a Sign out row (with confirm) at the bottom of the mobile settings hub; the header back on a chat, group or profile opened cold from a notification or App Link goes to the chat list instead of doing nothing"
status: merged
milestone: M5
branch: task/T-1173-mobile-sign-out-and-back
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1173: Sign out and Back on mobile

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-5 and MUX-6 (P1).
- **MUX-5, there's no Sign out anywhere:**
  - `signOut` exists (`apps/mobile/src/auth/session-store.ts:148-155`, exposed at `:163`), and the API side removes the push device first (`apps/mobile/src/auth/session.ts:56-68`, `unregisterNativePush`);
  - but no screen calls it. The settings hub (`apps/mobile/src/app/(tabs)/settings.tsx:179-200`) has no Sign out row;
  - a confirm dialog component exists: `apps/mobile/src/components/ui/confirm-dialog.tsx`.
- **MUX-6, Back does nothing after a cold open:**
  - a tapped notification on a cold start pushes `/chat/[id]` with no screen below it (`apps/mobile/src/lib/push/tap.ts:21-23`);
  - every header back is `router.back()`: `apps/mobile/src/app/chat/[id].tsx:91,131,167`, `apps/mobile/src/app/group/[id].tsx:190,217` and `apps/mobile/src/app/u/[handle].tsx:219`;
  - with no history that's a no-op, and hardware back leaves the app. Telegram always goes back to the chat list.

### What to build
1. **A new `apps/mobile/src/lib/navigation.ts`** exporting `goBackOrHome(router)`: `router.canGoBack() ? router.back() : router.replace('/')`. Use it at every `router.back()` listed above.
2. **The settings hub:** a "Sign out" row at the bottom of `settings.tsx`, in danger style, using the same row component the hub's cards use. It opens `ConfirmDialog` ("Sign out of Zilar on this phone?"), and Confirm then:
   1. awaits `useAuthStore.getState().signOut()`;
   2. makes sure the chat store's XMPP session ends. Find what ends it today when the status becomes `guest` (`apps/mobile/src/store/effects/runtime.ts:89,117` `endSession`). If nothing calls it on sign-out, call it, and cite what you found;
   3. runs `router.replace('/login')`.
   - `settings.tsx` stays at most 400 lines.
3. **No tests** (UI). The sign-out push removal is already in `session.ts`.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (MUX-5, MUX-6), `apps/mobile/src/auth/session.ts`, `apps/mobile/src/auth/session-store.ts:100-170`, `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/components/ui/confirm-dialog.tsx`, `apps/mobile/src/store/effects/runtime.ts:80-125`, `apps/mobile/src/lib/push/tap.ts` and `apps/mobile/src/app/_layout.tsx`.

### Allowed files
`apps/mobile/src/lib/navigation.ts`, `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/app/group/[id].tsx`, `apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/store/effects/runtime.ts`, `work/T-1173-mobile-sign-out-and-back.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator:**
  - Settings shows Sign out, and confirming it lands on the login screen;
  - a chat opened by deep link on a cold start goes back to the chat list.

---

## Report (written by the worker when done)

Done. MUX-5 (Sign out row) and MUX-6 (back after a cold open).

**What I changed**
- `apps/mobile/src/lib/navigation.ts` (new, 16 lines): `goBackOrHome(router:
  ImperativeRouter)` = `router.canGoBack() ? router.back() : router.replace('/')`.
  Typed against expo-router's exported `ImperativeRouter` (`useRouter()` returns it).
- `apps/mobile/src/app/chat/[id].tsx` (252), `group/[id].tsx` (337),
  `u/[handle].tsx` (275): every header/route back listed in the spec now calls
  `goBackOrHome(router)` instead of `router.back()` — chat 3 (all `ChatHeaderBar`
  `onBack`), group 2 (the `onBack` and the empty-topics redirect that used to be
  `router.back()` at old line 190), profile 1.
- `apps/mobile/src/app/(tabs)/settings.tsx` (243): a Sign out `Card` + `ListRow`
  at the bottom of the hub, with a `LogOut` icon in `DANGER`. Tapping opens the
  kit `ConfirmDialog` titled "Sign out of Zilar on this phone?"; Confirm runs the
  sign-out handler: it awaits the auth store's `signOut()` and then
  `router.replace('/login')` in `.finally`, so login is reached either way.
- `apps/mobile/src/store/effects/runtime.ts` was **not** changed (see finding).

**MUX-5, does sign-out end the chat store's XMPP session? (spec step 2.2)**
- `endSession` has **no callers**: `rg endSession apps/mobile packages` finds only
  its declaration (`store/effects/runtime.ts:89`) and the `makeLife` body
  (`:117`, `endSession: () => lifetime.closeStore()`). Nothing calls it.
- The XMPP session **is** ended on sign-out today, through another path:
  `session-store.signOut` sets `status: 'guest'` (`auth/session-store.ts:149-155`);
  `ChatStoreProvider` derives `active = mock || status === 'authenticated'` and its
  effect cleanup runs on that change (`store/chat-store-provider.tsx:124-130` →
  `store.getState().stop()`); `stop()` runs `coreStopStore` (`store/effects/lifecycle.ts:249-252`),
  which calls `ctx.rt.closeStore()` (`packages/client-core/src/store/lifecycle.ts:110-117`)
  — the same `closeStore` that `Life.endSession` wraps.
- Because the provider already ends the session, I added **no** explicit call in
  `settings.tsx` (the spec's condition "if nothing calls it on sign-out"). Calling it
  again would be a no-op (`closeStore` is idempotent, `lifetime.ts:114-121`).

**Deviation / note on "danger style"**
`ListRow`'s title colour is fixed at `text-foreground` (`components/ui/list-row.tsx:49`)
and `list-row.tsx` is not in the Allowed files, so the row is danger-styled via its
`LogOut` icon (`DANGER`) and the destructive ConfirmDialog button; the label text is
the default foreground. A red label would need a new prop on `ListRow` (out of scope
here) — flagging in case the lead wants it.

**Commands (real results)**
- `pnpm install`: done (18.3s, reused 1149).
- Single tests: none. The change is UI only (the spec says "No tests (UI)") and
  `runtime.ts`, the only tested store path in scope, was not modified.
- `pnpm gate` (repo root): `6 changed file(s) against main`; `PASS install (frozen) (1.0s)`;
  `PASS format (1.2s)`; `PASS lint (0.8s)`; `PASS typecheck (3.4s)`; `PASS effect (0.7s)`;
  `PASS tests @zilar/mobile (1.5s)`; `scope: every changed file is inside the Allowed files`;
  `GATE PASS`.

**Line counts** (all ≤ 400): settings.tsx 243, chat/[id].tsx 252, group/[id].tsx 337,
u/[handle].tsx 275, navigation.ts 16, runtime.ts 288 (unchanged).

**Not done / open**
- No emulator here, so the two acceptance checks (Settings → Sign out lands on
  login; a cold deep-linked chat's back goes to the chat list) are for the lead's
  device smoke. The logic is covered by the gate but not exercised on a device.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **`goBackOrHome`** (`lib/navigation.ts`) replaces `router.back()` in the chat, group and profile headers.
- **Settings:** a Sign out row (LogOut icon in DANGER) opens `ConfirmDialog`, then calls `signOut()` and `router.replace('/login')`.
- **The XMPP session:** the worker verified it ends through the chat store provider's guest watch (`chat-store-provider.tsx:124-130`, `store.stop`), so `runtime.ts` is unchanged.
- **Follow-up:** after a cold open from a notification, Android *hardware* back still leaves the app; only the header back goes home. Fix it in `tap.ts`: `replace('/')`, then `push` the chat.
- **Still to do:** the device check with the next APK.
