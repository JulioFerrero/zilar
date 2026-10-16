---
id: T-1719
title: "Web Settings › Routines (approved board WebRoutinesList): a Routines row with a running-count pill under 'AIs and tools', and /settings/routines listing every routine of my AIs in Running and Paused groups — AI picture, title with status dot, schedule · AI · chat, an Ask key (opens that chat) and Pause/Resume; row click reveals Delete. Server adds chatJid to GET /api/routines"
status: merged
milestone: M5
branch: task/T-1719-web-routines-page
model: auto
effort: default
depends_on: [T-1717]
estimate: 60 min
---

# T-1719: Web Settings › Routines

## Spec (written by Claude, do not edit)

### Why
Julio approved the Settings › Routines page on 2026-10-16 ("Build as drawn"). The web board is `docs/design/mockups/routines/WebRoutinesList.dc.html`; read it (`git show main:docs/design/mockups/routines/WebRoutinesList.dc.html`) and its README in the same folder before coding. T-1717 added `GET /api/routines` (`listMine`).

### Facts (the lead read them on 2026-10-16)
- **The read:** `listMine` is in `packages/api-contract/src/routines.ts`, as `MyRoutine` = `Routine` plus `aiName`, `aiAvatarUrl?` and `chatName`. The server side is `apps/server/src/routines/reads.ts` (`listMyRoutines`, 204 lines) and the handler in `apps/server/src/routines/api.ts`. It's mounted in `apps/server/src/app/routes-ai.ts:65` as `createRoutinesApi({ ...base, audit })`, where `config` is in scope (`:23`).
- **A room JID** is `${roomLocalpart}@${mucDomain}` lowercased (`apps/server/src/groups/delete-group.ts:31-33`, and `apps/server/src/topics/views.ts`), with `mucDomain = config.xmpp.mucDomain`. An AI's DM chat is the AI's `jid` (the `ais.jid` column).
- **The shared settings rows:** `SETTINGS_ITEMS` in `packages/chat-core/src/settings-items.ts` (132 lines). `approvals` is at `:49-56` and `machines` at `:57-64`, both `group: 'ais'`. Each item has `id`, `title`, `subtitle`, `icon` and `href`.
  - Adding an `icon` id widens `SettingsIconId`, so both icon maps must gain it: web `SETTINGS_HUB_ICONS` (`apps/web/src/components/settings/hub/rows.ts:46-59`) and the phone map (`apps/mobile/src/app/(tabs)/settings.tsx:58`, `approvals: ShieldCheck`).
  - Web only shows hrefs listed in `WEB_SETTINGS_HREFS` (`rows.ts:30-43`).
- **The model page:** `apps/web/src/routes/ApprovalsPage.tsx` (190 lines). It uses `SettingsShell` and `useQuery(() => fromApi(() => listApprovals()))`, plus `StateMessage`, `useAction` and the 30 s refresh.
  - Its route is in `apps/web/src/routes/AppRoutes.tsx:184-191` (lazy import at `:45-46`).
  - The hub's count pill for approvals is in `apps/web/src/routes/SettingsHubPage.tsx:45` and `:94-98`.
- **The web routine helpers:** `listAiRoutines`, `pauseRoutine` and `resumeRoutine` in `apps/web/src/lib/tools.ts:86-110` (`callApi((client) => client.routines.…)`). A chat opens at `/c/${encodeURIComponent(chatId)}`.

### Steps
1. **Server (tiny):**
   - add `chatJid: Schema.NullOr(Schema.String)` to `MyRoutine` in the contract;
   - in `listMyRoutines`, fill it with the topic's room JID for a group routine, or the AI's `jid` for a personal one;
   - pass `mucDomain: config.xmpp.mucDomain` into `createRoutinesApi` (an optional dep);
   - extend `apps/server/src/routines/mine.test.ts` with one assertion on `chatJid`.
