---
id: T-1289
title: "Mobile batch 2: one copy style for errors (MUX-26); proper empty states (MUX-27); one transient toast instead of stacked banners in the chat (MUX-32); a readable message time (MUX-25); New topic from the '+' menu (MUX-29)"
status: merged
milestone: M5
branch: task/T-1289-mobile-copy-states
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1289: Mobile batch 2

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md`:
- **MUX-26** (P3, `:119`): error copy is mixed ("Couldn't…" vs "Could not…. Try again." vs "Couldn't send. Retry").
- **MUX-27** (P3, `:91`): empty states are a single muted line: chats, messages, topics.
- **MUX-32** (P3, `:61`): errors are `DismissBanner`s stacked between the list and the composer (`apps/mobile/src/components/chat/chat-thread.tsx`), pushing the list up.
- **MUX-25** (P3, `:109`): the message time is 10 px mono in low-contrast greys.
- **MUX-29** (P3, `:79`): the "+" menu (`apps/mobile/src/components/chat/new-chat-button.tsx`) has no New topic; it's only reachable from a group screen.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **MUX-26:** one style everywhere: "Could not {verb} {thing}. Try again." for failures, with a "Retry" button label where there's an action. List every string you changed in the Report.
2. **MUX-27:** each empty state gets a lucide icon, a short title and one helpful line (with an action where one exists, for example "Start a chat"), using the existing `StateMessage` if it fits (cite it).
3. **MUX-32:** a small toast component (a new `apps/mobile/src/components/ui/toast.tsx`, if none exists) that shows one message at a time for about 3 s over the list. Use it for the chat screen's transient errors in place of the stacked banners. Keep persistent states (offline) as they are.
4. **MUX-25:** message time at 11 px with the existing muted token at higher contrast. Cite the token, no new hex.
5. **MUX-29:** a "New topic" entry in the "+" menu that asks which group (only groups where I can create topics), then opens the existing new-topic flow.
6. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (`:61`, `:79`, `:91`, `:109`, `:119`), and the files above.

### Allowed files
`apps/mobile/src/components/**/*.tsx`, `apps/mobile/src/components/**/*.ts`, `apps/mobile/src/app/**/*.tsx`, `work/T-1289-mobile-copy-states.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:** an empty state looks right; the message time is readable; "+" offers New topic.

---

## Report (written by the worker when done)

Rechecked all five findings on the base tree: each was still present, none already fixed.

### What I did

**MUX-26 (one copy voice).** Every chat failure now reads `Could not {verb} {thing}. Try again.`; the
existing `Retry` button label (`load-error.tsx` `RetryButton`, default `Retry`) is kept where a button
exists. Strings changed (all under `apps/mobile/src/components/chat/`):
- `message-list.tsx:293` `"Couldn't load messages"` → `"Could not load messages. Try again."`
- `chat-list.tsx:93` `"Couldn't load chats"` → `"Could not load chats. Try again."` (`LoadErrorBanner`)
- `chat-list.tsx:121` `"Couldn't load chats"` → `"Could not load chats. Try again."` (`LoadError`)
- `message-bubble-content.tsx:212` `"Couldn't send. Retry"` → `"Could not send. Try again."` (failed sticker)
- `attachment-body.tsx:224` `"Couldn't send. Retry"` → `"Could not send. Try again."` (failed upload)
- `voice-message-bars.tsx:63` `"Couldn't send."` → `"Could not send. Try again."` (voice fallback)
- `message-search.ts:227` `"Couldn't load more messages"` → `"Could not load more messages. Try again."`
- `message-search.ts:331` `"Couldn't search messages"` → `"Could not search messages. Try again."`
- `sticker-panel.tsx:180` `"Couldn't load stickers."` → `"Could not load stickers. Try again."`
- `chat-thread.tsx` pin/unpin already read `"Could not … Try again."` (unchanged).

**MUX-27 (empty states).** All three use the existing `StateMessage`
(`components/ui/state-message.tsx`, kind `empty`, lucide `icon`, `title`, `hint`, `action`):
- chats (`chat-list.tsx` `ListEmptyComponent`): `MessageSquarePlus` icon, title `emptyChatsText(...)`,
  hint "Start a chat to see it here." / "Try a different folder or search.", action **Start a chat**
  (opens search) only when there are no chats at all.
- messages (`message-list.tsx`): `MessageSquare` icon, "No messages yet", hint "Send a message to
  start the conversation." (no action; the composer is right there).
- topics (`group-topic-list.tsx`): `Hash` icon, "No topics found", hint + action **New topic** when
  `canCreate`.

