---
id: T-2232
title: "Rewrite map (no code change), messages core E: the chat screen, header, search and pins on web, phone and server. Behaviour list, twin logic, slop, lean target with budgets"
status: merged
milestone: M5
branch: task/T-2232-audit-messages-screen-search
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2232: Rewrite map, chat screen, search and pins

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: the code base is 240k lines of "slop", and trimming a few lines per task does not help. We will **rewrite** the messages core feature by feature, to a line budget, following `docs/LEAN_CODE.md` (read it first). This task is the map a rewrite is written from. It writes one document and changes no code.

### Scope (7,351 lines, counted 2026-10-19)
- `apps/web/src/routes/ChatView.tsx` (744)
- `apps/web/src/components/ChatHeader.tsx` (579)
- `apps/mobile/src/app/chat/[id].tsx` (547)
- `apps/mobile/src/components/chat/chat-search-results.tsx` (391)
- `apps/server/src/search/routes.ts` (385)
- `apps/mobile/src/components/chat/chat-header.tsx` (369)
- `apps/web/src/components/MessageSearchResults.tsx` (341)
- `apps/mobile/src/components/chat/message-search.ts` (330)
- `apps/mobile/src/components/chat/use-chat-screen.ts` (300)
- `apps/mobile/src/components/chat/message-search-list.tsx` (287)
- `apps/web/src/components/PeopleSearchResult.tsx` (249)
- `apps/server/src/search/snippet.ts` (233)
- `apps/web/src/components/PinsPanel.tsx` (224)
- `apps/server/src/pins/service.ts` (208)
- `apps/server/src/search/edit-overlay.ts` (204)
- `apps/server/src/search/match.ts` (203)
- `apps/server/src/connections/pinned-fetch.ts` (192)
- `apps/web/src/components/PinnedBanner.tsx` (164)
- `apps/server/src/search/service.ts` (150)
- `apps/web/src/components/ChatSearchBar.tsx` (149)
- `apps/mobile/src/components/chat/pinned-banner.tsx` (136)
- `apps/server/src/pins/access.ts` (128)
- `packages/api-contract/src/pins.ts` (99)
- `packages/chat-core/src/search.ts` (97)
- `apps/mobile/src/components/chat/typing-dots.tsx` (90)
- `apps/web/src/lib/useMessageSearch.ts` (89)
- `apps/mobile/src/components/chat/pins-sheet.tsx` (85)
- `apps/server/src/search/api.ts` (80)
- `packages/client-core/src/people-search.ts` (75)
- `packages/api-contract/src/search.ts` (67)
- `apps/mobile/src/components/ui/search-field.tsx` (53)
- `apps/mobile/src/components/chat/search-jump.ts` (45)
- `apps/mobile/src/lib/pin-snapshot.ts` (22)
- `apps/web/src/components/ui/search-field.tsx` (18)
- `apps/mobile/src/lib/search-api.ts` (15)
- `apps/mobile/src/lib/pins-api.ts` (3)

Read every file in scope fully. Read a file outside scope only to learn how the scope is used, for example the callers, the store selectors and the client-core API modules.

### Write `docs/audit/messages-screen-search.md`
1. **Behaviour list.** Number every behaviour a user sees or relies on, for example:
   - opening a chat: loading, the empty state, a missing chat;
   - the header: name, avatar, presence, typing, menu items and their conditions, AI states;
   - message search: query, results with snippets, jump to a result, edits shown in results;
   - people search;
   - pins: pin and unpin, the banner, cycling pins, the pins panel or sheet, jump;
   - the screen's own state: reply, edit or selection mode, focus.

   For each, give where web does it (`file:line`), where the phone does it, and what the server guarantees. Mark platform-only behaviours as such.
