---
id: T-0447
title: "AI memory M5b (web): each AI row in the group and topic panels opens a 'What <AI> remembers' dialog"
status: todo
milestone: M5
branch: task/T-0447-web-ai-memory-rooms
model: auto
effort: low
depends_on: [T-0443]
estimate: 0.3 day
---

# T-0447: web — the AI's memory of a room

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/ai-memory-plan.md` §3.6 (M5, rooms). Every member of a room can see what an AI remembers there. The AI's owner and the room's managers can forget facts and clear the memory: the server answers `canChange` (T-0441).

T-0443 built `AiMemorySection` for the DM panel. This task reuses it in a dialog.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ais/AiMemorySection.tsx`:**
  - `AiMemorySection({ chat, aiId, aiName })` (line 19) starts closed (`useState(false)` at line 28), with a "Show memory" button, and fetches only once open;
  - it already hides Forget and Clear when the server says `canChange: false`.
- **`apps/web/src/components/GroupPanel.tsx`:**
  - `GroupPanel({ chat, onClose })` (line 45);
  - the AI rows are rendered by `info.ais.map((ai) => …)` at lines 370-425, each a row `div` with the avatar, the name with `AiBadge`, "Added by …", and an optional Remove button;
  - `ai.aiId` and `ai.name` are available;
  - `chat.id` is the room JID.
- **`apps/web/src/components/TopicPanel.tsx`:**
  - `TopicPanel({ chat, onClose })` (line 48);
  - the AI rows are rendered by `aisState.ais.map((ai) => …)` at lines 642-675, with `ai.id` and `ai.name`;
  - `chat.id` is the topic room JID.
- **Kit:**
  - `Dialog({ open, onClose, title, description?, children?, actions?, size? })` (`apps/web/src/components/ui/dialog.tsx:5-27`);
  - `Button` with `variant="ghost"` and `size="sm"`.
  - Icons come from `lucide-react`. Use `Brain`, the same icon as the DM section.

### What to build
1. **`AiMemorySection`:** a new optional prop `initiallyOpen?: boolean` (default false). When true, the section starts open, loads at once and shows no Show or Hide button. Everything else is unchanged.
2. **New `apps/web/src/components/ais/AiMemoryDialog.tsx`:** `AiMemoryDialog({ chat, aiId, aiName, onClose })` renders `<Dialog open onClose={onClose} title={\`What ${aiName} remembers\`} size="md">` with `<AiMemorySection chat={chat} aiId={aiId} aiName={aiName} initiallyOpen />` inside.
3. **`GroupPanel.tsx` and `TopicPanel.tsx`:**
   - each AI row gets an icon `Button` (`variant="ghost"`, `size="sm"`, the Brain icon, `aria-label={\`What ${name} remembers\`}`) before the Remove button. It is shown to everyone who sees the panel.
   - Pressing it sets local state `memoryAi: { id, name } | undefined`, and the panel renders `<AiMemoryDialog chat={chat.id} … onClose={() => setMemoryAi(undefined)} />` while it is set.
4. **Tests:**
   - **`AiMemorySection.test.tsx`:** with `initiallyOpen`, the GET happens on mount and no Show memory button exists.
   - **New `AiMemoryDialog.test.tsx`:**
     - the title is "What Helper remembers";
     - it loads `/api/ai-memory?chat=<room>&ai=<id>`;
     - with `canChange: false` there is no Forget and no Clear;
     - Escape calls `onClose`.

     Stub `fetch` and route by URL, like `AiMemorySection.test.tsx`.
   - **`GroupPanel.test.tsx` and `TopicPanel.test.tsx`:** one test each: the AI row shows the "What <name> remembers" button, and pressing it opens the dialog. Change existing tests only if the new button breaks their setup.

### Read first
`AGENTS.md`, `docs/audit/ai-memory-plan.md` §3.6, `apps/web/src/components/ais/AiMemorySection.tsx`, `apps/web/src/components/ais/AiMemorySection.test.tsx:1-60`, `apps/web/src/components/GroupPanel.tsx:40-60` and `:360-430`, `apps/web/src/components/TopicPanel.tsx:40-60` and `:635-680`, `apps/web/src/components/ui/dialog.tsx:1-60`.

### Allowed files
`apps/web/src/components/ais/AiMemorySection.tsx`, `apps/web/src/components/ais/AiMemorySection.test.tsx`, `apps/web/src/components/ais/AiMemoryDialog.tsx`, `apps/web/src/components/ais/AiMemoryDialog.test.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/TopicPanel.test.tsx`, `work/T-0447-web-ai-memory-rooms.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AiMemorySection AiMemoryDialog GroupPanel TopicPanel
pnpm gate
```

### Acceptance
- In a group or topic panel, every AI row opens a "What <AI> remembers" dialog. It shows that room's pinned facts and earlier lines, and Forget and Clear only when the server allows them.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
