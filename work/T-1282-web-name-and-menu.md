---
id: T-1282
title: "WUX-38 + WUX-10: the web Profile page edits the display name; the hamburger menu gets icons, sections and a Settings entry"
status: merged
milestone: M5
branch: task/T-1282-web-name-and-menu
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1282: Display name in Profile; a clearer menu (web)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md`:
- **WUX-38** (P2, `:135`): the display name can't be changed after onboarding. `updateMe` is called only in `NamePage.tsx`, and `apps/web/src/components/ProfileSettingsSection.tsx` (301 lines) edits only the handle and the picture.
- **WUX-10** (P2, `:133`, and the summary at `:22`): the hamburger menu (`apps/web/src/components/chatList/ChatListMenu.tsx`) is 15 flat entries with no icons, no sections and no "Settings".

**First recheck both findings on main** (the code has moved since the audit). If one is already fixed, say so in the Report with `file:line` and skip it.

### What to build
1. **Name:** a Name field in `ProfileSettingsSection.tsx`, above the username:
   - trimmed, 1 to 64 characters (use the server's limit if it has one; cite it);
   - saves through the same `updateMe` call `NamePage` uses, and updates the store's display name so the UI changes at once;
   - the same Save, error and "Saved." pattern the bio uses.
   - If the file would pass 400 lines, put the field in a new `apps/web/src/components/ProfileNameField.tsx`.
2. **Menu:**
   - a lucide icon on every entry, the entries grouped into a few sections with dividers (for example: chats and people, AI, account and settings);
   - a "Settings" entry that opens the existing settings route (cite it);
   - keep every entry that's there today, and their order inside each section.
3. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (`:133-136`), `apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/chatList/ChatListMenu.tsx` and the web `NamePage` (find it).

### Allowed files
`apps/web/src/components/ProfileSettingsSection.tsx`, `apps/web/src/components/ProfileNameField.tsx`, `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/lib/api.ts`, `apps/web/src/store/**/*.ts`, `work/T-1282-web-name-and-menu.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:** change the name in Profile and it shows in the UI; the menu shows icons, sections and Settings.

---

## Report (written by the worker when done)

### Recheck on this branch (before the change)
Both findings still present, so both were fixed:
- **WUX-38** still open: `updateMe` was called only in `apps/web/src/routes/NamePage.tsx:23`; `ProfileSettingsSection.tsx` edited only the handle and the bio. (grep for `updateMe` finds `lib/api/chats.ts:66`, `lib/api.ts:74`, `routes/NamePage.tsx` only.)
- **WUX-10** still open: `apps/web/src/components/chatList/ChatListMenu.tsx` was a flat list of `MenuItem`s with no icons, no dividers and no "Settings" (the code had moved since the audit: `Contacts`, `Devices` and `My AIs` were already entries, so 17 today).

### What I did
**Name (WUX-38).** Added a `Name` `TextInput` above the `@username` field in `ProfileSettingsSection.tsx`, with the same Save / error / "Saved." pattern the bio uses (one shared `useAction`; the Save button is disabled when nothing changed). The field is trimmed and capped at the server's limit — **1..64 characters**, from `packages/api-contract/src/auth.ts:27-37` (`AuthDisplayName`, `isMaxLength(64)`) and enforced in `apps/server/src/auth/api.ts:91` ("name must be at most 64 characters"); `maxLength={64}` on the input and a local "Enter your name" guard when cleared. Saving calls `updateMe(name)` — the same call `NamePage` uses (`apps/web/src/lib/api/chats.ts:66`, which trims) — then `auth.refetch()`. When the name and the bio are saved together, the bio `PATCH /me` sends the new name (it requires a name), so a bio-only save can no longer revert a rename. On success it also updates the store's own display name via `storeApi.setState` (`me.name`), as the spec asks, and seeds the input from `GET /me` on remount so the value survives without a session (the web mock's `AuthProvider` returns a fixed "You" and a no-op `refetch`). I also reworded the generic save error from "Could not save your username…" to "Could not save your changes…" since the action now covers the name too.
The file is 358 lines, under the 400-line threshold, so the field stayed inline (no `ProfileNameField.tsx`).

**Menu (WUX-10).** Every entry now has a lucide icon (`MenuItem` already supported `icon`). The entries keep their existing wording, badges and handlers, and are grouped into three sections separated by `aria-hidden` dividers (`MenuDivider`): *chats and people* (Invite, Requests, Chat folders, Blocked people, Contacts, Explore groups, Stickers), *AIs* (Connections, Machines, Approvals, My AIs, Integrations), *account* (Devices, Profile, Notifications, Install app, Settings, Sign out). Within each section the original order is preserved. Added the missing **Settings** entry.

### Files changed
- `apps/web/src/components/ProfileSettingsSection.tsx`
- `apps/web/src/components/chatList/ChatListMenu.tsx`
- `work/T-1282-web-name-and-menu.md` (status/Report)

No change was needed in `apps/web/src/lib/api.ts` (`updateMe` is already exported) or in `apps/web/src/store/**` (the store update uses the existing `StoreApi.setState`, the same pattern `AiPanel.tsx` / `AiDangerZone.tsx` use).

### Commands run (real results)
- `pnpm install` → done, 1181 packages, one pre-existing peer warning on `@types/react-dom` in `apps/mobile`.
- Single test files: none — the gate reports "no nearby test files" for `@zilar/web` and the spec says UI gets no tests.
- `pnpm gate` (repo root) →
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (3.1s)
  PASS  format  (1.0s)
  PASS  lint  (2.0s)
  PASS  typecheck  (11.0s)
  PASS  effect  (2.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations / open questions
- **Settings target.** The spec says the Settings entry opens "the existing settings route". Web has **no `/settings` hub**: `AppRoutes.tsx` lists only leaf routes (`/settings/profile`, `/settings/notifications`, …) and the catch-all redirects `/settings` to `/`. The closest existing settings route is the account page, so Settings opens **`/settings/profile`** (`apps/web/src/routes/AppRoutes.tsx:196-203`). That duplicates the existing Profile entry; if a real settings hub is intended (mobile has one at `/settings`), say so and I will point it there — it would need a route that does not exist today and is outside the Allowed files.
- The name is only editable in the profile mock; the web mock's `AuthProvider` keeps a fixed user, so the change is shown in the field/store at once and persists across in-session navigation, but a full mock reload reseeds it.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit).**
- **Lead's check on the web mock:**
  - the hamburger menu has icons and three sections (people and chats; AI and tools; account), plus Settings;
  - Profile has a Name field, and renaming to "Ada L" saves with "Saved.".
- **Nit, accepted:** Settings and Profile both open `/settings/profile`, because there's no settings hub. A hub is a later product call.
- **Lead's checks after the rebase:** web tsc: 0 errors. The files are 358 and 207 lines.
