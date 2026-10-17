---
id: T-1843
title: "General never reads as done: no green done check and no dimmed title in the topic lists or the header key on web and phone (working and waiting marks still show); topicActivityView takes isGeneral"
status: merged
milestone: M5
branch: task/T-1843-general-never-done
model: auto
effort: default
depends_on: [T-1835]
estimate: 25 min
---

# T-1843: General never reads as done

## Spec (written by Claude, do not edit)

### Why
**T-1835 removed "Mark as done" from General:** it's the group's room and never finishes. Yet on 2026-10-17 the lead saw General drawn as done:
- **Live:** "ai test › General" in the web sidebar has the green done check.
- **Mock:** Dev team › General on web and on the phone group screen has the check and a muted title.

**The cause:** `topicActivityView` reports `done` when no AI is working or waiting and either `doneAt` is set or any AI's last state is `done` (`packages/chat-core/src/topic-activity.ts:34-50`). Once an AI finishes a reply in General, General looks finished.

### Facts (read by the lead on 2026-10-17)
- **`topicActivityView(activity, doneAt)`** (`packages/chat-core/src/topic-activity.ts:34-50`) returns `{ active, done, label }`, where `label` is `'Done'` when done. The tests are in `topic-activity.test.ts:31`.
- **Callers that have the topic:**
  - web `apps/web/src/components/TopicRow.tsx:96` (also the title color at `:130`, and `<AiActivityMarks activity doneAt>` at `:144`);
  - phone `apps/mobile/src/components/chat/topic-row.tsx:77` and `<AiActivityMarks>` at `:124-128`;
  - phone `apps/mobile/src/components/chat/chat-header.tsx:128` and `<AiActivityMarks>` at `:247-251`;
  - phone `apps/mobile/src/components/chat/ai-status-line.tsx:24` (reads `.active` only, so no change).
- **The marks components:**
  - web `apps/web/src/components/topic/AiActivityMarks.tsx:80-89` and phone `apps/mobile/src/components/chat/ai-activity-marks.tsx:160-170` take `{activity, doneAt}`, call `topicActivityView` and draw `<DoneCheck />` when `view.done`;
  - web `apps/web/src/components/topic/AisHereKey.tsx:30-32,57,67` reads `chat.topic` and renders `AiActivityMarks`.
- **The flag:** `TopicInfo.isGeneral` is a boolean on every topic.

### Steps
1. **chat-core:** `topicActivityView(activity, doneAt, isGeneral = false)`. When `isGeneral`, `done` is always `false` (and so is the `'Done'` label). `active` is unchanged.
2. **Marks components:** both `AiActivityMarks` take an optional `isGeneral?: boolean` and pass it through.
3. **Call sites:** pass `topic.isGeneral` (or `chat.topic?.isGeneral === true` in `AisHereKey`) at every caller listed above, including the `AiActivityMarks` props.
4. **No new tests** (UI), but keep `topic-activity.test.ts` passing. Every file stays at most 400 lines.

