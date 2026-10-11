# Live test, 2026-10-11

This is Julio's single live test after the simplify programme (2026-10-09 to 11): the Effect rewrite, one API contract, the client core, the mock rebuild, the 400-line splits and the ball avatars.

Everything here was merged with a green gate and reviewed by the lead, but **not yet tried by a person on the real site**. Each line says what to do and what "good" looks like.

## 0. Before the deploy

**Live now** (`/health`, read by the lead on 2026-10-11): commit `73fae1bf` ("T-0751: drizzle out of the server", 2026-10-09). `main` is **704 commits ahead**, so this deploy carries the whole programme.

1. **Back up the database by hand.** Migrations run when the server starts, and an image rollback does not undo them (`docs/RELEASING.md` §9, "Roll back"). The nightly B2 backup exists, but take a fresh one: in Coolify, on postgres, run **Backup now**.
2. **Add the three repository secrets** in GitHub, under Settings → Secrets → Actions: `COOLIFY_URL`, `COOLIFY_TOKEN` and `COOLIFY_SERVICE_UUID` (`docs/RELEASING.md` §9). From then on, **every green push to `main` deploys itself**. To pause that, set the repository variable `AUTO_DEPLOY=off`.
3. **Trigger the deploy.** Re-run the latest green "Production images" run on `main`, or let the lead push a docs commit and re-run.
4. **Good:** the deploy job ends green, and `https://chat.zilar.app/health` answers `"ok": true` with `"commit"` equal to the main sha. The lead checks this.

## 1. Sign-in and sessions
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
- **The web or server image:** in Coolify, set `IMAGE_TAG` back to the tag that is live now and restart (`docs/RELEASING.md` §9). **Before the deploy, note the current `IMAGE_TAG` and the live `/health` commit** in step 0.1.
- **A destructive migration:** restore the backup from step 0.1.
