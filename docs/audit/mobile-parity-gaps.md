# Mobile parity audit: web vs mobile for the last parity items

This file documents what the web app does today for AI tools, routines, the
activity feed, the `@mention` picker and the group / invite dialogs, and what
the mobile app currently has. Every claim is backed by a `path:line` that I
opened and checked. Where a feature is missing on mobile I write "does not
exist" and name the file(s) I searched.

The audit is read-only: no code or test was changed.

Conventions:
- All paths are relative to the repo root.
- "Server" means an Express/Hono handler under `apps/server/src`.
- "Mobile" always means `apps/mobile/src`.
- `apps/web/src/lib/tools.ts` and `apps/web/src/lib/routines.ts` are the web
  client twins of the server route files
  (`apps/server/src/tools/routes.ts`, `apps/server/src/routines/routes.ts`)
  and the wire contract documented at the top of each file
  (`apps/web/src/lib/tools.ts:1-5`).

---

## 1. AI tools

### 1.1 What the web app does

#### 1.1.1 The AI side panel mounts the Tools section for the AI's owner

`AiPanel` lives at `apps/web/src/components/ais/AiPanel.tsx`. It loads the
owner by `jid` through `listAis()` (`apps/web/src/lib/api.ts` — the helper
imported at `apps/web/src/components/ais/AiPanel.tsx:8-19`), and renders the
Tools section at the bottom of the panel for the AI owner only
(`apps/web/src/components/ais/AiPanel.tsx:783-794`):

```text
              <AiActivity aiId={ai.id} />

              <AlwaysAllowedList scope={{ aiId: ai.id }} />

              {/* T-0107: tools and routines of this AI. The panel mounts for
              the AI owner only, so every action is allowed. */}
              <ToolsSection scope={{ aiId: ai.id }} scopeKey={`ai:${ai.id}`} canManage />
              <RoutinesSection
                scope={{ aiId: ai.id }}
                scopeKey={`ai-routines:${ai.id}`}
                canManage
              />
```

The `canManage` flag is what hides Run / Revert / Delete for members who are
not the AI owner or a group owner/admin (per
`apps/web/src/components/tools/ToolsSection.tsx:30-42` and
`apps/web/src/components/tools/RoutinesSection.tsx:47-57`).

#### 1.1.2 What a person can do

The web Tools UI lets a manager (the AI owner for personal-chat tools, or
the AI owner / group owner-or-admin for group-topic tools) do all of:

1. **List** every tool of an AI (`GET /ais/:id/tools`), of a group
   (`GET /groups/:id/tools`), or of a topic (`GET /topics/:id/tools`).
2. **Show source** for the current version and any older version
   (`GET /tools/:id`, `GET /tools/:id/versions`, `GET /tools/:id/versions/:n`).
3. **See version history** with revert per older version
   (`POST /tools/:id/revert`).
4. **Run now** with an optional JSON `input`
   (`POST /tools/:id/run`).
5. **Delete** the tool (`DELETE /tools/:id`, idempotent 204).

The read routes and their access checks are at:

- `apps/web/src/lib/tools.ts:142-177` (client wrappers).
- `apps/server/src/tools/routes.ts:89-178` (read handlers).
- `apps/server/src/tools/routes.ts:180-249` (revert, delete).
- `apps/server/src/tools/routes.ts:252-298` (run).
- `apps/server/src/tools/routes.ts:308-341` (`toolAccess`: same 404 shape
  for missing / soft-deleted / blind / stranger — exists is never leaked).

The wire shapes are at:

- `apps/web/src/lib/tools.ts:13-55` (list / detail / version schemas).
- `apps/web/src/lib/tools.ts:57-89` (`ToolRun`, `ToolRunResult` discriminated
  by `ok: true | false`).
- `apps/server/src/tools/routes.ts:514-573` (`toToolWire`, `toVersionWire`,
  `toRunWire` — the server side of those schemas).

The visible strings on a tool row and the detail header are at:

- `apps/web/src/components/tools/ToolsSection.tsx:14-22` (`hostsLine`,
  `lastRunText`).
- `apps/web/src/components/tools/ToolsSection.tsx:131-164` (the empty-state
  copy and the row layout).
- `apps/web/src/components/tools/ToolDetailPanel.tsx:25-33` (`hostsLine`,
  `runStatusText`).
- `apps/web/src/components/tools/ToolDetailPanel.tsx:218-242` (header
  block, including "Waiting for approval" copy).
- `apps/web/src/components/tools/ToolDetailPanel.tsx:309-330` (Run now
  textarea label "Optional JSON input (max 4 KB)").
