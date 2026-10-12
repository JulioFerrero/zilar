---
id: T-1212
title: "Avatar seeds, mobile: every mobile Avatar/avatarSvg call site in docs/audit/avatar-seeds.md §4 passes the rule's seed through the chat-core helpers from T-1209 (person → bare JID, AI → AI JID, group → General room JID), and the web own-profile uploader gets its own bare JID, so the same person, AI or group has one ball on both apps"
status: merged
milestone: M5
branch: task/T-1212-mobile-avatar-seeds
model: auto
effort: default
depends_on: [T-1209]
estimate: 0.4 day
---

# T-1212: One ball per person, AI and group (mobile)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/avatar-seeds.md` §4 lists the call sites whose seed breaks the rule. T-1209 (merged) did two things:
- `avatarSvg` now normalizes every seed (`packages/chat-core/src/avatar.ts`);
- it added `personSeed(userId, domain)`, `aiSeed(aiJid)` and `groupSeed(generalRoomJid)` in `packages/chat-core/src/avatar-seed.ts`, exported from `@zilar/chat-core`, and changed every web site on the list.

The lead's emulator check found the case this fixes: Julio's ball is green in the mobile chat list and header (seed: the DM JID), and purple on his profile screen (seed: the user id, `apps/mobile/src/components/profile/profile-view.tsx:113`).

T-1209's pre-review left one web follow-up: the own-profile `AvatarUploader` in `apps/web/src/components/ProfileSettingsSection.tsx:58` still seeds by the user id. T-1209 added an `ownerSeed` prop to `AvatarUploader`; pass the own bare JID there.

### What to build
1. **Every mobile call site** on §4's "Call sites that would change" (person, AI and group, mobile entries) passes the rule's seed through the T-1209 helpers. Prefer a real bare JID already in scope: the DM `chat.id`, a store contact's `jid`, `person.jid`.
   - The mobile XMPP domain is in `XmppToken.domain` (`apps/mobile/src/lib/chat-api.ts:46-50`), and the store's own JID; use whichever the store exposes, and cite it.
   - Remove the `'me'` fallback seed in `apps/mobile/src/app/(tabs)/settings.tsx:86` (§3 notes it must go): while the profile isn't loaded, draw no ball, or the ball of the own JID once known.
   - **Leave §4's "NOT available today" mobile sites unchanged** (`topic-info-sheet.tsx:170`, `explore.tsx:279`, `at/[handle].tsx:181`), and list them in the Report.
