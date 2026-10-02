---
id: T-0130
title: Topics web fixes found by the T-0111 pre-review
status: merged
milestone: M5
branch: task/T-0130-topics-web-fixes
model: meta/muse-spark-1.3-contributor
depends_on: [T-0111, T-0113]
estimate: 0.5 day
---

# T-0130: Topics web fixes

## Spec (written by Claude, do not edit)

### Why
The pre-review of T-0111 finished after the merge and found real problems. Fix exactly these, in `apps/web` only. Read the current code first (`main` already has T-0111 and T-0113 merged).

### Fixes
1. **Kebab "Archive topic for everyone" leaves you on a dead topic** (`components/ChatHeader.tsx`, `store/realStore.ts` `applyTopicRow`): after the archive succeeds, call `refreshChats()` and navigate away exactly like the topic panel's archive does (to the group's General topic if it exists, else `/`). The archived row must disappear from the sidebar at once, not after the 60 s poll.
2. **A failed member removal kicks you out of the topic** (`store/realStore.ts` `removeTopicMember`, `components/TopicPanel.tsx`): the store refreshes and rethrows on ANY error, and the panel treats any rejection as "the topic was archived because the last member left" and navigates away. Only take the archived path when the server answered 404 (the topic is gone); on any other error (403, network) keep the user where they are and show the inline error. Add store and panel tests for a 403 and a network error (user stays, error shown) and for the 404 (user is moved).
3. **Mock store topic actions throw** (`store/store.ts`, used by `?mock=1`): `createTopic`, `patchTopic`, `addTopicAi`, `removeTopicAi`, `addTopicMember`, `removeTopicMember`, `leaveTopic`, `setMembersCanCreateTopics` must work in memory against the mock bundle in `mock/topics.ts`/`mock/api.ts` (the mock HTTP layer already implements them), so the New topic dialog, the task strip edits and the topic panel work in mock mode. Add one render test that opens the New topic dialog in mock mode, creates a topic and sees it in the sidebar, and one that changes a strip status.
4. **`TaskStrip.tsx` AI owner radio** compares by display name; compare `kind` and id like the user option. Test with two AIs that share a name.
5. **`TopicKeyboardNav.tsx`** accepts `activeChatId` and `groups` and discards them with `void`; either drive focus from them or remove the props and their call sites. It must not grab non-topic `/c/` links.
6. Nits: remove the tautology in `NewTopicDialog.tsx` (`store.groupInfo(groupId) ?? store.groupInfo(chat?.topic !== undefined ? groupId : groupId)`); add one render test with an archived row injected that shows the "Archived (n)" toggle and the removed-while-open redirect.

### Read first
`AGENTS.md`, `work/T-0111-topics-web.md` (Report and Review), `work/T-0113-chat-prefs.md`.

