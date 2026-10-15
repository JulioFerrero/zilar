---
id: T-1573
title: "Phone Group info T3 (plan docs/audit/phone-group-info-plan.md §6): the Content group on the root (Shared media, Pinned messages with count, Tools and routines; Activity and Always allowed for managers) and their pages, reusing the media sheet, the pins loader, the AI tools/routines/activity components and the always-allowed rows with new group-scoped API calls"
status: merged
milestone: M5
branch: task/T-1573-mobile-group-info-content
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1573: Phone Group info — Content pages

## Spec (written by Claude, do not edit)

### Why
This is step T3 of `docs/audit/phone-group-info-plan.md` §6 (read §4 and §5 too). The boards are `docs/design/mockups/group-info/README.md` and `Phone.dc.html:64-90`.

**The rules:**
- no headings or hint text;
- a status is an icon;
- a row whose count isn't loaded shows no number.

### Facts (the lead read them on main after T-1569, 2026-10-15)
- **The screen, `apps/mobile/src/app/group-info/[id].tsx` (303 lines):**
  - `const [page, setPage] = useState<'root' | 'members' | 'ais'>('root')` (`:53`);
  - the pages switch at `:132-150` (`MembersPage`, `AisPage`);
  - `groupChatId` is the group's General chat id.
- **`apps/mobile/src/components/group-info/root-page.tsx` (125):** the People `InfoRowGroup` (`:104-108`), Settings (`:111-113`) and Leave (`:117-119`). `InfoRow` takes `icon`, `label`, `count?`, `onPress` and `danger?`.
- **Web (the reference):** `apps/web/src/components/group-info/GroupInfoRoot.tsx:225-260` puts, between People and Settings:
  - **for everyone:** Shared media, Pinned messages (`count(pinCount)`) and Tools and routines;
  - **inside `isManager &&`:** Activity and Always allowed.
- **Shared media:** `MediaSheet({ chatId, title?, onClose, onJump })` (`apps/mobile/src/components/chat/media-sheet.tsx:54`) loads by itself through the store's `loadChatMedia`.
- **Pins:** the chat screen shows `PinsSheet` with `screen.pins` and `screen.jumpToPin` (`apps/mobile/src/components/chat/chat-overlays.tsx:35-48`). Find how `use-chat-screen.ts` loads `pins` and reuse that loader for `groupChatId`.
- **Tools and routines:**
  - `apps/mobile/src/lib/tools-api.ts` (204) has only `listAiTools` and `listAiRoutines` (`:114-116`);
  - the contract has `listForGroup` (`packages/api-contract/src/tools.ts:126`, GET `/groups/:id/tools`) and routines `listForGroup` (`packages/api-contract/src/routines.ts:37`);
  - the display parts are `ToolsSectionContent({ state, onRetry, onOpenTool })` (`apps/mobile/src/components/ais/tools-section.tsx:94`) and `RoutinesSectionContent` (`apps/mobile/src/components/ais/routines-section.tsx:217`).
- **Activity:**
  - `apps/mobile/src/lib/audit-api.ts` (56) has only `listAiAudit(aiId, before)` (`:8`, `:26`);
  - the contract's audit list takes `groupId` (`packages/api-contract/src/audit.ts:14`);
  - `apps/mobile/src/components/ais/ai-activity.tsx` (280) loads by `aiId` (`:35-78`).
- **Always allowed:**
  - `apps/mobile/src/lib/approvals-api.ts:153` has `groupRules(groupId)`;
  - the row is `AlwaysAllowedRow` (`apps/mobile/src/components/approvals/always-allowed-row.tsx:9`), as used by `apps/mobile/src/components/approvals/rules-section.tsx`;
  - web's group list allows a one-step revoke (`apps/web/src/components/approvals/AlwaysAllowedList.tsx:60,96`).

### Steps
1. **The root:** a Content `InfoRowGroup` between People and Settings:
   - Shared media (`Image`);
   - Pinned messages (`Pin`, with the count once the pins are loaded);
   - Tools and routines (`Wrench`);
   - **for managers:** Activity (`Activity`) and Always allowed (`ShieldCheck`, with the rule count once loaded).
2. **Pages:** `page` gains `'tools' | 'activity' | 'allowed'`. Each page is full screen with the back key and a 28 px title, like `MembersPage`.
   - **Shared media** opens `MediaSheet` for `groupChatId`. A jump goes to `/chat/<groupChatId>` at the message, the way search results open a message.
   - **Pinned messages** opens `PinsSheet` with the pins of `groupChatId`, using the chat screen's loader. A jump works the same way. Unpin follows the chat screen's `canUnpin` rule.