**MUX-32 (one transient toast).** New `components/ui/toast.tsx` (`Toast`, one message at a time,
`TOAST_DURATION_MS = 3000`; auto-dismiss via the house Effect timers `runLater`/`interruptFiber` from
`lib/effect/timers.ts`, no `setTimeout`). `chat-thread.tsx` renders it over the list in place of the
four stacked `DismissBanner`s; the store `actionError` and the `jumpMissed` notice are copied into the
toast and cleared. Persistent states (offline) untouched. `dismiss-banner.tsx` had no other caller, so
I deleted it to avoid dead code.

**MUX-25 (message time).** 10 px → 11 px in `message-bubble-decor.tsx` (`BubbleMeta` + big-emoji meta),
`plain-bubble-body.tsx` (`BubbleInlineMeta`), `attachment-body.tsx` (edited + time) and
`message-bubble-content.tsx` (image overlay). Incoming meta colour raised from `--subtle-foreground`
(`#8a8a8a`) to the existing `--muted-foreground` token (`#a1a1a1`) at the call sites (`message-bubble.tsx`,
`attachment-body.tsx`, `voice-message-bars.tsx`) through `MUTED_FOREGROUND` from `lib/colors.ts` — no new
hex. The outgoing bubble is light, so its meta stays `--bubble-out-meta` (`#525252`); no darker grey token
exists and a new hex is forbidden.

**MUX-29 (New topic from "+").** New `components/chat/new-topic-group-sheet.tsx`: the groups that have
topics and where `mayCreateTopic` allows it, loading each group through `ensureGroupDetail` and filtering
with the same `mayCreateTopic` the group screen uses. `new-chat-button.tsx` gained one menu entry **New
topic** (`Hash`); picking a group navigates to `/group/[id]?newTopic=1`, and `app/group/[id].tsx` opens the
existing new-topic flow once, using the same adjusted-state pattern as the `?searchChat=` handling.

### Files changed
- `apps/mobile/src/app/(tabs)/index.tsx` (wires the chats empty action)
- `apps/mobile/src/app/group/[id].tsx` (`?newTopic=1` opens the flow)
- `apps/mobile/src/components/chat/attachment-body.tsx`
- `apps/mobile/src/components/chat/chat-list.tsx`
- `apps/mobile/src/components/chat/chat-thread.tsx`
- `apps/mobile/src/components/chat/dismiss-banner.tsx` (deleted)
- `apps/mobile/src/components/chat/group-topic-list.tsx`
- `apps/mobile/src/components/chat/message-bubble-content.tsx`
- `apps/mobile/src/components/chat/message-bubble-decor.tsx`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/message-list.tsx`
- `apps/mobile/src/components/chat/message-search.ts`
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/new-topic-group-sheet.tsx` (new)
- `apps/mobile/src/components/chat/plain-bubble-body.tsx`
- `apps/mobile/src/components/chat/sticker-panel.tsx`
- `apps/mobile/src/components/chat/voice-message-bars.tsx`
- `apps/mobile/src/components/ui/toast.tsx` (new)
- `work/T-1289-mobile-copy-states.md`

### Commands (real results)
- `pnpm install` — succeeded at the start.
- `pnpm exec prettier --write <changed source files>` — formatted my files (a few needed wrapping).
- `pnpm gate` (first run) — **FAIL** on lint: 2 errors (`react-hooks/exhaustive-deps` on the chat-thread
  effect, `react(set-state-in-effect)` on the group-screen effect). Fixed both.
- `pnpm gate` (final) — **GATE PASS**:
```
gate: 19 changed file(s) against main
PASS  install (frozen)  (2.4s)
PASS  format  (1.4s)
PASS  lint  (1.0s)
PASS  typecheck  (5.3s)
PASS  effect  (2.7s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```
No single test files were run: the touched files are UI/components with no nearby tests (per AGENTS.md,
UI gets no tests).

### Deviations / notes
- **MUX-26 scope:** the chat "Couldn't" set the audit named, not every `Couldn't` in the app (several live
  in `lib/`/stores that are outside the Allowed files). For the send-failure pills the pill itself is the
  retry action, so its visible text is the sentence and its accessibility label stays `Retry sending …`;
  only `LoadError` carries a separate `Retry` button.
- **MUX-27:** the chats empty action "Start a chat" opens the search bar (the `+` FAB is the primary entry
  and `ChatList` cannot drive it).
- **MUX-25:** outgoing meta left at `#525252` for the reason above.
- Did not touch `chat-actions-sheet.tsx` ("Muted: change") or the delete-for-me item — not error copy and
  outside this task's five items.

### Open questions
None.

