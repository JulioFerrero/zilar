---
id: T-1574
title: "Phone Group info T4 (plan docs/audit/phone-group-info-plan.md §6): the Settings page (group picture upload/remove, 'Members can create topics' switch, AI listener switch + eagerness, Visibility row opening the existing sheet) with a new group-settings store action over groups.patch; the group screen's header drops its three old keys now that Group info holds them"
status: merged
milestone: M5
branch: task/T-1574-mobile-group-info-settings
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1574: Phone Group info — Settings page

## Spec (written by Claude, do not edit)

### Why
This is step T4 of `docs/audit/phone-group-info-plan.md` §6. `docs/design/mockups/group-info/README.md:45` says "Settings holds the picture, 'Members can create topics', the AI listener and visibility". The lead's answer in `work/T-1542-*.md` › Review: the group header keeps its keys until T4, and tapping the header opens info.

**The rules:** no headings, no hint paragraphs, and a status is an icon.

### Facts (the lead read them on main after T-1573, 2026-10-15)
- **The Group info screen:**
  - `apps/mobile/src/app/group-info/[id].tsx` (335 lines) and the page switch in `apps/mobile/src/components/group-info/group-info-pages.tsx` (223);
  - the root's Settings row (owner only) calls `onOpenSettings`, which today opens the visibility sheet (T-1552).
- **The contract:** `groups.patch` (PATCH `/groups/:id`, `packages/api-contract/src/groups.ts:215`) takes `PatchGroupPayload` (`:80-87`): `membersCanCreateTopics?`, `visibility?`, `handle?`, `background?`, `listenerEnabled?` and `listenerEagerness?` (`ListenerEagernessSchema`, `:25-28`). The detail carries `listener` (`:127`).
- **Web reference:**
  - `apps/web/src/lib/api/groups.ts:104-150`: `setMembersCanCreateTopics` and `setGroupListener`, both through `groups.patch`;
  - `apps/web/src/components/panels/GroupSettingSwitch.tsx`: the topic switch, and the "AI listener" switch plus eagerness (`:83-117`);
  - `apps/web/src/components/panels/GroupPictureSection.tsx`: `AvatarUploader` with kind `group`, for owners and admins.
- **Phone pieces:**
  - `apps/mobile/src/components/settings/avatar-control.tsx` (174): `AvatarControl({ ownerId, ownerName, currentUrl, token, phase, busy, onPick, onSavePicked, onRemove })`;
  - `apps/mobile/src/components/settings/use-profile-avatar.ts` (200): the user's pick, save and remove flow;
  - `createPicturePicker` and `createAvatarFileUploader` from `apps/mobile/src/components/settings/avatar-native` (used in `apps/mobile/src/app/me.tsx:10,101`);
  - AI pictures upload to `/api/avatars/ai/<id>` (`apps/mobile/src/components/ais/new-ai/orb-upload.ts:25-26`); a group's slot is `/api/avatars/group/<id>`.
  - The visibility sheet is `apps/mobile/src/components/chat/visibility-sheet.tsx`, wired by `use-group-visibility.ts`.
  - `apps/mobile/src/store/effects/group-actions.ts` is 393 lines: **do not grow it**.
- **The group screen:**
  - `apps/mobile/src/components/chat/group-header.tsx` (76) shows Back, then the tappable avatar and title (`onOpenInfo`), then three `IconButton`s: `onOpenLinks`, `onOpenVisibility` and `onOpenRoles` (`:16-35`);
  - `apps/mobile/src/app/group/[id].tsx` (363) wires them (`:238-241`) and mounts their sheets.

### Steps
1. **Store:** new `apps/mobile/src/store/effects/group-settings-actions.ts` with `patchGroupSettings(groupId, patch)` over `groups.patch`, in the `transferGroupOwner` pattern (write, `ensureGroupDetail(groupId, true)`, `refreshQuietly`).
   - Add the wrapper to `apps/mobile/src/lib/groups-api.ts`, the signature to `types-groups.ts`, and compose it in `groups.ts`, the same way T-1569 composed `group-membership-actions.ts`.
