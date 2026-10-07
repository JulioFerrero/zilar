---
id: T-0443
title: "AI memory M5a (web): a Memory section in the AI panel shows what the AI remembers in this DM; forget a fact, clear memory"
status: merged
milestone: M5
branch: task/T-0443-web-ai-memory-dm
model: auto
effort: low
depends_on: [T-0441]
estimate: 0.4 day
---

# T-0443: web — the AI's memory in the DM panel

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/ai-memory-plan.md` §3.6 (M5, DM part). The owner must see what the AI remembers in their DM, forget a pinned fact and clear the memory.

The server routes come from T-0441 (spec `work/T-0441-ai-memory-routes.md`). Their wire contract is:
- **`GET /api/ai-memory?chat=<jid>&ai=<aiId>`** returns `{ facts: { id: string; text: string }[], lines: string[], canChange: boolean }`;
- **`DELETE /api/ai-memory/facts/:id?chat=<jid>&ai=<aiId>`** returns `{ ok: true }`. A 403 has `error.code` `forbidden`; an unknown fact is a 404;
- **`POST /api/ai-memory/clear`**, body `{ chat, ai }`, returns `{ ok: true }`.
- A `lines` entry is either a summary, `#<lo>-<hi> <text>`, or a message, `#<seq> <YYYY-MM-DD> <sender>: <text>`.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ais/AiPanel.tsx`:**
  - it is the DM's AI panel; it finds the AI with `list.find((item) => item.jid === chat.id)` (line 187), so in a DM `chat.id` is the AI's JID;
  - the sections render in order, with `<UsageBlock ai={ai} />` at line 628 and `<AiActivity aiId={ai.id} />` at line 779, followed by `AlwaysAllowedList`, `ToolsSection` and `RoutinesSection` (lines 781-790).
- **`apps/web/src/lib/api.ts`:** `request(path, schema, init)` (line 191) answers from `mockRequest` in mock mode. The pattern to copy is `listPins`, `pinMessage` and `unpinMessage` (lines 907-923).
- **`apps/web/src/mock/api.ts`:** routing uses `const [head, first, second] = pathParts(path)` (line 2127). The in-memory pins block (around lines 2703-2760) shows the query parsing (`URLSearchParams`), `readJsonBody`, `jsonResponse` and `notFound`. The mock state's shape is at about line 90, and its seed at about line 1098.
- **Kit:**
  - `StateMessage({ kind: 'empty' | 'loading' | 'error', title, hint?, action?, size? })` (`apps/web/src/components/ui/state-message.tsx`);
  - `Button` (`components/ui/button.tsx`);
  - `ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel })` (`apps/web/src/components/ConfirmDialog.tsx:19`).
  - Icons come from `lucide-react`.
- **`apps/web/src/components/ais/AiPanel.test.tsx`** stubs `fetch` and counts calls in 11 places. **The new section must not fetch until the user opens it**, so those tests stay as they are.

### What to build
1. **`lib/api.ts`:**
   - `aiMemorySchema` (zod, per the contract) and `export type AiMemory`;
   - `getAiMemory(chat: string, aiId: string): Promise<AiMemory>`;
   - `forgetAiMemoryFact(chat: string, aiId: string, factId: string): Promise<void>`;
   - `clearAiMemory(chat: string, aiId: string): Promise<void>`.

   Use `URLSearchParams` for the query, like `listPins`. The DELETE and POST answers are parsed with `z.object({ ok: z.literal(true) })`.
2. **`mock/api.ts`:**
   - in-memory AI memory per `${chat}|${ai}`, seeded on first read with two facts and three lines:
     - facts: "Julio prefers short answers." and "The launch is on Friday.";
     - lines: one `#0-15 …` summary line and two `#16 2026-10-01 Julio: …` style lines;
   - `canChange: true`;
   - GET, DELETE (404 `not_found` for an unknown id) and clear (empties both lists).