3. **New `apps/mobile/src/components/group-info/tools-page.tsx`:**
   - add `listGroupTools(groupId)` and `listGroupRoutines(groupId)` to `tools-api.ts` (the same mapping as the AI versions);
   - render with `ToolsSectionContent` and `RoutinesSectionContent` when their props fit. Otherwise use plain rows (name plus a status icon). The page is read-only.
4. **New `apps/mobile/src/components/group-info/activity-page.tsx`:**
   - add `listGroupAudit(groupId, before)` to `audit-api.ts`;
   - let `ai-activity.tsx` take a scope (`{ aiId } | { groupId }`) instead of only `aiId`, keeping the AI behaviour unchanged;
   - the page reuses that list.
5. **The Always allowed page** (in `activity-page.tsx` or a new `allowed-page.tsx`): `groupRules(groupId)` rows with `AlwaysAllowedRow`, and revoke as on the AI's approvals screen.
6. **Every file stays under 400 lines.** If `[id].tsx` would pass 400, move the page switch into a new `group-info-pages.tsx`.

### Not in scope
- Settings (T4);
- channels;
- web;
- the server.

### Tests
None.

### Allowed files
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/components/group-info/root-page.tsx`
- `apps/mobile/src/components/group-info/tools-page.tsx` (new)
- `apps/mobile/src/components/group-info/activity-page.tsx` (new)
- `apps/mobile/src/components/group-info/allowed-page.tsx` (new, optional)
- `apps/mobile/src/components/group-info/group-info-pages.tsx` (new, only if needed)
- `apps/mobile/src/lib/tools-api.ts`
- `apps/mobile/src/lib/audit-api.ts`
- `apps/mobile/src/components/ais/ai-activity.tsx`
- `apps/mobile/src/components/chat/use-chat-screen.ts` (only to export the pins loader if it is not reusable as is)
- `work/T-1573-mobile-group-info-content.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock `/group-info/g-devteam` (owner):** after People, a Content group shows Shared media, Pinned messages, Tools and routines, Activity and Always allowed, then Settings.
- The Report gives each file's `wc -l` and says how the pins are loaded.

---

## Report (written by the worker when done)

### What I did

**Root (`root-page.tsx`).** Added the Content `InfoRowGroup` between People and
Settings, after `Phone.dc.html:64-90`: Shared media (`Image`), Pinned messages
(`Pin`, count once the pins are loaded), Tools and routines (`Wrench`), and,
inside `isManager`, Activity (`Activity`) and Always allowed (`ShieldCheck`,
count once the rules load). A count is `undefined` (no number) until its load
succeeds.

**Pages (`page` gains `'tools' | 'activity' | 'allowed'`).** Each is full screen
with the back key and a 28 px title, like `MembersPage`, and the older pages are
unchanged.

- `tools-page.tsx` (new): the group's tools and routines, read only. Each list
  uses the AI screen's `ToolsSectionContent` / `RoutinesSectionContent` (their
  optional write props are left off), plus `sectionStateOf`. `tools-api.ts` gains
  `listGroupTools(groupId)` / `listGroupRoutines(groupId)` (the same mapping as
  the AI versions, over `tools.listForGroup` / `routines.listForGroup`).
- `activity-page.tsx` (new): renders `AiActivity` with `groupId` and
  `showHeader={false}` (the page's 28 px title is the only heading).
  `ai-activity.tsx` now takes a scope (`{ aiId } | { groupId }`) instead of only
  `aiId`; the AI screen's behaviour is unchanged (`<AiActivity api aiId />` still
  compiles). `audit-api.ts` gains `listGroupAudit(groupId, before?)`.
- `allowed-page.tsx` (new): `useGroupRules(groupId, isManager)` loads
  `groupRules(groupId)` and renders `AlwaysAllowedRow` rows with the same
  two-step confirm revoke as the AI approvals screen (`RevokeConfirmDialog`);
  a 404 drops the row quietly (already revoked elsewhere), any other failure
  shows one fixed sentence. The route calls the hook once, so the root's count
  and this page share one list and one request. The load is gated on `isManager`
  (the row is manager-only), so members never fire it.

**Media and pins (`group-info-pages.tsx`, new; sheets).** `MediaSheet` and
`PinsSheet` are mounted beside the pages. A jump goes to the group's chat at the
message through the search-hit driver (`openSearchHitEffect`: `openAtMessage`
pages back, then `router.push('/chat/[id]')`; a miss lands with `notFound=1`),
exactly like search results. Unpin follows the chat screen's `canPin` rule.

