# Now

The live picture: what runs, what is next, what waits for Julio. The lead rewrites this file after every launch, merge or block, and commits it with the board. The full task list is `BOARD.md`; the rules are `CLAUDE.md` and `docs/LEAD_LOOP.md`.

**PAUSED 2026-10-08 ~16:10 (Julio: "the pc is about to explote and im in call, can you stop all?"):**
- **The lead stopped:**
  - the autopilot;
  - `lead watch`;
  - opencode (all workers);
  - the merge runner;
  - the merge gate in progress.
- **The cap after the resume is 3-4 workers.**
- **Stopped mid-work, worktrees kept:**
  - T-0606, T-0608, T-0610, T-0611, T-0613;
  - T-0607 and T-0609, each in a lead-approved test-only fix round.
- **Merged since 14:40:** T-0603, T-0601, T-0602, and probably T-0604 (check `git log`).
- **Approved, not merged:**
  - T-0599: its gate was SIGKILLed under memory pressure; no test failed. Retry it;
  - T-0605.
- **Not launched:** T-0612 (T-G).
- **To resume:** follow the CLAUDE.md first actions (start the autopilot), then resume at most 4 workers with `lead reply`.

**2026-10-08 14:40, Effect migration continues:**
- **Merged since 11:35:**
  - **Effect HTTP:** T-0578 (setup), T-0581 (drafts SSE), T-0582 (stickers JSON), T-0586 (GIFs);
  - **effect/sql:** T-0587, T-0588, T-0589, T-0590, T-0591, T-0592, T-0593 (connections, routines, the startup count, and the inline reads in memory, media, /me, approvals, routines and push);
  - **tool arguments plan:** T-0571 (the plan), T-0594 (T-A, the decode seam), T-0595 (T-F, sandbox), T-0597 (T-C, demo), T-0598 (T-D, web tools);
  - T-0596: dead zod schemas dropped from pins, roles and topics.
- **Approved, in the merge queue:**
  - T-0600: ejabberd admin client;
  - T-0603: T-B, the model tool arguments. The reasons keep zod's wording and never echo a value;
  - T-0601: LiteLLM admin client;
  - T-0602: stickers part B. **Every sticker route is now on Effect HTTP**;
  - T-0599: draft events, the invite CLI and the routine title;
  - T-0604: T-E, the tool and routine schemas. All 32 error texts in its files were checked byte for byte.
- **Running (effect/sql, transactions included):** T-0605 (topic access), T-0606 (avatars and backgrounds), T-0607 (push devices and machines), T-0608 (roles), T-0609 (invite-link join), T-0611 (public group join). **Effect Schema:** T-0610 (approval input).
- **Next:** T-0612 (T-G: the action registry takes Effect schemas only), after T-0604 merges.
- **Left on zod after the queue:** the legacy blocks in stickers, contact-requests and handles (exact 400 texts), plus `db/schema.ts`.
- **Follow-ups noted:** five stale "zod" comments; six near-copies of the first-issue message walker. Each copy has its own special cases, so merging them waits.

**2026-10-08 11:35, Julio back; Effect migration continues:**
- **Merged since 08:55:**
  - T-0576 (avatars HTTP), T-0577 (backgrounds HTTP) and T-0580 (file proxy HTTP, with a streamed body);
  - T-0579 (review follow-ups);
  - T-0583 (gateway reads on effect/sql);
  - T-0584 (audit service off drizzle and zod);
  - T-0585 (deleted the unmounted `/ai/virtual-keys` spike, as Julio decided).
- **Running (8):**
  - T-0571: the plan for the tool argument layer, in lead fix round 2. Finding 1 was wrong: there are four `argsSchema.safeParse` sites, not five;
  - **Effect HTTP:** T-0578 (setup), T-0581 (drafts SSE pilot), T-0582 (stickers JSON) and T-0586 (GIFs);
  - **effect/sql:** T-0587 (connections; the decrypt called inside a transaction stays on drizzle), T-0588 (routine scheduler and runner) and T-0589 (startup sticker count, plus the T-0584 nits).
- **Left on Hono after these:**
  - stickers part B (the upload and file GET);
  - the better-auth handler;
  - the `app.ts` shell;
  - the git proxy (`git/proxy.ts`, unmounted, planned S8). **Its fate is Julio's call** (convert, leave or delete).

**2026-10-08 08:55, Julio asleep, Effect night continues:**
- **Merged since 07:15:**
  - **effect/sql:** T-0567 (gateway db helpers), T-0568 (delegation service), T-0574 (sign-up invites, XMPP provisioning and the invite CLI runtime);
  - **Effect Schema:** T-0564, T-0565, T-0569 and T-0570 (server leaf parsers, gifs, push config, provider ids, templates);
  - **Effect HTTP:** T-0566 (invite links, client IP), T-0572 (machines and runner pairing), T-0560 (media gallery), T-0573 (voice, the binary pilot, guide item 12) and T-0561 (/me and account invites);
  - **comments:** T-0575 (client comments now point at the live server `api.ts` files).
- **Guide (`docs/EFFECT_GUIDE.md`):** Effect 4.0.2 drops `{ message }` on length checks; `Schema.Finite` for `z.number()`; item 13 on the client IP; every database needs a registered sql runtime, and never inside a module; jsonb.
- **Approved, merge queued:** T-0576 (avatars HTTP).
- **Running:**
  - T-0571: the plan for the AI tool argument layer, the biggest zod block left;
  - T-0577: background images HTTP;
  - T-0578: first-run setup HTTP;
  - T-0579: review follow-ups;
  - T-0580: the file proxy HTTP, with a streamed body.
- **Left on Hono after these:** drafts (SSE), stickers (multipart), gifs (media proxy), the git proxy, and the better-auth handler.
- **For Julio:** `apps/server/src/ai/routes.ts` (`POST /ai/virtual-keys`, a spike) is mounted only by its test, never in `app.ts`. Delete it or keep it?

**2026-10-08 07:15, Julio asleep, Effect night continues:**
- **Merged since 05:20:**
  - T-0556 and T-0562: agents G4 (the tool executor) and G9 (start, stop and reconcile). **Every gateway extraction G1-G9 is done**;
  - T-0558, T-0555, T-0559 and T-0557: message search, AI management, tools and provider-key connections HTTP;
  - T-0563: the Effect HTTP adapter now carries the real socket address, with one shared client-IP rule. This unblocks invite-links, machines and setup.
- **Approved, merge queued:**
  - T-0567: the gateway db helpers on effect/sql;
  - T-0564: zod leaf batch 1 (stream, xmpp and gif tokens, model entry, push protocol).
- **Running:**
  - T-0560: media gallery HTTP. It stalled twice and was moved to the paid Muse;
  - T-0561: /me and account invites HTTP;
  - T-0565: gifs provider and Giphy parser;
  - T-0566: invite-links HTTP, the first to use the socket address;
  - T-0568: the delegation service on effect/sql;
  - T-0569: zod leaf batch 2 (GitHub token, prices, transcription, listener score).
- **Next:**
  - T-0570: push config, subscriptions, AI templates and provider ids;
  - T-0571: an audit and plan for the AI tool argument layer, the biggest zod block left.
- **Deferred:** machines HTTP, because its test types `getClientIp` on a Hono `Context`. It needs a small design first.

**2026-10-08 05:20, Julio asleep, Effect night continues:**
- **Merged since 03:50:**
  - T-0539 (topics HTTP);
  - T-0550, T-0551 and T-0552: mobile API batches 6-8. **Every mobile API client is now on Effect Schema**;
  - T-0548 (AI usage and search archives on effect/sql);
  - T-0544, T-0543, T-0554, T-0545 and T-0553: integration settings, push, routines, voice transcription and approvals HTTP;
  - T-0549: agents G8b, the group ingest.
- **Approved, merge queued:** T-0556 (agents G4, the tool executor).
- **Running:**
  - T-0555: AI management HTTP, in an auto fix round with 2 should-fix items;
  - T-0557: provider-key connections HTTP;
  - T-0558: message search HTTP;
  - T-0559: tools HTTP;
  - T-0560: media gallery HTTP;
  - T-0561: /me and account invites HTTP.
- **Next:** T-0562, agents G9 (start, stop and reconcile), after G4 merges.
- **Model note:** during DeepSeek peak (01-04 UTC) the free Muse often stopped or hit its rate limit, and most workers fell back to the paid contributor Muse. T-0548 was switched by hand after two stalls.
- **Recipe additions in `docs/EFFECT_GUIDE.md`:**
  - item 8: output schemas strip unlisted keys, so check them field by field;
  - item 11: a thin Hono wrapper for tests that mount the old factory.
- **Hono modules left after this wave:** avatars, files, voice, drafts (SSE), the `ai` virtual keys, stickers, gifs (streams), backgrounds (bytes), invite-links (needs the socket IP), machines (the IP again) and setup (the IP again).

**2026-10-08 03:50, Julio asleep, Effect night continues:**
- **Merged since 03:00:**
  - T-0536 (groups HTTP), T-0532 (zod leaves mobile), T-0535 (machine registry on effect/sql), T-0537 (screenshot scripts) and T-0533 (xmpp, chats and AI memory HTTP);
  - T-0528, T-0540 (agents G7, the DM turn), T-0538 (one lenient mobile error envelope);
  - T-0541 and T-0547 (mobile API batches 4 and 5);
  - T-0546 (agents G8a, the group turn) and T-0542 (audit: no HttpApi response drops a field).
