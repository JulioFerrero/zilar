---
id: T-2015
title: "Claude audit (read-only): plan how web and phone share their duplicated non-UI logic — for each twin pair the T-2013 scan listed, what is the same, what is platform-specific, the shared module and API in client-core/chat-core, the library swaps, and worker-sized slices with expected line savings — written to docs/audit/share-plan.md"
status: merged
milestone: M5
branch: task/T-2015-claude-share-plan
model: anthropic/claude-opus-5-5
effort: high
estimate: 60 min
---

# T-2015: Plan for sharing the web/phone twin logic

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "maybe we can reduce the code we have, share components and functions, use libraries instead of hand writing all". The free scan `docs/audit/reduce-scan.md` (T-2013) measured the repo:
- only 4,558 lines of exact clones (1.66%);
- about 30 **non-UI modules that web and phone each keep their own copy of**, with different code and no shared import;
- 7 store-effect adapter pairs of 200–600 lines each.

Copy detectors can't see logic that is the same but written differently. That needs judgment, so Julio's Claude API credits pay for this one read-only plan. Workers on cheaper models then do the moves.

**Budget: about $20.** Read only the files listed below and the shared-package files they import or should import. Do not explore the rest of the repo. Write no code.

### Facts (from `docs/audit/reduce-scan.md` §3 "Non-UI logic pairs" and §1 "Clusters that span apps/web and apps/mobile", read by the lead on 2026-10-18)
- **Shared packages.**
  - `packages/client-core` (8.9k lines) holds the store, history and ledger used by both apps, plus `src/store/*`.
  - `packages/chat-core` (5.7k lines) holds platform-neutral message logic.
  - Both must stay free of React DOM and React Native imports, so a hook moves only if it uses plain `react`.
- **The non-UI twin pairs** (web / mobile line counts):

  | Topic | Web | Mobile | Lines |
  | --- | --- | --- | --- |
  | Composer drafts | `apps/web/src/lib/composer-drafts.ts` | `apps/mobile/src/lib/composer-drafts.ts` | 175/261 |
  | Chat-list cache | `apps/web/src/store/chatListCache.ts` | `apps/mobile/src/lib/chat-list-cache.ts` | 152/192 |
  | People search | `apps/web/src/lib/usePeopleSearch.ts` | `apps/mobile/src/components/contacts/use-people-search.ts` + `use-people-prefix-search.ts` | 180/72+ |
  | Message search | `apps/web/src/lib/useMessageSearch.ts` | `apps/mobile/src/components/chat/use-message-search.ts` | 98/42 |
  | Contact requests | `apps/web/src/lib/useContactRequests.ts` | `apps/mobile/src/lib/use-contact-requests.ts` | 63/60 |
  | Delayed value | `apps/web/src/lib/useDelayed.ts` | `apps/mobile/src/lib/use-delayed.ts` | 27/32 |
  | Smooth streaming text | `apps/web/src/lib/useSmoothText.ts` | `apps/mobile/src/lib/use-smooth-text.ts` | 187/255 |
  | Media retry | `apps/web/src/lib/media-retry.ts` | `apps/mobile/src/lib/media-retry.ts` | 164/156 |
  | Attachments | `apps/web/src/lib/attachments.ts` | `apps/mobile/src/lib/attachments.ts` | 225/227 |
  | Stickers | `apps/web/src/lib/stickers.ts` + `apps/web/src/lib/api/stickers.ts` | `apps/mobile/src/lib/stickers.ts` | 137+268/260 |
  | Push badge | `apps/web/src/lib/push/badge.ts` | `apps/mobile/src/lib/push/badge.ts` | 100/84 |
  | Draft stream | `apps/web/src/lib/drafts.ts` | `apps/mobile/src/lib/drafts.ts` | 160/335 |
  | Auth | `apps/web/src/lib/auth.ts` | `apps/mobile/src/lib/auth.ts` | 42/144 |
  | API client | `apps/web/src/lib/effect/api-client.ts` | `apps/mobile/src/lib/effect/api-client.ts` | 85/45 |
  | Effect errors | `apps/web/src/lib/effect/errors.ts` | `apps/mobile/src/lib/effect/errors.ts` | 30/39 |
  | `use-action` / `use-query` | `apps/web/src/lib/effect/use-action.ts` and `use-query.ts` | `apps/mobile/src/lib/effect/use-action.ts` and `use-query.ts` | 10+7 / 10+7 |
  | Person links | `apps/web/src/components/personLink.tsx` | `apps/mobile/src/lib/person-link.ts` | 143/69 |
  | Format | `apps/web/src/lib/format.ts` | `apps/mobile/src/lib/format.ts` | 2/32 |
  | Topics | `apps/web/src/store/effects/topics.ts` + `apps/web/src/lib/api/topics.ts` | `apps/mobile/src/lib/topics.ts` + `apps/mobile/src/lib/topics-api.ts` | 189/244+ |
  | Groups | `apps/web/src/lib/api/groups.ts` | `apps/mobile/src/store/effects/groups.ts` | 325/315 |
  | Client version | `apps/web/src/lib/useClientVersionCheck.ts` | `apps/mobile/src/lib/use-client-version.ts` | |
  | Offline cache | `apps/web/src/store/messageCache.ts` | `apps/mobile/src/store/offline-cache.ts` | |
  | Voice convert | `apps/web/src/lib/voice/convert.ts` | `apps/mobile/src/lib/voice.ts` | |