2. **Shared row:** add `{ id: 'routines', title: 'Routines', subtitle: 'Scheduled AI jobs you can pause or ask about.', icon: 'routines', href: '/settings/routines', group: 'ais' }` after `approvals` in `SETTINGS_ITEMS`. Map `routines` to lucide `Repeat` in **both** icon maps: web `rows.ts` (and add `/settings/routines` to `WEB_SETTINGS_HREFS`) and the phone `settings.tsx`. The phone screen comes in T-1720.
3. **Web lib:** `listMyRoutines()` in `apps/web/src/lib/tools.ts`, via `client.routines.listMine()`.
4. **Web page `apps/web/src/routes/RoutinesPage.tsx`,** plus a small row component in `apps/web/src/components/routines/RoutineRow.tsx`, built from the kit (`ListRow`, `IconButton` and the existing ball avatar the AI lists use, seeded by the AI's name and passing `aiAvatarUrl`):
   - `SettingsShell` titled "Routines", with two sections labelled **Running** (`status === 'active'`) and **Paused** (the rest), as on the board;
   - **each row:**
     - the AI's ball;
     - the title with a status dot (green `active`, grey otherwise);
     - one muted line: the schedule (chat-core `describeRoutineSchedule`, in mono), then ` · `, the AI name, ` · `, and the chat name when there is one;
   - **the keys on each row:**
     - **Ask** (a message-circle icon key) navigates to `/c/${encodeURIComponent(chatJid)}` (hidden when `chatJid` is null);
     - **Pause** or **Resume** (pause and play icon keys) calls `pauseRoutine` or `resumeRoutine`, then refreshes;
   - **clicking the row** toggles a red **Delete** icon key on that row, with the same two-step confirm `components/tools/RoutinesSection.tsx` uses. It calls its existing delete helper;
   - an empty list shows the kit's `StateMessage` with "No routines yet", with no hint text;
   - keep each file under 400 lines.
5. **Route:** `/settings/routines` in `AppRoutes.tsx` (lazy, `RequireAuth`), like Approvals.
6. **Hub pill:** in `SettingsHubPage.tsx`, show the count of running routines on the Routines row, like the approvals pill (hidden when 0).
7. **No UI tests.** Run the server test below.

### Allowed files
- `packages/api-contract/src/routines.ts`
- `apps/server/src/routines/reads.ts`
- `apps/server/src/routines/api.ts`
- `apps/server/src/routines/mine.test.ts`
- `apps/server/src/app/routes-ai.ts`
- `packages/chat-core/src/settings-items.ts`
- `apps/web/src/components/settings/hub/rows.ts`
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `apps/web/src/lib/tools.ts`
- `apps/web/src/routes/RoutinesPage.tsx`
- `apps/web/src/components/routines/RoutineRow.tsx`
- `apps/web/src/routes/AppRoutes.tsx`
- `apps/web/src/routes/SettingsHubPage.tsx`
- `work/T-1719-web-routines-page.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/mine.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Settings shows a Routines row** with the running count.
- **`/settings/routines` matches the board:** Running and Paused groups, with rows carrying the ball, title, dot, the schedule · AI · chat line, Ask and Pause or Resume.
- **The keys work:** Ask opens the chat, Pause and Resume change the status, and Delete appears on a row click with a confirm.
- **The phone's settings typecheck passes** with the new icon id.

---

## Report (written by the worker when done)

### What I did
- **Server (contract + read + handler):** added `chatJid: Schema.NullOr(Schema.String)` to `MyRoutine` (`packages/api-contract/src/routines.ts`). `listMyRoutines` now also selects the AI's `jid` (`a.jid AS ai_jid`) and returns each entry's `chatJid`: the topic's `<roomLocalpart>@<mucDomain>` (lowercased) for a group routine, the AI's own DM JID for a personal one, `null` when no `mucDomain` is known. `createRoutinesApi` gained an optional `mucDomain` dep and `routes-ai.ts` passes `config.xmpp.mucDomain`. `toMyRoutineWire` carries `chatJid`.
- **Shared row:** added the `routines` item (after `approvals`, group `ais`, href `/settings/routines`) to `SETTINGS_ITEMS`. Mapped `routines → Repeat` in both icon maps (web `rows.ts`, phone `settings.tsx`) and added `/settings/routines` to `WEB_SETTINGS_HREFS`.
- **Web lib:** `listMyRoutines()` in `lib/tools.ts` via `client.routines.listMine()`; `MyRoutine` re-exported.
- **Web page:** new `routes/RoutinesPage.tsx` (`SettingsShell` "Routines", Running = `status === 'active'` and Paused = the rest, server order kept, 30 s refresh, kit `StateMessage` for empty/loading/error) and `components/routines/RoutineRow.tsx` (AI ball via `EntityAvatar`, title with a status dot, `describeRoutineSchedule` in mono · AI name · chat name, Ask key to `/c/<chatJid>` hidden when null, Pause/Resume key).
- **Route + hub pill:** lazy `/settings/routines` route in `AppRoutes.tsx`; `SettingsHubPage` shows a `CountPill` with the running count on the Routines row (hidden when 0).
- **Phone:** icon map entry only (the phone screen is T-1720); typecheck passes.

### Files changed
- `packages/api-contract/src/routines.ts`, `apps/server/src/routines/reads.ts`, `apps/server/src/routines/api.ts`, `apps/server/src/routines/mine.test.ts`, `apps/server/src/app/routes-ai.ts`
- `packages/chat-core/src/settings-items.ts`, `apps/web/src/components/settings/hub/rows.ts`, `apps/mobile/src/app/(tabs)/settings.tsx`
- `apps/web/src/lib/tools.ts`, `apps/web/src/routes/RoutinesPage.tsx` (new), `apps/web/src/components/routines/RoutineRow.tsx` (new), `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/routes/SettingsHubPage.tsx`
- `work/T-1719-web-routines-page.md`

### Checks run
- `pnpm install` — ok.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/mine.test.ts` — **3 passed (1 file)**, 6.2 s. (I ran the AGENTS.md form of the task's first check, with the `--maxWorkers=2` cap; same file and assertions.)
- `pnpm gate` (`--base main`) — summary:
  ```
  PASS  install (frozen)  (2.6s)
  PASS  format  (2.5s)
  PASS  lint  (1.8s)
  PASS  typecheck  (16.6s)
  PASS  effect  (2.0s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (3.1s)
  SKIP tests @zilar/mobile (no nearby test files)
  PASS  tests @zilar/server  (28.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes for the lead
- **Delete gesture (spec step 4):** clicking the row toggles revealing the red Delete icon key; that key then asks (same two-step confirm as `RoutinesSection`: a red confirm key + a Cancel key), and confirm calls the existing `deleteRoutine` helper.
- **Mobile:** the shared registry shows the Routines row on the phone too (it points at `/settings/routines`, whose screen T-1720 adds), so the row is present before the screen. Phone typecheck passes.
- **`mucDomain` is optional** (per spec). Without it, a group routine's `chatJid` is `null` and the row hides Ask; a personal routine still gets the AI's DM JID. Production always passes `config.xmpp.mucDomain`.
- No UI tests were added (per spec); the server test was extended with `chatJid` assertions (personal → AI JID, group → topic room JID).

## Review (written by Claude)

**Approved and merged.** Julio approved this board ("Build as drawn", 2026-10-16).

- **Pre-review:** clean, 3 nits, all accepted:
  - an action-error notice that doesn't auto-hide;
  - the hub loads the full list just for the count;
  - an untested null-`mucDomain` branch.
- **The lead read `RoutineRow.tsx`:**
  - `EntityAvatar` (the AI ball), the title with a status dot, and the mono schedule · AI · chat line;
  - kit `IconButton`s for Ask (`/c/<chatJid>`) and Pause or Resume;
  - Delete, revealed on a row click, with a check/cross confirm.
- **The rest of the diff:**
  - the shared `routines` settings row, with the icon mapped on web and phone;
  - the hub count pill;
  - the server adds `chatJid`.
- **Next:** T-1720 is the phone twin.
