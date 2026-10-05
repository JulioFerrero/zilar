---
id: T-0190
title: Mobile: "Invite a friend" link sheet and the New message dialog (replaces "Coming soon")
status: merged
milestone: M5
branch: task/T-0190-mobile-invite-new-message
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0190: Invite a friend, and New message, on the phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-03: "implement all the features we have in web into the mobile app". On the phone, the chat list menu's `New message` opens a box that says `Coming soon`, and there is no way to create a personal invite link. Web has both (`NewChatButton` "New message" dialog and `InviteDialog`). This is T-0190d of the split in `docs/audit/mobile-parity-gaps.md` section 7.2, plus the New message box.

### What the person sees
1. Chat list, `+` menu, `New message`: a box (same structure and classes as the current placeholder) titled `New message` with the sentence `Invite a friend to start a conversation, or type their @username in the search bar above.` and two buttons on the right: `Close` (outline) and `Invite a friend` (primary). The chat list already has the search bar with the placeholder `Search, or type @username` (`apps/mobile/src/app/index.tsx` line 215), so the sentence is true on the phone.
2. `Invite a friend` replaces the box with the invite box: title `Invite a friend`, text `Send them this link. They join Zilar already connected to you.`, then a row with the link (one line, cut at the end) or `Creating link…` while it loads, and two buttons under it: `Copy` (copy icon; becomes `Copied` with a check icon after a copy) and `Share` (share icon, opens the system share sheet with the link). Then `Close` on the right. On failure the row is replaced by the danger-coloured sentence `Could not create an invite link. Try again.` and a `Try again` button that creates a new link.
3. Tapping outside the box or Android back closes it, like the other boxes of this menu.
4. A new link is created each time the invite box opens (web does the same). Icons from `lucide-react-native` (`Copy`, `Check`, `Share2`); no emoji.