2. **New `apps/mobile/src/components/group-info/settings-page.tsx`** (`page` gains `'settings'`; the Settings row opens it), full screen with the back key and a 28 px "Settings":
   - **Picture:** `AvatarControl` for the group (kind `group`, owner the group id), with a small hook in the style of `use-profile-avatar.ts` (new `apps/mobile/src/components/group-info/use-group-picture.ts`) that uploads to the group's avatar slot and refreshes the detail.
   - **"Members can create topics":** a switch.
   - **"AI listener":** a switch, and when it is on, the eagerness as a `SegmentedControl` of the contract's values.
   - **Visibility:** a row that opens the existing visibility sheet.
   - **Who sees it:** match web: owners and admins for the picture; read web's switches for their exact role rule and cite it.
   - **Write errors:** a fixed one-line sentence.
3. **The group screen:**
   - remove the three `IconButton`s and their props from `group-header.tsx`; the header is Back plus the tappable avatar and title;
   - in `apps/mobile/src/app/group/[id].tsx`, remove the wiring and any sheet that becomes unused there. Invite links, roles and visibility stay reachable from Group info.
4. **Every file stays under 400 lines.**

### Not in scope
- channels (T5/T6);
- web;
- the server;
- the group background.

### Tests
None.

### Allowed files
- `apps/mobile/src/components/group-info/settings-page.tsx` (new)
- `apps/mobile/src/components/group-info/use-group-picture.ts` (new)
- `apps/mobile/src/components/group-info/group-info-pages.tsx`
- `apps/mobile/src/components/group-info/root-page.tsx` (added by the lead in fix round 1)
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/store/effects/group-settings-actions.ts` (new)
- `apps/mobile/src/store/effects/groups.ts`
- `apps/mobile/src/store/types-groups.ts`
- `apps/mobile/src/lib/groups-api.ts`
- `apps/mobile/src/lib/chat-api-schemas.ts` (added by the lead after the block: carry `listener` and `avatarUrl` on the parsed detail)
- `apps/mobile/src/components/chat/group-header.tsx`
- `apps/mobile/src/app/group/[id].tsx`
- `work/T-1574-mobile-group-info-settings.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock `/group/g-devteam`:** the header shows only Back, the picture, the name and "6 members, 7 topics".
- **`/group-info/g-devteam`:** unchanged.
- The Settings page is read in the code.
- The Report gives each file's `wc -l`.

---

## Report (written by the worker when done)

### What I did

Resolved: the lead chose option 1 and added `apps/mobile/src/lib/chat-api-schemas.ts` to Allowed files, so the parsed group detail now carries `listener` and `avatarUrl`. Then I implemented T4 as specified.