### Allowed files
- `packages/chat-core/src/topic-activity.ts`
- `apps/web/src/components/TopicRow.tsx`
- `apps/web/src/components/topic/AiActivityMarks.tsx`
- `apps/web/src/components/topic/AisHereKey.tsx`
- `apps/mobile/src/components/chat/topic-row.tsx`
- `apps/mobile/src/components/chat/ai-activity-marks.tsx`
- `apps/mobile/src/components/chat/chat-header.tsx`
- `work/T-1843-general-never-done.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/topic-activity.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **In mock mode,** Dev team › General shows no green check and a normal title, on the web sidebar and the phone group screen.
- **Another topic** whose AI finished still shows the check.
- **A working AI in General** still shows its mark.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `packages/chat-core/src/topic-activity.ts`: `topicActivityView(activity, doneAt, isGeneral = false)`. When `isGeneral`, `done` is always `false` (so the label is `''` and never `'Done'`); `active` and its order are unchanged. Doc comment notes why.
- Both marks components (`apps/web/src/components/topic/AiActivityMarks.tsx`, `apps/mobile/src/components/chat/ai-activity-marks.tsx`) take an optional `isGeneral?: boolean` (default `false`) and pass it to `topicActivityView`.
- Call sites now pass the topic's flag:
  - web `TopicRow.tsx`: title color and `<AiActivityMarks>` both use `topic.isGeneral`; the green check and the dimmed title no longer appear for General.
  - web `AisHereKey.tsx`: `const isGeneral = chat.topic?.isGeneral === true;` feeds both `topicActivityView` (accessible label) and `<AiActivityMarks>`.
  - phone `topic-row.tsx`: dimmed title and `<AiActivityMarks>` use `topic.isGeneral`.
  - phone `chat-header.tsx`: `topicActivity` and `<AiActivityMarks>` use `topic.isGeneral`.
- `ai-status-line.tsx` was left alone: it only reads `.active`, and a working/waiting AI in General still shows its mark.
- No new tests, per the spec. All touched files stay under 400 lines (largest is `chat-header.tsx` at 278).

### Checks run

- `pnpm install`: Done, no errors.
- `pnpm --filter @zilar/chat-core exec vitest run src/topic-activity.test.ts --reporter=dot`: 1 file passed, 7 tests passed.
- `pnpm gate` from the repo root: **GATE PASS**.

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.9s)
PASS  lint  (1.0s)
PASS  typecheck  (6.2s)
PASS  effect  (1.7s)
PASS  tests @zilar/chat-core  (0.8s)
PASS  tests @zilar/mobile  (1.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- The `'Done'` label is also suppressed for General because the label is derived from `done`; that keeps the "AIs here" accessible name honest (`''` when nothing is active instead of "Done").
- I did not run the web/mobile UI by hand; the gate typechecks them and mobile tests pass. The mock-mode visual acceptance (Dev team › General without the check and with a normal title) needs the lead's smoke test.
- Files changed: the 8 listed by the gate above (7 source files + this task file).

### Round 2

- **Finding 1 (should-fix): fixed.** `apps/web/src/components/topic/AisHereKey.tsx` now returns `null` when `view.active.length === 0 && !view.done`, after computing the view. General with only finished AIs (`activity = [{state:'done'}]`, `done = false`, `active = []`) no longer draws an empty 36 px header key; other topics are unaffected because that combination already returned earlier on empty activity and a finished topic has `done = true`.
- **Finding 2 (nit): left as is.** It is a type-only inconsistency (`isGeneral?: boolean | undefined` in web) on a line this round does not otherwise touch; no behaviour changes.
- **Tests added:** none. The fix is in a React component with no test file, and the only package test that could cover it (`packages/chat-core/src/topic-activity.test.ts`) is outside the Allowed files; the spec also asks for no new tests. The existing chat-core test still passes.
- **Checks:** `pnpm --filter @zilar/chat-core exec vitest run src/topic-activity.test.ts --reporter=dot`: 1 file passed, 7 tests passed. `pnpm gate`: **GATE PASS**.

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.5s)
PASS  lint  (0.9s)
PASS  typecheck  (3.0s)
PASS  effect  (0.5s)
PASS  tests @zilar/chat-core  (0.8s)
PASS  tests @zilar/mobile  (1.4s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Round 3 (fresh session)

- **Finding 1 (should-fix): verified fixed** in `a6f630299`. `AisHereKey.tsx` now returns `null` when `view.active.length === 0 && !view.done`, so General with only finished AIs draws no empty header key; other topics reach that state only with empty activity, which already returned earlier.
- **Finding 2 (nit): fixed** in `37e7360af`. The prop on a line this task already added is now `isGeneral?: boolean` in the web `AiActivityMarks`, matching mobile. No call site passes an explicit `undefined`, so behaviour is unchanged.
- **Tests added:** none. Both changes are UI (a React component and a type annotation), the spec asks for no new tests, and no test file is in the Allowed files.
- **Checks run in this session:**
  - `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/topic-activity.test.ts`: 1 file passed, 7 tests passed.
  - `pnpm gate` from the repo root: **GATE PASS**.

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (0.6s)
PASS  lint  (0.7s)
PASS  typecheck  (3.9s)
PASS  effect  (0.5s)
PASS  tests @zilar/chat-core  (0.6s)
PASS  tests @zilar/mobile  (1.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No items remain from the Spec; the mock-mode visual acceptance still needs the lead's smoke test.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `7a496491a`, after 2 auto rounds.
- **The packet's should-fix (an empty "AIs here" key in General) is already fixed at HEAD:** `AisHereKey.tsx` returns null when nothing is active and the topic isn't done. The prop-type nit is aligned too.
- **Checked in web mock mode on the branch:** Dev team › General shows no green check and a normal title, and Checkout keeps its working marks.
- **The phone** shares the same `topicActivityView`, so it follows. It will show in the next phone build.
