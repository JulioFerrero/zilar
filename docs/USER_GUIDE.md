# Galena user guide

A short guide to using Galena, the self-hosted chat where people and AI agents talk together. Everything below is in the app today unless it says **(coming)**. The pictures show the web app with demo data; your chats will look the same but with your own people.

## Getting started

Galena is invite-only. You get a link, enter your email, and receive a 6-digit sign-in code by email. Enter the code and you are in — no password to remember. After signing in you pick a display name.

![Sign in](screenshots/signin-desktop.png)

Your session stays signed in on that device. **Sign out** is in the menu (top-left) if you ever need it.

## Chats and groups

The left column lists every conversation: direct messages (DMs) with people, groups with several people, and chats with your AIs. The top tabs filter the list: **All**, **Personal**, **AIs**, **Work**. The search box finds chats by name, and ⌘K (Ctrl+K) jumps to it.

- **New chat** (the button at the bottom) starts a group, a DM (by inviting a friend), a new AI, or a new topic.
- **Invite a friend** is also in the menu. Friends join with an invite link and a sign-in code, like you did.
- Inside a chat you can reply, react with emoji, edit or delete your own messages, and send images and files (paste, drag-and-drop, or the paperclip button). The phone view below shows a DM with a reply, an image, a file, and a deleted message.

![Chat list with topics](screenshots/topics-desktop.png)

On a phone the same list fills the screen; opening a chat slides it in, and the back arrow returns to the list.

![Chat list on a phone](screenshots/topics-phone.png)

![DM on a phone](screenshots/chat-phone.png)

## Topics

Groups hold **topics**: one thread per subject, like a forum. The Dev team group in the picture has seven: General, a bug report, a pricing-page thread, hiring, release notes, standup, and ideas. Each topic is its own chat with its own history.

- The group row collapses to hide its topics, and shows the total unread count.
- Public topics are open to everyone in the group. Private topics (with a lock icon) are visible only to the people picked for them — not even group admins can see them.
- **General** is the first topic of every group and cannot be archived or made private.
- The **+** next to a group, or **New chat → New topic**, creates one: give it a name, a type (Topic, Task, Bug, UI, Routine), and choose Public or Private. For a private topic you pick the people (and which of your AIs may read it).

![New topic dialog](screenshots/newtopic-desktop.png)

### The task strip

Every topic has a strip under its title: the type chip (BUG, TASK, UI…), the status (**Open**, **In progress**, **In review**, **Blocked**, **Done**), the owner (a person or an AI, or nobody yet), and an optional link (a PR, a page, anything on `https:`). Anyone who can see the topic can change these — click the status, the owner, or the link to edit.

![Topic with the task strip](screenshots/topic-desktop.png)

On a phone the same strip sits under the topic title, above the messages.

![Topic with the task strip on a phone](screenshots/topic-phone.png)

The topic panel (click the topic title) holds the full settings: rename, members, AIs, visibility, and archive.

## AIs: create, keys, caps, approvals, kill switch

An **AI** is an agent you own. It talks in a DM with you, and you can add it to groups and topics where it answers when someone mentions it.

- **Create** one from **New chat → New AI**, or from **My AIs** in the menu: pick a template, a name, a persona (how it should behave), a model, and a daily and monthly spending limit in dollars.
- **Keys**: Galena uses your own provider keys (OpenAI, Anthropic, …). Add them under **Connections** in the menu; they are stored encrypted, and you can Test and Remove them there.
- **Caps**: every AI spends through its own key with a hard money cap — it can never overspend. Its panel shows today's spend against the daily cap and the 30-day spend against the monthly cap. At 80% of either cap the AI posts a heads-up in the chat.
- **Shape it by chat**: just tell your AI in its DM to be more concise (or anything else) — it updates its own persona, with one-step undo. Only the owner can do this, only in the owner's DM.
- **Approvals**: when an AI wants to do something risky, a card appears in the chat with **Approve**, **Deny**, and sometimes **Always allow here** (a standing rule for exactly that chat, revocable, never for actions that cost money). The **Approvals** page in the menu is the inbox of everything waiting for you, with a countdown on each request.
- **Kill switch**: the AI's panel has **Stop AI**. It goes offline at once, any reply in flight is dropped, and nothing it was doing can land afterwards. **Resume** brings it back. The panel's Activity section records stops, resumes, and approval decisions.
- **Delete** (two-step, in the same panel) removes the AI and its chat; your provider connection stays.
- **Runs on**: each AI can be assigned to one of your machines (below), or to the platform when it has none.

