---
id: T-1330
title: "Web navigation like Telegram (docs/audit/nav-plan.md): the rail shows folders + Edit only, the hamburger menu shrinks from 18 items to 6, and a new /settings hub (profile card + grouped rows + Sign out) shares its row list with mobile via chat-core"
status: merged
milestone: M5
branch: task/T-1330-web-nav-simplify
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1330: Web navigation simplify

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, approved "Simplify like Telegram" after the lead's UI audit. The plan is `docs/audit/nav-plan.md`; read it first.

### What to build
1. **Shared row list.** Move the pure data in `apps/mobile/src/lib/settings-items.ts` (131 lines: `SettingsGroup`, `SETTINGS_GROUP_ORDER`, `SettingsItemShape`, `SETTINGS_ITEMS`; no imports) to `packages/chat-core/src/settings-items.ts`, and export it from `index.ts`.
   - `apps/mobile/src/lib/settings-items.ts` becomes a re-export so mobile is unchanged.
   - Keep the header comment, updated for the new home.
   - Check `.gitattributes` for a `merge=union` line naming the old path and move it too (say what you found).
2. **The `/settings` hub page** on web: `apps/web/src/routes/SettingsHubPage.tsx`, plus a route in `apps/web/src/routes/AppRoutes.tsx` (323 lines).
   - Inside `SettingsShell` (`apps/web/src/components/SettingsShell.tsx`).
   - A profile card at the top: avatar, name, @handle or email, linking to `/settings/profile`.
   - Then one card per group in `SETTINGS_GROUP_ORDER`, with each row's lucide icon, title, subtitle and a chevron, linking to its `href`. The web routes are the same `/settings/<page>` paths; check every `href` exists in `AppRoutes.tsx` and hide rows whose page web lacks.
   - Show the requests badge on Contact requests and the approvals badge on Approvals (the same sources the menu uses today, `apps/web/src/components/chatList/ChatListMenu.tsx:131-170`).
   - Show Integrations only under the same condition as `ChatListMenu.tsx:177-178`.
   - **Sign out** at the bottom in red, using the existing sign-out (`ChatListMenu.tsx:~200`).
   - At 400 px it's one column.
3. **Back arrows.** Every `/settings/<page>` `SettingsShell` back arrow goes to `/settings`, and the hub's back arrow goes to `/`. Find where `onBack` is set (cite it); change it in one place if possible.
4. **The hamburger menu** (`ChatListMenu.tsx`, 207 lines) becomes:
   - a profile row at the top (avatar, name, @handle) linking to `/settings/profile`;
   - Contacts (the requests badge);
   - My AIs;
   - Explore groups;
   - Invite a friend;
   - Settings (the approvals badge), linking to **`/settings`**.

   Remove the other items (they're in the hub) and the Sign out item (it's in the hub).
5. **The rail** (`apps/web/src/components/FolderRail.tsx`, 199 lines): keep the folder buttons and **Edit** (`:156`). Remove **New folder** (`:139`; adding a folder stays on the Chat folders page), **My AIs** (`:173`) and **Profile** (`:186`). Keep keyboard focus order working (`itemRefs`/`moveFocus`).
6. Every file stays at most 400 lines. **No tests** (UI). `SETTINGS_ITEMS` already has its mobile test; if it moves, move that test too (find it, and cite it).

