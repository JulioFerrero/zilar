---
id: T-1506
title: "Web Settings home, lean (approved canvas): no subtitles under rows or the header, the profile card shows the e-mail, Chat folders before Stickers"
status: merged
milestone: M5
branch: task/T-1506-web-lean-settings
model: auto
effort: default
depends_on: [T-1503]
estimate: 0.25 day
---

# T-1506: Web Settings home, lean

## Spec (written by Claude, do not edit)

### Why
Julio approved the lean Settings design on 2026-10-15 ("the lean settings also looks good no changes"). The boards and README are in `docs/design/mockups/lean-settings/`; read the README first. The rules:
- every row is an icon tile, a single-line title, an optional count pill and a chevron;
- **no descriptions or subtitles under any row**, and no status words.

The groups are:
- **Account:** Contact requests, Contacts, Blocked people, Devices, Notifications;
- **AIs and tools:** Approvals, Machines, Connections;
- **Chats:** Chat folders, Stickers;
- **Server:** Integrations (web only);
- then a red Sign out.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/routes/SettingsHubPage.tsx` (143 lines):**
  - `SettingsShell` has the subtitle "Your account, chats and AIs." (`:66-70`);
  - the profile card shows `@handle`, or the e-mail while there is no handle (`:43-46`, `:74-87`);
  - every `ListRow` gets `subtitle={row.subtitle}` (`:107-115`).
- **The shared list:** `packages/chat-core/src/settings-items.ts` (132 lines) is the list both apps read, in array order. The `stickers` item (`:82-88`) comes before `folders` (`:114-120`), so the Chats card shows Stickers first.
- **`SettingsShell`:** T-1503 (this task depends on it) makes `subtitle` optional in `apps/web/src/components/SettingsShell.tsx`.
- **`ListRow`:** the tile size is the kit's (`apps/web/src/components/ui/list-row.tsx:39`, 32 px). The boards draw 28 px tiles; keep the kit's.

### Steps
1. **`apps/web/src/routes/SettingsHubPage.tsx`:**
   - drop the `SettingsShell` subtitle;
   - stop passing `subtitle` to the rows;
   - the profile card's second line is the user's e-mail (`user.email`), with the name above it and the chevron as today. Remove the handle logic.
2. **`packages/chat-core/src/settings-items.ts`:** move the `folders` item before `stickers`, so both apps list Chat folders, then Stickers. Change nothing else; the `subtitle` field stays in the type, because the mobile app still reads it until its twin task.

### Not in scope
- the mobile Settings tab (its own task);
- the pages behind the rows.

### Tests
None (UI, CLAUDE.md Hard rules).

### Allowed files
- `apps/web/src/routes/SettingsHubPage.tsx`
- `packages/chat-core/src/settings-items.ts`
- `work/T-1506-web-lean-settings.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `/settings?mock=1` at 1280 and 390 px:
  - the title only;
  - the profile card shows the name and e-mail;
  - Account, AIs and tools, Chats (Chat folders, then Stickers) and Server, each row one line;
  - the count pills as before, and Sign out.
- No text under any row.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/routes/SettingsHubPage.tsx`:
  - dropped the `SettingsShell` `subtitle` ("Your account, chats and AIs."); the shell now gets `title` and `onBack` only;
  - stopped passing `subtitle={row.subtitle}` to `ListRow`;
  - the profile card's second line is now `user.email`, with `user.name` above it and the chevron unchanged; removed the `handle`/`secondary` logic.
  - hid the `profile` row from the grouped cards in the same `.map(...).filter(...)` that hides `integrations` for non-owners: the profile card above already opens `/settings/profile`, and the approved Account group is Contact requests, Contacts, Blocked people, Devices, Notifications (no Profile row). `packages/chat-core/src/settings-items.ts` still carries the item for mobile.
- `packages/chat-core/src/settings-items.ts`: moved the `folders` block so it comes immediately before `stickers`, so both apps list **Chat folders, then Stickers**. Nothing else changed; the `subtitle` field stays in the type for mobile.

### Checks run
- `pnpm install`: done (14.9s), peer-dependency warning in `apps/mobile` (@types/react-dom wanting @types/react ^19.3.0, found 19.2.18) — pre-existing, unrelated to this task.
- No single test files: the change is UI plus a shared constant-order edit, and no test in the repo references `SETTINGS_ITEMS`, the hub rows or `SettingsHubPage` (grep found none). Spec says "Tests: None (UI)".
- `pnpm gate` (from repo root), summary:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.8s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/chat-core  (1.4s)
  SKIP tests @zilar/web (no nearby test files)
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- **Scope line on gate is not mine.** `pnpm gate` passed but its scope line lists 3 files outside the Allowed files:
  ```
  scope: 3 file(s) outside the Allowed files:
    docs/design/mockups/lean-settings/Main.dc.html
    docs/design/mockups/lean-settings/Phone.dc.html
    docs/design/mockups/lean-settings/README.md
  ```
  These are the approved boards **you committed earlier on this branch** (commit `272213a37 T-1506: approved lean Settings boards`), so the diff is measured against `main`. My working-tree changes are exactly the three Allowed files (`git status --porcelain` shows only `apps/web/src/routes/SettingsHubPage.tsx`, `packages/chat-core/src/settings-items.ts`, `work/T-1506-web-lean-settings.md`). I left the boards untouched.
- I did not run a browser smoke at 1280/390 px: standing up a dev server needs a background process, which the rules forbid. Verified by code inspection only; the acceptance screenshot check is yours/Julio's.
- `user.email` is rendered directly inside the `user !== undefined` guard; `typecheck` passes, and React renders an empty string if the email is ever missing.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with 1 nit, for head `e02129ac1`, after one lead fix round that hid the Profile row (the card opens it).
- **Headless check (mock, dark, 1280 and 390 px):**
  - the title only;
  - the profile card shows "You" and the e-mail;
  - Account (Contact requests 2, Contacts, Blocked people, Devices, Notifications), AIs and tools (Approvals 1, Machines, Connections), Chats (Chat folders, Stickers), Server (Integrations), Sign out;
  - one line per row, no horizontal scroll, 0 page errors.
- **Carried:** the lean Settings boards and README in `docs/design/mockups/lean-settings/`.
