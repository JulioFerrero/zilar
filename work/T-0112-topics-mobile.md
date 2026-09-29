---
id: T-0112
title: Topics (mobile): a group opens to its topics list, a topic is a chat with the task strip
status: planned
milestone: M5
branch: task/T-0112-topics-mobile
model: meta/muse-spark-1.3-contributor
depends_on: [T-0111]
estimate: 2 days
---

# T-0112: Topics on the phone

## Spec (written by Claude, do not edit)

### Why
Same product as T-0111 on the Expo app (web is 80% of the effort, mobile follows; Julio's rule). Visual spec: the mockup's **Mobile 1** (topics of a group) and **Mobile 2** (inside a topic) boards, https://claude.ai/artifact/YKvuBAcmXzRdiyx83eppSd, with the tokens and depth recipes of `docs/design/ui-style.md` (§ mobile) and the existing `depth.ts` primitives.

### What to build
1. **Data** (`src/lib/*api*`, `src/store/real-store.ts`, `chat-core` fields from T-0111): the mobile API client (it has no `zod`; mirror the hand-written parsers already used there) for topics: list/create/patch, members read, `topics` inside `/api/chats`. Each topic is its own chat keyed by its room JID exactly like the web store; General keeps the group's old id. Same refresh rules (focus, 60 s while active, invitations). Unread counts per topic and aggregated per group.
2. **Chat list** (`src/app/index.tsx`, `chat-list-item.tsx`): a group row shows the title, "N topics", the aggregated unread, the newest message time and the last topic's preview ("Dev AI: Preview ready"). Tapping a group with topics opens the **topics screen**; a group without topics from an older server opens its chat as today.
3. **Topics screen** (new `src/app/group/[id].tsx`, `topic-row.tsx`): header with back, group avatar, title, "8 members, 2 AIs, 6 topics"; an inset search field; one row per topic: glyph tile, name, lock icon when private, status chip with dot (text always, never color alone), one-line preview, time, unread badge; General first, then newest first; long-press a row: Mute, Archive (managers). Raised "+" button (56 px, 18 px radius) bottom right opens the **new topic sheet** (name, type chips, Public/Private with the help text, member list for private; the creator locked in; the viewer's group AIs unticked with "AIs only read topics you add them to") only if the viewer may create.
4. **Topic screen** (`src/app/chat/[id].tsx`, `chat-header.tsx`, new `task-strip.tsx`): the header shows the topic name with the group name small above it and a Private chip; the **task strip** (type chip, status, owner, link) sits under the header for every topic; tapping the status opens a sheet with the statuses (optimistic with rollback), owner and link open small sheets (link must be `https:`; rendered as a link only then). A topic-info sheet from the header (members, AIs, visibility; leave a private topic; managers can archive). Approval cards already render in the topic where they were requested.
5. **Mock mode** (`src/mock/*`, honored only in dev builds or with `EXPO_PUBLIC_GALENA_MOCK`, one shared gate as today): the same seven topics as the web mock (one private).
6. Deep links: `/chat/<jid>` for any topic room JID works; a topic that disappears while open goes back to the topics screen with a short notice.

### Rules
- No new dependencies; NativeWind + the existing primitives. `apps/mobile` Vitest cannot resolve `@/` for component modules and has no component renderer: put logic in plain modules and test those (the pattern used by `run-state.ts` / `ai-actions-sheet` tests); components stay thin. Run `pnpm --filter @galena/mobile boot:ios` only if you touch native config (you should not).
- A private topic's name must never be shown to someone who cannot see it.
- Image budget: about 20 screenshots (downscale with `sips -Z 900`).
- Never use the simulators `DB167CD4` or `A3E0C081`, and never ports 3000, 8081, 5173.

### Read first
- `AGENTS.md`; `work/T-0111-topics-web.md` (Spec + Review) and its mapping code; `work/T-0108`–`T-0110` (API and rules)
- `apps/mobile/README.md`, `src/app/{index,_layout}.tsx`, `src/app/chat/[id].tsx`, `src/components/chat/{chat-list-item,chat-header,message-list,approval-card}.tsx`, `src/store/*`, `src/lib/*`, `src/mock/*`, `docs/design/ui-style.md`

### Allowed files
- `apps/mobile/src/**` (+ tests), `packages/chat-core/src/types.ts` only if T-0111 did not already add the fields
- `work/T-0112-topics-mobile.md`

**Not allowed:** server, web, other packages, native project files, dependencies.

### Tests (Vitest, plain modules)
- API parsers for topics (valid, missing fields, unknown enum values fall back safely), store mapping (General id kept, older server without topics, refresh add/remove, removed while open), ordering and aggregation helpers, status chip labels, https-only link helper, permission helpers (may create, may manage, may archive).

### Live check (the lead does it)
Mock scenario on the simulator that is **not** DB167CD4/A3E0C081, via the standard boot check; the real stack once T-0108–T-0111 are merged. Steps go in `docs/LIVE_CHECKS_2026-09-29.md`.

### Acceptance criteria
- [ ] A group opens to its topics; a topic opens to a chat with the task strip; creating and editing works in mock mode.
- [ ] Old servers (no `topics`) and old deep links keep working.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2
pnpm build
```

### Out of scope
- Roles, pinned messages, chat prefs, push, stickers (later tasks), tablet layout, usage or cost tracking.

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
