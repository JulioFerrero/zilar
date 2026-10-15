---
id: T-1532
title: "AI work in topics, step 6a (web): topic rows show the AIs at work with state marks (turning ring = working, amber dot = waiting for you, green check = done); the topic header gets an 'AIs here' key whose popover lists each AI with one line and Stop; a shared chat-core helper sorts and labels the activity"
status: merged
milestone: M5
branch: task/T-1532-web-topic-activity-marks
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1532: Web topic rows and header show the AIs at work

## Spec (written by Claude, do not edit)

### Why
This is step 6 of the approved "AI work in topics" plan. Read `docs/design/mockups/ai-work/README.md`, `Main.dc.html` and `States.dc.html`.
- **Sidebar:** each topic row ends with the pictures of the AIs working there, with their state marks.
- **Header:** an "AIs here" key shows those pictures.
- **The marks:**
  - **working:** a turning ring around the picture;
  - **waiting for you:** an amber dot;
  - **done:** a green check, when the AI finished or a person marked the topic done;
  - **idle:** no mark.

The data has been there since T-1514 (`TopicInfo.activity`) and T-1521 (`TopicInfo.doneAt`), and T-1528 refreshes it live. **This task adds no server change and removes nothing**: the task strip goes in the next step.

### Facts (the lead read them on main, 2026-10-15)
- **The data:**
  - `TopicInfo` (`packages/chat-core/src/types.ts`) has `activity: TopicAiActivity[]` (`{ aiId, name, avatarUrl?, state: 'working' | 'waiting' | 'done' }`, ordered working, waiting, done) and `doneAt: string | null`;
  - a topic chat is a `ChatSummary` with `topic` set.
- **`apps/web/src/components/TopicRow.tsx` (385 lines):** the title line (`:122-147`) is the title, Lock, `AiBadge`, then an `ml-auto` span with Muted and the time.
- **`apps/web/src/components/ChatHeader.tsx` (373 lines):** the "Search in chat" `IconButton` is at `:200-202`, followed by the chat menu. The file must not pass 400 lines.
- **The board's sizes:**
  - the mini picture is 20 px;
  - the working ring is a 28 px SVG circle (`r=12.5`, stroke `#ededed` 1.6, `stroke-dasharray="52 27"`) around it;
  - the amber dot is 8 px at the lower right, with a 2 px ring in the row's background;
  - the done check is a 16 px green circle (`#22c55e`) with a dark tick (`States.dc.html:33`, `Main.dc.html:58-59`);
  - a done topic's title is muted.
- **Pieces to reuse:**
  - `EntityAvatar` (`apps/web/src/components/EntityAvatar.tsx`, with `person`, `size` and `ai`);
  - `stopAiTurn(aiId, chatJid)` (`apps/web/src/lib/api/ais.ts:132`);
  - `Menu` or a popover from `apps/web/src/components/ui/menu.tsx`;
  - `IconButton`;
  - Tailwind's `animate-spin`.

### Steps
1. **New `packages/chat-core/src/topic-activity.ts`** (export it from the index), `topicActivityView(activity, doneAt)` returning:
   - `active`: the working, then waiting, entries;
   - `done: boolean`: true when nothing is active and either `doneAt !== null` or some entry is `done`;
   - `label`: e.g. "Dev-1 is working, QA-1 is waiting for you", "Done", or "".
   
   Add a small test, `topic-activity.test.ts` (pure).