2. **Twin logic.** Every piece that web and phone implement separately but that is the same rule (header menu items and their conditions, search state and paging, the pin cycle, screen state). Give both locations and line counts.
3. **Slop by rule.** For each rule in `docs/LEAN_CODE.md`, the places in scope that break it, with `file:line` and the lines it costs. This includes the server: route bodies, payload copying, repeated access checks.
4. **Dead code:** exports, props, routes and branches nothing reaches (prove it with `git grep`).
5. **Lean target structure:**
   - the new files, each with its home: a shared chat-screen view model, search model and pins model in `client-core`; app markup and gestures; one server service per rule;
   - what each file owns, and a line budget;
   - the files to delete;
   - the total budget against today's 7,351. Aim for at least 40% fewer lines with every behaviour from part 1 kept.

   Be concrete: someone must be able to write the rewrite spec from this part alone.
6. **Risks:** behaviours that are easy to lose in a rewrite (above all search access, so that nobody sees a chat they are not in), and how the lead should check each one (web mock, the phone emulator, or live).

Every number traces to a `file:line` you read. Change no code.

### Allowed files
- `docs/audit/messages-screen-search.md`
- `work/T-2232-audit-messages-screen-search.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The doc has all six parts.
- The target structure has budgets per file and a total.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/messages-screen-search.md` with all six parts: the behaviour list
(B1–B52 with web/phone/server locations and platform-only marks), twin logic with line
counts, slop by `docs/LEAN_CODE.md` rule, dead code with `git grep` proofs, the lean
target structure with per-file budgets and a 4,071-line total, and the risks with a
check method for each. No code was changed.

Measured facts the doc is built from: the 36 scope files are exactly 7,351 lines
(`wc -l`), matching the spec. `apps/server/src/connections/pinned-fetch.ts` (192) is
not chat pins — it is the SSRF-pinned transport for custom AI providers, called from
`ai/model-client.ts:396` and `connections/probe.ts:189` — so the feature baseline is
7,159. The target is 4,071 feature lines (43.1% fewer); with `pinned-fetch.ts` left
untouched the task file set goes to 4,263 (42.0% fewer). Both meet the 40% bar.

Two scope corrections are recorded in §0.2 and matter for the rewrite spec:
`search/service.ts` `allowedArchives`/`resolveChatFilter` is imported by eight other
server modules, and `typing-dots.tsx` `PulseDot` is used by three files outside this
screen.

### Files changed

- `docs/audit/messages-screen-search.md` — new, 532 lines.
- `work/T-2232-audit-messages-screen-search.md` — status and this Report.

### Commands and results

- `pnpm install` — done in 34.2 s, no errors.
- `pnpm gate` — `2 changed file(s) against main`; PASS install (frozen) 1.8 s,
  PASS format 0.6 s, PASS lint 1.3 s, PASS typecheck 1.4 s; SKIP effect (no source
  files changed), SKIP build @zilar/server; `scope: every changed file is inside the
  Allowed files`; `size: no changed source file is over 800 lines`;
  `comments: no task IDs in added comments`; ended with `GATE PASS`.
- No package tests were run: the change is one Markdown document and the gate skips
  tests when no source file changes.

### Problems, deviations, open questions

- The spec says "read every file in scope fully". I did. I also read the callers and
  shared modules needed to trace each behaviour (`ChatList.tsx`, `ChatActionsMenu.tsx`,
  `MessageMenuBody.tsx`, `message-bubble-actions.tsx`, both pin stores,
  `client-core/store/pins.ts`, `client-core/store/polling.ts`,
  `client-core/people-handle-search.ts`, `client-core/chat-extras-api.ts`,
  `chat-core/chat-labels.ts`, the mock search route and the two server search tests).
- No decision is needed. The audit is read-only by design; the rewrite itself is a
  later task.


## Review (written by Claude)

Approved; clean (2 nits). The map:
- behaviours B1–B52 with web, phone and server `file:line`;
- twin rules;
- a target of 4,071 lines against the feature's 7,159 (−43%), with web and phone each −57%;
- a build order and risks.

It also corrects the lead's scope:
- `connections/pinned-fetch.ts` is the SSRF-pinned AI-provider transport, not chat pins, and stays out;
- `search/service.ts`'s `allowedArchives` and `resolveChatFilter` serve eight other modules and move to a shared archive-access module unchanged in shape.

**Next:** rewrite specs from part 5, in the map's build order.
