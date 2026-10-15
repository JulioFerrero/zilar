---
id: T-1542
title: "Audit (plan only): phone Group info and channel info against the approved boards (group-info Phone.dc.html; web T-1494/T-1508/T-1519 as the reference): what the phone has today (group screen header sheets), what the boards need, the shared data already on the client, and a task list of small phone tasks"
status: merged
milestone: M5
branch: task/T-1542-mobile-group-info-audit
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1542: Phone Group info audit

## Spec (written by Claude, do not edit)

### Why
Julio approved the Group info design on 2026-10-15 (`docs/design/mockups/group-info/`: README, `Main.dc.html`, `Phone.dc.html`, the web channel boards). Web shipped it in three tasks:
- T-1494: the info pages;
- T-1508: Leave, More and the member rows;
- T-1519: channel info.

The phone has no Group info screen. The group screen `apps/mobile/src/app/group/[id].tsx` (359 lines) opens header sheets instead:
- `TopicActionsSheet`;
- `NewTopicSheet`;
- `InviteLinksSheet` (`apps/mobile/src/components/chat/invite-links-sheet.tsx`);
- `GroupRolesSheet` (`apps/mobile/src/components/chat/group-roles-sheet.tsx`);
- `VisibilitySheet` (`apps/mobile/src/components/chat/visibility-sheet.tsx`).

The lead needs facts before writing phone tasks. **This task writes a plan only: no code changes.**

