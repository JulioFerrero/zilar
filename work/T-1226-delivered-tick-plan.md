---
id: T-1226
title: "Plan (docs only): a real 'delivered' tick — three states sent / delivered / seen. Read the code and write docs/plan/delivered-tick.md: how a receiving client (web open, mobile open, mobile woken by push, mobile killed) proves delivery, DMs vs groups, server role, ids, UI, migration, and a task split the lead can spec from"
status: merged
milestone: M5
branch: task/T-1226-delivered-tick-plan
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1226: Plan the delivered tick

## Spec (written by Claude, do not edit)

### Why
Julio decided on 2026-10-12 to add a real **"delivered"** state, so own messages show three states:
- **sent:** the server has it;
- **delivered:** it reached the recipient's device;
- **seen:** the recipient read it.

What the code has today:
- `MessageStatus = 'sending' | 'sent' | 'read' | 'failed'` (`packages/chat-core/src/types.ts:7`);
- "sent" comes from stream-management acks (T-1153, T-1216, T-1220);
- "read" comes from XEP-0333 displayed markers (the ledger's `handleDisplayed`, `packages/client-core/src/store/ledger-incoming.ts`);
- **no delivery receipts exist** (no `urn:xmpp:receipts` anywhere in `packages/` or `apps/`).

This task writes **only a plan**. No code.

### What to write: `docs/plan/delivered-tick.md`
Every claim cites `file:line`. Mark anything you couldn't verify as **unverified**.
1. **Today's flow,** short: how a text becomes `sent` and `read` on both apps, and where the tick icons are drawn (web `MessageMeta`, the mobile bubble meta). Cite each.
2. **Proof of delivery, per receiver state,** with how each would send it:
   - a web tab open (connected);
   - mobile in the foreground;
   - mobile in the background, woken by an FCM data push (`apps/mobile/src/lib/push/background.ts`, `onWake`: it has a token and HTTP but no XMPP stream);
   - mobile killed or offline: delivered later, when it connects and catches up through MAM.
   Compare **XEP-0184 receipts** (client to client over XMPP) with a **server-recorded** delivery (an HTTP call from the push wake, or from the client after catch-up, stored server side and pushed to the sender). Say which covers the push-wake case, and recommend one, or a mix.
3. **DMs vs groups:** what "delivered" means in a group (all members, any member, or none). Recommend one; Telegram shows no per-member delivery in groups.
4. **Ids:** which id each receipt or record names (origin id vs stanza-id; see `packages/xmpp-core/src/stanza/resolve-sender.ts:116-132`). Explain how the sender's ledger matches it, including resent copies (T-1221 aliases).
5. **State rules:**
   - `delivered` sits between `sent` and `read`, and never moves backwards;
   - a `read` implies `delivered`;
   - a receipt that arrives before the ack still ends `delivered`.
6. **Server and storage:** whether anything must be stored, a migration if needed, and how the sender learns of a delivery while offline (e.g. on reconnect).
7. **Privacy:** whether a user can turn off delivered or read receipts. Recommend, and note that it's Julio's call.
8. **UI:** icons for sent, delivered and seen on web and mobile. Today's sent is one tick and read is two; propose the delivered look (for example two grey ticks, with seen as two accent ticks) and cite the current icon code.
9. **A task split:** 3 to 6 tasks the lead can spec, each with its files and the tests it needs (the message pipeline only), in order, and noting what's parallel.

### Read first
`AGENTS.md`, `packages/chat-core/src/types.ts`, `packages/client-core/src/store/ledger-incoming.ts`, `packages/client-core/src/store/send/outbox.ts`, `packages/xmpp-core/src/stanza/` (the markers code), `apps/mobile/src/lib/push/background.ts`, `apps/server/src/push/` (the `delivery.ts` and `archive-scan.ts` heads) and `docs/plan/plan.json` (the MP-F8 entry, if any).

### Allowed files
`docs/plan/delivered-tick.md`, `work/T-1226-delivered-tick-plan.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan answers items 1 to 9 with citations, and the gate passes.

---

## Report (written by the worker when done)

Wrote `docs/plan/delivered-tick.md` (docs only, no code). It answers all 9 spec items with
`file:line` citations; claims I could not verify in the tree are marked **unverified**.

Key recommendations: server-recorded delivery over HTTP for all receiver states (XEP-0184
receipts cannot cover the push-wake case — `background.ts` has token + HTTP but no XMPP stream);
no per-member delivered state in groups (DMs only, matching Telegram); receipts name the origin
id and match via the existing `sameMessage`/alias machinery; `delivered` ranks between `sent`
and `read` in `advanceStatus`; one privacy toggle for both delivered and read (Julio's call);
delivered = two grey ticks, seen = two accent ticks; 6-task split with files and tests.

Files changed: `docs/plan/delivered-tick.md` (new), `work/T-1226-delivered-tick-plan.md` (this report + status).

Commands and real results:
- `pnpm install`: done in 11.4s.
- `pnpm gate` (from repo root): `PASS install (frozen)`, `PASS format`, `PASS lint`,
  `PASS typecheck`, `SKIP effect (no source files changed)`, scope in Allowed files,
  `GATE PASS` (2 changed files against main).
- Single tests run while working: none — docs-only task, no code touched, and the gate's
  effect step skipped (no source files changed).

Problems / deviations: none. Security checklist: docs-only, no routes, storage, or secrets
touched; the plan itself records the checklist-relevant constraints (ids-only logging, atomic
writes, 404 parity, rate limits) for the future spec tasks.

Blocked / needs a decision (for the lead / Julio): group delivered semantics (§3), receipts
toggle shape (§7), and the server→sender live channel (§6) — all listed under "Open questions"
in the plan.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit.** The plan covers items 1 to 9, with citations.

**Julio's decisions (via AskUserQuestion, 2026-10-12):**
- **Groups:** delivered means **any member's device got it**, i.e. option (ii) in §3, not the recommended (iii).
- **Privacy:** **no toggle**; receipts are always on. Task 6 of §9 is dropped.

**The lead's choices:**
- server-recorded delivery (§2, transport B) for every receiver state, with no XEP-0184;
- the wire id is the origin id (§4).