**How the pins are loaded.** Through the store's `refreshPins(groupChatId)`,
which is the loader the chat screen uses (`openChat` runs the same core
`loadPins`; `refreshPins` is its exposed form). The list is
`state.pins(groupChatId)`, `canUnpin` is `state.canPin(groupChatId)`, unpin is
`state.unpinMessage(groupChatId, pinId)`. It runs once when the group chat row
is known (for the root count) and again when the Pinned row opens; the count
stays hidden until the first load succeeds. `use-chat-screen.ts` was reusable as
is, so I did not change it.

**File sizes (`wc -l`).**
- `apps/mobile/src/app/group-info/[id].tsx` 335
- `apps/mobile/src/components/group-info/root-page.tsx` 175
- `apps/mobile/src/components/group-info/group-info-pages.tsx` 223 (new)
- `apps/mobile/src/components/group-info/tools-page.tsx` 81 (new)
- `apps/mobile/src/components/group-info/activity-page.tsx` 36 (new)
- `apps/mobile/src/components/group-info/allowed-page.tsx` 205 (new)
- `apps/mobile/src/lib/tools-api.ts` 212
- `apps/mobile/src/lib/audit-api.ts` 69
- `apps/mobile/src/components/ais/ai-activity.tsx` 323

Because `[id].tsx` first grew past 400, per step 6 I moved the page switch into
the new `group-info-pages.tsx`; the switch alone was not enough to get back under
400, so that file also holds the media/pins state (`useGroupContent`,
`GroupContentSheets`). `[id].tsx` is now 335 lines.

### Checks run

- `pnpm gate` (first run): `FAIL typecheck` — one error,
  `allowed-page.tsx(194,22): Property 'confirmRule' does not exist on type
  'GroupRulesHandle'`. Fixed (added `confirmRule` to the handle), then re-ran.
- `pnpm gate` (final): `GATE PASS`, with
  ```
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.5s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/mobile  (2.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  ```
- No tests were added (the task says "Tests: None"; the change is UI only). No
  other command was run on its own, per AGENTS (gate runs format, lint,
  typecheck and the nearest tests). I did run `pnpm exec prettier --write` on the
  nine files before the first gate so the format step would pass.

I could not run the phone mock or the acceptance screen (`/group-info/g-devteam`)
— that needs the lead's/Junio's smoke. The mock backend already serves
`/groups/:id/tools`, `/groups/:id/routines`, `/audit?groupId=…` and
`/groups/:id/approval-rules`, so the pages have data in mock mode.

### Notes for the lead

1. **`[id].tsx` / step 6.** I moved the page switch into `group-info-pages.tsx`
   as the spec says, and put the media/pins state there too (the switch alone
   left the route at ~420 lines). The route still owns `page`, the data and all
   the sheets/dialogs; `group-info-pages.tsx` is the switch plus the two content
   sheets.
2. **Tools page has no sub-headings**, per the "no headings" rule and the
   instruction to use `*SectionContent`; the page title is "Tools and routines".
   If you prefer "Tools" / "Routines" labels there, it is a two-line change.
3. **Activity page** reuses the whole `AiActivity` list (load, Refresh via the
   retry path, Load more) with `showHeader={false}`; the small "Activity" heading
   is dropped so the 28 px page title is the only one.
4. **Counts.** Pinned is loaded eagerly on the route (extra request), Always
   allowed only for managers; both stay hidden until loaded, per the board rule.
5. **Scope.** Only the Allowed files were touched; web, the server, channels and
   Settings (T4) were left alone. `use-chat-screen.ts` was not needed.
6. The mobile Activity/tools/routines/always-allowed pages send manager-scoped
   reads; the server remains the enforcer.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 2 nits.
- **Phone smoke** (`/group-info/g-devteam`, owner, mock): PASS. Between People and Settings, a Content group shows:
  - Shared media;
  - Pinned messages `0`;
  - Tools and routines;
  - Activity;
  - Always allowed `0`.
  - The board shows "Always allowed 0", so a loaded zero is displayed.
- **Read in the code:**
  - **The page switch** moved into `group-info-pages.tsx` (223 lines); the screen is 335.
  - **Activity:** `ai-activity.tsx` takes an `AuditScope` (`{ aiId } | { groupId }`), the same as web, and the AI screen's call site is unchanged.
  - **Tools:** the tools 404 maps to an empty list, as on the AI screen.
  - **Pins:** unpinning uses the chat screen's rule.
- **Left as nits:**
  - a failed jump from a pin or media hit gives no feedback;
  - the Activity and Always allowed pages rely on the manager-only rows; the server enforces access anyway.