2. **Web:** `ProfileSettingsSection.tsx` passes `ownerSeed` = the own bare JID (`s.me?.jid`, as T-1209 used it) to `AvatarUploader`.
3. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/avatar-seeds.md` (all of it), `work/T-1209-web-avatar-seeds.md` (the Report: how the web side did it), `packages/chat-core/src/avatar-seed.ts`, `apps/mobile/src/components/chat/avatar.tsx` and `apps/mobile/src/components/profile/profile-view.tsx:100-120`.

### Allowed files
`apps/mobile/src/components/**`, `apps/mobile/src/app/**`, `apps/web/src/components/ProfileSettingsSection.tsx`, `work/T-1212-mobile-avatar-seeds.md`.

Inside the mobile folders, change only the files on the audit's §4 mobile list, and only their seed lines plus the imports.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator:** Julio's ball has the same colour in the chat list, the chat header and his profile.

---

## Report (written by the worker when done)

### What I did
- Mobile person sites now seed the ball by the bare JID (T-1209 helpers; domain from my own JID via `domainOfJid(me?.jid)`, the store's own JID `state.me?.jid` — the XMPP token's JID surfaced through `GET /api/me`, same source the web task used):
  - `profile-view.tsx:113` (the reported Julio green/purple case): new optional `seedFor(userId)` prop; `(tabs)/profile.tsx` passes `personSeed(userId, domain)`.
  - `floating-tab-bar.tsx:93`: `TabProfile` gains optional `seedFor`; `(tabs)/_layout.tsx` computes it the same way.
  - `(tabs)/settings.tsx:86`: the `'me'` fallback seed is gone — the ball is the own bare JID from the auth session (`me?.jid`); while no JID is known no ball is drawn (empty 64px box).
  - `settings/avatar-control.tsx:156` (+ new `ownerSeed` prop, the web `AvatarUploader` pattern): `settings/profile.tsx` passes `ownerSeed={ownJid}` from the chat store.
  - Member lists with no JID in scope get an optional `seedFor` prop, computed by the caller from my own JID: `topic-info-sheet.tsx:155` (host `topic-info-host.tsx`), `channel-members.tsx:40` (via `ChannelMembers`, caller `channel-screen.tsx`), `new-topic-sheet.tsx:205` (caller `group/[id].tsx`), `group-roles-sheet.tsx:124,290` (caller `group/[id].tsx`), `settings/requests.tsx:231` (local `RequestRow`, same file).
  - Real JIDs passed directly: `new-group-sheet.tsx:217` now uses `contact.jid` (was `contact.userId`; `Contact.jid` is on the same row, contract `contacts.ts:12`), `settings/blocked.tsx:185` uses `person.jid ?? person.userId` (`BlockedPerson.jid` is on the row).
  - `contacts/profile-card.tsx:80`: new optional `seed` prop; both callers pass the derived bare JID — `u/[handle].tsx` (domain from chat-store `me?.jid`) and `people-search-result.tsx` (domain from its `myJid` prop).
- Mobile AI sites: `ai-actions-sheet.tsx:51` and `ai-row.tsx:35` now use `aiSeed(ai.jid)` (was `ai.id`; `PublicAi.jid` is on the same object).
- Mobile group site: `group-list-item.tsx:96` now uses `groupSeed((topics.find(isGeneral) ?? topics[0])?.id ?? groupId)` (was the group-id UUID; General lookup is the same `topics.find(isGeneral)` form `group/[id].tsx:78-81` uses).
- Web follow-up: `ProfileSettingsSection.tsx` passes `ownerSeed={ownJid ?? undefined}` (`useChatSelector((s) => s.me?.jid)`, as T-1209 used it) to `AvatarUploader`.
- Left unchanged, per spec (§4 "NOT available today"): mobile `topic-info-sheet.tsx:170` (only `TopicAi.id` in scope; JID needs the group detail or a server change), mobile `explore.tsx:279` (only group id + handle; General room JID needs the topics), mobile `at/[handle].tsx:181` (same cold-directory reason). Untouched-but-already-correct sites: `chat-list-item`, `chat-header`, `topic-info-sheet:134`, `message-bubble`, `message-bubble-tombstone`, `mention-picker`, `forward-sheet`, `new-topic-sheet:235` (already `ai.jid`), `message-search-list`, `group-header`, `channel-screen:189` (already `feedId` = General room JID).
- No tests (UI), per spec.

### Files changed (24 + task file, all inside Allowed files)
Mobile `components/`: `profile/profile-view.tsx`, `nav/floating-tab-bar.tsx`, `settings/avatar-control.tsx`, `chat/topic-info-sheet.tsx`, `chat/topic-info-host.tsx`, `chat/channel-members.tsx`, `chat/channel-screen.tsx`, `chat/new-group-sheet.tsx`, `chat/new-topic-sheet.tsx`, `chat/group-roles-sheet.tsx`, `chat/group-list-item.tsx`, `contacts/profile-card.tsx`, `contacts/people-search-result.tsx`, `ais/ai-actions-sheet.tsx`, `ais/ai-row.tsx`. Mobile `app/`: `(tabs)/_layout.tsx`, `(tabs)/profile.tsx`, `(tabs)/settings.tsx`, `group/[id].tsx`, `settings/profile.tsx`, `settings/requests.tsx`, `settings/blocked.tsx`, `u/[handle].tsx`. Web: `ProfileSettingsSection.tsx`. Plus this task file (front matter + Report).

### Commands and real results
- `pnpm install`: done (16s).
- Single tests while working: none — spec says no tests (UI), and no test file covers the touched components (nearest test files under `apps/mobile/src` are auth/lib/store only).
- `pnpm gate` (final, after the lead rebased the branch onto main with the T-1213 fix): `gate: 25 changed file(s) against main / PASS install (frozen) / PASS format / PASS lint / PASS typecheck / PASS effect / SKIP tests @zilar/mobile (no nearby test files) / SKIP tests @zilar/web (no nearby test files) / scope: every changed file is inside the Allowed files / migration: every added migration continues from the base / GATE PASS`. (The earlier red gate in this worktree failed typecheck only on the pre-existing `retry-text.ts` break, fixed on main by T-1213; the rebase resolved it with no conflicts and no code changes from me.)
- First gate run also flagged `format` on 8 files (long `seedFor` lines); fixed with `prettier --write` on those files only. Final gate: format PASS, lint PASS, scope clean.
- Every touched file is at most 400 lines (largest: `topic-info-sheet.tsx` 359, `group-roles-sheet.tsx` 343, `requests.tsx` 302).

### Problems / deviations
- The `(tabs)/settings.tsx` card draws no ball (empty box) while the own JID is unknown, per the spec's "draw no ball" option. In practice the auth session (`me?.jid` from `GET /api/me`) is loaded before this screen renders.
- `seedFor`/`seed`/`ownerSeed` props default to the old user-id seed when the domain/JID is unknown (same fallback the approved web task used), so no screen crashes when the store JID is momentarily absent.
- Two accidental import deletions during editing (`topic-info-sheet.tsx` Button, `ai-actions-sheet.tsx` ActionSheet) were reverted immediately; the final diff contains only seed lines plus imports/props.

### Blocked / needs a decision
- None. The earlier block (red gate on the pre-existing `retry-text.ts` break) is resolved by the lead's rebase onto fixed main.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit.**
- **Mobile:** every site on the audit's §4 mobile list now seeds through `personSeed`, `aiSeed` or `groupSeed`, preferring real bare JIDs. The `'me'` fallback seed is gone, and the documented gap sites are unchanged.
- **Web:** the own-profile `AvatarUploader` gets `ownerSeed` = the own bare JID (T-1209's follow-up).
- **Lead checks:** `tsc` gives 0 errors for mobile and web on the branch, which the lead had rebased after T-1213.
- **Still to do:** the emulator check with the next APK (Julio's ball the same in the list, the header and the profile).