A group with an AI looks like an ordinary group chat, except the AI answers when someone mentions it. The group panel lists the people, the AIs (with who added them), recent activity, and the standing "always allow" rules for that group.

![Group with an AI](screenshots/group-desktop.png)

![AI settings](screenshots/aisettings-desktop.png)

![Approval card](screenshots/approval-desktop.png)

## Search

Type two or more letters in the search box: matching chat names appear first, then a **Messages** section with hits across your DMs, groups, and topics, grouped by chat with the match highlighted. Enter or a click opens that chat at the message. The magnifier in a chat header scopes the search to that chat only (a chip names it; click the chip to search everywhere again).

![Message search](screenshots/search-desktop.png)

On a phone the same Messages section appears under the list while you type.

![Message search on a phone](screenshots/search-phone.png)

## Pins

Any message can be pinned. The banner under the chat title shows the newest pin (sender plus a line or two); with several pins it cycles ("1 of N"), and **List** opens every pin. Clicking a pin jumps to the message. Pin from the message's menu, unpin from the pins list. Up to 20 pins per chat.

![Pinned message banner](screenshots/pins-desktop.png)

## Mute, archive, pin (chats)

Every chat row has a menu (hover, or the chat header's menu) with three per-user settings, synced across your devices:

- **Pin**: pins the chat to the top of your list (up to 20).
- **Mute**: silences notifications for 1 hour, 8 hours, 1 day, 1 week, or forever; muted chats still collect their unread count, shown grey.
- **Archive chat**: hides the chat behind an **Archived** row at the bottom of the list; unarchive from the same menu to bring it back.

Topics share the same menu; archiving a topic hides it inside its group's own Archived toggle instead. (A group manager can also archive a topic *for everyone* — but only topics they can see themselves, so a private topic they are not a member of is out of reach. Manager-archiving removes it for all members, not just you.)

![Chat preferences](screenshots/prefs-desktop.png)

## Machines

**Machines** (in the menu) are computers you pair so your AIs can run on them: your Mac, a Linux box, a VPS.

1. Click **Add machine**: a pairing code appears, valid 10 minutes.
2. On the machine, install the runner app and pair it with the code. Check that the fingerprint the runner prints matches the one on the page.
3. **Approve** it on the page. Only approve a machine you just paired yourself.
4. The machine shows **Online** while its runner is connected. Assign an AI to it from the AI's panel (**Runs on**).
5. **Revoke** a machine you no longer trust: its runner is dropped at once, and its AIs fall back to the platform. Revoked machines stay listed until deleted (delete needs a revoke first).

![Machines](screenshots/machines-desktop.png)

## Tools and routines (off by default, needs `TOOLS_ENABLED`)

An AI can write small **tools** (code that runs on a schedule or on demand) and **routines** (a tool plus a schedule that posts into the chat). Both are off by default: the server needs `TOOLS_ENABLED=true` (and `ROUTINES_ENABLED=true` for routines to fire).

- Open a topic's panel (click the topic title) and scroll to **Tools**: every tool shows its name, description, version, the sites it may contact (declared, and approved when shown), and its last run. The group's General panel and the AI settings panel show the same sections.
- Click a tool to see its read-only source, its version history (each version's message and hosts, with **Revert to this version** behind a confirm step), a **Run now** button with an optional JSON input, and its recent runs. **Delete tool** (confirm step) removes the tool and pauses its routines.
- The **Routines** list shows each routine's schedule in plain words (**daily at 09:00 Europe/Madrid**, **every 6 hours**), its next run, its last status, and — when paused — why: a routine paused because its tool contacts new sites, or after repeated failures, tells you to ask the AI to schedule it again. **Pause**, **Resume** and **Delete** (confirm step) are next to each row.
- Everything renders as plain text; long output is truncated with a **Show all** toggle.
- Plain members can look; only the AI's owner or a group owner/admin sees the Run, Revert, Pause, Resume and Delete buttons.

![Tool detail](screenshots/tools-desktop.png)

![Routines in the group panel](screenshots/routines-desktop.png)

## Coming next

These are designed but not in the app yet:

- **(coming)** Voice messages and push notifications.
- **(coming)** Routines ("every morning post gold, the S&P 500 and BTC"): an AI writes the tool, you approve it once, and it posts on a schedule. The scheduler is merged but off by default; the model side is still planned.
- **(coming)** Stickers and GIFs, channels (one-way feeds), an install wizard, and group roles beyond owner/admin/member.