3. **New `apps/web/src/components/ais/AiMemorySection.tsx`:** `AiMemorySection({ chat, aiId, aiName })`.
   - **Closed:**
     - `<section aria-label="Memory">` with the heading `Memory`;
     - the help line `What ${aiName} remembers from this chat. It reads this before replying.`;
     - a ghost `Button` "Show memory" (Brain icon). **No request is made until it is pressed.**
   - **Open:**
     - a loading `StateMessage` (size inline), then the content;
     - on an error, `StateMessage kind="error"`, title "Could not load the memory", with a Retry action.
   - **Content:**
     - **"Pinned facts":** one row per fact with its text and, when `canChange`, an icon `Button` (Trash2, `aria-label` "Forget this fact") that calls `forgetAiMemoryFact` and removes the row. A failure shows the inline line "Could not forget that fact" (`role="alert"`). With no facts, the muted line "Nothing pinned yet."
     - **"Earlier in this chat":** the `lines`. Strip the leading `#<n>` or `#<lo>-<hi>` token (regex `^#\d+(?:-\d+)? `) before showing each one. Use 13 px muted text, `whitespace-pre-wrap`, and `break-words`. With no lines, "Nothing older than the recent messages yet."
     - **When `canChange`:** a destructive outline `Button` "Clear memory" opens a `ConfirmDialog` with:
       - title "Clear memory?";
       - body `${aiName} forgets the pinned facts and the summaries of this chat. The messages stay, and it still reads the recent ones.`;
       - confirmLabel "Clear".

       Confirm calls `clearAiMemory` and then reloads. A failure shows "Could not clear the memory" (`role="alert"`).
   - **A "Hide memory" button** closes the section again.
4. **`AiPanel.tsx`:** render `<AiMemorySection chat={chat.id} aiId={ai.id} aiName={ai.name} />` right after `<UsageBlock ai={ai} />`.
5. **New `apps/web/src/components/ais/AiMemorySection.test.tsx`** (stub `fetch` and route by URL):
   - nothing is fetched before Show memory; pressing it GETs `/api/ai-memory?chat=…&ai=…`;
   - facts and lines render, with the `#…` tokens stripped;
   - Forget sends DELETE to the right URL and removes the row;
   - Clear asks first: Cancel sends nothing, Clear POSTs `{ chat, ai }` and reloads;
   - `canChange: false` hides Forget and Clear;
   - the empty texts show;
   - an error shows Retry, and Retry loads again.
6. **`AiPanel.test.tsx`:** do not change it. If a test there breaks, stop and report BLOCKED with the test name.

