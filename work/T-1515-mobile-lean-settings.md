---
id: T-1515
title: "Phone Settings tab, lean (approved canvas, twin of T-1506): no subtitles under rows or the header, the profile card shows the e-mail, no Profile row, no Server group on the phone"
status: merged
milestone: M5
branch: task/T-1515-mobile-lean-settings
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-1515: Phone Settings tab, lean

## Spec (written by Claude, do not edit)

### Why
Julio approved the lean Settings design on 2026-10-15. Read `docs/design/mockups/lean-settings/README.md` and `Phone.dc.html`. Web shipped as T-1506; this is the phone twin.
- **Every row** is an icon tile, a single-line title, an optional count and a chevron. No subtitles, no status words.
- **The groups:**
  - Account: Contact requests, Contacts, Blocked people, Devices, Notifications;
  - AIs and tools: Approvals, Machines, Connections;
  - Chats: Chat folders, Stickers;
  - "Server: Integrations. This group is web only."
- **The profile card** holds the picture, the name, the e-mail and a chevron.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/app/(tabs)/settings.tsx` (254 lines):**
  - `ProfileHeaderCard` shows `@handle`, or the e-mail when there is no handle (`:84-104`);
  - `GroupCard` passes `subtitle={row.subtitle}` to each `ListRow` (`:111-137`);
  - `SettingsScreenShell` has the subtitle "Your account, chats and AIs." (`:207`).
- **`apps/mobile/src/components/settings/screen-shell.tsx`:** `subtitle` is already optional (`:14`, `:44`).
- **`apps/mobile/src/components/settings/hub.ts` (71 lines):** `settingsHubGroups()` (`:64-71`) builds every group from the shared `SETTINGS_ITEMS`. That includes the `profile` row (the card already opens the profile) and the `server` group (`integrations`).
- **The shared order:** `packages/chat-core/src/settings-items.ts` already lists Chat folders before Stickers (T-1506).

### Steps
1. **`settings.tsx`:**
   - drop the shell subtitle;
   - stop passing `subtitle` to the rows;
   - the profile card's second line is the e-mail (`email`), and the handle logic goes.
2. **`hub.ts`:** `settingsHubGroups()` leaves out the `profile` row and the whole `server` group, so the phone shows Account, AIs and tools, and Chats.
3. **The tile size** stays the kit's `IconTile` (34 px with 10). The board draws 30 px.

### Not in scope
- web;
- the screens behind the rows;
- an Approvals count (the phone has no pending-approval count source today).

### Tests
None (UI, CLAUDE.md Hard rules). Keep existing tests passing: if one asserts the profile row or the server group, update it to the new groups.

### Allowed files
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `apps/mobile/src/components/settings/hub.ts`
- any existing test under `apps/mobile/src/components/settings/` that asserts the old groups
- `work/T-1515-mobile-lean-settings.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The Settings tab shows:
  - the title;
  - the profile card with the name and e-mail;
  - Account (5 rows), AIs and tools (3), Chats (Chat folders, then Stickers);
  - Sign out.
- Every row is one line, and the Contact requests count stays.

---

## Report (written by the worker when done)

### What I did

All three spec steps, mobile only.

- `apps/mobile/src/app/(tabs)/settings.tsx`:
  - `SettingsScreenShell` is called as `title="Settings"` only; the subtitle
    `"Your account, chats and AIs."` is gone (was `:207`, now `:205`).
  - `GroupCard` (`:124-131`) no longer passes `subtitle={row.subtitle}` to
    `ListRow`, so every row is a single line. The `requests` count pill is
    untouched.
  - `ProfileHeaderCard` second line is now `{email}` from `profile?.email ??
    me?.email ?? ''` (`:88`, `:101-103`); the `handle` local and the `@handle`
    branch are gone. The name, the picture and the chevron are unchanged.
- `apps/mobile/src/components/settings/hub.ts`:
  - added `PHONE_HIDDEN_ROWS = new Set(['profile'])` and
    `PHONE_HIDDEN_GROUPS = new Set(['server'])` (`:48-49`);
  - `settingsHubGroups()` now filters those out (`:74`), so the phone shows
    Account (Contact requests, Contacts, Blocked people, Devices, Notifications),
    AIs and tools (Approvals, Machines, Connections) and Chats (Chat folders,
    then Stickers). `settingsHubRows()` keeps returning the full shared list.
  - The `server` label entry and the `HUB_ICONS`/`SettingsHubRow.subtitle` fields
    stay: `SETTINGS_ITEMS` is shared and unchanged, and the icon map is typed as
    `Record<SettingsIconId, ...>` (removing an entry would be a type error).
- Tile size: left at the kit's `IconTile` (34 px with a 10 px radius), per the
  mockup README and spec step 3.

No shared registry or web file was touched. No new dependencies.

### Checks run

- `pnpm install` — done, 17.2s, done. Only the pre-existing `@types/react-dom`
  peer warning.
- `pnpm gate` (repo root) — exit 0. Summary:

  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (1.5s)
  PASS  lint  (1.5s)
  PASS  typecheck  (5.9s)
  PASS  effect  (2.0s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

  No single test files were run: grep found no test referencing
  `settingsHubGroups`/`settingsHubRows`, and there is no test under
  `apps/mobile/src/components/settings/` (the old
  `apps/mobile/src/lib/settings-items.test.ts` no longer exists — it moved to web
  in T-1330). `pnpm gate` reported `SKIP tests @zilar/mobile (no nearby test
  files)`. No test asserted the profile row or the server group, so none needed
  updating.

Changed files (`git status`): `apps/mobile/src/app/(tabs)/settings.tsx`,
`apps/mobile/src/components/settings/hub.ts`,
`work/T-1515-mobile-lean-settings.md` — all Allowed.

### Notes for the lead

- `SettingsHubRow.subtitle` and the `${title}: ${subtitle}` accessibility label
  stay, so screen readers still describe the row even though the visible
  subtitle is gone. The spec only asked to stop passing the subtitle through.
- `settingsHubRows()` still returns the full list including `profile` and
  `server`; the hiding is only in `settingsHubGroups()`, matching spec step 2.
  If you prefer `settingsHubRows()` itself to filter, say so and I will move it.
- No deviations from the spec; nothing blocked.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean (0 findings) for head `e73bdbf07`.
- **Phone smoke (mock build, emulator):** `/settings` passed.
  - The screen shows the title only, the profile card with "You" and the e-mail, Account (Contact requests with its count of 2, Contacts, Blocked people, Devices, Notifications), AIs and tools (Approvals, Machines, Connections), then Chats.
  - Every row is one line, and there is no Profile row or Server group.
