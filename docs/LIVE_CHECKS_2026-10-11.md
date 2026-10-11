# Live test, 2026-10-11

This is Julio's single live test after the simplify programme (2026-10-09 to 11): the Effect rewrite, one API contract, the client core, the mock rebuild, the 400-line splits and the ball avatars.

Everything here was merged with a green gate and reviewed by the lead, but **not yet tried by a person on the real site**. Each line says what to do and what "good" looks like.

## 0. The deploy (done, 2026-10-11)

The whole programme is live. Since the move to the Coolify Application `zilar-chat` (project "Zilar"), **every push to `main` that touches the apps deploys itself** from git (the movabase model; `docs/deploy/coolify-app-plan.md`). The database was started clean, as Julio chose ("was just some testing chats").

- **Check the live version:** `https://chat.zilar.app/health` shows `"commit"`. The lead checks it after each merge.
- **A deploy causes a few seconds of 503** while the container is swapped.

**Added the same day:**
- **Sign-in is email first** (T-1112, T-1114). A new email gets the **Invite code** input, pre-filled when you came from an `/invite/<code>` link.
- **`chat.zilar.app` links open the Android app** (T-1106).

## 1. Sign-in and sessions
- Sign in with your email: you go straight to the code. Open an invite link in a private window with a new email: the Invite code is filled in, and the account is created (T-1112).
- On the phone, tap a `https://chat.zilar.app/...` link in another app: it opens Zilar, not the browser (T-1106, needs the new APK).
- Sign out and sign back in, on web and on mobile (session cookie cache, T-0858).
- On the phone, sign out, then sign in as another user (T-0901).
- **Good:** the right chats appear each time, with no stale data from the previous user.

## 2. Chats and messages (the message pipeline)
- Send text, a reply, an edit, a reaction, a forward, a voice note, a photo and a file, on web and on mobile (T-0877, the store core T-0902 to T-0929).
- Stream an AI reply in a long chat (T-0845, T-0846).
- **Good:**
  - every message arrives once, on the other device too;
  - edits and reactions show on both;
  - the AI reply streams smoothly, with no jump.

## 3. Groups and topics
- **Web:** the **+** next to a group name creates a topic. This was broken on live before T-1099.
- On both apps: topic order, pin and unpin, mute, archive, roles, invite links, and joining a public group from Explore.
- **Good:** "New topic" says "in <group>" and opens the new topic.

## 4. AIs and approvals
- An AI DM shows as an AI on mobile (T-0843).
- Approve once, Always, Deny, and Revoke in Settings → Approvals (T-1087 fixed a false error on mobile).
- **Good:** the decisions stick, and "Always allowed" lists the rule.

## 5. Settings pages
- Open every settings page on web, which are lazy routes (T-0862): profile, avatar upload and remove, integrations, voice transcription, push, machines, connections, folders, stickers and GIFs.
- **Good:** each one loads, with no blank page and no error banner.

## 6. Looks
- Avatars without a picture are glossy balls on web and mobile, for people, groups and AIs alike (T-1091).
- Mobile is dark everywhere (T-0881), and money and topic order look the same on web and mobile (T-0844).

## 7. If something breaks
- **A bad merge:** revert the commit on `main` and push; the revert deploys itself. Or, in Coolify, redeploy an earlier deployment of `zilar-chat`.
- **A destructive migration:** restore the nightly B2 database backup.
