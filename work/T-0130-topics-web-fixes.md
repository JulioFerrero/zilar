---
id: T-0130
title: Topics web fixes found by the T-0111 pre-review
status: planned
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
pnpm --filter @galena/web test --maxWorkers=2
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
