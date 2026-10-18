---
id: T-1975
title: "Web Settings › Requests rows get the 36 px avatar like Blocked and Contacts (audit §1.7), name 14/500"
status: merged
milestone: M5
branch: task/T-1975-web-request-row-avatars
model: deepseek/deepseek-flash
effort: default
estimate: 15 min
---

# T-1975: Web request rows with avatars

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "make sure all the ui follows the same style and flow".

The lead's web sweep found the rows on `/settings/requests` without any avatar. Blocked and Contacts show a 36 px avatar, and so do the phone's request rows. The target is in `docs/audit/ui-consistency.md` §1.7 (web: 36 px avatar, title 14/500, subtitle 13).

### Facts (read by the lead on 2026-10-18)
- **The row.** `apps/web/src/routes/RequestsPage.tsx:127-161` is an `<li className="flex flex-wrap items-center gap-3 px-3 py-2.5">`.
  - The name is at `:129`: `text-[15px] font-medium`, followed by `@handle` in muted text.
  - `Waiting for an answer` at 13 px shows for outgoing requests.
  - Accept and Decline are `Button size="sm"` (Cancel for outgoing).
- **The pattern to copy.** `apps/web/src/routes/BlockedPage.tsx:106-112` renders `<EntityAvatar person={{ id: person.jid ?? person.userId, name: person.name, avatarUrl: person.image ?? undefined }} size={36} />` first in the same kind of `li`. The component comes from `apps/web/src/components/EntityAvatar.tsx`.
- **The data.** Read the fields of `request.other` in `RequestsPage.tsx` (at least `name` and `handle`, plus the user id and picture if present).

### Steps
1. **Add the avatar.** Render `EntityAvatar` at 36 px as the first child of the row, built from `request.other` the way Blocked does it. Seed it with the user id, so the colour matches the same person elsewhere. Pass the picture if the request carries one.
2. **Resize the name.** Change it to `text-[14px] font-medium`, per §1.7.
3. **Change nothing else.** No tests (UI). The file stays at or under 400 lines.

### Allowed files
- `apps/web/src/routes/RequestsPage.tsx`
- `work/T-1975-web-request-row-avatars.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The screenshots.** At 1440 and 390 px in the web mock, the lead sees Theo and Nora on `/settings/requests` with 36 px avatars, laid out like the rows on `/settings/blocked`.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

- Added `EntityAvatar` at `size={36}` as the first child of each row in `ContactRow` (`apps/web/src/routes/RequestsPage.tsx`), built from `request.other` exactly like `BlockedPage` builds its rows: `id: request.other.userId` as the seed, `name: request.other.name`, and `avatarUrl: request.other.image ?? undefined`. `ContactRequestPerson` carries `userId`, `name`, `handle` and `image`; there is no `jid`, so the seed is the user id as the spec asks.
- Changed the name from `text-[15px] font-medium` to `text-[14px] font-medium` (§1.7).
- Nothing else changed: handles, `Waiting for an answer` at 13 px, the buttons, `SettingsShell`, spacing and the row markup are untouched.
- Added the `EntityAvatar` import. No tests (UI), no new dependencies.

### Checks run

- `pnpm install`: done, 1155 packages added (one existing peer warning on `apps/mobile` `@types/react-dom`, unrelated).
- `pnpm gate` (repo root), real summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (0.7s)
  PASS  lint  (1.7s)
  PASS  typecheck  (4.6s)
  PASS  effect  (1.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Single test commands: none run, because the gate reports `SKIP tests @zilar/web (no nearby test files)` and this is UI-only.

The 2 changed files are `apps/web/src/routes/RequestsPage.tsx` and this task file; the gate lists no file outside the Allowed files.

### Notes for the lead

- I did not open the web mock or take the 1440/390 px screenshots; the visual acceptance remains for the lead/Julio. The markup and avatar size match `BlockedPage` (`size={36}`, same `li` classes), so the two lists should line up.
- `request.other.image` is currently always `null` from the mock backend's `contactPerson`, so the avatar falls back to the seeded initials/colour for Theo and Nora; the real picture is passed as soon as the API fills it.

## Review (written by Claude)

**Approved and merged.** The pre-review was clean, with 1 follow-up. On `/settings/requests` in the web mock at 390 px (`b617d9c40`), Theo and Nora show 36 px avatars and 14/500 names, the same layout as the Blocked rows.

**Follow-up, not done here:** Blocked's own name size (`BlockedPage.tsx:115`). It's a one-line size change, left for the next web cleanup.
