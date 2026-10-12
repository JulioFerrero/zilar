---
id: T-1203
title: "Audit: every ball-avatar call site on web and mobile, the seed it passes (user id, JID, group id, chat id) and which stable id is available there, with one proposed rule so a person or group gets the same ball everywhere"
status: merged
milestone: M5
branch: task/T-1203-avatar-seed-audit
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1203: Why the same person's ball changes colour

## Spec (written by Claude, do not edit)

### Why
The lead's emulator check (APK `c6591e1f`): Julio's ball is green in the chat list and header, but purple on his profile screen. The seed differs between screens:
- **Mobile:** the list and header pass `chat.id` (`apps/mobile/src/components/chat/chat-list-item.tsx:83-84`, `chat-header.tsx:128-129`), while the profile passes `profile.id` (`apps/mobile/src/components/profile/profile-view.tsx:113`).
- **Web uses several seeds:** `entry.userId` (`apps/web/src/components/PeopleSearchResult.tsx:103`), `member.jid` (`MentionPicker.tsx:50`), `groupId` (`TopicRow.tsx:246`), `chat.id` (`GroupPanel.tsx:150`), `message.senderId` (`MessageBubble.tsx:182,243`) and `group.chatJid` (`MessageSearchResults.tsx:178`).
- **The ball is drawn from the seed** by `avatarSvg(seed)` (`packages/chat-core/src/avatar.ts:63`) and `ballAvatarSvg(seed)` (`packages/ball-avatar/index.ts:39`).

This is an **audit only**. Write no code.

### What to build
A new `docs/audit/avatar-seeds.md`:
1. **A table of every call site** of `Avatar`, `avatarSvg` or `ballAvatarSvg` on web and mobile (grep both apps and the packages), one row each, with these columns:
   - the file and line;
   - who it draws (a person, an AI, a group or channel, or a topic);
   - the seed it passes, and what that value really is: a user id, a bare JID, a full JID, a room JID or a group id. Trace it to where it's set and cite that line;
   - which other ids are available at that call site without a new request.
2. **For each kind (person, AI, group):** is there one id that **every** call site can reach? For example the bare JID lowercased for people, or the General room JID for groups. Check that a message's `senderId` in a group is the member's real JID and not the room occupant JID; cite the decode line.
3. **A proposed rule** (one seed per kind), with a list of the call sites that would change, and any site where the rule's id isn't available today (and what it would take).
4. Check whether `avatarSvg` and `ballAvatarSvg` give the same picture for the same seed, and whether both apps use the same function.