### Round (fix round, T-1289 prereview)

**Findings fixed.**
- should-fix 1 (`sticker-message.tsx:89,93`, MUX-25): the sticker overlay meta was the one
  message-time call site the batch missed. Time `text-[10px]` → `text-[11px]`, and the ticks
  colour moved off the raw `#8a8a8a` hex to the existing tokens: `message.status === 'read' ? SEEN :
  MUTED_FOREGROUND` (`MUTED_FOREGROUND` `#a1a1a1`, `SEEN` from `lib/colors.ts`), matching the image
  overlay (`message-bubble-content.tsx`) and `BubbleMeta`. No new hex; file stays at 100 lines.

**Nits / follow-ups not touched** (per the round rules): the "Not sent" 10 px suffix
(`message-bubble-decor.tsx:77`) and the `?newTopic=1` silent no-op (`app/group/[id].tsx:140`) are nits
in lines this round does not change; F1 (failure copy in `lib/`/`store/`) is outside the Allowed files.

**Tests added.** None. The finding names no test, the change is a UI style tweak, the task Spec says
"No tests (UI)", and AGENTS.md gives UI code no tests. No test files exist near `sticker-message.tsx`
(gate reports `SKIP tests @zilar/mobile (no nearby test files)`).

**Gate result.** `pnpm gate` — **GATE PASS**:
```
gate: 20 changed file(s) against main
PASS  install (frozen)  (2.6s)
PASS  format  (1.4s)
PASS  lint  (1.2s)
PASS  typecheck  (5.0s)
PASS  effect  (1.5s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Disagreements
None.

### Round 2 (fix round 1, lead's emulator check)

**Finding fixed.** The "+" → New topic group picker never finished loading; it sat on "Looking
for your groups…" (spec item 5 / MUX-29, `apps/mobile/src/components/chat/new-topic-group-sheet.tsx`).

**Root cause (which group, which call).** I reproduced the data path in a throwaway store test
(`createRealChatStore` + `@zilar/mock-backend`, then deleted, not committed):
- every seeded group answers `GET /api/groups/:id` with 200 — `g-devteam`, `g-viernes`, `g-familia`,
  `g-qa`, `g-gym`, `g-product` and channel `g-acme`;
- the mobile `parseGroupDetail` accepts all seven;
- after boot, `joinGroups` has already cached all seven (`groupDetailsRevision === 7`,
  `groupDetail(id)` defined for every candidate), and `getGroup` goes through `mockFetch` exactly
  like `/api/chats`.

So there is **no mock-backend gap** in the seed and no single group that fails: all candidates land.
The defect is the sheet's own wait. `loading = checked < candidates.length` is all-or-nothing and
unbounded, and the shared `ensureGroupDetail` swallows a failed load
(`packages/client-core/src/store/groups.ts:63-66`, `catchCause → undefined`) without telling the
caller. Any candidate whose detail does not publish — a transient fetch failure, a group removed
server-side, or a load deduped against an earlier in-flight/aborted boot fetch — keeps `checked`
below `candidates.length` forever, so the spinner never stops and there is no error path out. The
fix removes that failure mode.

**What changed.** `new-topic-group-sheet.tsx` alone:
- eligible groups render as soon as each detail lands (already the `eligible.length > 0` branch);
- the spinner now shows only while nothing is eligible and the wait is not settled;
- `NEW_TOPIC_LOAD_CAP_MS = 5000` bounds the wait (house `runLater`/`interruptFiber`, no `setTimeout`);
- the spinner stops once every detail has landed **or** the cap fires (`settled`), and the empty
  state then reads "You can't create topics in any group yet.";
- no candidates at all short-circuits straight to the empty state.

**Tests added.** None. The Spec says "No tests (UI)" and AGENTS.md gives UI code no tests; the
reproduction test above was temporary and removed.

**Nits not touched.** The `?newTopic=1` silent no-op (`app/group/[id].tsx:140`) is a nit in a line
this round does not change.

**Commands (real results).**
- `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json` — **0 errors**.
- `pnpm gate` — **GATE PASS**:
```
gate: 20 changed file(s) against main
PASS  install (frozen)  (3.7s)
PASS  format  (2.4s)
PASS  lint  (1.4s)
PASS  typecheck  (5.9s)
PASS  effect  (2.4s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Round 3 (fix round 2, lead's emulator check)

**Finding fixed.** "+" → New topic showed "You can't create topics in any group yet." on the mock,
where `u-you` owns Dev team, so eligible groups must be listed.

**Investigation (why `eligible` is empty).** I mounted the real component against the real store
(`createRealChatStore` + `@/mock/backend`, jsdom, temporary test, deleted):
- when the chat list is loaded, the picker lists **Dev team, Familia, QA squad, Product**; the viewer
  id is `u-you` and `mayCreateTopic` returns true for every group where `u-you` is owner/admin, so
  the sheet's eligibility call is correct — **no `currentUserId`/member-id mismatch and no
  members/role shape bug** (hints a and c);
- the demonstrable defects are in the picker's load handling, not in the data:
  1. **the wrong empty state** — if the sheet opens before `/api/chats` answers, `candidates` is
     empty, so the previous `settled = !hasCandidates || …` was immediately true and it rendered the
     empty state while the list was still loading;
  2. **a detail that does not land on the first try** leaves `checked < candidates.length`; the store
     swallows a failed `ensureGroupDetail` and the sheet never retried, so after the 5 s cap it
     rendered the empty state with the groups never asked for again (hint b).

**What changed** (`new-topic-group-sheet.tsx` alone):
- `settled` now also requires `chatsLoad !== 'loading'` (`chatsReady`), so the empty state is not
  shown before `/api/chats` has answered;
- while the sheet is open a missing detail is retried every `NEW_TOPIC_RETRY_MS` (1 s) until it lands,
  the cap fires, or the sheet closes — one dropped load can no longer strand the picker;
- the round-2 streaming + 5 s cap stay as they were.

**Verification.** In the temporary mount test I made `getGroup` reject the **first attempt for every
group**; with the retry the picker still shows "Dev team, Familia, QA squad, Product" (~1 s later).
Tests added: none committed (Spec: "No tests (UI)"); the mount test was temporary and removed.

**Commands (real results).**
- `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json` — **0 errors**.
- `pnpm gate` — **GATE PASS**:
```
gate: 20 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.8s)
PASS  lint  (0.8s)
PASS  typecheck  (2.7s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (1.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Round 4 (fix round 3, lead's emulator check)

**Finding fixed.** The New topic picker still showed the empty state while Dev team's own group screen
offered New topic (`canCreate` true, `app/group/[id].tsx:118-122`).

**The mismatch (accessor, not id).** I checked both:
- **the id is the same** — the sheet's `group.id` is `chat.groupId`, and the group screen's route id is
  `onPressGroup(row.groupId)`, also a `chat.groupId` (`components/chat/chat-rows.tsx:59,91`); both
  resolve to `g-devteam`, so the id was not the difference;
- **the accessor was** — the group screen reads its detail with the hook
  `useChatStore((state) => state.groupDetail(groupId))` (`app/group/[id].tsx:64`) and its members from
  that result (`:104`). The sheet read `storeApi.getState().groupDetail(group.id)` inside a `useMemo`
  keyed on `groupDetailsRevision`: a one-shot snapshot that only refreshes when that memo recomputes,
  not the live subscription the group screen uses. The store's own docs say the point of the revision
  is that "`groupDetail` selectors re-fire" (`store/types-groups.ts:49-53`) — the sheet was not using
  such a selector.

**What changed** (`new-topic-group-sheet.tsx` alone): the sheet now computes eligibility with a
`useChatStore` selector that calls the **same** `state.groupDetail(groupId)` accessor, with the same
`currentUserId` and `members` the group screen uses. The selector returns one joined string over the
candidates (stable snapshot), and `eligible`/`checked` are derived from it, so a detail that lands
after mount always re-fires the sheet exactly as it re-fires the group screen. The round-2/3 streaming,
5 s cap and 1 s retry are unchanged.

**Check (mock).** jsdom mount test of the real component against the real store + `@/mock/backend`
(temporary, deleted): with `getGroup` failing the first attempt for **every** group, the sheet lists
"Dev team, Familia, QA squad, Product", and the group screen's exact read
(`groupDetail('g-devteam').members` + `mayCreateTopic`) returns `true` — both agree.

**Commands (real results).**
- `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json` — **0 errors**.
- `pnpm gate` — **GATE PASS**:
```
gate: 20 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.5s)
PASS  lint  (1.0s)
PASS  typecheck  (4.0s)
PASS  effect  (1.5s)
PASS  tests @zilar/mobile  (1.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-13: approved after 3 fix rounds.**
- **What the rounds fixed:** an infinite spinner; then a wrong empty state; then reading eligibility through the group screen's detail hook.
- **Lead's check on the emulator mock:** "+" → New topic lists Dev team, Familia, QA squad and Product.
- **Lead's checks after the rebase:** mobile tsc: 0 errors. `message-bubble.tsx` is exactly 400 lines; `dismiss-banner.tsx` was removed in favour of the toast.