2. **New `apps/web/src/components/topic/AiActivityMarks.tsx`:** for a topic's `activity` and `doneAt`:
   - **when something is active:** up to 3 overlapping 20 px `EntityAvatar`s (`ai`, the entry's name and `avatarUrl`), then "+N" when there are more. A working one has the 28 px dashed ring, turning slowly (`animate-spin [animation-duration:2.4s]`, and no animation under `motion-reduce`); a waiting one has the amber dot. The whole group is one `role="img"` with `aria-label` = `label`.
   - **when `done`:** the 16 px green check (`role="img"`, `aria-label="Done"`);
   - **otherwise:** nothing.
3. **`TopicRow.tsx`:** render `<AiActivityMarks …/>` in the title line's `ml-auto` span, before Muted and the time, only for topics. When the view is `done`, the title uses `text-muted-foreground`. Stay at or under 400 lines; move `rowPreview` into a new `apps/web/src/components/topicRowPreview.ts` if needed.
4. **New `apps/web/src/components/topic/AisHereKey.tsx`:** for a topic chat with something in `activity`:
   - an `IconButton` (36 px, kit) holding the marks, `aria-label` "AIs here: <label>";
   - it opens a popover listing every entry: a 28 px picture with its mark, the name, and one muted line ("is working", "is waiting for you" or "is done");
   - a working entry has a Stop `IconButton` (`Square` icon, "Stop <name>") that calls `stopAiTurn(aiId, chat.id)`; an error shows one line ("Could not stop <name>");
   - a waiting entry links to `/settings/approvals`.
   
   `ChatHeader.tsx` renders it before the Search key, in at most 3 added lines.
5. **Every file stays under 400 lines.**

### Not in scope
- removing the task strip, status, owner or kind (next task);
- the status line above the composer;
- the phone;
- the server.

### Allowed files
- `packages/chat-core/src/topic-activity.ts` (new)
- `packages/chat-core/src/topic-activity.test.ts` (new)
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/topic/AiActivityMarks.tsx` (new)
- `apps/web/src/components/topic/AisHereKey.tsx` (new)
- `apps/web/src/components/TopicRow.tsx`
- `apps/web/src/components/topicRowPreview.ts` (new, only if needed)
- `apps/web/src/components/ChatHeader.tsx`
- `work/T-1532-web-topic-activity-marks.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/topic-activity.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Web mock:**
  - "Checkout button hidden on Safari" ends with Dev-1 (turning ring) and QA-1 (amber dot);
  - General shows the green check, since its mock activity is Dev-1 done;
  - opening the Checkout topic shows the "AIs here" key, and its popover lists Dev-1 "is working" with Stop and QA-1 "is waiting for you".
- No horizontal scroll, 0 page errors.

---

## Report (written by the worker when done)

### What I did

Shared helper:
- **`packages/chat-core/src/topic-activity.ts`** (new): `topicActivityView(activity, doneAt)` returns `{ active, done, label }`. `active` holds the working entries first, then the waiting ones (stable sort by a `STATE_ORDER` map, so a done entry is never in it); `done` is true only when `active` is empty and either `doneAt !== null` or some entry is `done`; `label` is `"Dev-1 is working, QA-1 is waiting for you"`, `"Done"` when done, or `""` when idle. It also exports `topicActivityLine(state)` (`"is working"` / `"is waiting for you"` / `"is done"`), reused by the popover, so the wording lives in one place. Exported from `packages/chat-core/src/index.ts`.
- **`packages/chat-core/src/topic-activity.test.ts`** (new): 6 pure cases — working before waiting, a waiting entry that arrived first gets reordered, done from an AI, done from `doneAt`, idle, and an active AI with `doneAt` set stays not-done.

Web:
- **`apps/web/src/components/topic/AiActivityMarks.tsx`** (new): `AiActivityMarks({ activity, doneAt })` renders the green check when the view is done, nothing when idle, and otherwise a `role="img"` group (`aria-label` = `label`) of up to three overlapping 20 px `EntityAvatar`s (`ai`, the entry's name and `avatarUrl`) plus `+N`. Working entries carry the 28 px dashed ring (`r=12.5`, stroke `#ededed` 1.6, `stroke-dasharray="52 27"`) turning with `animate-spin [animation-duration:2.4s] motion-reduce:animate-none`; waiting entries carry the 8 px amber dot with a 2 px `ring-[var(--avatar-ring)]` that follows the row background like the online dot already does. It also exports `AiActivityMark` (one picture + its mark, for the 28 px popover picture; done overlays the check) and `DoneCheck` (the 16 px green circle with the dark tick).
- **`apps/web/src/components/topic/AisHereKey.tsx`** (new): for a topic chat with activity, a 36 px kit `IconButton` (`aria-label` `"AIs here: <label>"`) holding the marks, opening a `Menu` popover that lists every entry: its 28 px picture with its mark, the name, and one muted line from `topicActivityLine`. A working entry shows a `Square` `IconButton` (`"Stop <name>"`) that runs `stopAiTurn(aiId, chat.id)` through `useAction`/`Effect`; on failure one line reads `"Could not stop <name>"`. A waiting entry is a `<Link to="/settings/approvals">`. Renders nothing when there is no activity.
- **`apps/web/src/components/TopicRow.tsx`**: computes the view once and puts `<AiActivityMarks …/>` first in the title line's `ml-auto` span (before Muted and the time), only when `chat.topic` is set; when `activity.done` the title uses `text-muted-foreground`. 398 lines.
- **`apps/web/src/components/ChatHeader.tsx`**: renders `<AisHereKey chat={chat} />` before the Search key when `isTopic` (2 added lines: the import and the element). 373 lines.

No server change. No file outside the Allowed files was touched; `topicRowPreview.ts` was not needed (`TopicRow.tsx` stayed under 400).

### Checks run

- `pnpm --filter @zilar/chat-core exec vitest run src/topic-activity.test.ts --reporter=dot` — **6 passed (1 file)**.
- `pnpm gate` (from the repo root) — **GATE PASS**:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.7s)
  PASS  lint  (1.4s)
  PASS  typecheck  (3.7s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/chat-core  (1.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- I did **not** run the web mock: starting the dev server is a background job, which the safety rules forbid. The web-mock acceptance lines are for the lead's live check.

### Notes for the lead

- **Fix round: Stop only for your own AIs.** `AisHereKey` now loads the viewer's AIs with `listAis()` through `useQuery` (like `ProgressCard`) and shows the Stop key on a working entry only when its `aiId` matches one of their ids; while the list loads or if it fails, no Stop shows.
- **Stop goes through `useAction`/`Effect`.** The first gate run failed the Effect ratchet (W4) on a raw `stopAiTurn(...).catch(...)` in the new file. The row now runs the call as `Effect.tryPromise` inside `useAction` and renders the typed failure; the error line moved inside the working row. Nothing else changed in behaviour.
- **Popover rows are plain elements, not `MenuItem`s.** A working row nests a Stop `IconButton`, and a button cannot live inside a menu item; the waiting row is a real `<Link>`. So the popover is a `BaseMenu.Popup` with custom rows: the trigger opens it, Escape/outside-click closes it, but arrow-key roving between rows is not wired. Say the word if you want `MenuItem`s with the Stop key kept as a sibling instead.
- **Overlap.** The board draws the minis with a 4 px gap; the spec says "overlapping 20 px avatars", so I overlapped them by 6 px (`-ml-1.5`). Easy to change to a gap if the board is the final word.
- **Ring/dot colour.** The amber dot ring uses `var(--avatar-ring)` (the same variable the online dot uses), which the topic row already flips to `surface-raised` on hover/selection; in the header it falls back to the panel colour. The board uses a hard-coded row background instead.
- **Done case in the popover.** The spec's one line per AI covers "is done"; I show the 28 px picture with the 16 px check overlaid on its lower right, and the idle/idle-like fallback row (an unknown state can't occur) shows the picture alone. The topic row's done case is the check on its own, per spec.
- Suggest the lead eyeball at 390 px and wide: Checkout shows Dev-1 (ring) + QA-1 (dot), General shows the check with a muted title, and opening Checkout shows the "AIs here" key whose popover lists Dev-1/Stop and QA-1.

## Review (written by Claude)

**Approved and merged after one fix round.**

- **Pre-review:** the first packet had one nit (no arrow-key roving in the popover; accepted) and one follow-up: Stop showed for every working AI.
- **The lead's fix round:** show Stop only for the viewer's own AIs, matched through `listAis()` as `ProgressCard` does. The second packet was clean.
- **Headless web mock** (1280 and 390 px, both rounds):
  - Checkout ends with Dev-1 (dashed ring) and QA-1 (amber dot), labelled "Dev-1 is working, QA-1 is waiting for you";
  - General shows the green check with a muted title;
  - the Checkout header has the "AIs here" key, whose popover lists "Dev-1 is working" with Stop (the mock viewer owns Dev-1) and "QA-1 is waiting for you";
  - no horizontal scroll, 0 page errors.
- **Worker's choices, accepted:**
  - a 6 px overlap;
  - `--avatar-ring` for the dot's ring;
  - the check overlaid on a done AI's picture in the popover.
- **Next:** T-1534 removes the task strip still visible under the header, and T-1537 adds the status line.
