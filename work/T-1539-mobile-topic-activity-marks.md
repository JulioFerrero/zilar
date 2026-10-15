---
id: T-1539
title: "AI work in topics, step 7a (phone; twin of web T-1532): topic rows show the AIs at work with state marks instead of the status chip; the topic header gets an 'AIs here' key that opens a sheet listing each AI with one line, Stop for your own working AI, and the waiting one linking to Approvals"
status: merged
milestone: M5
branch: task/T-1539-mobile-topic-activity-marks
model: auto
effort: default
depends_on: []
estimate: 50 min
---

# T-1539: Phone topic rows and header show the AIs at work

## Spec (written by Claude, do not edit)

### Why
This is step 7 of the approved "AI work in topics" plan. Read `docs/design/mockups/ai-work/README.md`, `Phone.dc.html`, `PhoneSheet.dc.html` and `States.dc.html`. Web shipped this as T-1532.

**The marks:**
- **working:** a turning ring around the AI's picture;
- **waiting for you:** an amber dot;
- **done:** a green check;
- **idle:** nothing.

**The status chip** (a dot plus a status word) goes away on the phone rows. Status words are not allowed (D24 lean), and the hand-set status is being removed.

### Facts (the lead read them on main, 2026-10-15)
- **The shared helper** `packages/chat-core/src/topic-activity.ts` (T-1532) exports:
  - `topicActivityView(activity, doneAt)`, which returns `{ active, done, label }` (`active` is working then waiting; `label` is e.g. "Dev-1 is working, QA-1 is waiting for you", "Done" or "");
  - `topicActivityLine(state)`, which gives "is working", "is waiting for you" or "is done".
  - `chat.topic.activity` and `chat.topic.doneAt` are on `TopicInfo`.
- **`apps/mobile/src/components/chat/topic-row.tsx` (177 lines):**
  - `STATUS_DOT` (`:42-48`) and `status` (`:84`);
  - the status chip (`:131-140`) leads the preview line;
  - the title line ends with the pin and muted icons, then the time (`:66`);
  - `topicStatusLabel` is imported from `@/lib/topics` (`:16`).
- **`apps/mobile/src/components/chat/chat-header.tsx` (197 lines):**
  - the keys are Media (`:180-184`), Search (`:185-189`) and More (`:190-194`);
  - `isTopic` is at `:98`.
- **Pieces to reuse:**
  - `EntityAvatar` (`apps/mobile/src/components/chat/entity-avatar.tsx:28`; props `person`, `size`, `ai`);
  - `ActionSheet` and `ActionSheetItem` (`apps/mobile/src/components/ui/action-sheet.tsx:50`, `:148`);
  - `useAisApi()` with `api.listAis()` and `api.stopAiTurn(id, chatJid)` (`apps/mobile/src/lib/ais-api.ts:212-214`);
  - the ownership check pattern in `apps/mobile/src/components/chat/progress-card.tsx:115-125`;
  - the approvals screen is `/settings/approvals`.

