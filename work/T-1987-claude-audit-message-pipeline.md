---
id: T-1987
title: "Claude security audit 4/4: the message pipeline — XMPP config, archives and server message reads, chat marks, pushes, uploads and media, cards, questions, message blocks, search — findings go to a PRIVATE file"
status: merged
milestone: M5
branch: task/T-1987-claude-audit-message-pipeline
model: anthropic/claude-opus-5-5
effort: high
estimate: 45 min
---

# T-1987: Claude security audit 4 (message pipeline)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "find with Claude, fix with DeepSeek", using the Claude API credits. This is area 4 of 4, the message pipeline, one of the three crucial areas. This task only **finds**.

### The one hard rule: findings stay private
**The repo is public.**
- Write every finding to `/Users/julio/.zilar-lead/audits/T-1987-message-pipeline.md` (the folder exists, outside the repo).
- No finding, file:line, attack description or hint goes in this task file, a doc, a commit message or a code comment.
- This task file's Report gets only the counts per severity and that path.
- Read only. Change no source file.

### Scope
| Area | Paths |
|---|---|
| XMPP server config | `deploy/ejabberd/ejabberd.yml`, `infra/ejabberd/ejabberd.yml`, `deploy/baremetal/ejabberd.yml` (MAM, MUC defaults, upload, access rules, listeners, the HTTP API) |
| Server XMPP glue | `apps/server/src/xmpp/` (routes, provisioning, admin client usage) |
| Server reads of messages | `apps/server/src/chats/` (list, unread, read and delivered marks, delete-own, reply), `apps/server/src/search/`, `apps/server/src/auth/export.ts` archive scope only if not covered by audit 1 |
| Pushes | `apps/server/src/push/` (what a notification carries, who it goes to, subscriptions, the component, FCM tokens) |
| Media and uploads | `apps/server/src/media/`, `apps/server/src/files/`, `apps/server/src/avatars/`, `apps/server/src/card-media/`, `apps/server/src/stickers/`, `apps/server/src/link-preview/`, `apps/server/src/voice-transcription/` |
| Server-written messages | `apps/server/src/message-blocks/`, `apps/server/src/questions/`, `apps/server/src/agents/gateway/card-rekey.ts`, `apps/server/src/agents/gateway/post-blocks.ts`, `apps/server/src/notify/` |
| Client trust | `packages/xmpp-core/src/stanza/` (who the client believes sent a message, corrections, retractions, reactions, server-made cards) |

Follow a call into any other file whenever you need to. Don't repeat `docs/audit/security-audit.md` (SEC-1..15) or the private audits 1 to 3.

### What to look for (each needs a concrete path)
- **Reading what you shouldn't:**
  - a server route that reads the archive or chat state for a chat the caller is no longer in (left, kicked, banned, blocked), or never was;
  - MUC rooms that are not members-only, or are public, or whose history is reachable by a non-member;
  - MAM queries on a room the user left.
- **Spoofing:**
  - a client trusting a sender, a correction, a retraction, a reaction or a card whose `from` it never checks against the original sender;
  - server-made cards or blocks that a user can forge or edit;
  - a message claiming to come from an AI or the system.
- **Pushes:**
  - message text or sender names sent to FCM or APNs where the design says no content;
  - pushes for chats the user left or muted;
  - a push subscription registered for another user.
- **Uploads and media:**
  - upload URLs that are guessable or public without the room's access;
  - no size or type caps;
  - SVG or HTML served inline;
  - link previews fetching private addresses;
  - EXIF location kept on shared photos when the app says it is removed.
- **Marks and deletes:**
  - read, delivered or delete endpoints acting on another user's messages or chats;
  - delete-for-everyone not limited to your own messages;
  - a retracted message staying readable on the server.
- **Resource abuse:** unbounded fan-out, a missing rate limit on a message-related write, or huge stanzas or blocks.

### How to report (in the private file)
- **Format.** Use the same format as audit 1:
  - a header with the date, commit and files read;
  - a summary table;
  - then one entry per finding: ID (`A4-01` …), severity, where (`file:line`), the attack (plain steps, no exploit code), why the code allows it (quoted lines), the fix, and confidence (confirmed or plausible);
  - a "Ruled out" list.
- **Limits.** At most 15 findings. No style or generic hardening.

### Allowed files
- `work/T-1987-claude-audit-message-pipeline.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The private file exists, in the format above.
- The Report holds only counts and the path.
- No other repo file changed.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Read-only audit of the message pipeline scope. No source file changed; the only repo file changed is this task file.
- Findings written to the private file `/Users/julio/.zilar-lead/audits/T-1987-message-pipeline.md` (outside the repo), in the audit 1 format: header, files read, summary table, one entry per finding, and a "Ruled out" list.
- Counts: critical 0, high 4, medium 6, low 5 (15 findings).
- Nothing was run live; the confidence of each finding is stated in the private file.

### Checks run
- `pnpm install`: done.
- `pnpm gate` (exit 0):
  ```
  gate: 1 changed file(s) against main
  PASS  install (frozen)  (6.8s)
  PASS  format  (3.8s)
  PASS  lint  (3.0s)
  PASS  typecheck  (2.7s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single tests run (no code changed).

### Notes for the lead
- Details are only in the private file above. The private audit 2 file was not in the audits folder when I started, so I could not de-duplicate against it.

## Review (written by Claude)

Approved and merged (task file only).
- **Findings.** The lead read all 15 findings in the private file. Each one has a `file:line`, an ejabberd 26.07 source check where needed, a fix and a confidence level. They become separate fix tasks; the overlap with audit 2 (MUC affiliations) is folded into one.
- **Cost.** About $13.31 on `anthropic/claude-opus-5-5`: $2.39 for the main session plus $10.92 for six helper sessions.
