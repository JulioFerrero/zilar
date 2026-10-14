---
id: T-1352
title: "Refresh docs screenshots and the README/USER_GUIDE text to today's app: fix the shot table (scripts/shots.ts) for routes and setups that changed since 09-30, add shots for new screens, regenerate with pnpm screenshots, and correct stale feature text"
status: merged
milestone: M5
branch: task/T-1352-refresh-screenshots
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1352: Refresh screenshots and docs text

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: "do we need to update the readme? the screencaptures?"
- **The screenshots are stale.** All 17 files in `docs/screenshots/` date from 2026-09-30 (last commit `a5e150116`, T-0107). They're used by `README.md:61-64` and 17 times in `docs/USER_GUIDE.md`.
- **What has changed since:** the rail and menu (T-1330); the `/settings` hub (`apps/web/src/routes/SettingsHubPage.tsx`); orb avatars by name (T-1334); edge-to-edge photos (T-1335); contact requests as chat-list rows (T-1336); the photo viewer on a lightbox (T-1343); dialogs and menus on Base UI (T-1350, T-1349); and the 10-10 simplify, which deleted `packages/agent-drivers`, so check whether `/settings/machines` still makes sense.
- **The tooling:** `pnpm screenshots` (`package.json:27`) runs `scripts/screenshots.ts` (199 lines). It starts the web dev server in `?mock=1` and captures the table in `scripts/shots.ts` (133 lines, shots at `:70-113`).