### Read first
`AGENTS.md`, `packages/chat-core/src/avatar.ts`, `packages/ball-avatar/index.ts`, `apps/web/src/components/Avatar.tsx` (or wherever web's `Avatar` lives) and `apps/mobile/src/components/chat/avatar.tsx`.

### Allowed files
`docs/audit/avatar-seeds.md`, `work/T-1203-avatar-seed-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every claim in the doc cites a `file:line`.

---

## Report (written by the worker when done)

Wrote `docs/audit/avatar-seeds.md` (audit only, no code). Contents:

- §0: `avatarSvg` is a direct alias of `ballAvatarSvg` (`packages/chat-core/src/avatar.ts:63-65`); both apps render through `avatarSvg` from `@zilar/chat-core` (web via `avatarDataUri`, mobile via inline `SvgXml`). Same seed = byte-identical SVG. `avatarGradient` has no call sites.
- §1: seed-kind definitions traced to source (user id vs bare JID vs room JID vs group UUID vs AI JID vs occupant-JID fallback).
- §2: full call-site table — 3 direct `avatarSvg` uses + 24 mobile `Avatar` sites + 33 web `Avatar` sites (fixture excluded), each with file:line, who it draws, what the seed really is with a trace cite, and which other ids are in scope.
- §3: per-kind verdicts — person: YES (bare JID lowercased; incoming `senderId` is the real bare JID when `resolveSender` succeeds, `packages/xmpp-core/src/stanza/resolve-sender.ts:27-88`, called at `packages/xmpp-core/src/stanza/decode.ts:39`, assigned into `fromJid` at `decode.ts:83,130,148`, into `senderId` at `packages/client-core/src/store/ledger-incoming.ts:121`; outgoing `senderId` is the Better Auth user id, never a JID — named explicitly after fix round); AI: YES (AI JID, with the two `TopicAi`-only exceptions named); group: YES (General room JID, the only group identity visible on both apps).
- §4: proposed rule (normalize with `normalizeJid`, person→bare JID, AI→AI JID, group/topic→General room JID) with the change list per kind and the sites where the rule's id needs a load or server change (cold directory lists, `TopicAiView` lacking `jid`, unresolved senders, case normalization).

Files changed: `docs/audit/avatar-seeds.md` (new), `work/T-1203-avatar-seed-audit.md` (status + this report).

Commands and real results:

- `pnpm install`: done in 11s (pnpm v10.32.1).
- `pnpm gate`: GATE PASS — 2 changed files against main; PASS install (1.4s), format (0.6s), lint (0.9s), typecheck (1.2s); SKIP effect (no source files changed); scope: every changed file is inside the Allowed files.
- Single tests run while working: none — audit-only task, no code touched, and per AGENTS.md UI code gets no tests. `pnpm gate` ran the full checks once at the end.

### Fix round (prereview findings)

- Finding 1 (should-fix): fixed in `docs/audit/avatar-seeds.md` §3 — the person verdict now names the outgoing-`senderId` exception explicitly: outgoing `senderId` is the Better Auth user id (`lifecycle.ts:142`, `auth-api.ts:8-12`), never a JID; harmless today because all sender avatars render only for incoming group messages (mobile `message-bubble.tsx:200`, tombstone `:19`; web `MessageBubble.tsx:179,240`); the person rule means the bare JID, never "senderId as-is". Verified each cited line by reading the source.
- Findings 2–4 (nits in lines not otherwise changed): left untouched per instructions (do not touch nits unless in a line already changed). Note: the finding-1 edit also corrected the `decode.ts:83` cite to call at `:39` with assignments at `:83,130,148`, which resolves nit 3 as a side effect.
- `pnpm gate` after fix: GATE PASS — 2 changed files against main; PASS install (frozen) (1.1s), format (1.2s), lint (0.8s), typecheck (1.0s); SKIP effect (no source files changed); scope: every changed file is inside the Allowed files.
- Disagreements: none — finding 1 was correct and is fixed.

Problems / deviations: none. One correction during writing: an edit briefly mangled the `resolveSender` cite line in §3; repaired and re-verified. Also corrected a `GroupDetail.id` cite to `apps/server/src/groups/schemas.ts:51-52`.

Security checklist: no code, no routes, no secrets touched; doc cites ids as kinds only, no real user data. N/A otherwise.

Open questions for the lead: (1) confirm `normalizeJid` (bare+lowercase) as the canonical seed form — `bareJid` alone does not lowercase and stanzas may carry mixed case; (2) whether the follow-up implementation task should add `jid` to `TopicAiView` and/or General room JID to `DirectoryEntry`, or accept a detail load at those sites.

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 1 auto round. The pre-review is clean, with 4 nits.**
- **`docs/audit/avatar-seeds.md`:**
  - `avatarSvg` and `ballAvatarSvg` draw the same picture;
  - a table of every call site on both apps, with the real meaning of each seed;
  - **the proposed rule:** `normalizeJid` on every seed; a person by their bare JID, an AI by its AI JID, and groups, channels and topics by the General room JID.
- **About 30 sites change.** Gaps: topic AIs and cold directory cards need an extra id; unresolved group senders keep the occupant JID.
- **Next:** web and mobile fix tasks, following the doc's §4 list.
