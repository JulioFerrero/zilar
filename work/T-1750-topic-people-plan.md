---
id: T-1750
title: "Plan: the group and topic people flow from the approved boards (header stack and writing line, @ list of who's here, 'isn't in' line, In this topic with one-step Add people or AIs, per-topic tools and routines, group screen with who's in each topic), web + phone + server"
status: merged
milestone: M5
branch: task/T-1750-topic-people-plan
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1750: The topic people plan

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 Julio found the group and topic flow "non intuitive":
- he can't see who is in which topic;
- he can't add AIs or people;
- an @mention of an AI that wasn't in the topic went silent.

He approved a redesign. The boards and the rules are in `docs/design/mockups/topic-people/`; read the `README.md` and every `.dc.html` there. His choice: AIs stay **per topic**, and adding one from a topic is **one step** (if it isn't in the group yet, the same add puts it there). This task writes the plan only. No code.

### Facts (the lead read them on 2026-10-16)
- **The tables:**
  - `group_members` (`apps/server/drizzle/0003_shocking_boom_boom.sql:10`) and `group_ais` (`0008_sad_vulcan.sql:1`);
  - `topics` with `visibility` (public or private) and `is_general`, plus `topic_members` for private topics (`0018_lethal_warhawk.sql:1-25`);
  - `topic_ais` (`0020_dry_lord_hawal.sql:1-7`).
  - General's AIs are the group's `group_ais`: `apps/server/src/topics/ais.ts:23` (adding there answers 400) and `apps/server/src/topics/members.ts:63-76`.
- **Topic AIs:**
  - on the server, `apps/server/src/topics/ais.ts` (it checks `group_ais` at `:60`);
  - on web, `apps/web/src/components/panels/TopicAisSection.tsx` has an add picker, fed by `addableAis` in `apps/web/src/components/TopicPanel.tsx:113` (the caller's own AIs in the group);
  - the phone topic sheet `apps/mobile/src/components/chat/topic-info-sheet.tsx` (371 lines) only lists AIs (`:184-209`) and says "Roles are only available on private topics" (`:339`).
- **Phone group info:**
  - `apps/mobile/src/components/group-info/root-page.tsx`, `members-page.tsx` ("Add members" and "Invite with a link" at `:180-181`) and `ais-page.tsx` ("Add AI" for managers at `:107`).
  - The web group panel parts are `apps/web/src/components/panels/Group*.tsx` and `apps/web/src/components/GroupPanel.tsx`.
- **Tools and routines:**
  - the `routines` table has `group_id` and `topic_id` (`apps/server/drizzle/0023_classy_lester.sql:1-25`), but `ai_tools` has only `group_id` (`0017_plain_warstar.sql:25-36`);
  - the group pages are `apps/mobile/src/components/group-info/tools-page.tsx` and the web group panel's tools section.
- **Rules:** files of at most 400 lines; tests only for auth and keys, permissions and money, and the message pipeline; web and phone ship together; D24, matching the boards exactly.

### Steps
Write `docs/plan/topic-people.md`. Cite `file:line` for every claim about current code, and read before you write.
1. **Board by board:** for each board, list what exists today (file:line) and what's missing, on web and phone.
2. **The server:**
   - **One-step add:** an endpoint, or a change to the existing one, that adds an AI to a topic and, when it isn't in the group yet, to `group_ais` too, in one transaction. The same for a person: add to the group, plus `topic_members` when the topic is private.
   - **Who may do what:** today's rules, with file:line (owners and admins, the AI's owner, members); keep them unless the boards need a change, and say which.
   - **A read for the group screen:** each topic's people and AIs, for the stacks and the "4 people · Deepseek" line. Say whether today's topic and member APIs already give it.
   - **Per-topic tools and routines:** how the topic's "Tools and routines · 1 · 2" row gets its counts and list (routines by `topic_id`; for tools, is it "tools used by this topic's routines" or a new `topic_id`?). Recommend one.
3. **The client:**
   - **The header stack** and the "group · N" line, and the **writing line**: find how typing (chat states) works today in groups and topics, on both apps, and how to show the writers' names.
   - **The @ list filtered** to who's in the topic: find the mention autocomplete on both apps.
   - **The "isn't in" line** after a mention of a group member or AI who isn't in the topic: where it's decided, shown only to the sender, and its Add action.
   - **In this topic** on phone (sheet) and web (panel), and the **Add** sheet and dialog with People and AIs tabs.
   - **The group screen's Topics list.**
4. **The task breakdown:** ordered tasks, each one worker of about 20–45 min, with exact files, a minutes estimate, and the web and phone twins.
   - Server first, then web and phone in pairs.
   - At most 2 tests per task, and only for permissions (the one-step add's rules).
   - Every file stays at most 400 lines; `topic-info-sheet.tsx` (371) needs a split before it grows.
5. **Open questions for Julio** (at most 3), each with a recommended answer.

### Allowed files
- `docs/plan/topic-people.md`
- `work/T-1750-topic-people-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`docs/plan/topic-people.md`** covers steps 1–5 with `file:line` citations and a task list the lead can turn into specs.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

Wrote `docs/plan/topic-people.md` (plan only, no source changed): read all nine
`.dc.html` boards and `README.md` under `docs/design/mockups/topic-people/`, then
read the code and cited `file:line` for every claim.

- **Step 1 (board by board):** a table of the nine boards vs today's code, web
  and phone. Found: the header stack and count are missing on both; the writers'
  names exist but render as plain subtitles; the `@` list is group-level on both;
  phone's `topic-info-sheet.tsx` (371 lines) has no Add owner labels or
  tools/routines row; web and phone lack the Add sheet/dialog and the group
  screen's Topics list.
- **Step 2 (server):** recommended the one-step add as a change to the existing
  `addTopicAi`/`addTopicMember` handlers (group half in one `sql.withTransaction`,
  cap re-read inside); recorded today's rules and the rule changes the boards
  need (public topics accept a person add; an AI that must join the group keeps
  the owner/admin group rule). For the group screen read: the topics list already
  gives counts and AI names, recommend adding `memberIds` to `Topic` and
  `avatarUrl` to `TopicAi`, and fixing the non-General public count to `topic_ais`
  only. For tools/routines: both already carry `topic_id`; add
  `GET /api/topics/:id/routines`.
- **Step 3 (client):** header stack + `writingLabel`; mention candidates filtered
  to the topic; the sender-only "isn't in" line; In this topic with Add on both
  apps; the group screen's Topics list. Named exact files for each.
- **Step 4 (task breakdown):** 11 tasks in three waves (server first, then
  web/phone pairs), each ~35–45 min with exact files and its twin; tests only for
  permissions (2 in S1, 1 each in S2/S3); split `topic-info-sheet.tsx` in W6.
- **Step 5 (open questions):** the topic panel container (Sheet vs the board's
  340 px panel), a public topic's AI set, and who may make an AI join the group —
  each with a recommendation.

### Checks run

- `pnpm install` — Done in 14.7s.
- `pnpm gate` (repo root) — summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No files outside the Allowed files. No tests ran (no source files changed), so
  no single test file was run; the plan is documentation only.

### Notes for the lead

- The plan derives its task list (S1–S3, W1–W8) from the code and the boards; the
  ids are letters for the lead to turn into specs.
- The three open questions are real product decisions, not blockers: the plan
  states a recommendation and the rule each task should assume.
- No files outside `docs/plan/topic-people.md` and this task file were changed.

### Round: prereview fixes (2026-10-16)

Fixed the two should-fix findings in `docs/plan/topic-people.md`; left the four
nits untouched (the brief says not to touch nits unless they are on a line
already changed).

- **Finding 1 (should-fix, S1).** The S1 task text now requires a group
  owner/admin guard on the group half, separate from `requireManagedTopic`:
  the `group_members` insert must not go through a plain-member topic creator
  (who passes `requireManagedTopic` for their own topic, `access.ts:194-196`),
  and the AI group-join branch checks the actor is a group owner/admin and owns
  the AI (`groups/ais.ts:45-56`) before inserting `group_ais`. S1's second
  permission test now names that scenario, refused with 403 `forbidden`.
  Commit `fa8172506`.
- **Finding 2 (should-fix).** The cross-cutting rule's citation changed from the
  phantom `work/T-1747-message-blocks-plan.md:538` to `:34`, where the
  "every user-facing change ships on web and phone" rule actually lives.
  Commit `ef61c335f`.

Tests: none added or run. The diff still only changes the plan document; no
source or test files changed, so there is no behaviour to test. The finding-1
fix is a change to a task description, not to code.

`pnpm gate` (repo root, after both commits) — summary:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (0.9s)
PASS  typecheck  (1.0s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

`status: review` kept.

### Round: prereview fixes 2 (2026-10-16)

Fixed the one should-fix finding in `docs/plan/topic-people.md`; left the one nit
untouched (it is not on a line I changed).

- **Finding 1 (should-fix, cap).** §2.1's cap bullet and S1 now require the
  per-group advisory lock **before** the count, not just a re-read inside the
  transaction: `pg_advisory_xact_lock(hashtext('group-join:' + groupId))`, the
  exact key and pattern `apps/server/src/groups/join.ts:104` already uses, so a
  concurrent join and a concurrent one-step add serialize and the
  `MAX_GROUP_MEMBERS` cap is atomic instead of check-then-insert. Commit
  `a813988e8`.
- **Finding 2 (nit).** Not touched: it is on the S2 test line (`:317-318`), which
  this round does not change. Left for the lead, as the brief allows.

Tests: none added or run. The diff still changes only the plan document; no source
or test files changed, so there is no behaviour to test. The finding-1 fix is a
change to a task description, not to code.

`pnpm gate` (repo root, after the fix) — summary:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.2s)
PASS  lint  (0.9s)
PASS  typecheck  (0.9s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

`status: review` kept.

### Round 2 scope addition (2026-10-16, same branch)

The lead added join, leave, mute and the new public-topic membership rule. Plan
only, no code. Read the Round 2 boards from `main` (`b7c239dc5`) with `git show`
(README's "Round 2" section, and `PhoneGroup`, `PhoneJoin`, `PhoneLeave`,
`PhonePeople`, `WebTopic`, `WebGroup`); no rebase, no board files on this branch.

Added to `docs/plan/topic-people.md`:

- **Intro note** that the Round 2 boards live on `main` (`b7c239dc5`).
- **§2.5 the new membership rule.** Today a public topic has no `topic_members`
  rows; its people are implicitly the whole group (`service.ts:104-118`,
  `views.ts:13-27`, `queries.ts:58-72`, `room-members.ts:48-79`,
  `agents/gateway/db.ts:318-322`). Recommends `topic_members` holds a public
  topic's people too, with `isGeneral` (not `visibility`) selecting the
  whole-group rule; creator joins at creation; `patch.ts` stops deleting
  `topic_members` on going public; the backfill migration
  `apps/server/drizzle/0069_topic-members-backfill.sql`; a shared
  `TopicMemberRow` in `db/rows.ts`. Says who receives messages/pushes
  (`room-members.ts`, `room-push.ts`, `push/candidates.ts`) and that a
  non-member may read a public topic (`canSeeTopic`, `access.ts:93-95`).
- **§2.6 join and leave.** A new `POST /api/topics/:id/join`, and reusing
  `DELETE /topics/:id/members/:userId` for self-leave, refusing General; the
  permission rules; the leaver's AIs (`emitDroppedTopicAis`) and routines.
- **§3.6 the clients.** Your/Other topics lists, the Join-instead-of-composer
  preview, the Leave sheet, and the Mute switch; file names on web and phone with
  their sizes. Confirmed a topic's own room id can already be muted on both
  (`ChatActionsMenu.tsx:105-128`, `chat-actions-host.tsx:47-53`) and that push
  honors it (`candidates.ts:116`); only the switch and the muted icon are missing.
- **§4 task breakdown.** Added S4 (membership rule + backfill) and S5 (join and
  leave) to Wave 1, and W9/W10 (Join preview, Mute, Leave) to Wave 2; extended
  W7/W8 to the Your/Other lists, Join and muted icon; updated the cross-cutting
  rules. Changed S2's now-superseded "count to `topic_ais` only" line to defer to
  S4 (§2.5).
- **§5 open questions.** Kept at three: the panel container, who may make an AI
  join the group, and the new routines-on-leave question. Dropped Round 1's
  public-AI question, which Round 2 decided.

Tests: none added or run. The diff changes only the plan document and this report;
no source or test file changed, so there is no behaviour to test.

`pnpm gate` (repo root, after the plan edit) — summary:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.4s)
PASS  lint  (0.9s)
PASS  typecheck  (0.9s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

`status: review` kept.

### Round 3: prereview fixes (2026-10-16)

Fixed all 5 should-fixes and 3 nits from `PREREVIEW.md`, one commit per item, then
the gate. Plan only, no code; only `docs/plan/topic-people.md` changed.

- **Item 1 (finding 1) — preview history.** Added **§2.7** and task **S6**: a new
  read-only `GET /api/topics/:id/preview` for a public non-General topic a group
  member has not joined, reusing the search archive read
  (`search/archive-query.ts:105-131`, `search/service.ts:15-33`) and its decoding
  (`search/snippet.ts:48-70`), with the `UiMessage`-minimal shape and a per-user
  limiter. Corrected §3.6's false "reading the history works already"
  (`history-core.ts:63`); W9/W10 now render the S6 preview read-only. Commit
  `c77201a7d`.
- **Item 2 (finding 2) — drain-archive.** §2.6 and S5 now state archive-on-drain
  (`members.ts:227`) stays private-only; a public topic with no members stays live
  and joinable. Commit `1fd688859`.
- **Item 3 (finding 3) — public remove guard.** §2.6 and S5 now say a
  non-General public topic accepts **self only**; any other target, managers
  included, gets 403 `forbidden`. Commit `6f8e1132b`.
- **Item 4 (finding 4) — `joined`/`muted`.** Assigned to **S2**: contract `Topic`
  fields plus the `views.ts` fill (`toTopicView`/`toTopicViews`/`loadTopicViewParts`),
  `joined` = `topic_members` row or role holder (General always true), `muted` from
  the caller's `chat_prefs`. Commit `8c1de4fed`.
- **Item 5 (finding 5) — S4 split.** S4 is now **S4a (T-1754, merged)** =
  writes/creator/patch/backfill `0069`, and **S4b (T-1757, running)** = the read
  rule, `emitDroppedGroupTopicAis` for every non-General topic, re-backfill `0070`,
  and the `isTopicMember` helper; **S3 is T-1753, merged** with
  `listVisibleTopicRoutines` in `routines/reads.ts`. Commit `81882006b`.
- **Item 6 (nits 6–8).** Fixed the two citations (`agents/gateway/db.ts:342-349`,
  `topics/roles.ts:21-46`) and added the stale-comment refresh to S5. Commit
  `1202c47a5`.

Tests: none added or run — the diff changes only the plan document, no source or
test file.

`pnpm gate` (repo root, after the six item commits) — summary:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.3s)
PASS  lint  (1.1s)
PASS  typecheck  (1.0s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

`status: review` kept.

### Round 4: lead fixes (2026-10-16)

Aligned the Round-1 sections with the Round-2 membership rule; all six
`PREREVIEW.md` findings. Plan only, no code; only `docs/plan/topic-people.md`
changed.

- **Finding 1 — §2.1/§2.2/S1.** `addTopicMember` now inserts `topic_members` for
  **any non-General topic of either visibility** (public accepted), keeping the
  separate group-half owner/admin guard; deleted the "public topic's people are
  the whole group, so the topic half is a no-op" text. In §4, S1 moved **after**
  S4a/S4b (the Wave-1 list is now S4a, S4b, S1, S2, S3, S5, S6).
- **Finding 2 — §2.3/S2/§3.2/§3.4/W3/W4/W6.** `memberIds` is `topic_members`
  plus role holders for every non-General topic; only General is the whole group.
  The @ list (W3/W4) filters to `memberIds`; the People header (W6) is just
  "People" with its count — no "everyone in <group>".
- **Finding 3 — S6/§2.7.** The preview scopes `username` to the full room JID
  `<roomLocalpart>@<mucDomain>` (`search/service.ts:135-140`,
  `search/archive-query.ts:55-57`), not the bare localpart.
- **Finding 4 — `0070`.** S4b now names what `0070` adds: the group members who
  joined between T-1754's and T-1757's deploys, when only the writes were live and
  the reads still treated a public topic as the whole group.
- **Finding 5 — comment refresh.** S4b lists the comments T-1757 refreshed
  (`ai-access.ts:12-22`, `gateway/db.ts:305-316`, `room-members.ts:29-32,48-50`,
  `views.ts:14`, `roles/access.ts`, `routines/preflight.ts`, `groups/members.ts`);
  S5 now names the three T-0108 comments (`groups/members.ts:98,161,215`).
- **Finding 6 — S2 call sites.** S2 lists the 11 callers that take the caller id:
  `topics/api.ts:101,128,139,168,179,201,217,236,264,275` and
  `chats/list-handler.ts:165`.

Tests: none added or run — the diff changes only the plan document, no source or
test file.

`pnpm gate` (repo root) — summary:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (0.8s)
PASS  lint  (0.9s)
PASS  typecheck  (1.0s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

`status: review` kept.