- **Markdown.** Web renders it with `react-markdown` (`apps/web/src/components/MarkdownText.tsx`, 63 lines). Mobile hand-rolls a parser (`apps/mobile/src/components/chat/markdown-text.tsx`, 286 lines, plus helpers; the scan's §4 counts 394 lines).
- **Store-effect adapter pairs** (`apps/web/src/store/effects/*.ts` ↔ `apps/mobile/src/store/effects/*.ts`):

  | Adapter | Web/mobile lines |
  | --- | --- |
  | history | 312/315 |
  | ports | 286/286 |
  | send | 110/207 |
  | group actions | 160/327 |
  | pins | 119/219 |
  | locals | 87/112 |
  | lifecycle | 268/352 |

  The scan calls them adapters over `@zilar/client-core/store`. Check whether their logic, not just their wiring, is duplicated.
- **Hand-rolled helpers.** The scan's §4 lists 13 kinds at 57 sites, for example debounce, retry with backoff, and relative time. Check them against libraries the repo already has (`effect`: `Duration`, `Schedule`, `Cache`).

### Steps
1. **Classify each pair.** Read both sides and write one of:
   - (a) the same logic: move it to `client-core` or `chat-core` behind a small API, with thin platform adapters for storage, timers and fetch;
   - (b) partly the same: say what is shared and what stays;
   - (c) different on purpose: keep both, and say why.

   Give `file:line` for what you claim.
2. **Shared API.** For every (a) or (b), name the shared file path and its exported functions or types, the per-platform adapter, and the **net lines removed**: old lines in both apps minus new shared and adapter lines.
3. **Libraries.** For the mobile Markdown parser and any helper a library covers, name the library and an exact version from `npm view <pkg> version` (never from memory), with its RN/Expo compatibility, and what it replaces. Prefer libraries already in the repo, and `effect` modules over new packages.
4. **Store adapters.** Read the 7 store adapter pairs and say how much more could move into `client-core/store`.
5. **Write `docs/audit/share-plan.md`:**
   - start with a summary table (pair, verdict, net lines, risk);
   - then **worker slices**: each slice changes at most about 400 lines and lists its exact files. Order them so slices that touch different files can run in parallel. Each slice says which behaviour to check on web and on the phone;
   - mark any slice that touches the message pipeline, auth or money as needing tests (Julio's test rule).
6. **Stop when the plan is written.** No code changes. Every claim cites `file:line`.

### Allowed files
- `docs/audit/share-plan.md`
- `work/T-2015-claude-share-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/share-plan.md` exists, covers every pair above, and gives net line savings and ordered slices.
- No other file changed, and the gate passes.

---

## Report (written by the worker when done)

### What I did
- I wrote `docs/audit/share-plan.md`. It covers all 23 twin pairs from the spec, plus the Markdown parser, the hand-rolled helpers and the 7 store-adapter pairs. It gives:
  - a summary table (pair, verdict, net lines, risk, test need)
  - per-pair detail with `file:line`
  - library choices with versions from `npm view`
  - a store-adapter verdict
  - 28 worker slices in 3 waves, each with exact files and web/phone checks; slices that need tests are marked
  - a list of bugs and drift
  - 6 decisions for Julio
- Estimated saving: about 2,150 net lines now, plus about 160 in optional later steps.
- How I read the code: read-only sub-agents in this session read both sides of each pair. I re-read the key claims myself (listed under "Method and limits" in the plan) and grepped the importer lists. No code changed.
- Files changed: `docs/audit/share-plan.md` (new), `work/T-2015-claude-share-plan.md` (status and this Report).

### Checks run
- `pnpm install`: OK.
- `npm view` on 2026-10-18:
  - `mdast-util-from-markdown` 2.1.0 (lockfile 2.0.3)
  - `mdast-util-gfm` 3.1.0
  - `micromark-extension-gfm` 3.0.0
  - `react-native-markdown-display` 7.0.2 (last published 2023-12-11)
  - `marked` 18.1.1
- `pnpm gate`: install (frozen), format, lint and typecheck PASS; effect SKIP (no source files changed); scope: every changed file is inside the Allowed files; size within 400 lines; `GATE PASS`.
- No tests run: the change is docs only.

### Notes for the lead
- **Likely bugs found:**
  - Mobile offline cache loses `editedAt` as a `Date` after a cold start (`apps/mobile/src/store/offline-cache.ts:134-137,153-159`).
  - Mobile voice uploads the original recording with the converted size (`apps/mobile/src/lib/voice.ts:196-198`).
  - Mobile media retry drops the captured preview (`apps/mobile/src/lib/media-retry.ts:48-55`).
  - Mobile sticker URL check accepts `..` before adding the bearer token (`apps/mobile/src/lib/stickers.ts:88-89`).
- **Store drift:**
  - The phone never prunes inactive chats.
  - Web wipes chat prefs on a transient prefs failure.
  - Leaving the last seat in a topic errors on the phone.
- The slices are mapped to these in §6 of the plan.
- **Needs Julio** (§7 of the plan): adding the 3 mdast/micromark packages to chat-core (already in the lockfile through react-markdown), plus 5 behaviour choices. Hermes support for the `\p{…}` regex in micromark is untested on a device.
- Not read, so unverified: web `groupCreate.ts`, `realStore.ts`, `lib/api/sessionGone.ts`, and mobile `events.ts`, `user-state.ts`, `runtime.ts`.
- Net-line figures are planning estimates, not measurements.

## Review (written by Claude)

Approved, with a clean pre-review. The Opus run cost $2.96, against a $20 budget.

The plan covers every listed pair:
- about 2,150 net lines removed now, plus about 160 later;
- 3 waves of slices that each touch their own files (the barrels aside), with tests marked by Julio's rule;
- 10 cases of bugs or drift between the copies, each assigned to a slice.

Next, the lead launches wave 1 (all but W1-n) as worker tasks and asks Julio the 6 decisions in §7.