- **Parser** (`chat-api-schemas.ts`): `GroupDetailRawSchema` gains optional `avatarUrl` and `listener` (the contract's `GroupListener` shape); `parseGroupDetail` spreads them, so the parsed `GroupDetail` matches the contract type for those fields (absent on older servers stays absent).
- **Store**: new `group-settings-actions.ts` with `patchGroupSettings(groupId, patch)` in the `transferGroupOwner` pattern (write, `ensureGroupDetail(groupId, true)`, `refreshQuietly`). `groups-api.ts` gains the `patchGroupSettings` wrapper over `client.groups.patch` with `omitUndefined`, so only the keys the caller set go over the wire; the signature is on `types-groups.ts`; `groups.ts` composes the new actions (`GroupActions & GroupMembershipActions & GroupSettingsActions`).
- **Settings page** (`settings-page.tsx`, new): full screen, back key and a 28 px "Settings". `AvatarControl` for the group (owner the group id), `Switch` rows for "Members can create topics" and "AI listener", the eagerness as a `SegmentedControl` of the contract's values when the listener is on, and an `InfoRow` that opens the existing visibility sheet. Writes share one fixed error line. Gating matches web `GroupPanel.tsx`: the picture and both switches for `isManager` (`:303-330`), the visibility row for `isOwner` (`:332-341`).
- **Picture hook** (`use-group-picture.ts`, new), in the style of `use-profile-avatar.ts`: pick/transcode, upload the PNG to `/api/avatars/group/<id>` with `createAvatarFileUploader`, remove with a bearer `DELETE`; `onChanged` refreshes the group detail and the chat list (the phone's group header picture comes from the chat row).
- **Pages**: `group-info-pages.tsx` gains `'settings'` and passes `settings` through; `group-info/[id].tsx` opens the page from the Settings row (`onOpenSettings` no longer opens the visibility sheet directly) and exposes `onOpenVisibility`.
- **Group screen**: `group-header.tsx` is now Back plus the tappable avatar and title (the three `IconButton`s and their props are gone); `group/[id].tsx` drops those props and the now-unused `InviteLinksSheet`, `GroupRolesSheet`, `VisibilitySheet` and their hooks (`useGroupManage`, `useGroupInviteLinks`, `useGroupRoles`, `useGroupVisibility`). Invite links, roles and visibility stay reachable from Group info.
- **Fix round 1**: the root Settings row is now shown to managers (`root-page.tsx:165`), like web (`apps/web/src/components/group-info/GroupInfoRoot.tsx:265`); the route's `openSettings` gate follows (`group-info/[id].tsx:110`).

### Files and `wc -l`

```
166 apps/mobile/src/components/group-info/settings-page.tsx
214 apps/mobile/src/components/group-info/use-group-picture.ts
231 apps/mobile/src/components/group-info/group-info-pages.tsx
355 apps/mobile/src/app/group-info/[id].tsx
 44 apps/mobile/src/store/effects/group-settings-actions.ts
292 apps/mobile/src/store/effects/groups.ts
247 apps/mobile/src/store/types-groups.ts
175 apps/mobile/src/lib/groups-api.ts
299 apps/mobile/src/lib/chat-api-schemas.ts
 51 apps/mobile/src/components/chat/group-header.tsx
279 apps/mobile/src/app/group/[id].tsx
```

Every changed source file is under 400 lines.

### Checks run

- `pnpm install` at the start: done (11.5s).
- `pnpm gate` from the repo root (final, fix round 1 included): `GATE PASS`. Summary: `gate: 13 changed file(s) against main`; `PASS install (frozen) 1.0s`, `PASS format 1.5s`, `PASS lint 1.0s`, `PASS typecheck 3.6s`, `PASS effect 0.6s`, `PASS tests @zilar/mobile 3.9s`; `scope: every changed file is inside the Allowed files`; `migration`/`images`/`size` all OK.
- No standalone test run: the change is UI plus parser/store wiring and the task says "Tests: None"; `pnpm gate` ran the nearest mobile tests and they pass.

### Deviations from the spec

- The label "AI listener" is the spec's name for the switch; web's visible label is "Let AIs answer without @mention". I used the spec's shorter label.
- When `listener.available` is false, I show a lucide `Lock` icon as the status (web shows the sentence "Turned off on this server"; the phone rule is "a status is an icon, never a word") and disable the switch.
- Picture and switches are gated on `isManager`, the visibility row on `isOwner`, matching web (`apps/web/src/components/panels/GroupPanel.tsx:303-341`). The root Settings row is for managers (web `apps/web/src/components/group-info/GroupInfoRoot.tsx:265`), so admins reach the page and see the picture and switches but not the owner-only visibility row.

### Notes for the lead

- `parseGroupDetail` now keeps `listener`; a payload with a listener block missing `available` would fail to parse, since the contract requires it. The server always sets it (`apps/server/src/groups/api.ts:92`).
- The Settings page picture refreshes the detail and the chat list; the group header picture reads from the chat row (`EntityAvatar`), so the list refresh is what repaints it right away.
- I did not wire the dev mock backend for `PATCH /api/groups/:id` or the group avatar slot (not in Allowed files); in mock mode the listener reads unavailable and the picture writes would hit the real URL.

## Review (written by Claude)

**Approved and merged after one block and one fix round.**

- **The block:** the phone group-detail parser dropped `listener` and `avatarUrl`. The lead added `chat-api-schemas.ts`, and the detail now carries both, the same as web.
- **First packet:** clean, with 2 follow-ups. The lead sent one fix: the root's Settings row shows for managers, matching web's `GroupInfoRoot.tsx:265`. The second packet was clean, with 2 nits and 1 follow-up.
- **Phone smoke** (`/group/g-devteam`, mock): PASS. The group header is Back, the picture, "Dev team" and "6 members, 7 topics", with no keys; invite links, roles and visibility are reached from Group info.
- **Read in the code:** the Settings page has the picture (`AvatarControl` with the group slot), the "Members can create topics" switch, the "AI listener" switch with an eagerness control, and a Visibility row opening the existing sheet. Writes go through `patchGroupSettings`, which reloads the detail.
- **Left for the next phone task:**
  - **nit 3:** `parseGroupDetail` rejects the whole detail when a present `listener` block is malformed. It should drop only that field. Live sends the full block, so nothing is broken today;
  - **nit 2:** the eagerness control stays tappable while a write is in flight;
  - **the mock** has no group update or group-picture routes, so in mock mode the listener reads "unavailable".