### Read first
`AGENTS.md`, `docs/audit/nav-plan.md`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/app/(tabs)/settings.tsx` (the hub to match), `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/components/FolderRail.tsx`, `apps/web/src/components/SettingsShell.tsx`, `apps/web/src/routes/AppRoutes.tsx`.

### Allowed files
`packages/chat-core/src/settings-items.ts`, `packages/chat-core/src/settings-items.test.ts`, `packages/chat-core/src/index.ts`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/lib/settings-items.test.ts`, `.gitattributes`, `apps/web/src/routes/SettingsHubPage.tsx`, `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/components/settings/hub/**/*.tsx`, `apps/web/src/components/settings/hub/**/*.ts`, `apps/web/src/components/SettingsShell.tsx`, `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/components/FolderRail.tsx`, `apps/web/src/routes/*Page.tsx`, `work/T-1330-web-nav-simplify.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:**
  - the rail shows folders + Edit;
  - the menu has the 6 items above;
  - `/settings` shows the hub with Sign out;
  - a settings page's back arrow returns to `/settings`.

---

## Report (written by the worker when done)

### What I did

1. **Shared row list.** Moved the pure data of `apps/mobile/src/lib/settings-items.ts`
   (the four shapes/consts plus `SettingsItem`/`SettingsIconId`) to
   `packages/chat-core/src/settings-items.ts`, exported it from
   `packages/chat-core/src/index.ts`, and turned the mobile file into a re-export
   from `@zilar/chat-core` (mobile imports were left unchanged). Header comment
   rewritten for the new home; no row was added, reordered or reformatted.
   `.gitattributes` had one `merge=union` line naming the old path
   (`apps/mobile/src/lib/settings-items.ts`, line 4); I moved it to
   `packages/chat-core/src/settings-items.ts merge=union`.
2. **`/settings` hub.** New `apps/web/src/routes/SettingsHubPage.tsx` inside
   `SettingsShell`, plus a `/settings` route in `AppRoutes.tsx` under `RequireAuth`.
   It shows a profile card (avatar, name, `@handle` or email → `/settings/profile`),
   one card per group in `SETTINGS_GROUP_ORDER` with each row's lucide icon,
   title, subtitle and chevron (Link to its `href`), the requests badge on Contact
   requests and the approvals badge on Approvals (same hooks the menu uses,
   `useContactRequestCount` / `usePendingApprovalCount`), Integrations only when
   `useIsServerOwner()` is true, and Sign out in red at the bottom (confirm dialog,
   then the store's `signOut()`, same as `ChatList.tsx:189-200`). One column
   (`SETTINGS_COLUMN`), so 400 px is one column.
   Row inventory for web lives in `apps/web/src/components/settings/hub/rows.ts`
   (`WEB_SETTINGS_HREFS` filters to the `/settings/<page>` routes web has).
3. **Back arrows.** `onBack` is **not** set in one place: each settings page
   owns its handler. It is set at `MachinesPage.tsx:104`, `ApprovalsPage.tsx:101`,
   `ConnectionsPage.tsx:73`, `IntegrationsPage.tsx:50`, `NotificationsPage.tsx:68`,
   `AisPage.tsx:73`, `ProfilePage.tsx:13`, `StickersPage.tsx:158` and in the five
   `AppRoutes.tsx` wrappers (`RequestsRoute`, `FoldersRoute`, `BlockedRoute`,
   `ContactsRoute`, `DevicesRoute`, `:286-306`). Changed all 13 from `navigate('/')`
   to `navigate('/settings')`; the hub's own back arrow goes to `/`.
4. **Menu** (`ChatListMenu.tsx`): now the profile row (avatar, name, `@handle` →
   `/settings/profile`), Contacts (requests badge), My AIs, Explore groups,
   Invite a friend and Settings (approvals badge) → `/settings`. Removed Requests,
   Chat folders, Blocked people, Stickers, Connections, Machines, Approvals
   (entry), Integrations, Devices, Profile, Notifications and Sign out.
5. **Rail** (`FolderRail.tsx`): kept the folder tablist and Edit; removed New
   folder, My AIs and Profile, and the now-unused `FolderEditorDialog`/`FOLDER_MAX`
   plumbing. `itemRefs`/`moveFocus` cover exactly the tabs plus Edit.
6. All touched files are ≤ 400 lines. No tests added (UI; see below).

### Files changed

`packages/chat-core/src/settings-items.ts` (new), `packages/chat-core/src/index.ts`,
`apps/mobile/src/lib/settings-items.ts`, `.gitattributes`,
`apps/web/src/components/settings/hub/rows.ts` (new),
`apps/web/src/routes/SettingsHubPage.tsx` (new), `apps/web/src/routes/AppRoutes.tsx`,
`apps/web/src/components/chatList/ChatListMenu.tsx`,
`apps/web/src/components/FolderRail.tsx`, and the eight settings pages
`AisPage/ApprovalsPage/ConnectionsPage/IntegrationsPage/MachinesPage/NotificationsPage/ProfilePage/StickersPage.tsx`.

### Tests

- No test file to move: the mobile `apps/mobile/src/lib/settings-items.test.ts`
  was deleted in commit `0fee65c86` ("T-0933: Cut the mobile tests…"); `git ls-files`
  shows only `apps/mobile/src/lib/settings-items.ts`, and a repo-wide grep finds no
  test importing `SETTINGS_ITEMS`/`SETTINGS_GROUP_ORDER`. I did not create
  `packages/chat-core/src/settings-items.test.ts` because there is nothing to move
  and AGENTS says registry/UI changes get no new tests.
- I ran no single test file: there is no nearby test for the shared data (none
  exists) and the web changes are UI (web tests are skipped by the gate).

### Commands (real results)

```
pnpm install
  Done in 13.6s. (pre-existing warning: apps/mobile @types/react-dom 19.3.0 wants @types/react ^19.3.0, found 19.2.18)