- **Merge queue:** T-0539, topics HTTP. It was rebased after an `app.ts` conflict.
- **Running:**
  - T-0543, T-0544 and T-0545: push, integration settings and voice transcription HTTP;
  - T-0548: AI usage and search archives on effect/sql. It stalled once and was nudged to resume;
  - T-0549: agents G8b, the group ingest;
  - T-0550 and T-0551: mobile batches 6 and 7 (contacts, stickers, topics, chat).
- **Mobile QA rule:** for branches that change only lib code, the smoke opens the screens that use the changed clients through `ZILAR_ROUTES` (now in `docs/LEAD_HANDOFF.md`).
- **Left on mobile after T-0550/T-0551:** `tools-api.ts` only.

**2026-10-08 03:00, Julio asleep, Effect night continues:**
- **Merged since 02:00:**
  - T-0507 and T-0530: **zod is gone from web**;
  - T-0527 (mobile batch 2), T-0529 (agents G5a), T-0525 (pins, roles and audit HTTP);
  - T-0531: **zustand is gone from mobile.** `phone:smoke` passed;
  - T-0534 (agents G5b), T-0528 (chat-prefs and chat-folders on effect/sql).
- **Approved, in the merge queue:**
  - T-0536 (groups HTTP);
  - T-0532: **zod leaves mobile.** `phone:smoke` passed. It was rebased after a lockfile conflict;
  - T-0535 (machine registry on effect/sql);
  - T-0537 (screenshot scripts);
  - T-0533 (xmpp, chats and AI memory HTTP; rebased after an `app.ts` conflict).
- **Running or launching:**
  - T-0540: agents G7, the DM turn;
  - T-0539: topics HTTP;
  - T-0542: checks that no HttpApi response drops a field;
  - T-0538: one lenient error envelope for mobile, plus the search abort race;
  - T-0543: push HTTP;
  - T-0544: integration settings HTTP;
  - T-0545: voice transcription HTTP.
- **Written, waiting:** T-0541, mobile API batch 4, after T-0538.
- **Lead decisions:**
  - output schemas strip unlisted keys, so `docs/EFFECT_GUIDE.md` now requires a field-by-field check (T-0542 audits the merged modules);
  - `connections/service.ts` stays on drizzle until `ais/service.ts` moves its transactions (T-0535 re-scope).
- **Flake noted:** `Composer.voice.test.tsx:83` failed once in T-0530's merge gate under load, then passed 7 times in a row; the merge was retried.

**2026-10-08 02:00, Julio asleep, Effect night continues:**
- **Merged since 01:05:**
  - T-0519, T-0508 and T-0506 (the mobile pins pilot);
  - T-0505 (web `api.ts` part 1), T-0518, T-0521 (the atom-react plan), T-0504 (server config);
  - T-0523 (agents G6, the listener), T-0520 (chat-prefs and chat-folders HTTP), T-0524 (mobile API batch 1);
  - T-0522 (contacts and directory on effect/sql);
  - T-0526: **zustand is gone from web.** The stores run on an atom registry behind a zustand-compatible API. Bundle +16.7 kB gzip. The lead checked it in a browser in mock mode, side by side with main.
- **Merge queue:** T-0507 (web `api.ts` part 2), T-0527 (mobile batch 2), T-0529 (agents G5a), T-0525 (pins, roles and audit HTTP).
- **Running or launching:**
  - T-0528: chat-prefs and chat-folders on effect/sql;
  - T-0530: web `api.ts` part 3, after which zod leaves web;
  - T-0531: atom-react M1, after which zustand leaves mobile;
  - T-0532: mobile batch 3, after which zod leaves mobile;
  - T-0533: xmpp, chats and AI memory HTTP;
  - T-0534: agents G5b.
- **Lead decisions:**
  - atom-react W1 swaps the container (one atom per store) instead of moving a pilot slice; slice atoms come later;
  - invite-links and backgrounds HTTP wait. The Effect adapter loses the socket IP that the join limiter needs, and backgrounds stream bytes. Each needs its own design.
- **Runner incident:** the lead's runner script hit the 2-hour background limit at 01:39 and was restarted detached. One queued merge line was lost to a queue-file race and was re-added.

**2026-10-08 01:05, Julio asleep, Effect night continues:**
- **Merged since 23:45:**
  - T-0498: the HttpApi adapter;
  - T-0496: pins on effect/sql;
  - T-0509, T-0513, T-0515, T-0512, T-0510;
  - T-0516 and T-0517: agents G2 and G3;
  - T-0494: protocol on Effect Schema. `phone:smoke` passed, the first Effect bundle on Hermes;
  - T-0514: blocks, contacts and directory on HttpApi.
- **Merge queue:**
  - T-0519: contact-requests on effect/sql. The recovery test was re-seamed and now really reaches the insert;
  - T-0508: web drafts, tools and cache on Schema;
  - T-0506: the mobile pins pilot. The Expo export is 12.2 MB, and `phone:smoke` passed.
- **Running:**
  - T-0504: server config;
  - T-0505: web `api.ts` part 1. It was blocked because tests call zod `.parse` on two schemas; the lead allowed those 3 test files, changing their parse calls only;
  - T-0518: blocks and directory tests;
  - T-0521: the atom-react audit;
  - launching: T-0520 (chat-prefs and chat-folders HTTP), T-0522 (contacts and directory on effect/sql), T-0523 (agents G6, the listener) and T-0524 (mobile API batch 1).
- **Next:** T-0507 (web `api.ts` part 2) after T-0505; agents G5, G4 and G7; more HTTP and effect/sql modules; mobile API batches 2 and up; atom-react after the T-0521 plan.

**2026-10-07 23:45, Julio asleep, Effect night continues:**
- **Merged since 23:10:**
  - T-0495: runtime and logger;
  - T-0485: Giphy;
  - T-0483: Telegram import;
  - T-0497: recovery loop;
  - T-0499: agent-drivers;
  - T-0500: runner-tunnel schemas;
  - T-0501: apps/runner schemas;
  - T-0502: lead CLI schemas. Live `state.json` decode checked first;
  - T-0503: the agents split plan;
  - T-0511: tunnel server timers.
- **Merging:** T-0498 (HttpApi adapter, handles pilot; P1 gate passed) and T-0496 (pins on effect/sql, plus the migration plan).
- **Approved, waiting for a fix before merge:**
  - T-0494 (protocol on Effect Schema): after T-0496 merges, the worker regenerates the lockfile, then phone:smoke runs on the emulator (the first Effect bundle on Hermes);
  - T-0509 (RunnerClient): T-0511's new pong-timeout test is flaky (it failed 1 in 5 on main), and the T-0509 worker makes it deterministic.
- **Running:**
  - T-0512: agents G1 extraction;
  - T-0513: agents C1, the model call on Effect.
- **Paused:** T-0510 (blocks on effect/sql) waits for T-0496 in main; it was launched too early.
- **Ready after T-0494:**
  - T-0504: server config;
  - T-0505 and T-0507: web api.ts parts 1 and 2;
  - T-0506: mobile pins pilot;
  - T-0508: web drafts, tools and cache.
- **Lead decisions tonight:**
  - **effect/sql:** better-auth moves to a custom adapter over effect/sql; drizzle-kit migrations stay until the last step, then one transaction per migration;
  - **agents plan:** the oversized G1, G8 and C2 are split;
  - **effect version:** ^4.0.2 everywhere;
  - **lead tooling:** the lead runner script now runs `pnpm install --frozen-lockfile` in main after each merge, because the lead CLI broke once when T-0502 added `effect` to devtools.

**2026-10-07 23:10, Julio asleep ("dont stop working… dont make questions"):**
- **The lead decides alone tonight.** Anything that is Julio's call goes to "Waiting for Julio" below.
- **Merged tonight:**
  - T-0492: the transcription provider;
  - T-0493: the push pipeline;
  - T-0487: the mailer.