### What to write
Create `docs/audit/phone-group-info-plan.md` with:
1. **Boards:** what `Phone.dc.html` (and the README's phone notes) shows, section by section. Members and AIs count together ("AIs count as members", Julio 10-15).
2. **The phone today:** every group or channel info surface that exists, with `file:line` (the group screen's header, each sheet, member lists, invite links, roles, visibility, leave and delete if any, channel subscribers if any), and each file's line count.
3. **Web reference:** the web components from T-1494, T-1508 and T-1519 (`apps/web/src/components/group-info/`, `apps/web/src/components/channel-info/`), what each shows, and which data calls they make (`apps/web/src/lib/api/*`).
4. **Data on the phone:** for each piece the boards need, the phone API call that already exists (`apps/mobile/src/lib/*-api.ts`, with `file:line`) or "missing". Note any server route the phone lacks a client for.
5. **Gap table:** board section → phone today → what to build → files.
6. **Task list:** 3 to 6 phone tasks of about 30–60 worker minutes each, in order. For each one give:
   - the title;
   - the exact files (full repo paths), new or changed, every file kept under 400 lines;
   - which board section it covers;
   - dependencies.
   
   Channel info gets its own task(s).
7. **Open questions** for the lead, if any. Never guess: when unsure, say what you could not find.

### Rules
- Read the files; cite `file:line` for every fact.
- Docs only. The only files you change are the plan and this task file.
- Keep the plan under 300 lines.

### Allowed files
- `docs/audit/phone-group-info-plan.md` (new)
- `work/T-1542-mobile-group-info-audit.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/phone-group-info-plan.md` exists, covers sections 1–7 with `file:line` facts, and ends with a task list the lead can turn into specs.

---

## Report (written by the worker when done)

### What I did

Plan only; no code changed. Created `docs/audit/phone-group-info-plan.md` (205 lines) with the seven
sections the spec asks for:

1. Boards: `Phone.dc.html` (115 lines) section by section, plus the README's phone notes and the
   web pages it mirrors — header/back key, identity with `6 members`, Mute/Search/Add/More keys,
   the People/Content/Settings groups, the red Leave row, and the borrowed web/channel rules.
2. Phone today: every group and channel info surface with `file:line` (group header, topic actions,
   invite links, members/roles, manage = Leave/Make owner/Delete, visibility, channel screen and
   members), each with its line count.
3. Web reference: the T-1494/T-1508/T-1519 components, what each shows, and the web data calls.
4. Data on the phone: for each board piece, the existing mobile API call (`file:line`) or
   "missing", including the gaps (group-scoped tools/routines/activity, add/remove members and
   group AIs, group picture, `membersCanCreateTopics` setter and listener).
5. Gap table: board section → phone today → what to build → files.
6. Task list: six phone tasks of ~60 min each, in order, with the exact new/changed repo paths,
   the board section each covers, and dependencies; each file stays under 400 lines.
7. Open questions: the group/channel entry point, Mute scope, the "AIs count as members" count,
   root counts, and the missing phone setters I could not find.

### Checks run

- `pnpm install` — done, 22.5s, "Done".
- `pnpm gate` (from the repo root) — ended with:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (0.6s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (1.4s)`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test file was run: the change is docs only and touches no code.

### Notes for the lead

- Deviations: none. The only files touched are the two Allowed files.
- The plan ends with the open-questions section (spec item 7) after the task list (item 6).
- Facts are all cited `file:line`. The one place I could not find a phone capability is the group
  background / `membersCanCreateTopics` setter / AI listener setter; the shared contract has them
  (`packages/api-contract/src/groups.ts:84,124`), so T4 would add the wrappers. Written up as
  open question 6.
- No blockers.

### Round 2 (fix round)

Pre-review (`PREREVIEW.md`, against 22f6809) had must-fix=0, should-fix=3, nit=4. All three
should-fix findings are fixed in the plan; the four nits were left as is (none sits on a line this
round changed). No test was added: every finding is a docs correction and no finding named a test.

- Finding 1 (`docs/audit/phone-group-info-plan.md:44-45`): replaced the phantom "Open group" row
  and the dead `:129-199` range with the sheet's real items and range — Pin/Unpin, Mute
  (durations + Unmute), Archive/Unarchive, Archive topic for everyone for managers
  (`topic-actions-sheet.tsx:68-110`).
- Finding 2 (`:84-93`): gave real paths for the five web components — `GroupMembersSection.tsx`,
  `VisibilitySection.tsx` and `InviteLinksSection.tsx` directly under `apps/web/src/components/`,
  `ais/AiActivity.tsx`, `approvals/AlwaysAllowedList.tsx` — so a spec author does not look under
  `group-info/`.
- Finding 3 (`:149-151`, T2 and T4): recorded that `apps/mobile/src/store/effects/group-actions.ts`
  is already 393 lines, and moved T2's membership effects and T4's settings effects into new files
  (`group-membership-actions.ts`, `group-settings-actions.ts`) composed in `store/effects/groups.ts`,
  so neither task grows a file past 400.

Checks: `pnpm gate` from the repo root ended with `GATE PASS`:

    gate: 2 changed file(s) against main
    PASS  install (frozen)  (2.1s)
    PASS  format  (1.3s)
    PASS  lint  (1.1s)
    PASS  typecheck  (1.1s)
    SKIP effect (no source files changed)
    scope: every changed file is inside the Allowed files
    migration: every added migration continues from the base
    images: every workspace package an app image needs is copied into its Dockerfile
    size: every changed source file is within 400 lines
    GATE PASS

No single test file was run: this round is docs only.

Disagreements: none. All findings accepted as written.

### Round 3 (fix round)

Pre-review (`PREREVIEW.md`, against c715ef3) had must-fix=0, should-fix=1, nit=4.

- Finding 1 (`docs/audit/phone-group-info-plan.md:101`; PREREVIEW cites `:100`): corrected the
  `listGroupRoutines` citation from `lib/routines.ts:92` to `lib/tools.ts:92`. Verified against the
  tree: `apps/web/src/lib/tools.ts:92` declares `listGroupRoutines`, while
  `apps/web/src/lib/routines.ts` is an 8-line re-export of shared wording helpers with no such
  function.
- The four carried-over nits were left as is: none sits on a line this round changed.

No test was added: the finding is a docs citation correction and named no test.

Checks: `pnpm gate` from the repo root ended with `GATE PASS`:

    gate: 2 changed file(s) against main
    PASS  install (frozen)  (1.2s)
    PASS  format  (0.8s)
    PASS  lint  (0.8s)
    PASS  typecheck  (1.0s)
    SKIP effect (no source files changed)
    scope: every changed file is inside the Allowed files
    migration: every added migration continues from the base
    images: every workspace package an app image needs is copied into its Dockerfile
    size: every changed source file is within 400 lines
    GATE PASS

No single test file was run: this round is docs only.

Disagreements: none. Finding 1 accepted as written.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean after 2 autopilot rounds; only citation-precision nits remain.
- **The plan** (`docs/audit/phone-group-info-plan.md`, 209 lines) has the boards, the phone today, the web reference, the data calls, a gap table and six tasks (T1–T6).
- **Lead answers to §7:**
  1. **Entry point:** tapping the group header (picture or title) opens Group info, as on web and in Telegram. T1 keeps the three header keys (Invite links, Visibility, Members and roles) working. T4 removes them once the Settings page carries visibility and the root has the Members and Invite links rows.
  2. **Mute** does what web does (`GroupInfoRoot.tsx:98-112`): it mutes the group's own chat row through the existing pref (forever or unmute). It does not mute each topic.
  3. **Counts:** the root shows people plus AIs ("AIs count as members", Julio 10-15). The Members row shows people only, and the AIs row its own count. The phone group header's "6 members, 2 AIs" should become one combined count in T1.
  4. **Counts the root loads:** only data already loaded (members and AIs from the group detail). Pinned and Invite-link counts show when the existing clients have them, and the number is hidden otherwise (README:49). No new requests just for counts.
  5. **Channel entry:** `ChannelScreen`'s info becomes the channel info root in T5.
  6. **Yes, T4 adds the client wrappers** for the group picture/background, `membersCanCreateTopics` and the listener (the contract has them).
- **Next:** the lead specs T1 now.