### Read first
`AGENTS.md`, `docs/audit/ai-memory-plan.md` §3.6, `work/T-0441-ai-memory-routes.md` (What to build 1), `apps/web/src/components/ais/AiPanel.tsx:170-215` and `:620-640` and `:770-795`, `apps/web/src/components/ais/AiActivity.tsx`, `apps/web/src/lib/api.ts:185-230` and `:880-925`, `apps/web/src/mock/api.ts:80-100`, `:2120-2135` and `:2700-2770`, `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/ui/state-message.tsx`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/mock/api.ts`, `apps/web/src/components/ais/AiMemorySection.tsx`, `apps/web/src/components/ais/AiMemorySection.test.tsx`, `apps/web/src/components/ais/AiPanel.tsx`, `work/T-0443-web-ai-memory-dm.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AiMemorySection AiPanel
pnpm gate
```

### Acceptance
- In an AI DM, the AI panel has a Memory section. Opening it shows the pinned facts and the earlier summary. The owner can forget a fact and clear the memory after a confirmation.
- No request is made until the section is opened.
- Mock mode works with seeded data.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- **`apps/web/src/lib/api.ts`** — added the AI-memory section: `aiMemorySchema` + `export type AiMemory`, `getAiMemory`, `forgetAiMemoryFact`, `clearAiMemory`. Queries use `URLSearchParams`; the DELETE and POST answers parse with `z.object({ ok: z.literal(true) })`.
- **`apps/web/src/mock/api.ts`** — added `MockAiMemory` and an `aiMemory: Map<string, MockAiMemory>` on the mock state, keyed by `${chat}|${ai}` and seeded on the first read (two facts, three lines: one `#0-15 …` summary and two `#16 2026-10-01 …` messages). GET answers `{ facts, lines, canChange: true }`; DELETE removes one fact (unknown id → 404 `not_found`); clear empties both lists. All routes live in the main `mockRequest` chain next to the pins block.
- **New `apps/web/src/components/ais/AiMemorySection.tsx`** — closed: `<section aria-label="Memory">`, heading `Memory`, the help line, and a ghost `Button` "Show memory" (Brain); no request until it is pressed. Open: an inline loading `StateMessage`, then the content, or an error `StateMessage` with a Retry action. Content: "Pinned facts" (per-fact Trash2 icon button with `aria-label="Forget this fact"`, inline `role="alert"` line on failure, "Nothing pinned yet." when empty) and "Earlier in this chat" (leading `#<n>` / `#<lo>-<hi>` token stripped, 13 px muted, `whitespace-pre-wrap break-words`, "Nothing older than the recent messages yet." when empty). When `canChange`, a destructive outline "Clear memory" opens the `ConfirmDialog` from the spec; confirming calls `clearAiMemory` then reloads, a failure shows "Could not clear the memory" (`role="alert"`). A "Hide memory" button closes the section.
- **`apps/web/src/components/ais/AiPanel.tsx`** — render `<AiMemorySection chat={chat.id} aiId={ai.id} aiName={ai.name} />` right after `<UsageBlock ai={ai} />`.
- **New `apps/web/src/components/ais/AiMemorySection.test.tsx`** — 10 tests: no fetch before Show memory then one GET to the right URL; facts and stripped lines render; Forget DELETEs the right URL and removes the row; Clear asks first (Cancel sends nothing, Clear POSTs `{ chat, ai }` and reloads); `canChange: false` hides Forget and Clear; the empty texts; error → Retry loads again; forget/clear failure alerts; Hide memory closes.

**Deviations / notes**
- "destructive outline `Button`": the kit has no combined variant, so I used `variant="outline"` with `border-danger/40 text-danger hover:bg-danger/10`.
- The loading flag is set from the event that starts a load (Show/Retry/after-clear), not synchronously inside the effect: oxlint's `react(set-state-in-effect)` rejects the latter (it caught my first version).
- `AiPanel.test.tsx` was not changed and still passes.

**Commands and results**
- `pnpm install`: done; only the pre-existing `@types/react` peer warning in `apps/mobile`.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AiMemorySection AiPanel`: 2 files, **42 passed** (10 new + 32 AiPanel).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AiMemorySection`: 1 file, **10 passed**.
- `pnpm gate` (two earlier red runs were fixed inside scope: prettier on 4 files, then a lint rule in the new test, then `noUncheckedIndexedAccess` typing in the new test):
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (31.1s)
PASS  lint  (0.7s)
PASS  typecheck  (9.5s)
PASS  tests @zilar/web  (52.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Files changed** (all inside the Allowed files): `apps/web/src/lib/api.ts`, `apps/web/src/mock/api.ts`, `apps/web/src/components/ais/AiMemorySection.tsx` (new), `apps/web/src/components/ais/AiMemorySection.test.tsx` (new), `apps/web/src/components/ais/AiPanel.tsx`, `work/T-0443-web-ai-memory-dm.md`.

**Security checklist:** client-only change; no secrets or raw server text in the UI (fixed sentences), no logs added, no routes, no permissions changed.

**Open questions:** none.

## Review (written by Claude)

Approved (lead, 2026-10-06). AiMemorySection sits after Usage in the DM AI panel and fetches nothing until Show memory. It shows the pinned facts with Forget (when canChange), the earlier lines with the #ids stripped, and Clear memory behind a ConfirmDialog, followed by a reload. Errors are fixed sentences and Retry reloads. Mock mode has seeded data and lib/api has getAiMemory, forgetAiMemoryFact and clearAiMemory. Nit for a later pass: a double tap on Forget can show a false error.