### Steps
1. **New `apps/mobile/src/components/chat/ai-activity-marks.tsx`:** for a topic's `activity` and `doneAt`, through `topicActivityView`:
   - **when something is active:** up to 3 overlapping 20 px `EntityAvatar`s (`ai`, the entry's name and `avatarUrl`), then "+N";
     - a working entry has a 26 px dashed ring around it, turning slowly with `react-native-reanimated` (already a dependency; no animation when reduce-motion is on);
     - a waiting entry has an 8 px amber dot (`#f59e0b`) at the lower right with a 2 px ring in the background colour;
     - the group is one `accessibilityRole="image"` with `accessibilityLabel` = `label`;
   - **when `done`:** a 16 px green check (`#22c55e` circle, dark tick, `accessibilityLabel="Done"`);
   - **otherwise:** nothing.
2. **`topic-row.tsx`:**
   - remove the status chip, `STATUS_DOT`, `status` and the `topicStatusLabel` import;
   - render the marks at the end of the title line, before the time;
   - when the view is `done`, the title uses the muted colour.
3. **New `apps/mobile/src/components/chat/ais-here-sheet.tsx`** after `PhoneSheet.dc.html`: an `ActionSheet` titled "AIs here". One row per `activity` entry:
   - a 36 px picture with its mark, the name (15 px, 600) and one muted line from `topicActivityLine`;
   - a working entry of an AI **you own** (`api.listAis()` ids include `aiId`) has a Stop `IconButton` (`Square` icon, "Stop <name>") calling `stopAiTurn(aiId, chat.id)`; an error shows one line, "Could not stop <name>";
   - a waiting entry's row opens `/settings/approvals`.
   
   No Add key, and no idle AIs: the activity holds only working, waiting and done.
4. **`chat-header.tsx`:** for a topic with an active entry, an "AIs here" key comes first among the keys. It is an `IconButton` holding the marks, labelled "AIs here: <label>", and it opens the sheet. Keep the file under 400 lines; the sheet's open state lives in the header or a small hook.
5. **Every file stays under 400 lines.** Leave `topicStatusLabel` in `lib/topics.ts` if other files still use it.

### Not in scope
- the task strip (the next task);
- the status line above the composer;
- web;
- the server.

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/components/chat/ai-activity-marks.tsx` (new)
- `apps/mobile/src/components/chat/ais-here-sheet.tsx` (new)
- `apps/mobile/src/components/chat/topic-row.tsx`
- `apps/mobile/src/components/chat/chat-header.tsx`
- `work/T-1539-mobile-topic-activity-marks.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock, the Dev team group's topics:** Checkout ends with Dev-1 (ring) and QA-1 (amber dot); General shows the green check with a muted title; no row shows a status word.
- **The Checkout topic's header** has the "AIs here" key. Its sheet lists Dev-1 "is working" with Stop, and QA-1 "is waiting for you".

---

## Report (written by the worker when done)

### What I did

- **New `apps/mobile/src/components/chat/ai-activity-marks.tsx`** (twin of web `components/topic/AiActivityMarks.tsx`): through `topicActivityView(topic.activity, topic.doneAt)` it draws
  - `AiActivityMarks`: up to 3 overlapping 20 px `EntityAvatar`s (`ai`, entry name + `avatarUrl`), working before waiting, then `+N`; the group is one `accessibilityRole="image"` with `accessibilityLabel={label}`;
  - `AiActivityMark`: one picture with its mark — working gets a 26 px dashed ring turning once every 2.4 s, waiting an 8 px amber (`#f59e0b`) dot at the lower right with a 2 px ring in `ringColor`, done a 16 px green (`#22c55e`) check with `accessibilityLabel="Done"`;
  - a done topic shows only the green check; an idle topic shows nothing.
- **`topic-row.tsx`**: removed `STATUS_DOT`, the `status` variable, the `topicStatusLabel` import and the whole status chip; the title line now ends with `AiActivityMarks` (before the time); a `done` view draws the title in the muted colour.
- **New `apps/mobile/src/components/chat/ais-here-sheet.tsx`**: an `ActionSheet` titled "AIs here"; one row per `activity` entry with a 36 px picture marked, the name (15 px, 600) and one muted line from `topicActivityLine`; a working entry you own (`api.listAis()` ids contains `aiId`) has a Stop `IconButton` (`Square`, label `Stop <name>`) calling `stopAiTurn(aiId, chat.id)` and, on failure, one fixed line "Could not stop <name>"; a waiting entry's row opens `/settings/approvals`. No Add key, no idle AIs.
- **`chat-header.tsx`**: for a topic with an active entry, an "AIs here" `IconButton` holding the marks, labelled `AIs here: <label>`, comes first among the keys and opens the sheet (open state lives in the header). Files: header 227 lines, marks 193, sheet 137, row 173 — all under 400.

### Checks run

- `pnpm install`: done, no errors (peer-dep warning unchanged from base).
- Single tests: none — the change is UI only and the task says "Tests: None".
- `pnpm gate` (first run): `FAIL typecheck` — `ai-activity-marks.tsx` used `palette.background`, which does not exist (it is `palette.panel`). Fixed both defaults.
- `pnpm gate` (final run), the summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.8s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.4s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/mobile  (1.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- **Deviation on the animation:** the spec says the turning ring uses `react-native-reanimated`. The mobile code's existing motion pattern (`skeleton.tsx`, `typing-dots.tsx`, `folder-*`) uses React Native's `Animated` plus `useReducedMotion` from `react-native-reanimated`; I followed that pattern (RN `Animated` for the rotation, `useReducedMotion` to freeze it) rather than importing `Animated` from reanimated, so the file moves with the rest of the app. Say the word if you want the reanimated `useSharedValue`/`withRepeat` form instead.
- **Ring colour:** the marks sit on three different surfaces (topic row `#0a0a0a`, header and sheet `#111111`), so `AiActivityMarks`/`AiActivityMark` take an optional `ringColor` (the 2 px ring around the amber dot and the check), defaulting to the row background and set to `palette.surface` in the header and the sheet. This mirrors web's `--avatar-ring` variable.
- I could not run the phone smoke here; the acceptance points (the Dev team group's rows and the Checkout header sheet) need the lead's device check.
- `topicStatusLabel` stays in `lib/topics.ts` — `task-strip.tsx` still uses it.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with one nit (3+ AIs might clip inside the 40 px key; with 2 AIs nothing clips).
- **Phone smoke** (mock): PASS.
  - **`/group/g-devteam`:** General shows the green check with a muted title; "Checkout button hidden on Safari" ends with Dev-1 (dashed ring) and QA-1 (amber dot); no row shows a status word.
  - **`/chat/t-devteam-bug@rooms.zilar.test`:** the header has the "AIs here" key with both marks, before Media, Search and More. The old strip under it goes in T-1540.
  - **The sheet** was read in the code (the smoke cannot tap): a 36 px picture with its mark, the name and one line; Stop only for your own working AI; a waiting row opens `/settings/approvals`.
- **Lead note for the Group info plan (T-1542):** the group header says "6 members, 2 AIs". Julio's rule is that AIs count as members everywhere, so check whether 6 already includes the AIs.