- `apps/web/src/components/tools/ToolDetailPanel.tsx:380-385` (revert
  confirm body: "This creates a new version copying that version's code.
  The history keeps every version.").
- `apps/web/src/components/tools/ToolDetailPanel.tsx:472-478` (delete
  confirm body: "This deletes the tool and its routines. This cannot be
  undone.").

The "Waiting for approval: …" copy for unapproved hosts is at
`apps/web/src/components/tools/ToolDetailPanel.tsx:232-236` and the matching
row copy is at `apps/web/src/components/tools/ToolsSection.tsx:155-161`.

#### 1.1.3 The server caps and rate limits that any client must mirror

- **Manual run rate limit**: 5 per minute per user,
  `TOOL_RUN_RATE_LIMIT_MAX = 5`,
  `TOOL_RUN_RATE_LIMIT_WINDOW_MS = 60 * 1000`,
  `apps/server/src/tools/routes.ts:27-28` and applied at
  `apps/server/src/tools/routes.ts:263-265`.
  Over the cap the server answers `429 rate_limited: "Too many tool runs,
  try again in a minute"`.
- **`run` body**: `input` must serialise to **at most 16 KiB**
  (`MAX_TOOL_RUN_INPUT_BYTES = 16 * 1024`,
  `apps/server/src/tools/routes.ts:49`); above that the server answers
  `400 invalid_request: "input must serialise to at most 16384 bytes"`
  (`apps/server/src/tools/routes.ts:51-73`).
  The web client validates the same thing client-side at 4 KiB
  (`MAX_RUN_INPUT_BYTES = 4 * 1024`,
  `apps/web/src/components/tools/ToolDetailPanel.tsx:23`,
  enforced at `apps/web/src/components/tools/ToolDetailPanel.tsx:160-164`).
- **No runner configured**: `501 runner_unavailable: "No tool runner is
  configured on this server"` (`apps/server/src/tools/routes.ts:266-267`).
- **Tool not active**: `409 ai_not_active: "The AI is not active"`
  (`apps/server/src/tools/routes.ts:580-582`).
- **Manager-only writes**: revert, run and delete all return the same
  `404 not_found: "Tool not found"` for a viewer who may not write
  (`apps/server/src/tools/routes.ts:186-189`,
  `apps/server/src/tools/routes.ts:259-261`,
  `apps/server/src/tools/routes.ts:230-233`). The web client surfaces a
  friendly version: "You may not run this tool." for a 403/404 on run
  (`apps/web/src/components/tools/ToolDetailPanel.tsx:176-181`) and
  "You may not change this routine." for a 403/404 on routine mutations
  (`apps/web/src/components/tools/RoutinesSection.tsx:151-155`).
- **Tool + version caps**: `400 version_limit` / `400 tool_limit` are
  mapped from the service at `apps/server/src/tools/routes.ts:583-585`.

#### 1.1.4 Approve once and always-allowed (context, not in scope of T-0189)

The "approve once" / "approve always" / "deny" choice for a tool action
lives in `ApprovalCard` (`apps/web/src/components/ApprovalCard.tsx:66-103`)
and is wired to `decideApproval` (`apps/web/src/lib/api.ts:1190` —
`'approve_once' | 'approve_always' | 'deny'` is at
`apps/web/src/lib/api.ts:1138`). The card's three buttons
are rendered at `apps/web/src/components/ApprovalCard.tsx:208-245` with
labels "Approve" / "Deny" / "Always allow here". The "Always allow here"
confirm copy branches on topic / group / personal chat at
`apps/web/src/components/ApprovalCard.tsx:173-178` and is gated by the
server's `alwaysEligible` flag at `apps/web/src/components/ApprovalCard.tsx:112-113`.

### 1.2 What mobile has today

Mobile has the AI list, the AI detail/edit screen, the kill-switch and the
avatar uploader — those are out of scope here. For tools the picture is:

- `apps/mobile/src/lib/ais-api.ts` (full file, 305 lines): the AI management
  API. Lists / creates / updates / deletes AIs, lists connections, stops
  / resumes an AI (`apps/mobile/src/lib/ais-api.ts:66-76`). **No tools or
  routines calls.**
- A search of `apps/mobile/src` for the routes `tools`, `routines`,
  `run` and the client helpers used by web finds:
  - `apps/mobile/src/lib/ais-api.ts` (above).
  - No `tools-api.ts`, no `routines-api.ts`, no `*-tools-api.ts`,
    no `*-routines-api.ts`.
- `apps/mobile/src/components/ais/` (24 files, none named `tools*` or
  `routines*`):
  - `ai-actions-sheet.tsx`, `ai-row.tsx`, `ais.test.ts`,
    `delete-confirm.tsx`, `errors.ts`, `form.ts`, `limits-fields.tsx`,
    `limits.ts`, `machine-picker.test.tsx`, `machine-picker.tsx`,
    `model-picker.tsx`, `models.ts`, `option-row.tsx`,
    `provider-picker.tsx`, `providers.ts`, `require-ais-auth.tsx`,
    `run-state.test.ts`, `run-state.ts`, `screen-shell.tsx`,
    `template-cards.tsx`, `templates.ts`, `use-ais-api.ts`,
    `wizard-progress.ts`, `wizard-steps.tsx`.
- `apps/mobile/src/components/approvals/` has the approval cards and the
  "always allowed" rows (`always-allowed-row.tsx`, `approval-row.tsx`,
  `rows.ts`) and the rules API in
  `apps/mobile/src/lib/approvals-api.ts:42-48` —
  `listAiApprovalRules`, `listGroupApprovalRules`, `revokeApprovalRule`
  (the rules already exist on mobile; T-0184 covers the Approvals inbox
  page).
- `apps/mobile/src/app/ais/` has `[id].tsx`, `index.tsx`, `new.tsx` — the
  list, edit and new screens, all built on `ais-api.ts`. None of them
  renders tools or routines.

So for tools on mobile today: **does not exist**. No `tools-api.ts`, no
`tools-list.tsx`, no `tool-detail.tsx`, no equivalent of
`apps/web/src/components/tools/ToolsSection.tsx` or
`ToolDetailPanel.tsx` or `RoutinesSection.tsx`.

### 1.3 Suggested mobile surface (parity with web)

A mobile worker should mirror the web sections, behind `canManage = true`
for the AI owner and `canManage = false` otherwise (mobile has no notion of
"topic" yet — see ROADMAP — so the mobile equivalent of
`ToolsSection scope={{ topicId }}` is "do nothing yet").

For the run input cap, mobile should mirror the web client-side **4 KiB**
check (server caps at 16 KiB and answers 400 above that). The exact
client-facing sentence for the 5/min cap is "Too many tool runs, try again
in a minute" (use that verbatim; the rest of the app uses fixed sentences).

---

## 2. Routines

### 2.1 What the web app does

The Routines list lives next to the Tools list in `AiPanel`
(`apps/web/src/components/ais/AiPanel.tsx:790-794`). It is the same
`RoutinesSection` for an AI or a group, and shows the schedule in plain
words, the next / last run, the paused reason with its hint, and Pause /
Resume / Delete per row. The wire wrapper is at
`apps/web/src/lib/tools.ts:207-253` (read / pause / resume / delete), and
the plain-words helpers are at `apps/web/src/lib/routines.ts:25-122`:

- `describeRoutineSchedule` renders `every N hours` / `daily at HH:MM
  TZ on Mon, Wed, Fri` etc.; unknown shapes render `on a schedule`
  (`apps/web/src/lib/routines.ts:25-42`).
- `pausedReasonText` returns the re-approve hint for `hosts_changed` /
  `needs_approval` (`apps/web/src/lib/routines.ts:112-114`) and the
  "ask the AI to fix it" hint for `failures`
  (`apps/web/src/lib/routines.ts:115-117`).
- `MAX_OUTPUT_PREVIEW_CHARS = 2000` and `truncateOutput` cap long run
  output (`apps/web/src/lib/routines.ts:128-134`).

A user can do:

1. **List** routines of an AI (`GET /ais/:id/routines`,
   `apps/web/src/lib/tools.ts:228-230`,
   `apps/server/src/routines/routes.ts:53-74`).
2. **List** routines of a group (`GET /groups/:id/routines`,
   `apps/web/src/lib/tools.ts:233-235`,
   `apps/server/src/routines/routes.ts:76-99`).
3. **Pause** (`POST /routines/:id/pause`,
   `apps/web/src/lib/tools.ts:238-240`,
   `apps/server/src/routines/routes.ts:101-117`).
4. **Resume** (`POST /routines/:id/resume`,
   `apps/web/src/lib/tools.ts:246-248`,
   `apps/server/src/routines/routes.ts:119-135`). A routine paused for
   `hosts_changed` or `needs_approval` answers
   `409 needs_approval: "This routine needs re-approval"`; the web client
   shows the hint `apps/web/src/components/tools/RoutinesSection.tsx:149-151`.
5. **Delete** (`DELETE /routines/:id`, idempotent 204,
   `apps/web/src/lib/tools.ts:251-253`,
   `apps/server/src/routines/routes.ts:137-149`).

#### 2.1.1 Routine shape (the wire)

`apps/web/src/lib/tools.ts:207-223` (the schema the web client validates
against):

```ts
{
  id, aiId?, groupId?, topicId?, toolId?,
  title, toolName,
  schedule: unknown,                       // see schedule routing
  status: 'active' | 'paused' | 'needs_approval',
  pausedReason: 'user' | 'failures' | 'hosts_changed' | null,
  nextRunAt, lastRunAt, lastStatus, approvedHosts, scope
}
```

`schedule` is one of two shapes (see
`apps/web/src/lib/routines.ts:8-101` and
`apps/server/src/tools/adapters.ts:describeSchedule`):

- `{ kind: 'interval', everyMinutes: number }` where `everyMinutes >= 60`.
- `{ kind: 'daily', time: 'HH:MM', timezone: string, weekdays?: number[] }`
  with `time` matching `^([01]\d|2[0-3]):[0-5]\d$`, non-empty timezone, and
  weekdays `1..7` if present.

Both wire schemas are persisted by the scheduler. The server answers
`schedule: unknown` (`apps/server/src/routines/routes.ts:285`), so the
client must tolerate an unrecognised `schedule` and read it as
`"on a schedule"` rather than crashing
(`apps/web/src/lib/routines.ts:27-29`).

#### 2.1.2 Visible strings on a routine row

- `apps/web/src/components/tools/RoutinesSection.tsx:16-25` (`statusText`:
  `'needs approval' | 'paused' | 'active'`).
- `apps/web/src/components/tools/RoutinesSection.tsx:26-36` (`nextRunText`,
  `lastStatusText`).
- `apps/web/src/components/tools/RoutinesSection.tsx:200-211` (the row
  itself: `describeRoutineSchedule(routine.schedule) · runs
  {routine.toolName} · {statusText(routine)}`, then `next {…} · last …`,
  then the paused-reason line).
- `apps/web/src/components/tools/RoutinesSection.tsx:215-239` (the
  Pause / Resume button).
- `apps/web/src/components/tools/RoutinesSection.tsx:240-275` (the Delete
  two-step — first click arms, second click acts).
- `apps/web/src/components/tools/RoutinesSection.tsx:280-281` (inline
  error + hint).

#### 2.1.3 Error / status messages the UI shows verbatim

- `apps/web/src/components/tools/RoutinesSection.tsx:149-151`: when the
  server answers `409 needs_approval`, show the hint "This routine needs
  re-approval. Ask the AI to schedule it again." and keep the Pause /
  Resume / Delete buttons.
- `apps/web/src/components/tools/RoutinesSection.tsx:151-155`: when the
  server answers `403 | 404`, show "You may not change this routine."
- Otherwise: `error.message`.

For an unknown failure (`apps/web/src/components/tools/RoutinesSection.tsx:153-155`)
the fallback is "Could not update the routine."

The empty state copy is "No routines here yet. Ask the AI in the chat to
schedule one." (`apps/web/src/components/tools/RoutinesSection.tsx:186-189`).

### 2.2 What mobile has today

For routines on mobile: **does not exist**. There is no `routines-api.ts`
or `routines-*.ts` file under `apps/mobile/src`. The mobile AI screens
(`apps/mobile/src/app/ais/{index,[id],new}.tsx`) and the AI component
library (`apps/mobile/src/components/ais/*`) do not render a routines list.
The approval rules API at
`apps/mobile/src/lib/approvals-api.ts:45-47` already exposes
`listAiApprovalRules` / `listGroupApprovalRules` / `revokeApprovalRule`,
which the Always-Allowed list UI already uses — so the approvals side is
covered, but the routines scheduling side is not.

### 2.3 Suggested mobile surface (parity with web)

Mirror `apps/web/src/lib/tools.ts` routines helpers and
`apps/web/src/lib/routines.ts` plain-words helpers verbatim, then build a
mobile `RoutinesSection`. Use the same fixed sentences above.

---

## 3. Activity feed (`AiActivity` / `ActivitySection`)

### 3.1 What the web app does

`apps/web/src/components/ais/AiActivity.tsx` is the activity feed on the
AI panel; the underlying `ActivitySection` (exported from the same file,
lines 86-227) is shared with the group panel
(`apps/web/src/components/GroupPanel.tsx:549` and
`apps/web/src/components/TopicPanel.tsx:904`).

#### 3.1.1 What rows it shows

Each row is a `PublicAuditEntry` (the schema is at
`apps/web/src/lib/api.ts:1851-1863`):

```ts
{
  id: string,
  at: string,                      // ISO timestamp
  aiId: string | null,
  groupId: string | null,
  action: string,                  // see mapping below
  subjectId: string | null,
  argsHash: string | null,
  cost: { currency: 'EUR' | 'USD'; amount: number } | null,
  result: 'ok' | 'denied' | 'error',
  detail: Record<string, unknown> | null,
  actorUserId: string | null,
}
```

The displayed human sentence is computed by `describeAuditEntry`
(`apps/web/src/components/ais/AiActivity.tsx:11-29`) and has three special
cases plus a fallback that humanises the action:

- `approval.decided` + `detail.decision === 'approve_once' | 'approve_always'`
  → `"A request was approved"`
  (`apps/web/src/components/ais/AiActivity.tsx:14-17`).
- `approval.decided` + `detail.decision === 'deny'`
  → `"A request was denied"`
  (`apps/web/src/components/ais/AiActivity.tsx:18-20`).
- `approval.decided` (any other / missing decision)
  → `"A request was decided"`
  (`apps/web/src/components/ais/AiActivity.tsx:21-22`).
- `ai.stopped` → `"Stopped"`
  (`apps/web/src/components/ais/AiActivity.tsx:22-24`).
- `ai.resumed` → `"Resumed"`
  (`apps/web/src/components/ais/AiActivity.tsx:24-25`).
- any other action → `humaniseAction(action)`:
  uppercase first segment, join with the rest with spaces
  (`apps/web/src/components/ais/AiActivity.tsx:39-48`).

The right-hand column is `formatRelativeAudit(at, now)`
(`apps/web/src/components/ais/AiActivity.tsx:57-71`): `"just now"`,
`"{minutes} min ago"`, `"{hours} hour|hours ago"`, `"{days} day|days ago"`.

The page header is "Activity" with a refresh icon (`aria-label="Refresh
activity"`) — see `apps/web/src/components/ais/AiActivity.tsx:174-188`.
The empty state is "No activity yet." (line 207), the loading state a
three-row skeleton (`apps/web/src/components/ais/AiActivity.tsx:262-282`),
and the error state shows the `error.message` plus a "Retry" button
(`apps/web/src/components/ais/AiActivity.tsx:191-204`).

#### 3.1.2 How it loads

- **Polling / pagination**: the page is **not** polled. The component
  re-loads on `refreshTick` (manual refresh icon) and on
  `scopeKey` change (`apps/web/src/components/ais/AiActivity.tsx:100-140`).
  Pagination uses a keyset cursor: `next: string | null` on the page
  response, and `Load more` calls `listAudit({ ...scope, limit, before:
  next })` (`apps/web/src/components/ais/AiActivity.tsx:142-168`,
  `apps/web/src/components/ais/AiActivity.tsx:212-222`).
- **Page size**: 20 entries per page (`PAGE_LIMIT = 20`,
  `apps/web/src/components/ais/AiActivity.tsx:9`,
  `apps/web/src/components/ais/AiActivity.tsx:115`,
  `apps/web/src/components/ais/AiActivity.tsx:148`).
- **Route**: `GET /api/audit?aiId=…|groupId=…&limit=…&before=…`,
  see `apps/web/src/lib/api.ts:1889-1903`. The server contract is at
  `apps/server/src/audit/routes.ts:17-24` and the route handler at
  `apps/server/src/audit/routes.ts:29-63`:
  - `?aiId=…|?groupId=…` — exactly one, never both, otherwise
    `400 invalid_request: "Provide exactly one of groupId or aiId"`
    (`apps/server/src/audit/routes.ts:38-39`).
  - `limit` is `z.coerce.number().int().min(1).max(200).optional()`
    (`apps/server/src/audit/routes.ts:21`,
    `apps/server/src/audit/routes.ts:55`,
    `MAX_AUDIT_LIST_LIMIT = 200` at
    `apps/server/src/audit/service.ts:127`).
  - `before` is a keyset cursor string, max 256 chars
    (`apps/server/src/audit/routes.ts:22`).

#### 3.1.3 Displayed action set (with examples)

`describeAuditEntry` handles `approval.decided`, `ai.stopped`,
`ai.resumed` specially. Anything else passes through `humaniseAction`,
which only capitalises the first segment. The action shape on the wire
is a dotted, lowercase + underscore id that the schema validates against
`ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`
(`apps/server/src/audit/service.ts:19`), enforced on the `action` field
(`apps/server/src/audit/service.ts:41`).

### 3.2 What mobile has today

- `apps/mobile/src/lib/ais-api.ts` (full file, 305 lines): no `listAudit`
  or audit-related method.
- `apps/mobile/src/components/ais/` (all files listed in §1.2): no audit
  list component.
- `apps/mobile/src/app/ais/[id].tsx`: the AI edit screen; no activity feed.

So for the activity feed on mobile: **does not exist**. The closest
sibling — `apps/web/src/components/ais/AiActivity.tsx` — has no mobile
equivalent.

### 3.3 Suggested mobile surface (parity with web)

`AiActivity` / `ActivitySection` are pure data — they only read audit
entries. A mobile worker would mirror `describeAuditEntry`,
`formatRelativeAudit`, the loading / empty / error states, and the
20-per-page keyset pagination (`PAGE_LIMIT = 20`, `limit` cap `200`).

---

## 4. `@mention` picker

### 4.1 What the web app does

The picker lives in two files:

- `apps/web/src/components/MentionPicker.tsx:1-67`. It is a small pure
  component: a `role="listbox"` with one `role="option"` per member, an
  `aria-activedescendant` on the textarea for keyboard focus, an `ai`
  `AiBadge` next to AI members (`apps/web/src/components/MentionPicker.tsx:57`),
  and the avatar / name + handle label
  (`apps/web/src/components/MentionPicker.tsx:50-56`).
- `apps/web/src/components/Composer.tsx` — the parent composer.

#### 4.1.1 Trigger rules

The query starts on `@` and only when the `@` is the first char or follows
whitespace. The rules are in
`packages/chat-core/src/mentions.ts:21-35`:

```ts
export function findMentionQuery(text: string, caret: number) {
  const position = Math.max(0, Math.min(caret, text.length));
  if (position === 0) return undefined;
  let start = position;
  while (start > 0 && !WHITESPACE.test(text[start - 1] ?? '')) start -= 1;
  const at = text.lastIndexOf('@', position - 1);
  if (at < start || (at > 0 && !WHITESPACE.test(text[at - 1] ?? ''))) return undefined;
  return { start: at, query: text.slice(at + 1, position) };
}
```

The `@` itself is not part of the query (`packages/chat-core/src/mentions.ts:178`):
the picker filters with `query.trim().replace(/^@/, '')`.

The picker opens in `onChange`
(`apps/web/src/components/Composer.tsx:301-311`):

```ts
const onChange = (next, caret) => {
  setMentions((previous) => rebaseMentions(value, next, previous));
  setValue(next);
  setPicker(isGroup ? findMentionQuery(next, caret) : undefined);
  setActiveIndex(0);
  ...
};
```

#### 4.1.2 What it lists

It lists the people of the group and the group's AIs, never the current
user (`apps/web/src/components/Composer.tsx:255-265`):

```ts
const isGroup = store.chats.find((chat) => chat.id === chatId)?.kind === 'group';
const meJid = store.me?.jid ?? undefined;
const members = isGroup
  ? store.groupMembers(chatId).filter((member) => !isMentionOfMe(member.jid, meJid))
  : [];
const candidates = picker === undefined
  ? []
  : filterMentionMembers(members, picker.query).slice(0, MENTION_MAX_ROWS);
const pickerActive = isGroup && picker !== undefined;
const pickerOpen = pickerActive && candidates.length > 0;
```

`store.groupMembers` (the source of the list) is built by
`mentionMembersFor(detail)` at `apps/web/src/store/store.ts:537-545` from
the group's `GroupDetail`:

- people: `{ jid: ${userId}@zilar.test, name, handle? }`
- AIs: `{ jid: ai.jid, name }` (no handle).

`MENTION_MAX_ROWS = 6` (`apps/web/src/components/Composer.tsx:53`).

Filtering ranks handles first, then name word-prefix matches
(`packages/chat-core/src/mentions.ts:174-200`).

#### 4.1.3 How a mention is inserted and sent

`pickMention` (`apps/web/src/components/Composer.tsx:410-424`) calls
`insertMention` from `@zilar/chat-core`
(`packages/chat-core/src/mentions.ts:50-72`):

- The inserted token is `@${member.handle}` when the member has a handle,
  else `@${member.name}`, with a trailing space.
- The mention record is `{ jid, name, begin: query.start, end: query.start
  + token.length }`.

The picked mentions are sent as `UiMention[]` through `store.sendText`
(`apps/web/src/components/Composer.tsx:478-502`), with `SendTextOptions =
{ replyTo?, mentions? }` (`apps/web/src/store/store.ts:90-93`). The store
trims the text and re-projects mentions to the trimmed text via
`mentionsForTrimmedText` (`apps/web/src/store/store.ts:1236-1246`,
`packages/chat-core/src/mentions.ts:218-234`).

The `mentions` payload rides the XMPP message body through
`apps/web/src/store/realStore.ts:3964-3971` (web-only). The wire format is
XEP-0372 references; offsets are converted to / from UTF-16 by
`@zilar/xmpp-core` (see `packages/chat-core/src/mentions.ts:1-6`).

#### 4.1.4 Keyboard behaviour

- `ArrowDown` / `ArrowUp` wrap around and move the `activeIndex`
  (`apps/web/src/components/Composer.tsx:540-549`).
- `Enter` or `Tab` picks the active row
  (`apps/web/src/components/Composer.tsx:550-557`).
- `Escape` closes the picker without picking
  (`apps/web/src/components/Composer.tsx:558-564`).
- `Backspace` inside or just after a mention removes the whole
  `@Name|@handle` token
  (`apps/web/src/components/Composer.tsx:585-602`).

`mousedown` on a row uses `event.preventDefault()` so the textarea keeps
focus (`apps/web/src/components/MentionPicker.tsx:42`).

`aria-autocomplete="list"`, `aria-expanded={pickerOpen}`,
`aria-controls={MENTION_PICKER_ID}` and
`aria-activedescendant={mention-option-${jid}}` are set on the textarea
when the picker is open
(`apps/web/src/components/Composer.tsx:987-993`).

### 4.2 What mobile has today

For `@mention` on mobile: **does not exist** in the composer.

- `apps/mobile/src/components/chat/composer.tsx` (full file, 580 lines):
  no `@` trigger, no picker, no mention state. The composer is a
  `TextInput` (`apps/mobile/src/components/chat/composer.tsx:491-509`)
  with `onChangeText={handleChange}` that sends a typing notification
  (`apps/mobile/src/components/chat/composer.tsx:457-462`) and calls
  `onSend(text)` on send (`apps/mobile/src/components/chat/composer.tsx:391`).
- `apps/mobile/src/store/types.ts:37-39`: `SendTextOptions = { replyTo? }`
  — **no `mentions` field**.
- `apps/mobile/src/store/chat-store.ts:899-926` (`sendText` in the mock
  store) and `apps/mobile/src/store/real-store.ts:3084-3124`
  (`sendText` in the real store): neither reads or sets `mentions` on the
  message.
- `apps/mobile/src/store/real-store.ts:3476-3511` (the edit path) **does**
  read `mentions` and rebase them — but the only way they get there is
  via an inbound correction. There is no path that creates them.
- `apps/mobile/src/components/chat/composer.tsx` does **not** import from
  `@zilar/chat-core` at all (`grep -c chat-core
  apps/mobile/src/components/chat/composer.tsx` → 0). It imports
  `@zilar/protocol` (`StickerSchema`, `Attachment`,
  `apps/mobile/src/components/chat/composer.tsx:1`) and the emoji /
  sticker / GIF helpers — no mention imports.

So `MentionPicker` does not exist on mobile, the composer has no
`@`-trigger logic, the store has no `mentions` argument on `sendText`,
and no chat-core mention helpers are imported by the mobile composer.

The package-level helpers mobile would need are all already in
`@zilar/chat-core` and are pure (no DOM / React deps):

- `findMentionQuery` — `packages/chat-core/src/mentions.ts:21`.
- `insertMention` — `packages/chat-core/src/mentions.ts:50`.
- `filterMentionMembers` — `packages/chat-core/src/mentions.ts:174`.
- `isMentionOfMe` — `packages/chat-core/src/mentions.ts:207`.
- `rebaseMentions` — `packages/chat-core/src/mentions.ts:97`.
- `mentionsForTrimmedText` — `packages/chat-core/src/mentions.ts:218`.
- `splitMentions` — `packages/chat-core/src/mentions.ts:128`.

### 4.3 Suggested mobile surface (parity with web)

- A mobile `MentionPicker` component (the listbox above the composer).
- Composer changes: keep the active mention range across edits via
  `rebaseMentions`, drop a mention when its range is touched
  (`packages/chat-core/src/mentions.ts:108-118`).
- `SendTextOptions` adds `mentions?: UiMention[]`
  (mirroring `apps/web/src/store/store.ts:90-93`).
- `store.sendText` re-projects the mentions onto the trimmed text via
  `mentionsForTrimmedText` (mirroring
  `apps/web/src/store/store.ts:1236-1246`).
- Phone-only: the picker must survive the keyboard; the native `TextInput`
  selection is already tracked in `apps/mobile/src/components/chat/composer.tsx:174`,
  so the trigger hook is local.

---

## 5. Dialogs (`InviteDialog`, `NewGroupDialog`)

### 5.1 What the web app does

#### 5.1.1 `InviteDialog` (a one-step personal-invite dialog)

`apps/web/src/components/InviteDialog.tsx:7-104`:

- Title: **"Invite a friend"** (line 63).
- Body: **"Send them this link. They join Zilar already connected to
  you."** (lines 64-66).
- The dialog **creates a single personal invite** through the store's
  `createInvite()` (`apps/web/src/components/InviteDialog.tsx:15-19`)
  which POSTs `/api/invites` (`apps/web/src/lib/api.ts:298-300`). The
  response shape is `{ code, url, expiresAt? }`
  (`apps/web/src/lib/api.ts:171-177`). Failure renders "Could not create
  an invite link. Try again." (`apps/web/src/components/InviteDialog.tsx:25-26`).
- Copy button. Success state: button label flips to **"Copied"** with a
  check icon (`apps/web/src/components/InviteDialog.tsx:75-89`).
- Esc closes from any focus position
  (`apps/web/src/components/InviteDialog.tsx:34-42`).
- Only one option: a personal invite. No label, max-uses, expiry,
  revoke-this-link or per-group picker. Group invite links have their own
  dedicated surface in `InviteLinksSection.tsx`.

#### 5.1.2 `NewGroupDialog` (two-step group / channel creator)

`apps/web/src/components/NewGroupDialog.tsx:10-377` is used for both
**groups** (`channel = false`) and **channels** (`channel = true`) via
the `channel?` prop (`apps/web/src/components/NewGroupDialog.tsx:12-15`).
Mounted by `apps/web/src/components/NewChatButton.tsx:257-258`.

Step 1 — members (`apps/web/src/components/NewGroupDialog.tsx:152-202`):
- Empty contacts → **"Invite a friend first to start a group."**
  (`apps/web/src/components/NewGroupDialog.tsx:156-160`).
- One checkbox row per contact, with avatar, name and `HandleSuffix`
  (`apps/web/src/components/NewGroupDialog.tsx:161-183`).
- Footer: **Cancel** | **Next** (Next is disabled until ≥ 1 member is
  selected, `apps/web/src/components/NewGroupDialog.tsx:194-201`).

Step 2 — title + visibility + (channel-only) blurb
(`apps/web/src/components/NewGroupDialog.tsx:203-340`):

- **Title** input: `maxLength={100}`, autofocus, placeholder
  **"Group name"** or **"Channel name"** (`apps/web/src/components/NewGroupDialog.tsx:204-213`).
- **Channel description** (channels only) `<textarea maxLength={300}`
  (`apps/web/src/components/NewGroupDialog.tsx:214-224`).
- **Visibility** radio group: **Private** | **Public**
  (`apps/web/src/components/NewGroupDialog.tsx:229-272`). Helper text
  per side ("Only invited people can join this group." or
  "Anyone can find and join this group.", lines 263-271; the channel
  wording is parallel).
- **Handle** input (public only): `maxLength={32}`, placeholder
  **"hiking_club"** (`apps/web/src/components/NewGroupDialog.tsx:275-292`).
  Live availability through `checkGroupHandle` debounced
  (`apps/web/src/components/NewGroupDialog.tsx:51-80`); inline result is
  **"@{handle} is available"** (good) or one of:
  - `'invalid'` → **"Use 3–32 characters: letters, numbers and _, starting
    with a letter."** (`apps/web/src/components/NewGroupDialog.tsx:348-350`).
  - `'reserved'` → **"That handle is reserved. Try another."** (line 351).
  - `'rate_limited'` → **"Too many checks — wait a little and try again."**
    (line 353).
  - default → **"That handle is taken. Try another."** (line 355).
- **Group description** (public groups only, `!channel`)
  `<textarea maxLength={300}>` placeholder **"Description (optional, one
  line)"** (`apps/web/src/components/NewGroupDialog.tsx:301-311`).
- Footer: **Back** | **Create** (no busy label — the Create button is a
  static label with only a `disabled={busy}` state, see
  `apps/web/src/components/NewGroupDialog.tsx:327-337`; **"Creating…"**
  and **"Switching model…"** are nowhere in this dialog — the
  busy-state copy "Saving…" / "Switching model…" lives in the AI panel,
  not here).

Create summary (errors → sentences, `apps/web/src/components/NewGroupDialog.tsx:359-377`):

| Server error code | Displayed message |
| --- | --- |
| `handle_invalid` | "Use 3–32 characters: letters, numbers and _, starting with a letter." |
| `handle_reserved` | "That handle is reserved. Try another." |
| `handle_taken` | "That handle was just taken. Try another." |
| `rate_limited` | "Too many tries — wait a little and try again." |
| any other | `error.message` |
| network / unknown | "Could not create the group. Try again." (or "channel" for channels) |

`step === 'title'` validation:

- Empty title → **"Enter a channel name"** / **"Enter a group name"**
  (`apps/web/src/components/NewGroupDialog.tsx:91-92`).
- Public + empty handle → **"Choose a handle for the public group."**
  (`apps/web/src/components/NewGroupDialog.tsx:96-98`).
- Public + unavailable handle → `handleReasonText(check.reason)`
  (`apps/web/src/components/NewGroupDialog.tsx:100-103`).

Esc closes from any focus position
(`apps/web/src/components/NewGroupDialog.tsx:37-45`).

Wire: the dialog calls
`store.createGroup(title, selected, { kind?, description?, visibility?,
...})` for groups or `store.createChannel(...)` for channels
(`apps/web/src/components/NewGroupDialog.tsx:107-125`). Both POST
`/api/groups` (`apps/server/src/groups/routes.ts:122-146`) with the
schema at `apps/server/src/groups/routes.ts:50-63`:

```ts
{
  title: string (1..100),
  memberIds: string[] (default []),
  kind?: 'group' | 'channel',
  description?: string (≤ 300, trim),
  visibility?: 'private' | 'public',
  handle?: string (1..64)
}
```

The server enforces: title length (`apps/server/src/groups/routes.ts:40-43`),
description length (`apps/server/src/groups/routes.ts:45-48`),
member cap (constant `MAX_GROUP_MEMBERS`, referenced at
`apps/server/src/groups/routes.ts:52`), and validates the handle shape +
uniqueness inside one transaction
(`apps/server/src/groups/service.ts:201-310`). The handle claim is
atomic with the group insert — a race on the same lowercased handle maps
to `409 handle_taken`
(`apps/server/src/groups/service.ts:281-283`).

#### 5.1.3 The web `NewChatButton` menu

`apps/web/src/components/NewChatButton.tsx:178-223`: items are
**New group**, **New channel**, **Explore groups**, **New message**,
**New AI**, and **New topic** (when the user has at least one group
where they may create one). All open a modal-style dialog at
`z-40` (`apps/web/src/components/NewGroupDialog.tsx:143`).

### 5.2 What mobile has today

#### 5.2.1 The new-chat menu and primary dialogs

`apps/mobile/src/components/chat/new-chat-button.tsx:54-181`:

- Menu items (lines 88-130):
  - **New channel** → opens `NewChannelSheet` (built).
  - **New group** → "Coming soon" placeholder (`apps/mobile/src/components/chat/new-chat-button.tsx:160-178`).
  - **New message** → "Coming soon" placeholder (same block).
  - **Explore** → `router.push('/explore')` (`apps/mobile/src/components/chat/new-chat-button.tsx:114-122`).
  - **Join with a link** → `JoinLinkForm` (built).
- The web also has **New AI** (in the menu at
  `apps/web/src/components/NewChatButton.tsx:205-211`). On mobile, the AI
  creation lives at `/ais/new` (button on the AIs screen,
  `apps/mobile/src/app/ais/index.tsx:163-166`), reached from Settings. The
  new-chat menu does not have a New AI entry.

So for the dialogs on mobile:

- **InviteDialog** equivalent (the personal-invite flow): **does not
  exist**. The mobile group screens have a dedicated "Invite links" sheet
  (`apps/mobile/src/components/chat/invite-links-sheet.tsx`) for
  **group invite links** (`createInviteLink(...)` at
  `apps/mobile/src/app/group/[id].tsx:78` and
  `apps/mobile/src/components/chat/channel-screen.tsx:59`), but no
  one-step personal-invite dialog. `createInvite` (web's
  `/api/invites` POST) is not implemented in any mobile API client
  (`apps/mobile/src/lib/invite-links-api.ts` does group invite links, not
  personal invites; verified by reading the full file — it only exports
  group link methods, see `apps/mobile/src/lib/invite-links-api.ts:204+`).
- **NewGroupDialog** equivalent: **does not exist** (the menu shows
  "Coming soon" for `New group` and `New message`). The mobile group screens
  cover the directory API (visibility, handle, public joins, check
  handle, by-handle lookup — see `apps/mobile/src/lib/directory-api.ts`)
  but **no create-with-members flow** lives on mobile.
- **NewChannelSheet**: exists at
  `apps/mobile/src/components/chat/new-channel-sheet.tsx:1-101`. It has
  only `title` (max 100) and `description` (max 300). It does **not**:
  - ask for **member selection** (channels on the server are
    `moderated: true, membersByDefault: false` — see
    `apps/server/src/groups/service.ts:324`).
  - offer **visibility** (private / public + handle).
  - ask for a **handle**.
  - push to the **store** (`apps/mobile/src/lib/groups-api.ts:20` — only
    `createChannel({ title, description? })`; no visibility / handle /
    members).
  - show the channel-short blurb in the create call body
    (`apps/mobile/src/lib/groups-api.ts:144-164` — only `title`, `kind`,
    optional `description`).

#### 5.2.2 The visibility / handle parts the mobile group screens already have

`apps/mobile/src/lib/directory-api.ts:49-58` (`GroupVisibilityState`) and
`apps/mobile/src/lib/directory-api.ts:221-225` (`buildVisibilityBody`)
are already wired and used by `VisibilitySheet`
(`apps/mobile/src/components/chat/visibility-sheet.tsx`,
imported from `apps/mobile/src/app/group/[id].tsx:15-18`). The sheet has
`mayChangeVisibility`, the `VisibilitySheet` component, and the
`visibilitySaveError` mapper. The by-handle open path exists at
`apps/mobile/src/app/at/[handle].tsx` (handle-screen open,
`apps/mobile/src/app/at/[handle].tsx`) and the directory listing at
`apps/mobile/src/app/explore.tsx` (mobile Explore screen,
`apps/mobile/src/app/explore.tsx`), both via
`apps/mobile/src/components/directory/use-directory-api.ts:1`
(use-directory-api.ts,
`apps/mobile/src/components/directory/use-directory-api.ts`).

So the **post-create** visibility / handle work is mobile-ready — only
the **create** paths and the personal-invite dialog are missing.

### 5.3 Differences summary

| Web dialog / menu entry | Mobile status | Mobile files |
| --- | --- | --- |
| InviteDialog (personal one-step) | **does not exist** | searched `apps/mobile/src/components/chat/**`, `apps/mobile/src/lib/**` |
| NewGroupDialog (members + title + visibility + handle) | **does not exist** | `apps/mobile/src/components/chat/new-chat-button.tsx:165` "Coming soon" |
| NewChannelSheet | exists with title + description only; no members, no visibility / handle | `apps/mobile/src/components/chat/new-channel-sheet.tsx:1-101`, `apps/mobile/src/lib/groups-api.ts:20,144-164` |
| New menu item "New AI" | routed through `/ais/new` from Settings (AIs screen), not the new-chat FAB | `apps/mobile/src/app/ais/index.tsx:163-166`, `apps/mobile/src/components/chat/new-chat-button.tsx` (no entry) |
| New menu item "New topic" | exposed inside group screens, not from the FAB | `apps/mobile/src/components/chat/new-topic-sheet.tsx` |
| New menu item "Explore" | present, navigates to `/explore` | `apps/mobile/src/components/chat/new-chat-button.tsx:114-122` |
| New menu item "Join with a link" | present, opens `JoinLinkForm` | `apps/mobile/src/components/chat/new-chat-button.tsx:123-130`, `apps/mobile/src/components/chat/join-link.tsx` |

---

## 6. Pitfalls for mobile workers (the things that bit us before)

The AGENTS.md pitfalls (`AGENTS.md:48-55`) apply on top of these task-specific
ones:

1. **Approve-always needs a group admin in a group**. The server answers
   `409 always_requires_admin` if a non-admin tries to set a group rule
   (`apps/web/src/components/ApprovalCard.tsx:92-98`). Mirror the same
   drop-third-button + sentence pattern on mobile
   ("Only a group admin can always allow an action here.").
2. **Action eligibility may not exist at all**. The server answers
   `409 always_not_allowed` for actions that cannot be "always allowed"
   (e.g. cost-bearing ones); mirror the web-side fixed copy
   ("This action can only be approved one time.").
3. **Audit fields are category-scoped**: an `audit` row is scoped by `aiId`
   or `groupId` (`apps/server/src/audit/routes.ts:38-39`). The server
   refuses "both / neither". On mobile the picker should mirror the web
   union: `AuditScope = { aiId } | { groupId }` and never both.
4. **Audit list caps**: `limit` is clamped at the server to
   `MAX_AUDIT_LIST_LIMIT = 200` (`apps/server/src/audit/service.ts:127`).
   The web client hard-codes `PAGE_LIMIT = 20`
   (`apps/web/src/components/ais/AiActivity.tsx:9`); follow that.
5. **Tool run rate limit** is 5 / minute per user
   (`apps/server/src/tools/routes.ts:27-28`,
   `apps/server/src/tools/routes.ts:263-265`). The friendly sentence to
   show on `429 rate_limited` is the server's: **"Too many tool runs,
   try again in a minute"**. Don't paraphrase.
6. **Tool run input cap** is 16 KiB at the server
   (`apps/server/src/tools/routes.ts:49`); the web client validates 4 KiB
   (`apps/web/src/components/tools/ToolDetailPanel.tsx:23`). Match the
   client-side 4 KiB.
7. **Manager-only writes return 404, not 403** — the existence of the
   resource is never leaked (`apps/server/src/tools/routes.ts:186-189`,
   `apps/server/src/tools/routes.ts:259-261`,
   `apps/server/src/tools/routes.ts:230-233`,
   `apps/server/src/routines/routes.ts:103-106`). The web client turns
   a 403/404 on a run into **"You may not run this tool."**
   (`apps/web/src/components/tools/ToolDetailPanel.tsx:176-181`) and on
   a routine mutation into **"You may not change this routine."**
   (`apps/web/src/components/tools/RoutinesSection.tsx:151-155`).
8. **Routines `resume` may need re-approval**. A routine paused for
   `hosts_changed` or `needs_approval` answers
   `409 needs_approval` (`apps/server/src/routines/routes.ts:315-317`).
   The web client shows the hint **"This routine needs re-approval. Ask
   the AI to schedule it again."**
   (`apps/web/src/components/tools/RoutinesSection.tsx:149-151`).
9. **Routine `schedule` is `unknown`**. The wire shape is documented at
   `apps/web/src/lib/routines.ts:8-101`; an unknown shape must read
   `"on a schedule"` (`apps/web/src/lib/routines.ts:27-29`), never crash.
   The two valid shapes are `interval` (`everyMinutes >= 60`) and
   `daily` (`time` matches `^([01]\d|2[0-3]):[0-5]\d$`, non-empty
   timezone, weekdays `1..7`).
10. **`@handle` shape rules**: the server enforces `3..32` characters,
    letters / numbers / `_`, starting with a letter
    (`classifyHandle` and `normalizeHandle` live in
    `apps/server/src/handles/rules`; the web twin lives in
    `apps/web/src/lib/handles.ts:58` and is the same module the web UI
    uses for the live handle check at
    `apps/web/src/components/NewGroupDialog.tsx:51-80`). The web
    friendly sentence is **"Use 3–32 characters: letters, numbers and
    _, starting with a letter."**
    (`apps/web/src/components/NewGroupDialog.tsx:348-350`).
11. **Group handle claim is atomic**. The race on the handle primary key
    maps to `409 handle_taken`; the friendly sentence is **"That handle was
    just taken. Try another."**
    (`apps/web/src/components/NewGroupDialog.tsx:366-368`). The friendlies
    in the `NewGroupDialog` table above (5.1.2) must be mirrored verbatim
    on mobile.
12. **Public handle change interval** (server, see `apps/server/src/groups/visibility.ts:46-50`)
    — `409 handle_change_too_soon` if the group's handle changed within
    the last 14 days. The mobile `visibilitySaveError` mapper
    (`apps/mobile/src/components/chat/visibility-sheet.tsx`, imported
    `apps/mobile/src/app/group/[id].tsx:17`) already covers this — keep
    that mapping.
13. **Server URLs are sometimes relative**. The sticker URLs in
    particular may arrive as `/api/stickers/...` and must be turned into
    absolute URLs against the API origin on native (the same fix used
    for the relative-URL pitfall in AGENTS.md, line 53). The verified
    places that already do this on mobile:
    - **Stickers**: relative paths are resolved to the API origin in
      `apps/mobile/src/lib/stickers.ts:70-72`
      (`isSameOriginStickerUrl` guard) and
      `apps/mobile/src/lib/stickers.ts:113-117` (`stickerImageSource`
      returning the resolved absolute URI).
    - **GIFs**: the proxy media URL is built from `apiOrigin`,
      `apps/mobile/src/lib/gifs-api.ts:89` and `apps/mobile/src/lib/gifs-api.ts:92`
      (`apiOrigin` helper).
    - **Avatar**: the settings avatar image source resolves relative
      paths against the API origin,
      `apps/mobile/src/components/settings/profile-logic.ts:207-231`
      (`avatarImageSource`), called by
      `apps/mobile/src/components/settings/avatar-control.tsx:52`.
    - **API clients default to `API_URL`**: the API clients
      (`apps/mobile/src/lib/ais-api.ts:1`,
      `apps/mobile/src/lib/connections-api.ts`,
      `apps/mobile/src/lib/groups-api.ts`,
      `apps/mobile/src/lib/invite-links-api.ts`,
      `apps/mobile/src/lib/approvals-api.ts`) all default `apiUrl` to
      `API_URL` from `apps/mobile/src/lib/auth.ts`, but that is the
      request URL, not the avatar / sticker URL fix.

    A mobile worker adding a new field with relative paths must add the
    resolution at the consumer (or a shared helper), not assume the API
    client covers it.
14. **Sticker / avatar bytes must be PNG or WebP**. Phone photos are JPEG;
    re-encode. See the existing mobile sticker/avatar flows.
15. **Lucide icons, not emoji, in app chrome**. The web uses
    `lucide-react` (`apps/web/src/components/ais/AiActivity.tsx:2`,
    `apps/web/src/components/Composer.tsx:13`, etc.) and mobile uses
    `lucide-react-native` (`apps/mobile/src/components/chat/new-chat-button.tsx:2`,
    `apps/mobile/src/components/ais/ai-actions-sheet.tsx`, etc.). Keep
    that rule.
16. **No `Promise` parameter inside a `Coroutine`** (Expo cannot convert
    it) and Hermes has no `crypto.subtle`. Tools / routines never reach a
    `Coroutine` in this audit, but a mobile worker who adds a native
    bridge must respect these.
17. **User-facing errors are fixed sentences, never raw server text**
    (AGENTS.md). The audit mentions the exact sentences above; new copy
    in mobile must follow the same rule. The friendly sentences in
    `apps/web/src/components/NewGroupDialog.tsx:359-377` (create errors),
    `apps/web/src/components/tools/ToolDetailPanel.tsx:176-181` (run
    permission), `apps/web/src/components/tools/RoutinesSection.tsx:149-155`
    (routine permission / re-approval) and
    `apps/web/src/components/ApprovalCard.tsx:84-98` (always-eligibility)
    are the templates to copy.

---

## 7. Suggested task split

The lead is the spec owner for T-0189 and T-0190 (see `work/BOARD.md`).
Below is a one-day-or-smaller split with `Allowed files` per task, as
plain suggestions.

### 7.1 T-0189 — AI tools, routines, activity feed on the AI screen

**Suggested split (each task ≤ 1 day, all keep the doc as reference):**

#### T-0189a — `tools-api` + `routines-api` + read-only "AI → Tools" list

Scope:
- Add a `tools-api.ts` mirror of `apps/web/src/lib/tools.ts` (read helpers
  + types, no writes yet).
- Add a `routines-api.ts` mirror of `apps/web/src/lib/tools.ts` routines
  helpers (read helpers + types, no writes yet).
- Add a plain-words helper file mirroring `apps/web/src/lib/routines.ts`
  (pure helpers: `describeRoutineSchedule`, `pausedReasonText`,
  `truncateOutput`, `MAX_OUTPUT_PREVIEW_CHARS`).
- Render a read-only "Tools" section on the AI edit screen
  (`apps/mobile/src/app/ais/[id].tsx`) below the home-machine picker,
  for the AI owner only.
- Render a read-only "Routines" section on the same screen.

Allowed files (one entry, never reorder the others):
- `apps/mobile/src/lib/tools-api.ts` (new)
- `apps/mobile/src/lib/tools-api.test.ts` (new)
- `apps/mobile/src/lib/routines-api.ts` (new)
- `apps/mobile/src/lib/routines-api.test.ts` (new)
- `apps/mobile/src/lib/routines-format.ts` (new; the pure helpers)
- `apps/mobile/src/lib/routines-format.test.ts` (new)
- `apps/mobile/src/components/ais/tools-section.tsx` (new)
- `apps/mobile/src/components/ais/routines-section.tsx` (new)
- `apps/mobile/src/app/ais/[id].tsx` (mount the sections)

Out of scope: writes (revert / run / delete / pause / resume), the AI
panel Activity tab.

#### T-0189b — Tool writes (Run now, Revert, Delete)

Scope:
- Add the write helpers to `tools-api.ts` (`revertTool`, `runToolNow`,
  `deleteTool`).
- Add a `tool-detail-sheet.tsx` that opens when a tool row is tapped,
  mirrors `apps/web/src/components/tools/ToolDetailPanel.tsx`. Use the
  same client-side 4 KiB JSON cap and the 5/min rate-limit messaging.
- Add the `Delete tool` and `Revert to this version` two-step confirms.

Allowed files:
- `apps/mobile/src/lib/tools-api.ts` (extend with writes)
- `apps/mobile/src/lib/tools-api.test.ts`
- `apps/mobile/src/components/ais/tools-section.tsx` (open detail sheet)
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx` (new)
- `apps/mobile/src/components/ais/tool-detail-sheet.test.tsx` (new)

Out of scope: routines writes, activity feed.

#### T-0189c — Routines writes (Pause / Resume / Delete)

Scope:
- Add the write helpers to `routines-api.ts` (`pauseRoutine`,
  `resumeRoutine`, `deleteRoutine`).
- Mirror the `RoutinesSection` row UI from
  `apps/web/src/components/tools/RoutinesSection.tsx:215-275` (Pause /
  Resume + Delete two-step).
- Mirror the `409 needs_approval` hint copy.

Allowed files:
- `apps/mobile/src/lib/routines-api.ts` (extend with writes)
- `apps/mobile/src/lib/routines-api.test.ts`
- `apps/mobile/src/components/ais/routines-section.tsx`

Out of scope: tools writes, activity feed.

#### T-0189d — Activity feed on the AI screen (`AiActivity`)

Scope:
- Add `audit-api.ts` mirroring `apps/web/src/lib/api.ts:1851-1903`
  (`publicAuditEntrySchema`, `auditPageSchema`, `listAudit`).
- Add a mobile `AiActivity` mirroring
  `apps/web/src/components/ais/AiActivity.tsx` (paginated 20-per-page
  list, refresh icon, relative timestamps, the
  `approval.decided` / `ai.stopped` / `ai.resumed` fixed copies,
  empty / loading / error states).
- Mount under `apps/mobile/src/app/ais/[id].tsx`.

Allowed files:
- `apps/mobile/src/lib/audit-api.ts` (new)
- `apps/mobile/src/lib/audit-api.test.ts` (new)
- `apps/mobile/src/components/ais/ai-activity.tsx` (new)
- `apps/mobile/src/components/ais/ai-activity.test.tsx` (new)
- `apps/mobile/src/app/ais/[id].tsx`

### 7.2 T-0190 — `@mention` picker and the remaining dialog gaps

**Suggested split:**

#### T-0190a — `@mention` picker in the composer

Scope:
- Reuse the chat-core mention helpers (`findMentionQuery`,
  `insertMention`, `filterMentionMembers`, `isMentionOfMe`,
  `rebaseMentions`, `mentionsForTrimmedText`, `splitMentions`) — they
  are pure and live in `packages/chat-core/src/mentions.ts`.
- Extend `SendTextOptions` on mobile with `mentions?: UiMention[]`
  (mirroring `apps/web/src/store/store.ts:90-93`).
- Wire `store.sendText` to apply `mentionsForTrimmedText` after the
  trim (mirroring `apps/web/src/store/store.ts:1236-1246`).
- Build a `MentionPicker` mobile component (the listbox that sits
  above the composer). Trigger rules: same as web (see §4.1.1).
  Lists: members of this group, AIs in this group. Never the current
  user (`isMentionOfMe`).
- Handle the keyboard: ↑/↓ wrap, Enter / Tab picks, Esc closes, ↑
  in an empty composer edits the last editable one (already covered by
  web `apps/web/src/components/Composer.tsx:576-582` — add the same).
- Pick inserts `@handle` (when present) or `@name`, plus a trailing
  space; the picker closes and the caret is positioned after the
  token (mirroring `apps/web/src/components/Composer.tsx:410-424`).
- Backspace inside a removal empties the whole token.

Allowed files:
- `apps/mobile/src/components/chat/mention-picker.tsx` (new)
- `apps/mobile/src/components/chat/mention-picker.test.tsx` (new)
- `apps/mobile/src/components/chat/composer.tsx` (extend)
- `apps/mobile/src/store/types.ts` (extend `SendTextOptions`)
- `apps/mobile/src/store/real-store.ts` (extend `sendText` to send
  `mentions`)
- `apps/mobile/src/store/real-store.test.ts` (extend)

Out of scope: new chat dialogs (`NewGroupDialog` / `InviteDialog`
equivalents).

#### T-0190b — `NewGroupDialog` mobile equivalent (two-step group creator)

Scope:
- Mirror `apps/web/src/components/NewGroupDialog.tsx`: contacts list,
  title, visibility radio, handle with live availability check,
  description. Use the same fixed sentences (§5.1.2).
- Wire the create call through `groups-api.ts`. Extend
  `apps/mobile/src/lib/groups-api.ts` with a `createGroup(input)`
  helper that POSTs `/api/groups` with `title`, `memberIds`, `kind?:
  'group'`, `description?`, `visibility?`, `handle?`
  (the schema at `apps/server/src/groups/routes.ts:50-63`).
- Replace the "Coming soon" placeholder at
  `apps/mobile/src/components/chat/new-chat-button.tsx:160-178` with
  the new `NewGroupSheet`.

Allowed files:
- `apps/mobile/src/lib/groups-api.ts` (extend)
- `apps/mobile/src/lib/groups-api.test.ts`
- `apps/mobile/src/components/chat/new-group-sheet.tsx` (new)
- `apps/mobile/src/components/chat/new-group-sheet.test.tsx` (new)
- `apps/mobile/src/components/chat/new-chat-button.tsx`
  (replace the placeholder; the menu line at line 163 may stay)

Out of scope: `New message` (DM-by-handle), `InviteDialog` equivalent,
`NewChannelSheet` parity (visibility / handle).

#### T-0190c — `NewChannelSheet` parity (members, visibility, handle)

Scope:
- Extend `apps/mobile/src/components/chat/new-channel-sheet.tsx` with
  visibility / handle / member selection, using the same friendly
  sentences as `NewGroupDialog`. Members default to empty for channels
  (`apps/server/src/groups/service.ts:324`).
- Extend `apps/mobile/src/lib/groups-api.ts` if needed (the existing
  `createChannel` already accepts `description`; add `visibility`,
  `handle`, and `memberIds`).

Allowed files:
- `apps/mobile/src/lib/groups-api.ts`
- `apps/mobile/src/lib/groups-api.test.ts`
- `apps/mobile/src/components/chat/new-channel-sheet.tsx`
- `apps/mobile/src/components/chat/new-channel-sheet.test.tsx` (new)

Out of scope: the personal `InviteDialog`.

#### T-0190d — Personal `InviteDialog` mobile equivalent

Scope:
- Add a `createInvite()` helper (POST `/api/invites`,
  response `{ code, url, expiresAt? }`,
  `apps/web/src/lib/api.ts:171-177`,
  `apps/web/src/lib/api.ts:298-300`) to a new
  `apps/mobile/src/lib/invites-api.ts`. Reuse the bearer / `API_URL`
  pattern from `apps/mobile/src/lib/ais-api.ts:181-211`.
- Build a mobile `InviteDialog` mirroring
  `apps/web/src/components/InviteDialog.tsx`: title "Invite a friend",
  body "Send them this link. They join Zilar already connected to
  you.", a Copy button that flips to "Copied", the same Esc closes,
  the same "Could not create an invite link. Try again." failure copy.
- Wire the FAB menu (or a Settings entry) to open it. The FAB does
  not currently have an Invite entry — pick the path that fits the
  agreed surface in the spec.

Allowed files:
- `apps/mobile/src/lib/invites-api.ts` (new)
- `apps/mobile/src/lib/invites-api.test.ts` (new)
- `apps/mobile/src/components/chat/invite-dialog.tsx` (new)
- `apps/mobile/src/components/chat/invite-dialog.test.tsx` (new)
- `apps/mobile/src/components/chat/new-chat-button.tsx` (add menu
  entry, only if the spec picks the FAB as the entry point)

Out of scope: any code in `apps/server/src`, `packages/**`, or web.

---