### Allowed files
`apps/web/**` and `work/T-0130-topics-web-fixes.md`. Not allowed: server, mobile, `chat-core` (unless a type must change; say so in the Report), dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/web test --maxWorkers=2
pnpm build
```
(Correct form for the test command; never `test -- --maxWorkers`. Run the full web suite once, at the end.)

### Acceptance criteria
- [ ] Each of fixes 1 to 6 done with a test that fails without it.
- [ ] Web suite exits 0 with no unhandled errors.

### Out of scope
Anything not listed. No live browser check is possible for the worker: say in the Report what the tests prove and what still needs eyes.

---

## Report (written by the worker when done)

### What I did
- Fix 1 (kebab archive leaves a dead topic): `ChatHeader.tsx` `archive()` now navigates after success exactly like the topic panel (to the group's General topic when it exists, else `/`); `store/realStore.ts` `applyTopicRow` drops an archived row at once (the server excludes archived topics) instead of keeping it until the 60 s poll; new `refreshGeneralTopic` store action (mock + real) resolves General after a real list refresh so navigation never lands on a stale row.
- Fix 2 (failed member removal kicks you out): `realStore.ts` `removeTopicMember` is ONE DELETE and rethrows as-is; `TopicPanel.tsx` `removeMember` is ONE call (the store action only) and navigates away only when `refreshTopicRow` proves the topic row is gone from the refreshed list. 403/network rejections keep the row and the open chat; a 404 for a non-member (stale list, double click) reloads the members and stays.
- Fix 3 (mock store topic actions threw): `store/store.ts` mock store now implements `createTopic`, `patchTopic`, `addTopicAi`, `removeTopicAi`, `addTopicMember`, `removeTopicMember`, `leaveTopic`, `setMembersCanCreateTopics` in memory through the mock HTTP layer (`mock/api.ts` already implements every topic route), folding returned rows into the painted list (archived rows drop out at once). New render tests: the New topic dialog creates a topic in mock mode and it appears in the sidebar; the strip status flips Open → Done against the mock PATCH with no inline error.
- Fix 4 (AI owner radio compared by display name): `TaskStrip.tsx` derives both user and AI owner ids from the mention JID (`ai-<id>@<domain>` → `<id>`, like the server's JID format) and compares `kind` + `id` for both kinds. Test seeds two AIs sharing the name "Helper" with the second owning the topic: exactly one radio reads checked.
- Fix 5 (`TopicKeyboardNav` discarded props): removed the `activeChatId`/`groups` props and both call sites (`ChatList.tsx`); the wrapper now navigates only `a[data-topic-row]` inside `nav[aria-label="Chats"]`, so DM/group singleton rows, message links, search hits and the empty state never take part. `TopicRow.tsx` marks its link with `data-topic-row`. Test walks the full Up/Down cycle and asserts every stop is a topic row, never the DM.
- Fix 6 (nits): removed the `NewTopicDialog.tsx` tautology (`groupInfo(groupId) ?? groupInfo(same)` → `groupInfo(groupId)` with a comment on the key). Added a render test with an injected archived row showing the "Archived (1)" toggle and revealing the row on open. The removed-while-open redirect is covered by the existing real-store test plus the new kebab-archive test (dead topic → General).
- Fail-without verification: the new strip owner test fails on the old name comparison (both Helpers would read checked / wrong id sent); the 403 panel test fails on the old any-error-navigates code (dialog would close); the mock dialog test fails on the old throwing stubs.

### Review fixes (lead pre-review findings 1–5)
- MUST-FIX finding 1 (double DELETE → false 404 navigation): `TopicPanel.removeMember` now calls only the store action (one DELETE). The panel treats a 404 as "gone" only when `refreshTopicRow` (real: re-fetch list, row absent; mock: row absent locally) says the topic itself is gone — otherwise it reloads the members and stays with no error. `mock/api.ts` DELETE now 404s for a non-member like the server, so the strict mock would have caught the old bug. Tests: panel 404-on-live-topic stays open with no alert; panel really-removes-Ana shows her row gone and stays; store `refreshTopicRow` returns false with the row listed, true when gone.
- Finding 2 (keyboard nav walks DM rows): nav now selects `a[data-topic-row]` only; `TopicRow` marks its link. The old single-step test is replaced by a full-cycle walk asserting no stop is the DM row. Fails without the fix (DM link has no attribute, cycle would land on it).
- Finding 3 (`refreshGeneralTopic` awaited a schedule): now awaits the real `refreshChats()` closure before resolving General. Test removes General locally and proves the action resolves it from the fetched list (fails on the old code: `getChats` never called, resolves undefined).
- Finding 4 (self-archive notice): `patchTopic` marks the open chat quiet when its own archive succeeds; the removed-while-open flow consumes the mark and moves to General with `topicNotice` unset. Store test proves quiet move; the kebab mock test asserts `topicNotice` is undefined after the archive. Genuine disappearances still show the notice (pre-existing test).
- Finding 5 (test name overclaim): renamed to "shows an injected archived row under the Archived toggle".

### Files changed
- `apps/web/src/components/ChatHeader.tsx`: kebab archive navigates to General/`/` after success.
- `apps/web/src/store/realStore.ts`: `applyTopicRow` drops archived rows at once; `removeTopicMember` is one DELETE + rethrow; new `refreshTopicRow` (real refresh + row check); `refreshGeneralTopic` awaits the real `refreshChats()` closure; `quietArchiveIds` set suppresses the self-archive notice; `leaveTopic` swallows 404 after refreshing; `ApiError` import.
- `apps/web/src/store/store.ts`: `refreshGeneralTopic` + `refreshTopicRow` on the interface with mock impls; all eight mock topic actions implemented in memory (+ `withMockTopicRow`/`mockChatFor`/`topicIdForChat` helpers, `Topic` type import); mock `patchTopic` clears a lingering notice on self-archive.
- `apps/web/src/components/TopicPanel.tsx`: single store-only removal call; 404 → `refreshTopicRow` decides (gone → navigate, alive → reload members, no error); non-404 → inline error; unused endpoint import removed.
- `apps/web/src/mock/api.ts`: DELETE answers 404 for a non-member like the server.
- `apps/web/src/components/TaskStrip.tsx`: `ownerIdFor` JID helper; AI radio compares `kind` + `id`; AI id sent is the server id, not the JID.
- `apps/web/src/components/TopicKeyboardNav.tsx`: props removed; selects `a[data-topic-row]` in the chat-list nav.
- `apps/web/src/components/TopicRow.tsx`: `data-topic-row` on the row link.
- `apps/web/src/components/ChatList.tsx`: call site updated (no props).
- `apps/web/src/components/NewTopicDialog.tsx`: tautology removed.
- Tests: `TaskStrip.test.tsx` (+1 AI-owner-by-id), `TopicPanel.test.tsx` (+3: 403 stays + inline error, 404-on-live stays with no alert, real removal shows row gone and stays), `realStore.topics.test.tsx` (+6: archived-patch drops row, quiet self-archive, `refreshGeneralTopic` awaits fetch, 403 keeps row, network keeps row, 404 row-check alive/gone), `TopicsMockE2E.test.tsx` (+2: dialog create in mock mode, strip status in mock mode; +1 kebab archive → row gone, view on General, no notice), `TopicsSidebar.test.tsx` (+2: full-cycle nav skips DM, archived toggle; renamed overclaiming test), `ChatPrefs.test.tsx` (topic PATCH stub so the pre-existing row/header tests run against the new archive path).
- `work/T-0130-topics-web-fixes.md`: this Report; status → review.

### Review round 2 (lead packet, 5 findings — verified already fixed in tree)
This round's packet (`PREREVIEW.md`, read then deleted, not committed) lists the same 5 findings as the first review round, and all are already implemented in commits `9ab6098` + `3e2a700`. I verified each against the current code and re-ran every check:
- Finding 1 (double DELETE): `TopicPanel.removeMember` calls only the store action (one DELETE, `TopicPanel.tsx:262-263`); a 404 navigates away only when `refreshTopicRow` proves the row is gone (`realStore.ts:2651-2654`); the mock DELETE 404s for a non-member (`mock/api.ts:1038-1043`), so the strict mock catches the old bug. Tests: `TopicPanel.test.tsx:152` (404-on-live stays, no alert), `:167` (real removal, row gone, stays), `realStore.topics.test.tsx:398` (row-check false-when-listed / true-when-gone).
- Finding 2 (nav walks DMs): nav selects `a[data-topic-row]` only (`TopicKeyboardNav.tsx:24`); `TopicRow.tsx:59` marks its link. Test `TopicsSidebar.test.tsx:59` walks the full Up/Down cycle asserting no stop is the DM row.
- Finding 3 (`refreshGeneralTopic` await): awaits the real `refreshChats()` closure (`realStore.ts:2588-2593`), with the comment explaining `refreshChats` action only schedules. Test `realStore.topics.test.tsx:344` removes General locally and resolves it from the fetched list.
- Finding 4 (self-archive notice): `quietArchiveIds` (`realStore.ts:510,2151-2152,2620`) suppresses the notice for the archiving client. Tests: `realStore.topics.test.tsx:317` (quiet move) + kebab mock test asserting `topicNotice` undefined.
- Finding 5 (test name): `TopicsSidebar.test.tsx:108` renamed to "shows an injected archived row under the Archived toggle".
- No code changes were needed this round; only the task file (this Report section + status) changed, plus deletion of the packet.

### Review round 3 (lead packet, findings 1–4; 5–6 skipped per instructions)
Packet (`PREREVIEW.md`, read then deleted, not committed) verified against HEAD `64c2fd5`:
- Finding 1 (gone-path untested + overclaiming name): renamed `TopicPanel.test.tsx:167` to "stays on a live topic when the removal removes Ana but the topic lives on" with a comment explaining why it does not archive. Added "navigates away when the row re-check finds the topic gone" (DELETE 404s, row dropped to simulate archived server truth → asserts dialog closes, i.e. `navigate('/')` + `onClose`). Added "keeps the user in the topic with an inline error on a network failure" (DELETE throws `ApiError` 0/network → inline error shown, dialog stays). Fail-without: dropping the `navigate`/`onClose` calls fails the gone test (dialog stays open); the old single-DELETE-without-recheck code fails the new tests the same way as round 1.
- Finding 2 (PATCH payload unasserted): the AI-owner test now clicks the non-owning Helper and asserts `patchTopic` was called with `{ owner: { kind: 'ai', id: 'helper-1' } }` — a JID-as-id regression fails it (verified by temporarily reintroducing `id: member.jid`: test fails with the JID in the received payload, passes after revert).
- Finding 3 (stale-state row check): split `refreshChats` into a swallowing wrapper + throwing `refreshChatsOrThrow`; `refreshTopicRow` awaits the throwing half so a failed refresh rejects and the panel shows the inline removal error instead of misreading stale state as "alive". New store test: DELETE 404s + `getChats` rejects → `refreshTopicRow` rejects with the network error and the row is untouched. Background callers (poll, focus, roster, schedule) keep the old swallow-and-retry behavior — only the re-check throws.
- Finding 4 (static import): all `await import('@/lib/api')` in `store.ts` (topic actions + chat-prefs actions) replaced with one static import block; `tsc` clean, which rules out an import cycle (`store.ts` → `api.ts` → `mock/*`, none import the store back). The vite `INEFFECTIVE_DYNAMIC_IMPORT` warning source is gone (full-build re-verification below).
- Findings 5–6 skipped per instructions (no changes).

### Commands run and real results (round 3)
- `pnpm install`: pass (809 ms, "Already up to date").
- `pnpm format:check`: pass ("All matched files use Prettier code style!") after deleting the lead's `PREREVIEW.md` packet (it was the only prettier-dirty file; packets are not committed).
- `pnpm lint`: pass (oxlint clean, exit 0).
- `pnpm typecheck`: pass (turbo 10/10 tasks successful).
- `pnpm --filter @zilar/web test --maxWorkers=2`: 69 files passed, 756 passed, exit 0, no unhandled errors.
- `pnpm build`: pass (2/2 turbo tasks).
- Round 3 full suite (once, at the end, restricted form): 69 files passed, 759 passed, exit 0, no unhandled errors. `pnpm build`: 2/2 pass with no `INEFFECTIVE_DYNAMIC_IMPORT` warning. (`format:check`/`lint`/`typecheck` re-verified above in this round.)

### Commands run and real results (rounds 0–1)
- `pnpm install`: pass (6.7 s, first run).
- `pnpm format:check`: pass ("All matched files use Prettier code style!") after `prettier --write` on touched files. Note: `PREREVIEW.md` (lead's file, not committed) is prettier-dirty; all tracked files pass.
- `pnpm lint`: pass (oxlint clean, exit 0).
- `pnpm typecheck`: pass (turbo 10/10 tasks successful).
- `pnpm --filter @zilar/web test --maxWorkers=2`: 69 files passed, 753 passed, exit 0, no unhandled errors (first round). Full suite re-run once at the end (see below).
- `pnpm build`: pass (2/2 turbo tasks).
- Per-file Vitest runs during review fixes (one command at a time, `--maxWorkers=2`): `TopicPanel.test.tsx` 9 passed; `realStore.topics.test.tsx` 13 passed; `TopicsSidebar.test.tsx` 8 passed; `TopicsMockE2E.test.tsx` 3 passed.
- Final full suite (once, at the end): 69 files passed, 756 passed, exit 0. (`format:check`/`lint`/`typecheck`/`build` re-verified above during the review round.)
- Round 2 verification full suite (once, at the end): 69 files passed, 756 passed, exit 0, no unhandled errors.
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|: any|as any` in touched non-test source: no hits.

### Problems, deviations from the spec, open questions
- Panel double-call kept: `TopicPanel.removeMember` still calls the endpoint then the store (spec says both files are in scope and the store must refresh+rethrow correctly; the panel tests prove the 404/403 split on both calls). The store call can 404 on a row the endpoint already archived — that also navigates, which is correct since the topic is gone.
  → SUPERSEDED by review finding 1: the double call is removed (single store call). The paragraph above is kept for history; the current code issues exactly one DELETE per removal.
- `ownerIdFor` assumes the web JID convention `ai-<id>@<domain>` for AIs (matches `mock/groups.ts`, `mock/members.ts`, and the server's `ai-<aiId>@<domain>` in `apps/server/src/ais/*test.ts`); users stay `<id>@<domain>`. If the server ever changes AI JID shape, the strip owner mapping needs revisiting — the unit test pins the current shape.
- Keyboard nav still matches `a[href^="/c/"]` *within the chat list*: DM/group singleton rows are inside the nav so Up/Down can land on them (same as before — the pre-existing test proves General→topic movement). What fix 5 required — not grabbing *non-list* `/c/` links (message links, search hits) and not taking dead props — is done; scoping tighter (topic-links-only) would change Up/Down behavior for DMs and was left alone.
  → SUPERSEDED by review finding 2: nav now selects `a[data-topic-row]` only, so DM rows are skipped too. The full-cycle test proves it.
- No live browser check was possible (worker environment): the mock-mode render tests prove dialog-create → sidebar, strip edits, kebab archive → General, and panel 403/404 flows. Still needs eyes: real-server archive navigation timing (refresh round-trip), the kebab on a topic whose General hasn't loaded, and the two-AIs-same-name picker against real group members.
- `applyTopicRow` archived-drop: a manager archive that the server answers with `archived: false` (shouldn't happen) would upsert normally; the row then leaves on the next poll/refresh.
- Review finding 3 note: `refreshGeneralTopic` awaits the real `refreshChats()` closure directly. `refreshChats` as an action still only schedules (debounce for background events); only this action awaits the closure. The test pins the await.
- Review finding 4 note: the quiet mark is consumed by the next `refreshChats()` run for that chat id. If a *genuine* disappearance of the same topic lands in the same refresh batch (vanishingly unlikely — the row was just archived by this client), the notice would be suppressed once. Acceptable.
- `PREREVIEW.md` in the worktree is the lead's file: read, not edited, not committed.
- Round 3 packet likewise read then deleted (`rm PREREVIEW.md`), not committed.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:** merged after three rounds; no must-fix left.

### Findings
- Fixed across the rounds: kebab archive navigates away and the row drops at once; a failed member removal no longer kicks you out (single DELETE, 404 re-check throws on refresh failure); mock store topic actions work; AI owner compared by id (PATCH carries the AI id); topic-only keyboard navigation; quiet notice for a self-archive; tests for the gone path, 403 and network error.
- UI verified by tests and mock mode only, not live.

### Follow-ups
- `TopicPanel.leave()` swallows every error and always navigates away; on a network error the user is moved but still a member. Stay and show the inline error on non-404.
- `quietArchiveIds` is not cleared when General is absent after a self-archive.
- `addMember`/`addAi` in the panel still call the endpoint and then the store (double write, second error swallowed).
- Kebab archive failure sets `actionError` on a hidden element (no visible feedback).
- `refreshTopicRow` can read a stale list if a generation bump aborts the refresh.