### What to build
1. **Run `pnpm screenshots` once as is** and note which shots fail or show the wrong thing (routes like `/settings/machines`, ids like `c-devteam-bug` and `c-ana`, and setups like `openChatMenu`, `openNewTopic` and `searchTickets`, which may have changed). Fix `scripts/shots.ts` (and the setups in `scripts/screenshots.ts`) so every shot shows its screen as it is today.
   - **Remove** shots of screens that no longer exist, and their references in the docs.
   - **Add** shots for: the chat list with the contact-request rows (desktop and phone); the `/settings` hub; a chat with an edge-to-edge photo bubble, if the mock can show one (mock images are blank by Julio's decision; if so, skip it and say why); and the open message menu (right-click).
2. **Regenerate** all shots with `pnpm screenshots`, and commit the PNGs. Keep the 16 px gutter and viewport sizes as the table has them.
3. **Text:**
   - In `README.md` and `docs/USER_GUIDE.md`, fix every sentence and image reference that no longer matches the app. Verify each claim against the code and cite `file:line` in the Report.
   - **Don't add marketing text**, and don't list UI libraries in the README.
   - The README's status table (`:121` area) may stay as is unless something in it is now wrong.
4. **No tests.** Every source file stays at most 400 lines.

### Read first
`AGENTS.md`, `scripts/screenshots.ts`, `scripts/shots.ts`, `README.md`, `docs/USER_GUIDE.md`, `apps/web/src/routes/AppRoutes.tsx`.

### Allowed files
`scripts/screenshots.ts`, `scripts/shots.ts`, `docs/screenshots/*.png`, `README.md`, `docs/USER_GUIDE.md`, `work/T-1352-refresh-screenshots.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `pnpm screenshots` runs clean.
- Every image the README and USER_GUIDE reference exists and shows today's UI.
- The gate passes.
- **The lead looks at every PNG.**

---

## Report (written by the worker when done)

**Status: review.** All 19 shots regenerate clean with `pnpm screenshots`, the gate passes, and every image the README/USER_GUIDE reference exists and shows today's UI.

### What the baseline run showed
`pnpm screenshots` (as is) captured 7 shots and then failed:

- `locator.click: Timeout … waiting for getByRole('button', { name: 'Chat menu' })` at `scripts/screenshots.ts:96` on `prefs-desktop.png`.
- Cause: every chat id in the old table was the pre-unification web id (`c-ana`, `c-devteam-bug`, `c-qa`, `c-devai`). The unified mock seeds chats by bare JID (`packages/mock-backend/src/domains/chats/seed.ts:14-91`, `.../topics/seed.ts:16-150`) and the route is `/c/<encodeURIComponent(chatJid)>` (`apps/web/src/components/ChatListItem.tsx:102`), so those paths fell through to "no chat selected".
- `signin-desktop.png` also "succeeded" but showed the wrong thing: mock mode always reports an authenticated viewer (`apps/web/src/auth/AuthProvider.tsx:252-260`), and `LoginPage.tsx:24-26` redirects a signed-in person home, so `/login?mock=1` screenshotted the chat list. (The old on-disk PNG was also stale: it read "Sign in to Galena".)

### Shot table and setups (`scripts/shots.ts`, `scripts/screenshots.ts`)
- All chat paths now use the mock bare JIDs, URL-encoded exactly like the app's own links: `/c/ana%40zilar.test`, `/c/qa%40rooms.zilar.test`, `/c/ai-dev-1%40zilar.test`; the topic shots use the Dev team General topic `/c/dev-team%40rooms.zilar.test` (see the fix round below). `/settings/machines` is unchanged: the route still exists (`AppRoutes.tsx:173-180`) and is still linked from the hub (`components/settings/hub/rows.ts:37`), so the shot stays.
- Added shots: `settings-desktop.png` (`/settings` hub, `routes/SettingsHubPage.tsx`) and `messagemenu-desktop.png` (right-click message menu, `components/MessageBubble.tsx:191-199`).
- New setups: `openMessageMenu` (right-clicks the newest `[data-message-id]`), `waitPins` (waits for `[aria-label^="Jump to pinned message"]`; the pins load over the mock API after the chat opens and the old `none` setup raced and sometimes missed the banner), and `searchMessages`.
- `searchTickets` → `searchMessages`: the old query `tickets` (7 chars) also drives the People search, which the mock backend does not serve (`apps/web/src/lib/api/people.ts:60` calls `/users/search`; `contact-requests/routes.ts:46-55` only serves `/users/by-handle/:handle`), so the shot painted a mock-only "Could not search. Try again." The setup now types a two-letter query (`ti`), below the people-search minimum of 3 (`usePeopleSearch.ts:7`), so the shot shows the chat-name and Messages results cleanly. Query text is arbitrary; say the word and I'll switch it back and accept the mock error line.
- `openNewTopic`: the row's "New topic in Dev team" button is hover-only and the group header button sits over it, so a normal click never lands. The setup now dispatches the click directly (same trick as `openToolDetail`).
- `/login` is special-cased in `capture`: it skips `?mock=1` and stubs `/api/**` with 401 locally, so the live auth path renders the real "Sign in to Zilar" form. The route predicate matches only pathnames starting `/api/` — a `**/api/**` glob also swallowed the dev server's own `/src/lib/api/*.ts` module requests and blanked the page.
- **Skipped the edge-to-edge photo shot, as the spec allows.** Mock photos are inline `data:` SVGs (`packages/mock-backend/src/domains/messages/builders.ts:38-67`) on an untrusted host, so `sanitizeIncomingAttachment` (`packages/chat-core/src/media.ts:146-176`, called at `packages/client-core/src/store/ledger-incoming.ts:195`) downgrades every mock image to a file card. The mock backend is outside this task's Allowed files, so no shot can show a photo bubble today (visible in `chat-phone.png` / `search-desktop.png` as "Stage.png 0 B PNG").
- Kept the 16 px gutter note and every viewport as the table had them (`DESKTOP` 1440×900, `PHONE` 390×844).

### Docs text
`docs/USER_GUIDE.md`:
- Sign out is in **Settings**, not the menu (`SettingsHubPage.tsx:120-127`); the menu dropped it (`chatList/ChatListMenu.tsx:122-130`).
- The list filter is the left rail (`components/FolderRail.tsx:26-43`) / phone chips (`FolderTabs.tsx:18-26`) reading **All chats**, **Personal**, **AIs** from the seeded folders (`packages/mock-backend/src/domains/chat-folders/seed.ts:20-44`) — there is no **Work** tab.
- **New chat** now offers group / channel / Explore groups / New message / New AI / New topic (`NewChatButton.tsx:170-189`).
- The phone DM caption no longer says "an image": the mock shows that photo as a file card (see above).
- Keys/Approvals/Machines moved from "in the menu" to **Settings → …** (`components/settings/hub/rows.ts:29-42`).
- Adding a contact is by @username via the search / a share link, then **Add contact** (`PeopleSearchResult.tsx:87`, `AddContactDialog.tsx:87`, `ContactProfileRow.tsx:209-218`) — not "in the chat-list menu / + new chat menu / empty state". The share link button is **Add contact**, not "Send request".
- The chat-row menu has more than "three per-user settings" (`ChatActionsMenu.tsx:86-196`): Pin, Mute…, Archive chat, Mark as read/unread, plus Clear history in a DM.
- Chat folders open from the rail's **Edit** key (`FolderRail.tsx:137`), Machines from **Settings → Machines**.
- Added image references: `settings-desktop.png`, `messagemenu-desktop.png`, and `topics-desktop.png` again in the contacts section (caption says the request rows sit at the top).

`README.md`: reviewed against the code and **left unchanged**. Its "See it" images all exist, and nothing in it names the rail, the menu, or a settings route, so no sentence there is now false (the M5 status row at :121 is still accurate; the task allowed it to stay).

### Commands and results
- `pnpm install` — Done in 14.8 s (pnpm 10.32.1); one pre-existing `@types/react-dom` peer warning in `apps/mobile`, unrelated.
- `pnpm screenshots` (baseline) — captured 7, then `TimeoutError` on `Chat menu` (`c-ana` id, above).
- `pnpm screenshots` (after id/setup fixes) — failed on `openNewTopic` (button covered), then on the photo selector before that shot was removed.
- `pnpm screenshots` (first pass) — `captured …` × 21 and `All 21 screenshots are under 400 KB.`
- `pnpm gate` (first pass):
  ```
  gate: 25 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (1.4s)
  PASS  effect  (0.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- I fixed formatting of `scripts/shots.ts` with `pnpm exec prettier --write` on my changed files only, before the gate. No tests were run: no test file or package source changed (scripts + docs only).

### Lead fix round (after the lead looked at all 21 PNGs)
1. **Duplicate shots dropped.** `requests-desktop/phone.png` were byte-identical to `topics-desktop/phone.png`, so I removed both entries from `scripts/shots.ts`, deleted the two PNGs (`git rm`), and the contacts image in `docs/USER_GUIDE.md:121` now points at `topics-desktop.png` with the caption "The chat list with contact requests at the top".
2. **Empty topic fixed.** The bug topic rendered "No messages yet" because `seedMessages` builds the message table only from `messageSeeds` (`packages/mock-backend/src/domains/messages/seed.ts:46-54`), whose keys (`packages/mock-backend/src/domains/messages/threads/index.ts:19-32`) are DMs and group-room JIDs only — there is no topic JID such as `t-devteam-bug@rooms.zilar.test`, and `loadHistory` reads `data.messages[chatJid] ?? []` (`packages/mock-backend/src/xmpp/core.ts:224-227`). The only seeded topics with history are the group **General** topics, whose `chatJid` is the group room JID (`packages/mock-backend/src/domains/topics/seed.ts:16-35`). So `topic-desktop.png` and `topic-phone.png` now use `/c/dev-team%40rooms.zilar.test` (Dev team General), which has the full group thread and the task strip (`Dev team › General`, `GENERAL · Open · No owner · Add link`). No non-General seeded topic has messages, so the type chip in these shots reads `GENERAL`, not `BUG` — no mock change was made (out of Allowed files).
3. **Text caret removed.** `openToolDetail` and `openRoutines` now blur the focused element (`page.evaluate(() => document.activeElement?.blur())`) after they click/scroll, so `tools-desktop.png` and `routines-desktop.png` show "Dev team › Checkout button hi…" with no caret.
4. **Not changed (app bug, filed separately):** the "Messages" label overlapping the Marketing AI avatar in `search-desktop.png` / `search-phone.png`; both shots are unchanged from the lead's view.

Fix-round commands:
- `pnpm screenshots` — `captured …` × 19 and `All 19 screenshots are under 400 KB.` (verified no two PNGs share an md5).
- `pnpm gate` — `gate: 25 changed file(s) against main`, then `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`, `GATE PASS`.

### Files changed
`scripts/shots.ts`, `scripts/screenshots.ts`, `docs/USER_GUIDE.md`, the refreshed PNGs plus the new `settings-desktop.png` and `messagemenu-desktop.png` (19 total; `requests-desktop.png` and `requests-phone.png` were removed in the fix round), and this task file. `README.md` unchanged.

### Problems / deviations / open questions
- **No photo shot** (allowed by the spec) for the trust-check reason above.
- **Open question:** the mock has no people-search route, so a 3+ character search always shows "Could not search. Try again." I worked around it in the shot; fixing the mock route is a separate task (and outside Allowed files).
- **Topic shots use a General topic** for the reason in the fix round: no non-General seeded topic has messages.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean; the packet is current for `9f7f7b3c` after 2 lead rounds.**
- **Round 1:** dropped the duplicate `requests-*` shots, moved the topic shots to a seeded topic with history, and blurred the panel-title caret.
- **Round 2:** regenerated on top of T-1353.
- **Lead's review:** looked at every PNG (19 files), all of today's UI. Every image `README.md` and `docs/USER_GUIDE.md` reference exists. The search-overlap bug these shots exposed was fixed in T-1353.