pnpm exec prettier --write apps/web/src/components/settings/hub/rows.ts apps/web/src/routes/SettingsHubPage.tsx
  both written (fixed the first gate's format failure)

pnpm gate
  gate: 18 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (5.9s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/chat-core  (1.3s)
  PASS  tests @zilar/mobile  (1.6s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
```

### Deviations / notes

1. **Install app kept in the menu.** The spec's removal rule is "the other items
   (they're in the hub)"; "Install app" is a browser affordance, not a settings
   duplicate, and `ChatListMenu.tsx` is its only render site on web (grep). The
   six listed items are all present; Install stays a conditional seventh. Say the
   word and I'll drop it.
2. **Back arrows are 13 edits, not one.** `SettingsShell` takes `onBack` as a
   prop, and each page/wrapper supplies `navigate('/')`; there is no single
   shared call site to change without restructuring the prop flow (and, on the
   lazy pages, without leaving `useNavigate` unused). I changed each target.
3. **`onSignOut` / `isServerOwner` stay in `ChatListMenuProps`** although the menu
   no longer uses them: `apps/web/src/components/ChatList.tsx` (outside the
   Allowed files) still passes them and owns the sign-out confirm dialog. So the
   menu no longer opens that dialog, and the dialog + `storeApi.getState().signOut()`
   remain in `ChatList.tsx` as now-unreachable code that I cannot remove from here.
   `installEvent`/`installFailed`/`installing`/`onInstall` are still used (Install kept).

### Open questions

- The menu's Contacts row: the spec gives no href, only "Contacts (the requests
  badge)". I linked it to `/settings/contacts` (the page the label names). If it
  should open the requests list instead, it's a one-line change to
  `/settings/requests`.
- Should the now-dead sign-out dialog in `ChatList.tsx` be cleaned up in a
  follow-up task (it needs files outside this task's scope)?

### Security checklist

UI only: no new server route, write, query, secret or log added. The new
`/settings` route sits under `RequireAuth`, so it is covered by the 401 sweep.

### Round (lead fix round, 2026-10-13)

The lead overrode the pre-review's Finding 1. **Install app is a conditional
7th item by lead decision.** (T-0119) It only appears when the browser offers
`beforeinstallprompt` (`installEvent !== null`), and it has no other home on
web, so removing it (the earlier `da4fabe6` fix) left web uninstallable from
the app. I restored the same conditional `<MenuItem>` block, after Settings,
with its `installing` guard and `Install failed — try again` state, and removed
the stale comment claiming the install props were kept only because
`ChatList.tsx` passes them — they are used by the item, as before. The
`onSignOut`/`isServerOwner` note stays, since those two props are still passed
by `ChatList.tsx` and unused here.

Commands (real results):

```
pnpm gate
  gate: 18 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.4s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.6s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/chat-core  (1.1s)
  PASS  tests @zilar/mobile  (1.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
```

### Disagreements

None.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round and 1 lead round; the packet is current for `22c258fe`.**
- **Lead's headless check** (Playwright Chromium, web mock of this branch before the rounds):
  - the rail shows All chats, Personal, AIs and Edit;
  - the menu has the profile row (You, you@zilar.test), Contacts, My AIs, Explore groups, Invite a friend and Settings (badge 1);
  - Settings goes to `/settings`, the hub has the profile card and the Account / AIs and tools / Chats / Server cards with Sign out in red at the bottom;
  - Blocked people's Back goes to `/settings`, and the hub's Back goes to `/`;
  - at 400 px it's one column.
- **Lead's decisions:**
  - Contacts goes to `/settings/contacts`;
  - **Install app stays** as a conditional 7th item: the auto round removed it, and the lead restored it because it has no other home.
- **Follow-up:** the shared row subtitle "Push on this phone…" reads oddly on web. Give each platform its own subtitle.