### Verified facts (do not re-derive)
- Server: `POST /invites` in `apps/server/src/auth/routes.ts` lines 124-131, session required, answers `{ code, url, expiresAt }`.
- Web: `inviteSchema` (`code`, `url`, `expiresAt?`) and `createInvite()` in `apps/web/src/lib/api.ts` lines 171-177 and 298-300; `apps/web/src/components/InviteDialog.tsx` (copy, the error sentence, `Creating link…`); the New message dialog in `apps/web/src/components/NewChatButton.tsx` lines 296-330.
- Mobile menu: `apps/mobile/src/components/chat/new-chat-button.tsx` (184 lines). `type NewChatAction = 'channel' | 'group' | 'message' | 'join'` (line 14); the modal at lines 136-180 shows `JoinLinkForm` for `join`, `NewChannelSheet` for `channel`, and the `Coming soon` placeholder (lines 159-178) for both `group` and `message`. Keep the placeholder for `group` (T-0190's sibling task handles it); replace it only for `message`.
- Copy and share on mobile: `apps/mobile/src/app/group/[id].tsx` lines 369-381 wire `Clipboard.setStringAsync` (`expo-clipboard`, already a dependency) and React Native `Share.share({ message })` at the screen edge and pass `copyText` / `shareText` callbacks down, because neither runs in Node tests. Do the same: the invite box takes `copyText` and `shareText` props.
- Mobile API pattern: bearer `request` in `apps/mobile/src/lib/ais-api.ts` lines 181-211; `createAisApi(getToken, fetchImpl, apiUrl)` line 215; hook and mock pattern `apps/mobile/src/components/chat/use-approvals-api.ts` and `apps/mobile/src/mock/approvals.ts`.

### What to build
1. New `apps/mobile/src/lib/invites-api.ts`: `Invite { code; url; expiresAt? }`, `InvitesApiError` (status, code), `InvitesApi { createInvite(): Promise<Invite> }`, `createInvitesApi(getToken, fetchImpl = fetch, apiUrl = API_URL)` (POST `/invites`, bearer, defensive parse: missing `code` or `url` is `invalid_response`).
2. New `apps/mobile/src/mock/invites.ts` (`createMockInvitesApi()` returning `https://chat.zilar.app/invite/mock-code`) and `apps/mobile/src/components/chat/use-invites-api.ts` (real or mock, like `use-approvals-api.ts`).
3. New `apps/mobile/src/components/chat/invite-sheet.tsx`: the invite box of point 2, props `{ api: InvitesApi; copyText(text): Promise<void>; shareText(text): Promise<void>; onClose(): void }`. One request at a time; ignore a result that arrives after close.
4. New `apps/mobile/src/components/chat/new-message-sheet.tsx`: the box of point 1, props `{ onInvite(): void; onClose(): void }`.
5. `apps/mobile/src/components/chat/new-chat-button.tsx`: add `'invite'` to `NewChatAction`; `message` shows `NewMessageSheet`, its `Invite a friend` switches the action to `invite`, which shows `InviteSheet` with the real clipboard and share wired here (as in `group/[id].tsx`). `group` keeps the placeholder. Nothing else in the menu changes.
6. Tests (Vitest): `apps/mobile/src/lib/invites-api.test.ts` (path, method, bearer, parse, bad body, HTTP error); `apps/mobile/src/components/chat/invite-sheet.test.tsx` (loading text, link shown, Copy calls `copyText` with the url and flips to `Copied`, Share calls `shareText`, failure sentence and `Try again` creates a new link, Close); `apps/mobile/src/components/chat/new-message-sheet.test.tsx` (the sentence, Close, Invite a friend calls `onInvite`).

### Read first
`AGENTS.md` (mobile pitfalls), `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/web/src/components/InviteDialog.tsx`, `apps/web/src/components/NewChatButton.tsx` (lines 296-330), `apps/mobile/src/app/group/[id].tsx` (lines 360-385), `apps/mobile/src/lib/ais-api.ts` (lines 60-90 and 181-240), `apps/mobile/src/components/chat/use-approvals-api.ts`.

### Allowed files
`apps/mobile/src/lib/invites-api.ts` (new), `apps/mobile/src/lib/invites-api.test.ts` (new), `apps/mobile/src/mock/invites.ts` (new), `apps/mobile/src/components/chat/use-invites-api.ts` (new), `apps/mobile/src/components/chat/invite-sheet.tsx` (new), `apps/mobile/src/components/chat/invite-sheet.test.tsx` (new), `apps/mobile/src/components/chat/new-message-sheet.tsx` (new), `apps/mobile/src/components/chat/new-message-sheet.test.tsx` (new), `apps/mobile/src/components/chat/new-chat-button.tsx`, `work/T-0190-mobile-invite-new-message.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot invites-api invite-sheet new-message-sheet
pnpm gate
```
The lead checks the menu on the Android emulator before merging.

### Acceptance
- `New message` shows the web's sentence and opens `Invite a friend`; the invite box creates a link, copies it, shares it, and shows the failure sentence with Try again.
- `New group` still shows its placeholder; nothing else changes. No server, web or package change; no new dependency; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Revoking invites, a list of my invites, the New group sheet, starting a DM by @handle from this box.

---

## Report (written by the worker when done)

### What I did
- New message box: `NewMessageSheet` shows the web sentence ("Invite a friend to
  start a conversation, or type their @username in the search bar above.") with
  outline `Close` and primary `Invite a friend`, same box structure/classes as
  the placeholder it replaces.
- Invite box: `InviteSheet` creates a new link on every open (remount per open;
  stale results ignored via the `active` flag), shows `Creating link…` while
  loading, the truncated link with `Copy` (Copy/Check icons, flips to `Copied`)
  and `Share` (Share2 icon, system share sheet) underneath, `Close` on the
  right; on failure the row is replaced by `Could not create an invite link.
  Try again.` with `Try again` (one request at a time, guarded) plus `Close`.
- API: `createInvitesApi` POSTs `/api/invites` with bearer auth and defensive
  parse (missing `code`/`url` or non-string `expiresAt` is `invalid_response`);
  `createMockInvitesApi` returns `https://chat.zilar.app/invite/mock-code`;
  `useInvitesApi` mirrors `use-approvals-api.ts`.
- `new-chat-button.tsx`: added `'invite'` to `NewChatAction`; `message` shows
  `NewMessageSheet` (Invite switches to `invite`), `invite` shows `InviteSheet`.
  `group` keeps the untouched placeholder. Nothing else in the menu changed.

### Files changed
- `apps/mobile/src/lib/invites-api.ts` (new), `.test.ts` (new)
- `apps/mobile/src/mock/invites.ts` (new)
- `apps/mobile/src/components/chat/use-invites-api.ts` (new)
- `apps/mobile/src/components/chat/invite-sheet.tsx` (new: stateful `InviteSheet`
  + hook-free `InviteSheetBody`, the `join-link.tsx` test pattern),
  `.test.tsx` (new)
- `apps/mobile/src/components/chat/new-message-sheet.tsx` (new), `.test.tsx` (new)
- `apps/mobile/src/components/chat/new-chat-button.tsx` (menu wiring only)

### Commands and real results
- `pnpm install`: ok (12s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  invites-api invite-sheet new-message-sheet src/components/chat/new-chat-button.test.tsx`:
  4 files, 20 tests passed (incl. the pre-existing menu test).
- `pnpm gate`: GATE PASS — `PASS install (frozen)`, `PASS format`, `PASS lint`,
  `PASS typecheck`, `PASS tests @zilar/mobile`,
  `scope: every changed file is inside the Allowed files`. First gate run failed
  on `format` (4 of my files); fixed with `prettier --write` on my files only,
  re-ran gate once: PASS.

### Problems / deviations from the spec
- Path: spec says POST `/invites`; mobile sends `/api/invites` (server mounts
  auth routes under `/api`, `apps/server/src/app.ts:287`; every mobile API uses
  the `/api` prefix). Same endpoint.
- `useInvitesApi` is created per spec but the menu uses
  `createInvitesApi(getSessionToken)` directly: the hook needs
  `useGlobalSearchParams`, which the existing `new-chat-button.test.tsx` (not in
  Allowed files, cannot edit) does not mock, so calling it breaks that test. A
  personal invite link needs a real session anyway.
- `expo-clipboard` is loaded via dynamic `import()` in the copy callback:
  a static import crashes Node tests (`__DEV__ is not defined` from
  expo-modules-core); precedent is `session-token.ts`. `Share` (react-native) is
  only touched on press. Verified the pre-existing menu test still passes.
- Async transitions (loading -> link / failure -> retry) are tested at the
  `InviteSheetBody` + API level: effects never run under `react-dom/server`,
  so the wrapper test asserts the initial `Creating link…` render only.
- Security checklist: no secrets/tokens in logs or errors (fixed user-facing
  sentences only); no server routes touched; bearer token via header only.

## Review (written by Claude)

**Verdict:** Approved, clean on the first pre-review (free Muse). New `invites-api.ts` (POST `/invites`), its mock and hook, `InviteSheet` (link, Copy/Copied, Share, the failure sentence with Try again) and `NewMessageSheet`; the `+` menu's `New message` now shows web's sentence with `Close` and `Invite a friend`; `New group` keeps its placeholder. Emulator (galena, live server): smoke PASS; the lead opened the menu and the New message box and compared it with web. The invite box itself was not opened on the emulator: it would create a real invite on the live server, which the lead does not do without Julio; its behaviour is covered by `invite-sheet.test.tsx`. Accepted nits: two small ones.