- **Merge queue** (one at a time, run by the lead's runner script):
  - T-0495: the runtime and pino logger. The lead sent 3 fix rounds for redaction: objects become fields, Errors become `err`;
  - T-0485: Giphy;
  - T-0483: Telegram import. A fix round added an edge catch-all so the token can never leak;
  - T-0497: the recovery loop.
- **Running:**
  - T-0494: the protocol on Effect Schema plus every consumer;
  - T-0496: the `effect/sql` spike on pins;
  - T-0499: agent-drivers;
  - T-0500: runner-tunnel schemas;
  - T-0501: apps/runner schemas.
- **Launching:**
  - T-0498 (the HttpApi adapter, handles pilot), after T-0495 merges;
  - T-0502 (lead CLI schemas);
  - T-0503 (the audit that splits the agents module into small tasks).
- **Found on main:** `apps/server/src/topics/backfill.test.ts` fails, because migration 0045 (T-0470) adds a foreign key to `topics` that the test's exclusion list doesn't skip. The gate missed it because it only runs related tests. T-0494 carries the one-line fix (lead-approved). Follow-up: the merge gate should run the whole server suite at least once a day.
- **Decisions the lead took:**
  - workers may not run `npx` or detached `python` processes; they use `pnpm exec` and run the gate in the foreground;
  - the draft hub stays as it is: its sync ordering needs no Effect, so it moves with the drafts route later.

**2026-10-07 late night (Effect everywhere):**
- **Julio:** "all the codebase to be effect 4.0". That means frameworks too, Effect Schema instead of zod, and web and mobile now. **No new features.** Use as many workers as the PC handles; it ran 9 at a load around 44 with 52% memory free.
- **Merged since the last update:**
  - T-0479: the round budget;
  - T-0480: the delegation service;
  - T-0481: AI-to-AI handoff.
- **Running:**
  - T-0482: the delegate tools, in a fix round. It was nearly done when the no-features rule came, so it finishes;
  - T-0483 to T-0489: logic conversions (Telegram import, guarded fetch, Giphy, runner hub, mailer, scheduler and sweeper, sandbox runner);
  - T-0490: the whole-codebase plan. It produces `docs/audit/effect-everywhere-plan.md`, with the architecture per layer, measurements and task lanes.
- **Next:** after T-0490, rewrite `docs/ROADMAP_EFFECT.md` and `docs/EFFECT_GUIDE.md` from the plan. Then foundations, then one pilot per layer, then the bulk.
- **Waiting for Julio:** as before: the upload cutover, the mobile version bump, the Coolify secrets.

**2026-10-07 night (listener + kit):**
- **Merged:**
  - T-0469: release-readiness audit;
  - T-0471 and T-0473: docs and env examples catch-up;
  - T-0470: listener schema 0045;
  - T-0472: scoring core;
  - T-0474: settings routes, plus `LISTENER_ENABLED` (off by default);
  - T-0476 and T-0477: kit panel rows and the Chip. The kit cleanup is done; the rest of the audit's batches is low value.
- **Running:**
  - T-0475: the listener in the gateway (S3), adding `LISTENER_MODEL`, paid with the master key;
  - T-0478: the web settings (W1).
- **Next, in order** (one gateway task at a time, all in `gateway.ts`):
  1. S4: the per-human-message budget (4 AI messages, 2 hops) and AI-to-AI handoff;
  2. S5: `delegate` and `task_status`;
  3. W2: wake and delegation lines in the chat;
  4. then pilot polish.
- **Waiting for Julio:**
  - the Caddy cutover for the upload lock;
  - the mobile work: upload lock and backgrounds;
  - the Effect pairs;
  - the mobile version bump;
  - the 3 Coolify secrets.
- **The rule stays:** 2 workers, no mobile.

**2026-10-07 evening:**
- **Backgrounds done on web and server:** T-0457 to T-0466 merged (presets, own images with dim, groups set by admins; my per-chat choice wins). Mobile render and picker wait for a free PC.
- **Julio's next picks:**
  - web kit cleanup: T-0467 audit refresh, running;
  - listener + delegation: T-0468 plan, running;
  - then pilot polish;
  - plus a release check: T-0469 (Effect status, READMEs, release checklist), spec ready, launches when a slot frees.
- **The rule stays:** 2 workers, no mobile.

**2026-10-07 late afternoon (backgrounds):**
- **Merged:**
  - T-0455: the "Remembered: <fact>" line;
  - T-0456: the backgrounds plan. Julio's decisions are in `docs/audit/chat-backgrounds-plan.md` §8: both scopes; images after presets; coloured grounds plus brand gold; group backgrounds that admins set, where my own per-chat choice wins.
- **Doctor (f703edb):** clean, 2 nits in `files/routes.ts`: an `isDmBlocked` copy and the RFC 5987 filename encoding. These become a small cleanup task.
- **Running:**
  - T-0457: preset tokens;
  - T-0458: server prefs schema.
- **Next:**
  - C: the image upload server;
  - D: web render;
  - E: web picker;
  - F and G: group backgrounds.

  The rule stays: max 2 workers, no mobile.

**2026-10-07 afternoon (upload lock):**
- **Julio's decisions** are in `docs/audit/upload-auth-plan.md` §7: server streaming; forwards keep their file; 404 now and delete later; break old builds after a redirect window.
- **Merged:**
  - T-0452: the plan;
  - T-0453: `GET /api/files?chat=&url=`, member-only, with Range;
  - T-0454: web loads same-origin `/upload` files through it.
- **Next:**
  - **mobile (when Julio frees the PC):** bearer headers on `expo-image`, `expo-video` and the voice player for `/api/files`;
  - **cutover (Julio, live server):** Caddy sends `GET /upload/*` to the server route as a redirect window, keeps PUT on ejabberd, and must not log the `url` query;
  - **later:** a deletion job, after the read-write volume mount.
- **No workers running.**

**2026-10-07 midday:**
- **AI memory is complete (M1-M6).**
  - Merged since the morning: T-0446 (compactor), T-0448 (mobile polish), T-0450 (web polish) and T-0451 (mobile room memory sheet).
  - The mobile memory, forward and media screens are not checked on the emulator yet; wait until Julio frees the PC.
- **Running:** T-0452, the audit and plan for locking `/upload` (Julio chose it). Next: turn its plan into tasks and ask Julio its open questions.
- **Rule (memory `pc-busy-light-load`):** while Julio works, at most 2 workers, web and server only, no emulator.

**2026-10-07 morning:**
- **Julio is working on the PC: at most 2 workers at a time until he says otherwise.**
- **Merged:** T-0447 (web room memory dialog) and T-0449 (mobile Memory section, after a lead fix round for a Forget race).
- **In review:**
  - T-0446 (compactor) and T-0450 (web polish): pre-reviews restarted after they stalled overnight;
  - T-0448 (mobile polish): a fresh pre-review after its fix round.
- **Local dev:** vite and the server hit the background time limit and are stopped. Restart them only when Julio asks.
- **Next, one at a time while under 2:**
  - M6b, the mobile room memory (the group and topic info sheets);
  - emulator QA of the forward, media and memory screens, only when Julio frees the PC.

**2026-10-06 late evening:**
- **Merged:** T-0436, T-0440 to T-0445:
  - the mobile media sheet;
  - AI memory M3a context, M3b tools, M4a routes, M4b room cleanup and M5a web DM section;
  - mobile multi-select forwarding.
- **The AI now remembers.** Each turn indexes the chat, reads its facts and memory block, and can recall, zoom and remember.
- **Running:**
  - T-0446 (M3c compactor: builds the summaries);
  - T-0447 (M5b web room "What <AI> remembers" dialog).
- **Next:**
  - M6 mobile memory UI;
  - one web and one mobile polish task for the nits (T-0436, T-0439, T-0443, T-0445);
  - emulator QA of the mobile forward and media sheets (never seen on a device).
- **Gate flake:** the first T-0441 merge failed its gate under load. A re-run passed and the merge went through.

**2026-10-06 evening:**
- **Merged:** T-0433 to T-0435 and T-0437 to T-0439:
  - AI memory M1, M2a and M2b;
  - the web media panel;
  - the mobile forward sheet;
  - web multi-select forwarding.
- **T-0436 (mobile media sheet):** approved. Its rebase conflicted with T-0435 in `[id].tsx`; the worker is resolving it (keep both sheets). Then run `lead merge T-0436` again. It is not checked on the emulator yet (smoke skips `[id]`).
- **Running AI memory tasks:**
  - T-0440 (M3a): turns index the chat and read facts and the memory block; window 50.
  - T-0441 (M4a): the routes.
  - T-0442 (M4b): room cleanup.
- **Next:**
  - M3b, the tools `recall`, `memory_zoom` and `remember`, with a new secret-pattern check. There is no pattern helper today; `redactSecrets` only redacts known values. It waits for T-0440, because both touch `gateway.ts`.
  - M3c, the compactor.
  - M5 (web) and M6 (mobile).
  - Mobile multi-select forwarding, after T-0436.

**2026-10-06 afternoon (resumed):**
- **Merged:** T-0419 (web forward picker), T-0430 (MAM newest page), T-0431 (`/api/media`) and T-0432 (mobile forwardMessages).
- **T-0430** proved and fixed Julio's AI bug: without a cursor, MAM returned the OLDEST page. The deep test archive has 33 rows, and the AI saw rows 1-30, ending at "are you still running?". His two vanished Spanish messages were retracted from his own session (12:17:49 and :53); the only path that sends a retraction is the Delete menu plus its confirm.
- **AI memory:** Julio chose automatic, always-on memory per chat, with members viewing room memory and the owner and admins deleting it, and a 50-message window. The plan is `docs/audit/ai-memory-plan.md` (v2). M1 = T-0433 (the only schema task), running.
- **Running:** T-0433 and T-0434 (web media panel).
- **Local dev:** `pnpm infra:up`, then the server with `pnpm --filter @zilar/server dev` and `ZILAR_API_URL=http://localhost:3188 pnpm --filter @zilar/web dev`. Never use turbo dev, because port 3000 is Julio's gmail-mcp. In dev the OTP is in the server log (`dev-mailer`).

**PAUSED 2026-10-06 (Julio needs the computer):** the lead stopped the autopilot, `lead watch`, opencode (workers), local dev (vite 5173, server 3188), the site preview, the emulator and the zilar-dev docker containers. Since the last update: T-0427, T-0428, T-0429 and T-0410 were merged. T-0419 is PACKET READY (clean, 3 nits) and not merged; review it on resume. Next: the gallery 1b route spec, then the mobile `forwardMessages` (mobile has no send timeout machinery; use the `markStickerFailed` style `failed: true`). To resume, follow the CLAUDE.md first actions (start the autopilot).

Last updated: 2026-10-06 ~12:40 UTC, after the manual deploy, merging T-0414/T-0425/T-0426 and launching T-0419/T-0427/T-0428/T-0429.

Older: 2026-10-05 ~14:40 local, after merging T-0223 and launching T-0225; earlier merged T-0222, T-0211 (Julio: "the resize is working great") and T-0221, and launching T-0222. Main checkout got `pnpm install` (T-0211 added Ink/React; the autopilot could not start without it). Julio's watcher reopened on the new version and floated; test window closed.

Autopilot restarted with `ZILAR_REVIEW_MODEL=meta/muse-spark-1.3-contributor` (free Muse still 429 at ~12:05). When the free listing answers again (`opencode2 run -m "opencode/muse-spark-1.3-contributor-free#low" "Reply OK."`), restart it without the variable.

FREE MUSE RATE-LIMITED since ~10:43 UTC (429 "Rate limit exceeded" for every session). Manual fallback in place (tested, keeps the session's context): `opencode2 api session.switchModel --param sessionID=S -d '{"model":{"providerID":"meta","id":"muse-spark-1.3-contributor","variant":"low"}}'`, then `lead reply` (worker) or `opencode2 api session.prompt` (pre-review). Done this way: T-0212 worker and pre-review, T-0215 pre-review. T-0216 automates it in the autopilot (Julio: "use free Muse as much as possible, switch to my paid one if it fails, without restarting"); launched. T-0215 adds `ZILAR_REVIEW_MODEL` for the doctor.

Julio's watcher now runs in a floating Ghostty window. Julio approved the `lead watch` mockup (artifact https://claude.ai/artifact/8QujyLaobor35XDKHr7ZZG, copy in `docs/design/briefs/T-0211-lead-watch-mockup.html`).

Emulator: run only the `galena` AVD (never `bicing_plus`, Julio's). Its DNS failed today (smoke screenshots stuck on the boot spinner); start it with `-dns-server 8.8.8.8,1.1.1.1`.

Token saving check: the first fresh-session fix round (T-0191 round 1) started at ~21k context instead of the old session's ~158k per step.

Known issue: `pnpm install` flips two `transitivePeerDependencies` entries (`bufferutil`, `utf-8-validate`, under the `metro-runtime` block of `pnpm-lock.yaml`) between worktrees: T-0203 added them, T-0204 removed them. Harmless, but it puts lockfile noise in every task. Later: an audit task to find why (pnpm version or install order).

Models (Julio, 2026-10-05): default `opencode/muse-spark-1.3-contributor-free`; MiniMax M3 only for the easiest exact tasks; billed `meta/muse-spark-1.3-contributor` is the fallback if the free listing hits limits.

## Morning summary for Julio (2026-10-06, written 06:55 local)

**Overnight:** about 95 tasks merged since 22:00, mostly the UI kit migration on web and mobile.
- Every web field, menu, dialog, checkbox and radio switch is now on the kit.
- On web, the ★ ✕ ↑ ↓ glyphs are now icons. On mobile, the ✓ glyphs are icons and the message bubbles draw tick icons.
- Emulator QA ran in mock mode, runs 14-24, all on the `galena` AVD only. Every finding became a task and was fixed.

**Bugs found and fixed tonight:**
- mobile: the visibility and invite sheets were hidden under the keyboard;
- mobile and web: search never found groups by name;
- web, narrow screens: Escape in the chat header and task menus left the chat;
- mobile: long AI messages collapsed to a narrow column, and the markdown reply showed as a huge empty block;
- mobile: the New topic form overflowed its card;
- web: the handle check reset when the active Public option was clicked again;
- autopilot: a fix round that hit a rate limit stalled silently (T-0335; the autopilot was restarted on it).

**Doctor audits:**
- Audit 1: full suites green (web 1500, mobile 1982, server 1886).
- Audit 2: one should-fix (Badge aria-label), fixed in T-0334.
- Audit 3: clean.

**Needs you:**
1. **Auto-deploy:** add the GitHub secrets `COOLIFY_URL`, `COOLIFY_TOKEN` and `COOLIFY_SERVICE_UUID` (= `zogjtvwnoh9rqo96h7e7ajz1`).
   - The images pipeline is green: the web image builds in 40 s.
   - Until the secrets exist, live chat.zilar.app stays on v0.1.13.
2. ~~Forwarding UI questions~~: answered on 10-06 (all recommendations).
3. ~~Media gallery questions~~: answered on 10-06 (all recommendations).
4. **Security, for you to decide:** `/upload/*` has no auth. Anyone who has a file URL can read the file, even after the message is retracted.
5. **For later:** blocking matches the localpart only (doctor audit 1). That is harmless while federation is off, but revisit it before turning federation on.

## Running (max 6, at most 3 mobile; Julio 2026-10-05)

Emulator QA now goes to a Sonnet subagent ("android emulator expert", Julio's request): it builds, taps, screenshots and reports, never edits files. Run 1 done: T-0189, T-0212, T-0213, T-0218 PASS on a mock build, no crash; layout issues (routine row squeeze on Delete confirm, Activity header/icon, "Show all" under the gesture bar, version date cut) → T-0229 (written, launches after T-0219). Run 2 done (T-0219 PASS; keyboard + stale list → T-0230, merged). Run 3 done (T-0228: channel Private/Public and handle checks PASS; the sheets sit under the keyboard and mock create throws by design → T-0234). Julio: never wait for the QA subagent; merge on code review, QA findings go to a polish task.

| Task | What | Step | Note |
| --- | --- | --- | --- |
| T-0410 | Media gallery 1a (server): index tables + indexer | pre-review after fix round | the only schema task; then the `/api/media` route (1b) |
| T-0419 | Forwarding step 4 (web): Forward menu item + picker | coding | then multi-select |
| T-0427 | Mobile forwarded header | fix round (big-emoji branch) | |
| T-0428 | Mobile New chat menu on ActionSheet | coding | audit batch 23 part |
| T-0429 | Mobile DismissBanner on the chat screen | coding | audit batch 17 |

The sixth (web) slot waits for T-0419 (then multi-select) or T-0410 (then the gallery route). Remaining audit batches: 11 (tab chrome, no tests), 19 and 20 (in-bubble controls: lead leaves them raw, bubble colours), the rest of 23.

**Deploy 2026-10-06 12:24 UTC (Julio: "Deploy now, by hand"):** CI green on eeaddee3, images run 37462477607 built all four, Coolify service restarted with pull. Live `/health` shows `commit: eeaddee3…`, and the live web bundle contains the T-0409 "Forwarded from" header. Auto-deploy still needs the 3 GitHub secrets. Merged after the deploy: T-0414, T-0425, T-0426.

Merged 11:30-12:10 UTC: T-0407, T-0408, T-0409, T-0411, T-0412, T-0413, T-0415, T-0416, T-0417, T-0418.
- **Forwarded header (T-0409):** the lead checked it in the browser (mock, Ana chat). "Forwarded from Luis in Friday plans" shows above the text.
- **QA run 34** (main dd4e6a07, mock) PASS for the pins banner and sheet, the Connections icons, New folder, Delete folder, the Integrations eye, Stickers Import and Move, and the AIs tab. No crash. Marker b45684f1.
  - Finding: "Revoked (1)" shows no tap hint (lead saw `qa34/16.png`) → T-0421.
- **Lead decision:** the mobile `LoadError` component keeps its quiet raised Retry key (its comment says this is on purpose), so audit batch 27 is not migrated.

Earlier: T-0407 to T-0412 were launched 11:05-11:28 UTC on DeepSeek flash (off-peak).

**Julio, 2026-10-06 ~11:15 UTC:** he accepted every recommendation in the forwarding plan §5 and the media gallery plan §5 (recorded in both docs).
- **Forwarding order:** T-0409 (receive and header), then the `forwardMessages` store action, then the picker and multi-select UI, then mobile.
- **Gallery order:** T-0410 (1a), then the `/api/media` route (1b), then the web panel, then mobile.

Merged 10:40-11:20 UTC: T-0398 to T-0406.
- T-0400 had one lead fix round: a test could pass without pressing anything.
- T-0406 wrote the `docs/audit/ui-kit-leftovers.md` batches, the source of the next kit tasks.

QA run 33 (main d2b455fc, mock) PASS. The ON Switch now has a light thumb on a grey track (the lead saw `qa33/02_on_off.png`), and the catalog Switch works. The settings screens load straight to content in mock, so their states cannot be seen. No crash. Marker b45684f1.

Earlier: launched 10:38 UTC (off-peak, DeepSeek flash). Merged 10:35-10:38 UTC: T-0391 to T-0397 (mobile guard, SegmentedControl, panel states, Switch; web loading lines, list errors, Connections icons). QA run 32 (main b4763d36, mock, qa32/):
- **PASS:** the Stickers tabs and the catalog segmented control.
- **ISSUE:** an ON Switch has a dark thumb that overhangs the light track and vanishes into the card (lead saw 23z.png) → T-0404, which launches in the next mobile slot.
- **Inconclusive:** the T-0393 panels. Their states could not be forced. The sticker panel showed an empty grid and its pack tabs did not switch. T-0393 did not touch the tabs, so this is likely mock data; check it later.
- No crash. Marker b45684f1.

Merged 10:15-10:35 UTC: T-0384, T-0386 (mobile StateMessage), T-0387, T-0388 (Captions icon instead of "Aa"), T-0389 (web SecretInput), T-0390. QA run 31 (main e298c4d6): T-0383, T-0386 catalog, T-0387 PASS; T-0384 Blocked PASS, Explore Show more not reachable in mock (3 rows), panel Retry not forceable. Marker restored to b45684f1.

Merged 10:00-10:15 UTC: T-0380 (settings Back/AI icons, unused AiPageShell frame removed), T-0381, T-0382 (picker rows), T-0383 (mobile group roles), T-0385 (hover actions). The free Muse started rate-limiting at ~10:05 UTC; the autopilot switches those sessions to the paid Muse. Off-peak launches go to DeepSeek flash.

Next after this batch: mobile kit Switch (web has one); adopt the mobile StateMessage and SegmentedControl in more screens (folder tabs, other loading/error states); QA run 32 for T-0392, T-0393.

QA run 30 (main a15f1213, mock): T-0377 and T-0378 PASS (dark theme; the light theme was not checked because the app keeps its own theme). Marker restored to b45684f1.

Merged since the morning report (2026-10-06): T-0357 to T-0379; T-0374 to T-0379 added the visibility/invite buttons, Plus icons for the "+" glyphs, the FAB/voice play on Button with the guard now also flagging `key-primary` and solid `bg-danger`, the topic info Leave/Archive and New topic Create guard (mobile), the raised group FAB (mobile) and the Explore states. Earlier (web: SearchField, inline StateMessage, MenuItem on the chat and message menus, GIF/Stickers states, and kit Buttons on Connections, folders, task link, contact row, pinned banner, machine cards, AIs, Integrations, ConfirmDialog, New AI, avatar uploader, pack editor, panel close buttons and dialog Cancel/Back/Close; mobile: the create, visibility, roles, topic, task strip, profile and channel buttons). No hand-rolled solid `bg-danger` button is left on web.

QA run 29 (main b0931985, mock): T-0360, T-0361, T-0362 PASS, no blank pills. Findings → T-0377 (Archive red with dark text; New topic Create enabled with empty name). Not checked: the visibility share-link buttons (no share link in mock), profile card states eve/bob/ada. One ANR came from the QA agent's own key flood in Chats search, not reproduced by normal typing. Marker restored to b45684f1.

Still raw on web after this batch: MessageBubble inline Retry/Delete links, FolderRail keys, TaskStrip chips, EditBar strip, FileMessage key-icon retry, list rows and tabs (rows, tabs, radios and grid cells stay raw by design). Mobile: the image viewer Close (black overlay) and the AI wizard/option rows.

Time correction (checked with `date`): it is 04:42 local, Tue 10-06. The "~04:xx–05:50 local" stamps below were estimated and run up to about an hour ahead; their order is right.

~11:05 local (09:04 UTC): Julio asked for 6 workers and to watch the peak hours.
- **Launched:** T-0357 to T-0359 (web) and T-0360 to T-0362 (mobile, the last accent pills).
- **Model:** all six are on the free Muse, because DeepSeek's peak runs until 10:00 UTC; a failure falls back to the paid Muse.
- **Specs:** every spec now says that labels go inside `<Text>`, after the T-0349 blank-button bug.
- **Doctor audit 4:** clean.

08:48 local: night finished.
- **Merged:** T-0354 (2 nits; the lead checked every label is inside `<Text>`) and T-0356.
- **QA run 28 PASS:** the Profile labels show, and Save name enables on edit. The lead saw qa28/01.png.
- **No workers running.** 116 tasks were merged since 22:00 on 10-05.
- **CI on main:** the last completed green run is T-0352. Later pushes cancel older runs by design (T-0289); the run for T-0354 is in progress.

08:35 local: merged T-0353 and T-0355. QA run 27 (qa27/; the lead saw 11.png):
- **ISSUE:** the Settings → Profile buttons are blank pills. T-0349 passed the labels as bare strings with no `<Text>` around them; the lead scan finds them in those 3 files only → T-0356, launched.
- **PASS:** Integrations, Requests, Telegram import, New group, Explore and the @handle screen.

Julio is awake (08:2x) and asked to finish the running tasks and then get the night report. No new work after T-0354 and T-0356.

07:52 local: QA run 26 PASS (qa26/; the lead saw 14.png). The kit Buttons on Machines, Connections, Stickers and the New pack editor are consistent and work. Edit on owned packs cannot be reached in mock. No crash. Phone marker b45684f1 (lead checked).

07:40 local: merged T-0345 (Connections buttons) and T-0346 (Stickers buttons).

T-0346 blocked once, validly: `sticker-pack.tsx` imports from `stickers.tsx`, so its test needed the same mocks. That was a lead spec miss; the "one level up" grep in LEAD_HANDOFF was skipped. The lead allowed the test file (mocks only) and the worker finished. T-0347 launched.

07:28 local: merged T-0343 (Machines pill buttons on Button, clean) and T-0344 (web TextInput, clean). Lead browser check in mock mode: the Telegram import field has the kit well style with its label. PASS.

07:20 local: merged T-0342 (web New topic visibility on SegmentedControl; 1 a11y nit, polish only).

QA run 25 (qa25/; the lead saw 14.png), no crash:
- **PASS:**
  - "Remove this pack?" and the Integrations "Remove" confirm are the kit ConfirmDialog;
  - the Add machine dialog has the bordered card and kit buttons, with a dark Copy icon and a dark "Copied" check.
- **Not reachable in mock:**
  - "Delete this pack?" and "Discard changes?": mock owned-pack rows are not tappable;
  - the T-0341 empty states: the mock lists are not empty.
- **New pack, back after typing only a name:** no prompt. That is by design: for a new pack, `changed` counts only ready stickers (`sticker-pack.tsx:187-188`).

Phone marker b45684f1 (lead checked).

07:15 local: merged T-0341 (clean). QA run 25 sent (qa25/) for the settings confirms, the Add machine dialog and the Plus icons.

07:10 local: merged T-0340 (Add machine dialog on the kit; 1 nit → T-0341, launched).

07:03 local: merged T-0339 (4 mobile settings confirms on the kit ConfirmDialog; 0 nits). It is not checked on the emulator yet; next QA run.

06:55 local: QA run 24 PASS (qa24/; the lead saw 01.png).
- The time and tick stay together on one line, including in "Draft three taglines…".
- The "1) …" bubble fits its content.
- The Launch checklist list reads as a list.
- The ticks are centred on the digits.

No crash. Phone marker b45684f1 (lead checked). The mobile bubble chain T-0336, T-0337 and T-0338 is done.

06:51 local:
- **Doctor audit 3 (since 21297ac): clean.** must-fix 0, should-fix 0, 3 test and wording nits, no task. It confirmed the T-0337 causes.
- **T-0338 merged,** after 1 automatic round whose should-fix the pre-review later withdrew; 1 nit.
  - The tick view now sits inside the time's Text behind ` ⁠`.
  - Each list item is one Text with an inline marker.
- **QA run 24 sent** (qa24/).

06:34 local: QA run 23 (qa23/; the lead saw 01.png).
- **PASS:**
  - the long "1) …" message wraps normally;
  - the Launch checklist markdown shows every part in a normal-height bubble;
  - the ticks are now centred on the time digits.
- **Two follow-ups** → T-0338, launched:
  - in "Draft three taglines…", the tick wraps alone onto a second line, because the time and the tick are separate inline pieces since T-0336;
  - the "1) …" bubble has about 2 empty lines under its time (the ListBlock row's measuring).
- No crash. Phone marker b45684f1 (lead checked).

06:30 local: merged T-0337 (2 nits). Both causes are in `MarkdownText`:
- "1) …" parses as a one-item list, whose text had `flex: 1` (basis 0) → it is now `flexShrink: 1`;
- the code block's horizontal ScrollView grew to fill the free height → it now has `flexGrow: 0`.

The ticks get `translateY: 2`. The worker ran on DeepSeek flash (off-peak). QA run 23 sent (qa23/).

06:16 local: QA run 22 (qa22/).
- **Ticks:** the tick icons show; no ✓ or ○ glyphs are left. They sit about a third of the digit height too high (lead saw z1.png).
- **New bug** (lead saw 07.png), in the Marketing AI mock chat:
  - the long plain incoming message wraps a letter or two per line, in a very narrow column;
  - the markdown reply renders as a huge, square, mostly empty grey block, showing only "Full brief …".

  The cause is unknown and may be old, since T-0336 touches only outgoing bubbles. → T-0337 (find the cause + fix + tick nudge), launched.
- No crash. Phone marker b45684f1 (lead checked).

06:10 local: merged T-0336 (the inline time in outgoing text and markdown bubbles is followed by a Ticks icon instead of ✓ / ✓✓ / ○; 1 nit). QA run 22 sent (qa22/) to check the alignment.

06:03 local: QA run 21 PASS (qa21/). The New topic sheet is a kit bottom sheet. With Private chosen, Cancel and Create are reachable after one swipe. The keyboard keeps the field visible, and Create is reachable with it open. The backdrop and the back button close the sheet. No crash. QA reported Create clipped before scrolling (02.png); the lead looked, and it is the scroll area's edge with more content below, which is normal for a sheet. Phone marker b45684f1 (lead checked).

05:59 local: merged T-0332 (the New topic sheet uses the kit BottomSheet, so the long Private form scrolls; clean after the fix round). QA run 21 sent (qa21/). No workers run now.

05:58 local: merged T-0335 (in review status, a worker that hits a rate limit now falls back in place to the paid Muse; 0 nits) and restarted the autopilot on it. One instance runs, and lead.log is ticking.

05:52 local: T-0332's automatic fix round went idle/failed on the free Muse rate limit, and nothing followed for about 25 minutes: no FALLBACK and no STALLED line. The cause: `decide.ts` skips the worker quota fallback when the task is in `review`. The lead switched T-0332 to the paid Muse in place and resent the fix (the test must assert the BottomSheet `title` prop). T-0335 fixes the autopilot.

05:50 local: merged T-0334 (Badge aria-label follows the visible 99+; 0 nits). The doctor's should-fix is closed.

05:45 local: doctor audit 2 (since fc0be5e) found must-fix 0, should-fix 1, nits 2.
- **Should-fix:** the Badge aria-label used the raw count while the badge showed 99+. The lead's T-0321 spec caused it → T-0334, launched.
- **Nit:** the Discover Share button lacks the T-0331 reason. It is unreachable today (imported packs never appear in Discover), so no task.
- **Nit:** the roles checkbox has no `disabled`. It is moot: the whole row already gets `disabled:opacity-50` while busy.

T-0332 is in an autopilot fix round (1 should-fix).

05:26 local: merged T-0333 (sticker panel tabs on SegmentedControl, with arrow keys; 0 nits).

05:21 local:
- **T-0331 merged.** On an imported pack, the disabled Share button shows its reason again: a hover title on a wrapper span, plus `aria-describedby`. 2 form nits accepted.
- **QA run 20: PASS** (qa20/). The kit Checkbox works in New topic (members, AIs, the locked "You") and in the roles holders. The approver tick is a Check icon. No ✓ glyphs are left. Phone marker b45684f1 (lead checked).
- **Box shape:** QA calls the boxes round. They were already round before T-0329 (`rounded-md` on a 20 px box), so this is not a regression.
- **Overflow:** the lead saw in 03.png that with Private plus 4 people plus 2 AIs, the Cancel / Create row spills below the New topic card. The card is `max-h-[85%]` with no ScrollView → T-0332, launched.

05:15 local: merged T-0329 (mobile kit Checkbox with a Check icon; the ✓ glyphs in the topic and roles pickers are now icons; 1 cosmetic nit). QA run 20 sent (qa20/).

05:13 local: merged T-0330 (SegmentedControl ignores re-clicks; PackEditor ↑ ↓ ✕ become icons). No glyph buttons are left on web. Launched T-0331.

05:12 local: read the doctor audit (`../zilar-doctor/DOCTOR.md`, range d8259fe..fc0be5e, 193 commits). The full suites of every package are green: web 1500, mobile 1982, server 1886. The loop and scope checks are clean. One should-fix:
- **What:** `isBlockedSender` (`packages/chat-core/src/blocked.ts:10-12`) matches the localpart only, so `bea@other.test` would be hidden when `bea` is blocked.
- **Lead decision: no task now.** Federation is off (`infra/ejabberd/ejabberd.yml:49`: no s2s listener, every s2s denied), so every sender shares one domain and nobody can be over-blocked today. The test pins this behaviour on purpose. Revisit if federation is ever turned on. Morning note for Julio.

05:09 local: merged T-0325, T-0326, T-0327 and T-0328, all with clean pre-reviews. Their effect:
- the Stickers page uses the kit;
- no raw radios are left on web;
- the ↑ ↓ ★ ✕ glyphs on the Stickers page, the sticker panel, Telegram import and Connections are now icons.

Bug found in the T-0326 pre-review: SegmentedControl fires `onChange` on a click of the active option, so the handle check resets → T-0330. Polish note from T-0327: a disabled kit Button hides its hover title (Share on an imported pack). Launched T-0329 (mobile ✓ glyphs, kit Checkbox) and T-0330.

05:01 local: lead browser check on main, mock, wide; all four PASS:
- the chat list and topic unread Badges render;
- New topic, Private: the kit Checkbox rows toggle when the row is clicked, and "You" stays checked and dimmed;
- Who can see it is a segmented control (that one was already on the kit);
- Explore: the All/Groups/Channels segmented control filters, and Channels shows Acme Announcements.

New group shows "Invite a friend first", because the mock has no contacts, so its checkboxes were not seen.

04:59 local: merged T-0322 (page states on StateMessage), T-0324 (SegmentedControl radio mode: Explore filter, group Visibility) and T-0323 (kit Checkbox; 1 nit accepted), all with clean pre-reviews. Launched T-0325 and T-0326.

04:54 local: merged T-0321 (unread pills on the kit Badge; pre-review clean, 0 nits). Board rows need the `[T-XXXX](file.md)` link format, or `lead merge` refuses.

04:48 local: launched T-0323 (Checkbox) and T-0324 (SegmentedControl radio mode). The free Muse is still rate-limited, so the workers run on the paid fallback.

04:45 local: launched T-0321 (Badge) and T-0322 (StateMessage), the next web kit adoptions. Neither kit piece had app users before (StateMessage had 3).

04:42 local: merged T-0320, after a lead fix round: the regression test threw inside a listener, which jsdom swallows; it now uses a spy plus a control test. No hand-rolled web menus are left. Bug fixed: on narrow screens, Escape in the chat header or task strip menus used to leave the chat.

~05:35 local: merged T-0319 (message and chat actions menus on Menu; Escape works from anywhere).

~05:20 local: merged T-0318 (web kit Menu). Lead browser check, mock, wide: the main menu opens; ArrowDown, End and Escape all work.

~05:10 local: QA run 19 PASS (qa19/).
- Search: `dev` shows a Chats section (Dev AI, Dev team) above Messages, and tapping Dev team opens it.
- The visibility, members/roles and topic info sheets on BottomSheet stay above the keyboard; the roles field also checked.
- T-0317 cards: the border now gives a clear edge (lead saw qa19/12.png). The dark fill stays close to the dimmed chat. The lead compared qa18/04.png, where the bubbles are near-white with no menu, against qa19/12.png, where they are grey: the dim works. No further task.
- Topic info opens from the topic's ⋮ menu, not from long-press.
- Phone marker b45684f1 (lead checked).

~05:00 local: merged T-0317 (card contrast). QA run 19 sent (qa19/) for T-0314, T-0315 and T-0317.

~04:55 local: merged T-0315 (3 sheets on BottomSheet) and T-0316 (web search finds groups by name; lead checked in mock: "dev" shows Dev team with all 7 topics). QA run 18 PASS (qa18/): the message menu and the centred delete dialog work, and so do pins, invite links and the kit BottomSheet. In dark mode the floating cards barely stand out (lead saw 02/03.png) → T-0317. The voice download prompt is not reachable in mock. The free Muse is rate-limited again; workers fall back to the paid Muse.

~04:40 local: merged T-0314 (mobile search shows a Chats section above Messages; groups are found by name).

~04:30 local: QA run 17 PASS (qa17/): chat list search well, clear, People view; Stickers Discover search filters; GIF search bar (the mock GIFs are blank tiles); Telegram import field. Older bug found (lead saw 03.png and read the code): with 2+ characters the search shows only messages, never matching chats, and `filterChats` ignores `groupTitle`, so groups are never found by name → T-0314. Phone marker b45684f1 (lead checked).

~04:35 local: merged T-0313 (kit BottomSheet; 3 nits accepted). QA run 18 sent (qa18/) for T-0312 and T-0313.

~04:25 local: merged T-0312 (message actions on the kit ActionSheet with icons, centred delete ConfirmDialog; voice download prompt on ConfirmDialog; 2 nits accepted).

~04:15 local: merged T-0311, after a lead unblock: `emoji-sheet.test.tsx` reaches `GifPanel` through another file, and the transitive pitfall is now in `docs/LEAD_HANDOFF.md`. The plain mobile fields are all on the kit (TextField and SearchField). QA run 17 sent (qa17/).

~04:05 local: QA run 16 PASS (qa16/). With the keyboard open, the visibility sheet shows the Handle field, the availability line and Save (lead saw 02.png). The invite links sheet is still OK. Kit SearchField: topic search filters, Explore with a compass icon, catalog clear works. T-0307 sign-in fields not reachable, because mock mode starts signed in. Phone marker b45684f1 (lead checked).

~04:00 local: merged T-0309. No hand-rolled search bars are left on mobile. Left raw on purpose: the composer, OtpInput, the sticker-pack emoji cell and the folder name row (it has an inline counter).

~03:50 local: FIRST FULL IMAGES RUN GREEN (37400612697, tip c1837ca3), about 3.5 min end to end. zilar-web took 40 s (T-0304 native builder; the old QEMU build was still running after 55 min), server 3.5 min, postgres and ejabberd under 1 min. The "Deploy to Coolify" job ran and logged "Auto-deploy skipped: set COOLIFY_URL, COOLIFY_TOKEN and COOLIFY_SERVICE_UUID". Once Julio adds the secrets, every green main deploys by itself.

~03:50 local: CI green on c1837ca3. The old images run had ignored the cancel and still held `publish-main`; force-cancelled it, and images run 37400612697 (the first with the T-0304 native web builder) started; lead is timing it. Merged T-0307, T-0308 (kit SearchField), T-0310 (visibility sheet keyboard fix). QA run 16 sent (qa16/).

~03:40 local: QA run 15 (qa15/): PASS for Integrations (cards show in mock; `?mock=not-owner` shows the lock), Join link field, AI Model, $ limits, tool Run input, machine rename, new sticker pack name. ISSUE: the visibility sheet is fully hidden by the keyboard (lead saw 10.png) → T-0310. Editing an owned sticker pack's name is not reachable in mock. Phone marker b45684f1 (lead checked).

~03:50 local: merged T-0302, T-0306, T-0305 (nit waived: the close icon keeps `MUTED_FOREGROUND`; my acceptance line was too broad). Cancelled images run 37396257689 (zilar-web still under QEMU after 55 min, stale code, and it held the `publish-main` group, so newer image runs queued behind it were cancelled). Timing the images run for tip c1837ca3, the first with the T-0304 native builder; merges are held until it finishes. QA run 15 sent (qa15/).

~03:40 local: QA run 14 PASS (qa14/): invite links sheet sits above the numeric keyboard (lead saw 02.png), backdrop closes and inside taps do not; the create-sheet, roles and task-strip link fields show the well look and typing works. No crash. Phone marker restored to b45684f1 (lead checked).

~03:30 local: merged T-0304 (web image builder runs natively; local amd64 cross-build passed) and T-0303 (Integrations owner mock: `?mock=1` shows the cards, `?mock=not-owner` the lock). First images run 37396257689: zilar-web still building under QEMU after 32 min; the next images run on the tip uses the T-0304 Dockerfile (lead is timing it).

~03:22 local: merged T-0299 (invite links sheet keyboard), T-0300, T-0301 (all clean, 0 nits). QA run 14 sent for all three (qa14/).

~03:14 local: merged T-0297 (mobile TextField batch 2) and T-0298 (web TextInput batch 6, the last plain web fields). QA run 13 (qa13/): T-0297 fields PASS. Integrations was not testable, because the mock user is not the owner and gets the lock page. Finding: the invite links sheet never avoided the keyboard → T-0299. Still to migrate after T-0300/T-0301: join-link and visibility-sheet (their tests overlap with T-0300), sticker pack, stickers, explore, machines, folder editor, telegram import, AI pickers. Images run 37396257689 is still building zilar-web.

~03:05 local: merged T-0293, T-0294 (mobile TextField; QA run 12 PASS, qa12/), T-0295, T-0296 (removed dead mobile AddContactSheet, found by QA 12). First production image build is running (images run 37396257689: server, postgres, ejabberd built OK; web still building at 00:59 UTC); deploy skips until the Coolify secrets exist.

~02:50 local: merged T-0290, T-0291, T-0292 (bare field without label/hint/counter). `lead merge` pushes main, so each merge restarts CI; with T-0289 the older runs cancel. Lead plan: hold one merge until CI on the tip finishes so the images workflow builds once and proves the pipeline.

~02:30 local: merged T-0287 (mobile ConfirmDialog), T-0289 (CI cancels superseded main runs, so the tip finishes and images can build), T-0288 (first TextInput users; lead browser check of the recessed field + focus outline). QA run 11 PASS (qa11/): Open group icon aligned, topic actions sheet, AI delete and machine confirms, kit confirm sample; always-allowed revoke not reachable in mock. The QA agent pinned a mock topic by accident (mock only).

~02:20 local: merged T-0284 (topic actions sheet + Open group icon), T-0285, T-0286. All 5 web chat panels are now on the kit Sheet; no hand-rolled `role="dialog"` left on web except `StickerPanel` (non-modal popover). Lead browser check (mock, wide): channel panel opens on the right, Escape closes it, focus returns to the header. Narrow check not done (window would not resize); covered by the kit test.

~02:20 local: merged T-0282 (kit Sheet + `use-modal.ts`; modal Escape stops at the topmost overlay, also when undismissable; listeners in layout effects). QA run 10 PASS in dark mode (T-0283 sheets + kit catalog; light mode not checked: `cmd uimode night no` did not switch the app). One finding: "Open group" row has no icon, so it is out of line → in T-0284.

~02:10 local: merged T-0280 (cause: Escape fired before the Dialog's passive effect attached its listener; test now waits) and T-0283 (mobile kit ActionSheet). QA run 10 sent to the Sonnet subagent (T-0283 sheets + kit catalog, screenshots in job tmp `qa10/`).

~02:00 local: merged T-0281 (accent pill guard, after a lead fix round: no vacuous pass).

~01:55 local: merged T-0277, T-0278, T-0279. No hand-rolled accent buttons left on web (only 2 badge spans). Images workflow has only skipped so far (main moves faster than CI); the first build comes when merges pause.

~01:40 local: merged T-0272 (lockfile flip fixed with `packageExtensions`; pnpm changelog quotes not verified by the lead), T-0274 (no hand-rolled modal dialogs left on web), T-0275, T-0276. Images workflow verified: it skips non-tip commits ("no longer the tip of main") and will build when CI passes on the tip.

~01:30 local 10-06: merged T-0260 (auto-deploy; images publish on every green main; the deploy step stays skipped until Julio adds the 3 secrets) and T-0273 (clean).

Later the same night: merged T-0261 (forward wire), T-0262 (ticks + folder deep link), T-0263 (lead fix: kit Dialog 85vh + scrolling body), T-0264 (mobile kit batch 1 + `zilar://dev/kit`), T-0265, T-0266, T-0267 (SectionLabel heading), T-0268, T-0269 (CI flake: '535' in random requestId), T-0270 (folder editor on kit, browser-checked), T-0271. QA run 9 all PASS (qa9/). T-0260 got a lead fix round: tip-of-main guard + serialized publishing (overlapping CI runs could push an older `latest`).

Night 10-06 (Julio asleep, `caffeinate -dimsu` running): merged T-0251, T-0252 (after a lead memo fix round), T-0253 (lead browser check), T-0254, T-0255 (lead allowed hub.test.ts), T-0256 (forwarding plan), T-0257 (media gallery plan), T-0258 (4 dialogs on kit), T-0259 (CI red since T-0244: slow folder cap test; fixed). QA run 8 sent (T-0251, T-0252, T-0254, T-0255). Live chat.zilar.app is still v0.1.13: Julio said no manual release tonight; T-0260 automates it.

Waiting for Julio:
- Forwarding UI (plan T-D/T-E) needs his answers to `docs/audit/forwarding-plan.md` §5 (7 questions with recommendations).
- Media gallery Task 1 (schema migration) needs his answers to `docs/audit/media-gallery-plan.md` §5 (8 questions).
- Security note from T-0256: `/upload/*` is served with no auth (bearer URLs); anyone with a URL can read the file, even after a retraction.
- T-0260 merged: add GitHub repo secrets `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_SERVICE_UUID` (= `zogjtvwnoh9rqo96h7e7ajz1`). Optional repo variable `AUTO_DEPLOY=off` pauses it. Until then live stays v0.1.13.

2026-10-06 ~00:25 local: merged T-0246 (web kit 2; lead saw ListRow, SegmentedControl, Card render in Cosmos on 5100; first load takes a few seconds), T-0248 (mobile folder chips), T-0249 (web blocked previews), T-0234 (mobile create sheets + keyboard). QA run 6 done: Settings hub, Blocked people, block from search PASS; Integrations row hidden under the tab bar → T-0251. QA run 7 sent (T-0248 chips, T-0234 sheets). Cosmos running from main on http://localhost:5100 for Julio. Next specs: mobile folders part 2 (editor + Settings row), more web kit migrations (settings rows, dialogs), mobile kit.

Merged: T-0245 (`model: auto` = DeepSeek flash off-peak, free Muse in DeepSeek peak; autopilot restarted on it; follow-up: FALLBACK line wording for DeepSeek in `decide.ts:112`). Running on DeepSeek (launched 22:00-22:10 UTC 10-05): T-0246 web kit 2, T-0247 mobile Settings hub, T-0248 mobile folders chips, T-0249 web blocked previews; T-0234 in auto round 1 (2 must-fix). Merged: T-0244 (mobile block users; DeepSeek flash trial: 9.2 min total, $0.093 off-peak, 1 should-fix in round 1 like Muse's web twin T-0235; not yet seen on a device). Merged: T-0243 (web React Cosmos + kit batch 1; lead opened the catalog: 7 groups load. Next kit task: port 5050 (AirPlay holds 5000), host localhost, decorator min-h-dvh). Network outage ~evening 10-05 (ENOTFOUND api.meta.ai): the T-0244 pre-review and the doctor stalled; the lead re-prompted both. Merged: T-0238 (web Chat folders page + editor; lead browser check twice; final check is the lead's because the last packet reused a pre-fix PREREVIEW.md). Merged: T-0233 (mobile floating bottom bar, Profile tab; QA run 5 PASS on a mock build, no crash, screenshots in job tmp `qa5/`: bar, badge, FAB above the bar, list end clear, tabs, Profile tiles, no bar inside a chat, Android back returns to Chats. Polish for the Settings redesign: AIs and Settings tab headers have ~18 px side padding vs ~36 px elsewhere). Next mobile: Settings hub redesign (grouped cards), mobile folders (chips from the API + editor), hub row "Blocked people" after T-0244. Merged: T-0242 (dot grid numbers from `@zilar/ui-tokens`; nit: stale "Julio decides later" comment above `platformDifferences`). Merged: T-0240 (`packages/ui-tokens`, drift tests; main got `pnpm install`). Next UI kit step: web kit P1 + React Cosmos. Merged: T-0241 (mobile mention chips; "mine" look only visible in the real app, `me` is unset in mock). Merged: T-0227 (mobile @mention picker; QA run 4 PASS on a mock build: picker above the input, AI badge, self excluded, filter, select, overwrite keeps typed text, no picker in DMs; screenshots in the job tmp `qa4/`; the mock Dev team detail lacks Dani/Rubén, mock data only; follow-ups: channel feed mentions, received-mention highlight). Merged: T-0239 (web hides blocked people's group/channel messages; Blocked page null-handle fix). Block follow-ups: chat list previews/unread from blocked people, stale comment `apps/server/src/blocks/routes.ts:74`, mobile block UI. Merged: T-0237 (web folders from the server, chips + left rail; lead checked the rail in mock mode at 1440x900). Merged: T-0236 (UI kit audit, `docs/audit/ui-kit-audit.md`; next `packages/ui-tokens`, web kit + Cosmos, mobile kit with the react-native-web fallback, then migrations per area). Merged: T-0235 (web block/unblock + Blocked people page; 2 nits deferred: unblock error sentence, mock self-block). Merged: T-0232 (chat_folders server, migration 0040, clean first pre-review). Merged: T-0171 (block users server, after lead round 1). Queued: T-0234 (create sheets keyboard + mock create, after T-0233). Lead TODO: Docker compose rehearsal for T-0172 (push-deploy.test.sh already PASS 25/25).

Merged: T-0228 (public groups/channels), T-0230 (tool sheet keyboard), T-0172 (push component host), T-0231 (folder matcher), T-0225 (doctor accepts `CLAUDE.md` in lead commits), T-0224 (doctor in-place fallback; autopilot restarted), T-0226 (`ZILAR_SMOKE_MOCK=1 pnpm phone:smoke <ref>`: mock build, emulator only, leaves `.zilar-phone/commit` alone), T-0219 (tool Run/Revert/Delete; QA run 2 PASS, keyboard and stale-list issues → T-0230), T-0229 (AI screen layout fixes). Free slot (6th): block users web UI once T-0171 merges. Next: received mentions highlighted in mobile bubbles (after T-0227); New channel members step.

Merged: T-0222, T-0223 (docs sync: FEATURES 14 rows, parity roadmap state, README M5). Doctor flagged the lead's `CLAUDE.md` edit (d70f6d36) as must-fix; Julio chose "keep it, allow lead edits": `CLAUDE.md` line 10 updated (92190c62), T-0225 updates the doctor prompt. Doctor stalled twice on 429; lead switched it by hand both times until T-0224 merges.

First live `LEAD: FALLBACK`: T-0220's pre-review (free 429 → paid, same session) worked. T-0220 merged; autopilot restarted.

Merged since the last update: T-0214 (New group sheet), T-0216 (in-place fallback; autopilot restarted WITHOUT `ZILAR_REVIEW_MODEL`: new sessions start on free Muse and switch on a 429), T-0218 (tool detail sheet, read only).

## Next, in order

- Julio 2026-10-05 (chat background): dot grid on BOTH web and mobile. Already true: mobile chat draws it with an SVG pattern (`apps/mobile/src/components/chat/chat-background.tsx`); T-0242 only takes its numbers from `packages/ui-tokens`. Later feature in the plan: custom chat backgrounds (images or dots in different colours), web first.

0. Julio (2026-10-05, Telegram screenshots): folders (All/Personal/AIs/Work) fully editable and configurable like Telegram; AIs and the header options move to a floating bottom tab bar; redesign Settings and Profile. Today folders are hard-coded in `apps/mobile/src/lib/filter.ts` and `apps/web/src/components/FolderTabs.tsx`, nothing on the server. Brief and mockup v3 done (`docs/design/briefs/telegram-nav-folders-settings.{md,html}`, artifact https://claude.ai/artifact/BHee2ibwek1Q7ALdWjp38N). Julio's decisions are in the brief: monochrome keys, no Work default, tabs Chats/AIs/Settings/Profile, desktop folder rail. T-0231 (chat-core matcher) launched. Next: server `chat_folders` table + API (schema, after T-0171 merges), web rail + Chat folders page, mobile tabs, mobile folders, Settings, Profile. Julio: ask every question with the AskUserQuestion tool.

1. A mock-mode emulator build. Cause found: `scripts/phone/install.sh:46` builds `assembleRelease`, and `apps/mobile/src/mock/gate.ts:7-14` ignores `?mock=` outside `__DEV__` unless `EXPO_PUBLIC_ZILAR_MOCK` is baked in. So `zilar://ais/ai-dev-1?mock=1` hits the real API ("That AI no longer exists."). Idea: `pnpm phone:smoke --mock <branch>` builds with `EXPO_PUBLIC_ZILAR_MOCK=1` (emulator only, never the phone) and opens `/ais/ai-dev-1`. T-0189, T-0213, T-0218 were never seen on a device.
2. From the audit: @mention picker (7.2a), New channel parity (7.2c). Re-check every fact in the code.

Waiting for Julio: the AI screen's Tools/Routines/Activity sections could not be seen on the emulator (the test account has no AI; creating one needs a provider key). Look at an AI on the phone after the next release.

## MiniMax M3 scorecard (Julio, 2026-10-05: give it harder tasks, no replays)

| Task | Difficulty | Rounds | Pre-review | Tokens in | Note |
| --- | --- | --- | --- | --- | --- |
| T-0205 | easy (devtools parse) | 0 | clean, 2 nits | 0.49M | exact to spec |
| T-0194 | easy (guard tests) | 0 | clean, 0 nits | 1.4M | did the negative test properly |
| T-0195 | medium (docs audit) | 2 | round 1: 7 should-fix (invented strings, false claims, wrong citations) | 8.1M+ | merged; lead spot-check 9/10 citations exact |
| T-0215 | easy (env override, 3 files) | 0 | clean, 1 nit | | merged |
| T-0217 | easy (type + ref guard) | 0 | clean, 0 nits | | merged |

## Free-model benchmark (2026-10-05, 5 hard prompts, one run each, graded by the lead)

Prompts and outputs: `~/.claude/jobs/fcd95e40/tmp/bench/` (temporary). Scores: `opencode/muse-spark-1.3-contributor-free` 5/5 (fastest, 26 s avg, concise, proposed our real T-0198 fix); `opencode/mimo-v2.6-flash-free` 5/5; `opencode-go/longcat-2.5-preview-free` 5/5; `opencode/nemotron-3-ultra-free` 5/5 (one invented issue); `opencode-go/space-bunny-free` 4/5 (wrong event-loop order, most thorough elsewhere); `minimax-coding-plan/MiniMax-M3` 2/5 (wrong event loop and tiling, a fix that does not work across processes). `opencode-go/ox-alpha-free` unavailable, `opencode/fledge-alpha-free` not available in our country. Waiting for Julio: trial the free Muse listing on real tasks (rate limits and prompt logging unknown).
| T-0203, T-0204 | easy (prompts) | | | | queued |
| T-0207 | medium-hard (mobile sheet, state machine) | | | | after T-0191 |

## Blocked or waiting for Julio

- T-0186 notification settings: needs the server push work (T-0172), not approved.
- Phone checks: the Aa press on a voice note, the silent model load after restart, transcribe with real speech, the new settings screens (Integrations, Stickers). The last APK was built but not installed (the phone refused the USB install).
- Release: everything merged since v0.1.13 reaches the live web only with the next release.

## Recent events

- 2026-10-05: merged T-0206 (RepoMapper trial, `docs/audit/repomap-trial.md`): recommendation DROP. Our tasks mostly create new files, which a map of existing code cannot show; the maps only echoed the spec's "Read first" plus noise. Tool left at `~/.zilar-lead/tools/RepoMapper` (deletable).

- 2026-10-05: merged T-0205, the first MiniMax M3 task (clean first round) and the first squash merge: main gained exactly one commit `T-0205: ...` with the branch commits in its body.

- 2026-10-05: merged T-0200 (squash merges; its own merge still used the old flow). Follow-ups: T-0205 written; `docs/LEAD_PLAYBOOK.md` got a squash note. Checked for Julio: a shared warm start saves at most ~12k uncached tokens per session (first step of T-0201: input 12068, cache 0) and OpenCode forks keep the parent's folder, so not worth building.

- 2026-10-05: Julio approved the token-saving tasks: T-0202 (A), T-0203 (B), T-0204 (C) written. The lead updated `AGENTS.md` "Running tests" (quiet dot reporter, `pnpm gate` once, small sessions) and the spec rule in `CLAUDE.md` (Checks = single tests + `pnpm gate`); T-0194 and T-0195 Checks trimmed to match.

- 2026-10-05: merged T-0201 (runner connect test polls for "live"; fixes the CI flake Julio pasted). Token audit of worker sessions shown to Julio: fix rounds in the same long session (up to 217k context per step) are the main waste; proposals A/B/C (fresh session for fix rounds, quiet gate output, pre-review reuses the gate result) wait for his answer.

- 2026-10-05: MiniMax-M3 has no effort variants; a launch with `effort: low` fails with no reply. `effort: default` works (tested). T-0194 and T-0195 now say `effort: default`. Noted in `docs/LEAD_HANDOFF.md`.

- 2026-10-05: **main's history compacted** (Julio's request): 1,146 commits became 227, one per task; the final tree is identical, the 14 release tags `v0.1.0`..`v0.1.13` were re-created (same message and date) on the matching new commits and force-pushed; main force-pushed with a lease on the old sha `e80dfa25`. Backups: local branch `backup/main-pre-compact` and `~/.zilar-lead/compact/main-pre-compact.bundle` (verified). Untouched: `t0113-orig`, `archive/*`, `spike/T-0118-push`, old detached worktrees. Gate PASS on the new main. Commit hashes quoted in older task files and Reviews point to the old history (still in the backup).
- 2026-10-05: merged T-0173 (Effect 4.0 spike, `docs/EFFECT_GUIDE.md`) after a lead nits round; a second power cut overnight lost nothing.
- 2026-10-04: merged T-0196 (the doctor), T-0187 (mobile sticker packs; `addStickerFavorite` deferred to the first star button) and T-0188 (mobile owner integrations), all with emulator smoke PASS for the mobile ones.
- 2026-10-04: Julio: easy exact tasks move to `minimax-coding-plan/MiniMax-M3` (his subscription) to spend less on Muse; pre-reviews stay on Muse. `lead switch-model` back to Muse if one needs more than 2 fix rounds.
- 2026-10-04: merged T-0199 (pre-review follow-ups) and T-0198 (state writes re-read the file first).
