---
id: T-1308
title: "Mobile: chat header title and status centred on the avatar; the contact profile page rebuilt Telegram-style (big centred photo, name + status, round action buttons, info section, shared media, Block in red)"
status: merged
milestone: M5
branch: task/T-1308-mobile-header-profile
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1308: Chat header alignment and a Telegram-style profile page (mobile)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, on the emulator:
- **The header:** the "Julio" and "online" lines aren't aligned with the avatar. The lead measured on the live release APK (1080×2400): the back button spans y 166–271 (centre about 218), the name and status block spans y 136–235 (centre about 185), so the text sits about 33 px (≈11 dp) too high. Files: `apps/mobile/src/components/chat/chat-header.tsx` (183 lines), `apps/mobile/src/components/chat/chat-header-bar.tsx` (42 lines).
- **The profile:** "when you click the profile page is horrible, needs to be more like Telegram". Today `apps/mobile/src/app/u/[handle].tsx` (295 lines) is one small card: avatar, name and handle, "You are already contacts.", a Message button and a plain "Block" link.

### What to build
1. **Header:** the title (name) and subtitle (status) are vertically centred on the avatar and the header buttons, so all of them share one centre line. Check the group header too (`apps/mobile/src/components/chat/group-header.tsx`) and align it the same way.
2. **Profile page** (contact and stranger), Telegram-style, using the existing theme tokens and lucide icons (no emoji):
   - a large centred avatar (about 96–112 dp), the name below it (large, semibold), and under it the status ("online" / "last seen …", from the same source the chat header uses) or the @handle;
   - a row of round action buttons with icon and label under each:
     - Message (opens the DM; keep T-1288's `resolveDmChatId` path);
     - Mute (the existing mute action, if the DM exists);
     - Search (opens in-chat search, if the DM exists);
     - for a stranger, the primary action is "Add contact" or "Send request", reusing today's logic;
   - an info section, a grouped list: "@handle" (Copy username on tap, with the existing toast if there is one), "Bio" (if any);
   - a "Shared media" row that opens the existing shared media screen for the DM, if one exists (cite it); otherwise leave it out;
   - Block or Unblock at the bottom, in the destructive red token, with the existing confirm.
   - Split the page into small components under `apps/mobile/src/components/profile/` so every file stays at most 400 lines.
3. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/components/chat/chat-header.tsx`, `apps/mobile/src/components/chat/chat-header-bar.tsx`, `apps/mobile/src/components/chat/group-header.tsx`, `apps/mobile/src/components/profile/` (list it), and `apps/mobile/src/lib/colors.ts`.

### Allowed files
`apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/components/profile/**/*.tsx`, `apps/mobile/src/components/profile/**/*.ts`, `apps/mobile/src/components/chat/chat-header.tsx`, `apps/mobile/src/components/chat/chat-header-bar.tsx`, `apps/mobile/src/components/chat/group-header.tsx`, `work/T-1308-mobile-header-profile.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator:** the header text is centred on the avatar (bounds checked with `uiautomator`), and the profile page shows the photo, name, status, the action row, info and Block.

---

## Report (written by the worker when done)

### What I did

**Header alignment (chat + group).**
- `apps/mobile/src/components/chat/chat-header.tsx`: the title wrapper already had
  `flex-1`, so it stretched to the full header height and its two text lines sat at the
  **top**, ~11 dp above the centred back button/avatar (matches the lead's measure:
  back centre ≈ 218, text block centre ≈ 185 on a 1080×2400 APK). Added `justify-center`
  to the title wrapper and to the three Pressable wrappers (topic info / group / DM
  profile), and gave the name (`leading-5`), subtitle and topic line (`leading-4`)
  explicit line heights so the block centres cleanly. Every element in the
  `h-16 flex-row items-center` row now shares one centre line.
- `apps/mobile/src/components/chat/group-header.tsx`: same change to the title wrapper
  (`justify-center` + `leading-5`/`leading-4`).

**Profile page, rebuilt Telegram-style** (contact, stranger, pending, blocked, self):
- New `apps/mobile/src/components/profile/` files, each well under 400 lines:
  - `profile-header.tsx` — large centred avatar (104 dp, `profile.image` with the ball
    fallback), name (22/600) and the status under it (`online` / `last seen …` from
    `chatSubtitle`, the same source the chat header uses), with the green dot when online;
    the status falls back to `@handle` when no DM exists (stranger).
  - `profile-actions.tsx` — the round action row (icon in a circle + label under it).
  - `profile-info.tsx` — the grouped info card: `@handle` (tap copies `@handle`, the app's
    `Toast` confirms "Username copied") and `Bio` when the server sends one.
  - `profile-block.tsx` — Block at the bottom in the destructive token, reusing the
    existing inline confirm (`shouldResetBlockConfirm` from the add-contact card);
    Unblock (outline) for a blocked profile; hidden for `self`.
  - `profile-person.ts` — `ProfilePerson = HandleProfile & { bio?: string }` (see deviation 4).
- `apps/mobile/src/app/u/[handle].tsx`: keeps all existing logic (lookup with 404/missing/
  error/retry, send, cancel/accept/decline via `actOnProfileRequest`, block/unblock) and now
  composes the components above. Added:
  - Message → the existing `openMessage` / `resolveDmChatId` path (T-1288);
  - Mute/Unmute → the row swipe's mute action (`setChatPref` + `mutedUntilFor('forever')`,
    or `mutedUntil: null`), shown only when the DM exists;
  - Search → in-chat search, the same route the chat header uses
    (`router.push({ pathname: '/', params: { searchChat: dmChatId } })`), only when the DM exists;
  - stranger → "Send request" (existing `sendContactRequest`); pending → Cancel;
    request received → Accept / Decline / Requests (the old card's links screen).
  - The DM is resolved with the existing `resolveDmChatId` against the contacts list.

### Files changed
- `apps/mobile/src/components/chat/chat-header.tsx`
- `apps/mobile/src/components/chat/group-header.tsx`
- `apps/mobile/src/app/u/[handle].tsx`
- `apps/mobile/src/components/profile/profile-header.tsx` (new)
- `apps/mobile/src/components/profile/profile-actions.tsx` (new)
- `apps/mobile/src/components/profile/profile-info.tsx` (new)
- `apps/mobile/src/components/profile/profile-block.tsx` (new)
- `apps/mobile/src/components/profile/profile-person.ts` (new)
- `work/T-1308-mobile-header-profile.md`

### Commands and results
- `pnpm install` — done.
- `pnpm gate` (first run): `FAIL format` on `apps/mobile/src/app/u/[handle].tsx`
  (prettier). Fixed with `pnpm exec prettier --write` on the new/changed profile files,
  then re-ran.
- `pnpm gate` (final):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/mobile  (1.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Single test files run while working: **none** — this is UI-only (the spec says no tests),
  and there are no test files next to the changed files. The gate's `tests @zilar/mobile`
  step ran the nearest mobile tests.

### Deviations from the spec (and why)
1. **"Shared media" row left out.** The spec allows this ("otherwise leave it out").
   Shared media today is the in-chat `MediaSheet` **bottom sheet**
   (`apps/mobile/src/components/chat/media-sheet.tsx`), opened from the chat header via
   `setMediaOpen(true)` (`chat-overlays.tsx:48`); there is no shared-media screen/route.
   Opening it from the profile would need a route/param in the chat screen
   (`app/chat/[id].tsx`, `use-chat-screen.ts`), which are **outside the Allowed files**, and
   its `onJump` needs the message list only the chat screen owns.
2. **Mute reuses the row swipe's action, not the durations submenu.** A single round button
   cannot host the mute submenu; the pref write is the existing one
   (`chat-row-swipe.tsx:82-88`: mute forever / unmute), so it is literally the existing
   mute action.
3. **`Bio` needs a widened type.** The by-handle response carries `bio`
   (`apps/server/src/contacts/reads.ts` → `profileForHandle`, contract
   `HandleProfile.bio`), but the phone's `apps/mobile/src/lib/contacts-api.ts`
   `HandleProfile` narrows it out, and that file is outside the Allowed files. The screen
   widens it locally as `ProfilePerson = HandleProfile & { bio?: string }` (no `any`).
4. The avatar now uses the lookup `image` (the person's photo) instead of always drawing the
   ball; the ball stays as the fallback.
5. `request_received` keeps Accept/Decline and adds a "Requests" action to preserve the old
   card's link to `/settings/requests`.

### Security checklist
- No new routes/writes beyond the existing contact/block/pref APIs; no secrets logged;
  no `where` scoping or caps touched. UI-only.

### Open questions
- None blocking. The only judgement calls are deviations 1–2 above.

### Round (prereview fix)

- **Finding 1 (must-fix) — fixed.** `apps/mobile/src/app/u/[handle].tsx` was 509 lines,
  over the spec's 400-line limit, and the Report never disclosed it. Moved `buildActions`
  (now exported) into `apps/mobile/src/components/profile/profile-actions.tsx`, and the DM
  handlers (`openMessage`, `toggleMute`, `openSearch`, `copyUsername`) plus the DM-derived
  `dmChatId` / `muted` / `status` / `online` into the new hook
  `apps/mobile/src/components/profile/use-profile-dm.ts`. The screen is now **333 lines**.
  No behaviour change: same `resolveDmChatId` path, same `setChatPref` mute write, same
  clipboard toast, same header status source.
- **Finding 2 (nit) — not touched.** `profile-info.tsx` is not a line I changed this round;
  per the fix-round rule, nits in untouched lines are left alone.
- **Follow-up 1 — not touched.** The mobile `HandleProfile.bio` fix belongs in
  `apps/mobile/src/lib/contacts-api.ts`, outside the Allowed files.
- **Disagreements:** none.

Tests: none added. The spec says UI gets no tests and this is a pure component/hook
extraction with no behaviour change; the finding named no test.

Commands (this round):
- `pnpm gate` —
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.4s)
  PASS  lint  (0.6s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/mobile  (1.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Single test files run while working: **none** — UI-only.

Files changed this round:
- `apps/mobile/src/app/u/[handle].tsx`
- `apps/mobile/src/components/profile/profile-actions.tsx`
- `apps/mobile/src/components/profile/use-profile-dm.ts` (new)
- `work/T-1308-mobile-header-profile.md`


## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (the profile screen shrunk to 400 lines; 2 nits, 1 follow-up).**
- **Header (emulator mock, Marta):** the text block spans y 171–266, centre 218.5, the same as the back button (166–271). Before, it sat 33 px high.
- **Profile** (`zilar://u/marta`, mock resolves it as a stranger): a large centred photo, the name and @handle, a round "Send request" action, a Username row with copy, and Block in red.
  - **Still to check live:** the contact version (Message, Mute, Search), on Julio's profile after the merge.
- **Lead's checks after the rebase:** mobile tsc: 0 errors; the largest file is `app/u/[handle].tsx` at 333 lines.
- **Follow-up F-1:** `HandleProfile` drops `bio` (`apps/mobile/src/lib/contacts-api.ts:23-29`).
- **Note:** in mock, contacts have no handle, so the header's profile link doesn't show (`chat-header.tsx`, `dmHandle`); this predates the task.
