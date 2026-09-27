# Lead playbook: how the boss Claude runs Galena

This is for a Claude instance acting as **lead** (the "boss") on Galena, or on any project run the same way. It covers how to plan work, run cheap worker agents, review what they produce, merge it, and keep Julio in the loop. Everything here comes from what actually worked, and failed, while building M0 and M1 (tasks T-0001 to T-0025, 2026-09-27/28).

Read it fully once. After that, use §4 (the loop) and §15 (gotchas) as your checklist.

---

## 1. Roles and authority

| Who | Does | Never does |
|---|---|---|
| **Julio** (owner) | Decides product, style and architecture. Uses the app and reports bugs. Approves anything risky. | Is not your debugger. Don't make him run commands you can run yourself. |
| **You** (lead Claude, Opus) | Plan, write task specs, launch and supervise workers, answer their permission requests, review, send fixes back, rebase, merge, push, keep the board, test live, report to Julio with screenshots. | Don't write the feature code yourself. Workers do the heavy lifting; you review. Small edits to docs, board and specs are fine. |
| **Workers** (DeepSeek V4.1 Flash via OpenCode 2, provider `opencode-go`) | One task each, in their own git worktree, following `AGENTS.md`. They write the Report and commit to the task branch. | Don't push, merge, rebase, switch branches, run `gh`/`sudo`, or touch files outside the task's Allowed files. |

**Julio's standing authorization** (2026-09-27, verbatim): *"control opencode2 to the fullest, run the merges, spawn as many deepseek 4.1 flash as you like with opencodego, and handle the control, you are claude opus and can work with this, if there is any, style, problem or anything, stop and ask me"*.

So you may, without asking:
- create worktrees and sessions
- approve or reject worker permission requests
- rebase, merge to `main` (fast-forward only), push `main`, and watch CI
- start and stop **your own** dev processes

**Stop and ask Julio** about:
- any style or UX choice that isn't already in `docs/design/ui-style.md`
- any architecture or security decision that isn't in `docs/PROJECT_PLAN.md` (decisions D1–D23)
- installing system software (brew, CocoaPods, Xcode components)
- anything that touches money, real accounts, or external services beyond GitHub for this repo
- a problem you can't solve after two honest tries

**Things Julio has settled. Don't reopen them:**
- **Stack:** XMPP (ejabberd) with our own React web app and Expo app. Matrix is rejected.
- **Privacy:** the Telegram model, with no E2EE for now.
- **UI:** as close to Telegram as possible.
- **OpenCode network setting:** he keeps the OpenCode service open on his network. Never propose changing that again.
- **Budget:** not a concern. First users are Julio and his friends.

**Order of work** (Julio: "continue with the work as intended"): follow the milestones in the plan. M1 is usable human chat, M2 is real AIs. Don't take shortcuts, such as wiring an AI in early, even when it's tempting.

## 2. Read these first (in this order)

1. `docs/PROJECT_PLAN.md`: the design, the decisions log (§3), and the self-improvement rules. Read the table of contents, then the sections you need.
2. `docs/design/ui-style.md`: the Telegram-like style guide. Every UI spec links to it. When you add a UI rule, add it here, not only in a task.
3. `AGENTS.md`: the worker rules. Workers load it automatically. You don't edit it lightly: it's the contract.
4. `work/BOARD.md`: tasks, statuses, follow-ups, and the Done table.
5. `work/README.md` (statuses) and `work/TEMPLATE.md` (task file layout).
6. The last two or three merged task files, to see the style of Specs, Reports and Reviews.
7. `git log --oneline -30` on `main`.

## 3. If two leads share this repo

Two boss Claudes on one repo will collide unless you split the work explicitly:
- **Claim before you start.** Put your name in the Notes column of `work/BOARD.md` (e.g. "lead: Claude B") and commit it to `main` before creating the worktree.
- **Stay out of the other lead's worktrees** (`../galena-T-XXXX`), sessions and monitors. `workers.txt` (see §6) records who launched what.
- **Split by area**, not by task number. For example, one lead takes mobile and the other takes server + web. Never let two tasks share Allowed files, even across leads.
- **Merge one at a time.** Before merging, `git pull --ff-only` on `main`, then rebase the task onto it. If a push is rejected, pull and rebase again; never force-push.
- **Leave the live stack alone** (§12). It may be serving Julio.

## 4. The loop (the whole job, step by step)

```
pick ─► spec ─► launch ─► watch ─► (permissions) ─► DONE ─► review ─┬─► approved ─► rebase ─► merge ─► push ─► CI ─► cleanup ─► board ─► tell Julio
                                                                    └─► changes requested ─► Review section + prompt the same session ─► watch …
```

1. **Pick.** Take the next tasks from the board that don't depend on unfinished work. Run up to 2–4 workers in parallel, **only if their Allowed files don't overlap** (see §5).
2. **Spec.** Write `work/T-XXXX-name.md` from the template (§5). Commit it to `main` (`work: spec for T-XXXX (…)`), add the row to `BOARD.md`, and commit.
3. **Launch.** Run `launch.py` (appendix A). It creates the worktree + branch from `main`, then an OpenCode session with the permission rules (appendix C) and the standard prompt (appendix D). Put any files the worker needs but can't create in its worktree, such as a copy of `infra/.env`. **Never print the file's contents.**
4. **Watch.** Arm a Monitor running `oc-watch.py <session> <label>` (appendix B). It prints permission requests, reminds you after 3 minutes of pending, and prints `DONE` when the session goes idle. Monitors expire after 30 minutes, so re-arm them. One Monitor can wrap several watchers with `& … & wait`.
5. **Permissions.** Answer every request quickly, using the policy in §7. A worker blocks while a request is pending.
6. **DONE.** Check the front matter status:
   - `review` → review it.
   - `blocked` → read the question. Answer it yourself if it's within the plan; otherwise ask Julio.
   - still `in-progress` → the model stopped early. Prompt it to continue (appendix D).
7. **Review** (§8). Be thorough: this is where the value is.
8. **Changes requested** (§9): write the Review section, commit it on the task branch, and prompt the **same session** with a short message pointing to it. Go back to step 4.
9. **Approved** (§10): rebase onto `main` and re-run all checks, fast-forward merge, update `BOARD.md` (move the row to Done with a one-line summary), push, watch CI, and remove the worktree and branch.
10. **Tell Julio** (§11): a few lines on what's merged and what's next, plus screenshots for anything visual.

Keep the loop going until the board's current milestone is done, unless Julio says stop. If he says **"finish the subtasks, don't start more"**, finish the in-flight tasks (review, rounds, merge) and launch nothing new.

## 5. Writing a spec that a cheap model can execute

Flash-class models are good at executing precise instructions and bad at guessing. Every ambiguity in the spec turns into a review round later.

**Front matter:** `id`, `title`, `status: todo`, `milestone`, `branch: task/T-XXXX-short-name`, `model: opencode-go/deepseek-v4.1-flash`, `depends_on`, `estimate`.

**Sections**, always in this order:
- **Goal:** 2–4 sentences, and *why*. Quote Julio's bug report if the task comes from real use.
- **Read first:** exact paths, plus the relevant sections of the plan and style guide. Name the external docs to check, with versions (e.g. "ejabberd 26.07 `mod_muc_admin` `send_direct_invitation`: check the exact argument names").
- **Allowed files:** globs. Be generous inside the area and strict outside it. Say explicitly what is **not** allowed (e.g. "Not allowed: `packages/**`; if chat-core lacks something, ask in the Report"). `pnpm-lock.yaml` is allowed whenever deps change.
- **Allowed dependencies:** list them by name, with the install command if it's special (`npx expo install …`). Nothing else may be added.
- **What to build:** numbered items, each with its tests named ("Tests: after an optimistic send, when the echo arrives, the list row's status becomes `sent`"). Spell out edge cases and security rules, such as spoof checks and http(s)-only links.
- **Integration / visual check:** what to run live, and what to paste in the Report. For mobile: `npx expo run:ios --no-bundler`, start Metro in the background, **stop Metro at the end**, and put screenshots in `apps/mobile/screenshots/`.
- **Acceptance criteria:** checkboxes that are verifiable.
- **Checks:** always the full set: `pnpm install`, `format:check`, `lint`, `typecheck`, `test`, `build`.
- **Out of scope:** what they must not do yet.

**Rules that saved rounds:**
- If the dev stack is running for Julio, say so in the spec: *"You may run integration tests against the running stack at 127.0.0.1. Never run `pnpm infra:up`, `infra:down` or `infra:reset`, and never stop any running process."* Also add the matching deny rules (appendix C, the "live stack" extras).
- Give UI tasks a reference: the style-guide section, plus "match the behavior of the web version in T-00XX".
- Put shared logic in shared packages (`@galena/chat-core`, `@galena/protocol`, `@galena/xmpp-core`) and tell each app to consume it, not duplicate it.
- Size: 1–2 days of human work at most. If a spec has more than ~6 build items, split it.
- Don't let two parallel tasks touch the same package. Sequence them with `depends_on`.

## 6. Launching workers with OpenCode 2

Facts (OpenCode v2.0.12):
- `opencode2 api <operationId> [--param k=v] [-d JSON]` talks to Julio's running OpenCode service.
- **Output gets truncated on pipes.** Redirect it to a file, then read the file.
- `session.create` body: `{"title", "agent":"build", "model":{"providerID":"opencode-go","id":"deepseek-v4.1-flash"}, "location":{"directory": <worktree>}, "permissions": [rules…]}`. The response has `data.id` (`ses_…`).
- **Permission rules:** `{"action":"shell","resource":"<glob>","effect":"allow|ask|deny"}`. The **last match wins**, so put general rules first and exceptions after them. The command tool's action is **`shell`, not `bash`**; rules with `bash` silently never match. Verify new rules with a harmless test (e.g. deny `echo *`, ask `date *`).
- `session.prompt --param sessionID=… -d '{"text": "…"}'` blocks until the turn ends, so run it detached (`nohup … &`, or `Popen(start_new_session=True)`).
- `session.message.list --param sessionID=… --param limit=2 --param order=desc`: newest first. An entry with `type: "idle"` means the run ended, and `outcome` tells how.
- `session.permission.list --param sessionID=…` lists pending requests: `id`, `action`, `resources`.
- `session.permission.reply --param sessionID=… --param requestID=per_… -d '{"decision":"once|always|reject","message":"…"}'`.
  - Use **`once`**. Don't use `always`: it persists beyond this task.
  - A `reject` with a helpful `message` is how you steer the worker.
- **Julio can watch any worker live** with `cd ../galena-T-XXXX && opencode2 -s <session>`. Put that line on the board.

`launch.py` (appendix A) records `TASK SESSION WORKTREE` in `workers.txt` in your scratch folder. Keep that file: you need the session ids to send later rounds.

## 7. Permission policy (answer within minutes)

| Request | Decision |
|---|---|
| `curl` to `127.0.0.1` / `localhost` (health, local API) during an integration task | `once` |
| `curl` / `wget` to docs sites or package registries, to read docs | `once`, if it's relevant to the spec |
| `npx expo install <dep listed in the spec>`, `npx expo run:ios --no-bundler`, `npx expo start` for the visual check | `once` |
| `npx <anything else>`, `pnpm dlx` | Usually `reject`, with a message naming the allowed alternative (`pnpm exec …`, or the devtools package) |
| `docker ps`, `docker compose … logs` | Allowed by the extras when a live stack is running. Otherwise `once`. |
| `docker compose up/down/stop/restart`, `pnpm infra:*`, `kill`, `pkill` while Julio uses the stack | `reject`: "The stack is serving Julio; test against it as it is." |
| `rm -rf` inside the worktree, for build output | `once`. Outside the worktree: `reject`. |
| Reading `.env` files outside its worktree, or anything under `~` | `reject`. Explain where its copy is and to not print values. |
| `brew`, `sudo`, system installs | `reject`, and tell Julio if it's actually needed. |

Real example of a steering reject:
```json
{"decision":"reject","message":"Not needed: the lead copied the matching local dev infra/.env into YOUR worktree (infra/.env). Use it as it is, do not look outside your worktree, do not print its values, and do not run infra:reset."}
```

If a request sits pending over 3 minutes (the watcher prints `STILL PENDING`), handle it right away. A missed permission once stalled a worker for a long time.

## 8. Reviewing: the part that matters most

Work in the task's worktree. For each task:

1. **Read the Spec again, then the Report.** Note every claim in the Report: you will verify them.
2. **Scope check:**
   ```bash
   git -C ../galena-T-XXXX diff --stat main...HEAD
   git -C ../galena-T-XXXX diff --name-only main...HEAD   # every path must match Allowed files
   ```
   A file outside the allowed list is a finding, even if the change is harmless.
3. **Run every check yourself** and don't trust the Report. Write the output to log files so a truncated pipe can't hide a failure:
   ```bash
   for c in format:check lint typecheck test build; do
     if pnpm $c > "$S/$c-XX.log" 2>&1; then echo "$c PASS"; else echo "$c FAIL"; tail -30 "$S/$c-XX.log"; fi
   done
   ```
   Check the test count against the Report.
4. **Read every changed line** (`git diff main...HEAD -- <path>`), with this lens:
   - **Correctness:** does it do what the spec says, including the edge cases? Trace one real flow end to end.
   - **Security:**
     - injection (links: only http(s); T-0013 found `javascript:`)
     - auth gaps (T-0015: OTP gating, hashing, trusted origins)
     - privilege (T-0003: non-admin accounts must be JWT-only)
     - spoofing (only accept XMPP events from our own domains or server)
     - secrets in logs
     - replay of old events (T-0006)
   - **Protocol truth:** things that pass unit tests but fail against the real server. T-0016: real JIDs must come from the occupant roster. T-0021: xmpp.js 0.14 miscounted XEP-0198 acks.
   - **Tests:** do they test the behavior or just the mock? Would they fail if the feature broke? Are the named tests from the spec present?
   - **Honesty:** does the Report say what really happened? Are skipped parts admitted?
   - **Style:** matches the surrounding code, with no dead code, no `any`, no `@ts-ignore`, and no new deps outside the spec.
5. **Visual tasks:** open every screenshot (Read the PNG) and compare it with `ui-style.md` and with Telegram. Look closely at spacing, alignment, colors, and truncation. For example, the T-0023 review found a double space after "Dani:" in group previews. Also watch for false alarms: 5 of 10 avatars being red looked like a regression but was hash luck on short mock ids. Check before you report.
6. **Live test** when the task touches real data or XMPP: run it against the stack (§12) with the test accounts. Many real bugs only show up there:
   - the list status stuck on 🕐
   - your own typing echoed back by the MUC
   - raw JID localparts shown as names
7. **Look beyond the spec.** Julio explicitly likes it when you find bugs and propose better, more Telegram-like UI. Put small in-scope fixes in the review round, and bigger ones on the board as new tasks or follow-ups. Mention them to Julio.
8. **Write the Review section** in the task file, not in chat:
   ```markdown
   ## Review (written by Claude)

   **Verdict:** Round N: changes requested   |   Approved

   What you verified (checks with counts, screenshots, the live test).

   ### Findings
   1. **Short title** (`file.ts`). What's wrong, how you saw it, and exactly what to do, including the test to add.
   2. *(No change needed.)* Things you checked and accept, so the worker doesn't "fix" them.

   ### Follow-ups
   - Items moved to the board.
   ```
   Commit it on the task branch: `T-XXXX: review round N (…)`.

## 9. Review rounds

- Prompt the **same session** so it keeps its context (template in appendix D). Point to the Review section; don't restate everything in the prompt.
- Ask for a **"Round N"** part appended to the Report, with real results, and the status kept at `review`.
- Findings from live use that arrive mid-task (Julio reports a bug while the worker is still busy) go into a notes file in your scratch folder. Add them to the next round; don't interrupt a running turn.
- Most tasks needed 1–2 rounds. If a worker fails the same finding twice, narrow it down: give the exact function, the failing input, and the expected output. If it still fails, write a separate small task, or ask Julio whether a stronger model is fine for it.
- Never approve with a known bug "to fix later" unless it goes on the board as a follow-up and Julio isn't hitting it right now.

## 10. Rebase, merge, push, clean up

Workers can't rebase or merge, so you do it:

```bash
cd ../galena-T-XXXX
git rebase -q main
# Lockfile conflict (common when two tasks added deps):
#   git checkout --ours pnpm-lock.yaml && pnpm install && git add pnpm-lock.yaml && git rebase --continue
#   (during a rebase, "--ours" is main's side; pnpm install then re-adds this branch's deps)
pnpm install --frozen-lockfile        # must pass, or the lockfile is wrong
# Re-run the full check loop from §8. The merge result is what counts.

cd ../galena                          # main checkout
git merge --ff-only -q task/T-XXXX-name
# Edit work/BOARD.md: remove the row from the active table and add it to Done with a one-line summary
# (e.g. "(2 rounds: fixed javascript: link injection)") and the date. Set the task file's status: merged.
git commit -qam "board: T-XXXX merged"
git push -q origin main
gh run list --limit 1 --commit "$(git rev-parse HEAD)"   # watch it until it's completed; a red CI is your job to fix
git worktree remove ../galena-T-XXXX && git branch -d task/T-XXXX-name
```

**Exception:** don't remove a worktree whose processes are serving Julio's live stack. Right now that's `../galena-T-0024`: the server, Vite and the test bridge run from it.

## 11. Talking to Julio

- He follows along from his phone (Remote Control), often away from home. Keep messages short: what merged, what's in progress, anything you need from him, and what's next.
- **Send screenshots proactively** for anything visual: send the file (SendUserFile when it's available), and also save it in the repo or your scratch folder. He loves seeing progress.
- He sometimes writes in Spanish, including inside Galena chats. Answer in the language he used, in English by default.
- When he reports a bug from real use, reproduce it live, turn it into a task (or a round on an in-flight task), and tell him which one.
- When something is blocked on him (an Apple Developer account, installing CocoaPods, a style call), ask one clear question with options, then keep working on other things.
- Report outcomes faithfully. "Tests fail: X" beats a vague "almost done".

## 12. The local dev stack and live testing

- **Infra:** `pnpm infra:up` / `infra:smoke` / `xmpp:e2e` (Postgres 18 + pgvector, ejabberd 26.07, LiteLLM 1.102.1 pinned by digest). There's no MinIO: its images were deleted on 2026-09-11, so uploads use ejabberd's upload volume for now.
- **Ports:**
  - **3000 belongs to Julio's own Next.js app.** Never use it.
  - The Galena server runs on **3188**.
  - Vite runs on **5173**, with `GALENA_API_URL=http://localhost:3188` for its `/api` proxy.
- **Start commands** (from the worktree that serves the live stack, with logs in your scratch folder):
  ```bash
  (cd apps/server && PORT=3188 nohup pnpm exec tsx --env-file=.env src/index.ts > "$S/srv.log" 2>&1 &)
  (cd apps/web && GALENA_API_URL=http://localhost:3188 nohup pnpm exec vite --port 5173 --strictPort > "$S/web.log" 2>&1 &)
  ```
- **Sign-in codes:** in dev, the server logs `OTP for <email>: <code>`. A Monitor on the server log with `grep -oE "OTP for [^ ]+: [0-9]{6}|ERROR.*|\"level\":50.*"` gives you codes and errors. Never paste codes or invite tokens into commits or docs.
- **Test accounts:** "Ana (test)" and "Claude (test)". Their cookie jars live in the scratch folder, with `curl -b/-c`.
- **The bridge:** a temporary script, `packages/xmpp-core/src/zz-bridge.ts`, in the live worktree. **It is untracked: never commit it.** It keeps "Claude (test)" online, so Julio can chat with you inside Galena:
  - it appends inbound messages to `inbox.log` (watch it with a Monitor on `^IN |STATUS (offline|reconnecting)`)
  - it sends each line appended to `outbox.jsonl` (with typing first)
  - it sends displayed markers and joins groups at start

  Run it with `pnpm --filter @galena/devtools exec tsx ../xmpp-core/src/zz-bridge.ts <scratch> <cookie-jar>`. Scripts must live inside a package to resolve `@xmpp/client`.
- **Screenshots without the Chrome extension:** use the iOS Simulator's Safari.
  ```bash
  xcrun simctl openurl <udid> http://localhost:5173
  xcrun simctl io <udid> screenshot out.png
  ```
  Simulators: iPad `A3E0C081-CEA4-453B-ABA1-23EE7D044E54`, iPhone `DB167CD4-BDCE-4E04-BC5E-85EE868A6AD8`. For the mobile app: `npx expo run:ios --no-bundler`, plus Metro.
- **Never** stop, reset or restart the stack while Julio is using it unless he agrees. Workers get deny rules for it (appendix C).

## 13. Worker prompt conventions

- The first prompt is standard (appendix D). The worker reads the task file and `AGENTS.md` itself; don't paste the spec into the prompt.
- Follow-up prompts are short and point to a file section. Always end them with: run every check, append "Round N" to the Report, keep `status: review`, and commit with the `T-XXXX:` prefix.
- If the model stops in the middle of a task, send a nudge: "Continue the task in work/T-XXXX…md from where you stopped. Finish every item, run every check, fill in the Report, set status: review and commit."

## 14. Memory and docs hygiene

- New UI rules go in `docs/design/ui-style.md`. New decisions go in the plan's decisions log. A task file is not the place for either.
- Keep `BOARD.md` accurate at all times. It's what Julio and the other lead look at.
- Put scratch artifacts (logs, cookie jars, screenshots, notes) in your scratch folder, never in the repo, unless a task asks for them (e.g. `apps/mobile/screenshots/`).

## 15. Gotchas (each one cost time)

1. **Permission rules:** the action is `shell`, not `bash`. The last match wins.
2. **`opencode2` output is truncated on pipes:** always redirect it to a file.
3. **zsh quirks:**
   - `set -- $pair` doesn't word-split.
   - `echo ====` fails with "= not found" (`=word` expansion), so quote it.
   - Globs with no match are errors.
4. **Monitors expire after 30 minutes.** Re-arm them, including the stack and bridge monitors.
5. **Stalled workers:** a missed permission request stalls a worker silently. The watcher's `STILL PENDING` line exists for this.
6. **Lockfile conflicts on rebase:** see the recipe in §10. Always verify with `--frozen-lockfile`.
7. **Port 3000 is Julio's.** Galena uses 3188 and 5173.
8. **Scripts outside the repo can't resolve workspace deps.** Put them inside a package and run them with the devtools `tsx`.
9. **Real-use XMPP bugs:**
   - MUC reflects your own chat states and markers to you.
   - Occupant nicks aren't real JIDs; resolve through occupant-id and the roster.
   - xmpp.js 0.14 has two XEP-0198 counter bugs, fixed by our own counter (T-0021).
10. **Better Auth behind a proxy:** it needs `advanced.ipAddress` configured (a board follow-up for deployment).
11. **Hashes on tiny samples cluster.** Don't file a "colors are broken" bug without computing the distribution first.
12. **Stash:** the git stash is shared across worktrees and sessions. Use WIP commits instead.

## 16. State snapshot (2026-09-28, when this was written)

- **Merged:**
  - M0 foundations: monorepo, infra, XMPP accounts and rooms, protocol, the OpenCode driver, the server foundation, auth, xmpp-core, provisioning
  - web and mobile chat shells, web polish
  - the SM ack fix
  - contacts, groups and chats
  - **the web app on real data** (T-0024), which Julio has used live
- **In flight:**
  - **T-0023** mobile polish: round 1, fixing the double space in group previews.
  - **T-0025** real-use fixes: the list status stuck on sending, XEP-0249 invites, roster pushes, live list refresh, the big-emoji sender name. Its round 2 must add two live bugs:
    - Your own typing is shown to you in groups. Ignore `fromJid === me.jid` for typing and displayed markers.
    - Names fall back to the raw JID localpart. Resolve names from group members and occupants, and fall back to "Someone".
- **Next, after those** (the board's planned rows):
  - the mobile app on real data (mirror T-0024)
  - the LiteLLM spike (T-0007)
  - the voice spike (T-0010)
  - the GitHub App spike (T-0009)
  - then M2: real AIs (gateway, listener, AI profiles, BYOK)
- **Temporary things to remove eventually:**
  - `zz-bridge.ts` / `zz-ana.ts` in `../galena-T-0024`
  - that worktree itself, once the live stack no longer runs from it

---

## Appendix A: `launch.py`

Save it in your scratch folder next to `rules.json`. Usage: `python3 launch.py T-0026 T-0026-name.md task/T-0026-name [extra-rules.json]`.

```python
#!/usr/bin/env python3
"""Create a worktree + OpenCode session for a task and send the first prompt.
Usage: launch.py TASK_ID TASK_FILE BRANCH [extra_rules.json]
Env: REPO (default: the Galena checkout), MODEL_PROVIDER, MODEL_ID."""
import json, os, subprocess, sys

task, task_file, branch = sys.argv[1], sys.argv[2], sys.argv[3]
extra = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else []
S = os.path.dirname(os.path.abspath(__file__))
repo = os.environ.get("REPO", "/Users/julio/personal-projects/galena")
wt = os.path.join(os.path.dirname(repo), f"{os.path.basename(repo)}-{task}")
model = {"providerID": os.environ.get("MODEL_PROVIDER", "opencode-go"),
         "id": os.environ.get("MODEL_ID", "deepseek-v4.1-flash")}

subprocess.run(["git", "-C", repo, "worktree", "add", "-q", wt, "-b", branch, "main"], check=True)
rules = json.load(open(f"{S}/rules.json")) + extra  # last match wins: extras override the base
body = {"title": f"{task} ({task_file})", "agent": "build", "model": model,
        "location": {"directory": wt}, "permissions": rules}
out_file = f"{S}/create-{task}.json"  # opencode2 truncates output on pipes
with open(out_file, "w") as f:
    subprocess.run(["opencode2", "api", "session.create", "-d", json.dumps(body)], stdout=f, check=True)
sid = json.load(open(out_file))["data"]["id"]

prompt = (
    f"You are an implementer on the Galena project. Do the task in work/{task_file} and follow AGENTS.md strictly (read both completely first).\n\n"
    f"Context: you are in a git worktree at {wt}, already on branch {branch}. Run pnpm install first. Other workers are working in parallel in other worktrees, so stay strictly inside your task's Allowed files.\n\n"
    f"When finished: fill in the Report section with real command results, set status: review in the task front matter, and commit to this branch with a message starting with \"{task}:\". Do not push, merge or switch branches (those commands are blocked).\n\n"
    "Some commands (curl, npx, docker, rm -rf) need approval from the lead; if one is rejected, read the rejection message and adapt.\n\n"
    "If you need a decision or something is unclear, set status: blocked, write the question in the Report, commit, and stop.")
subprocess.Popen(["opencode2", "api", "session.prompt", "--param", f"sessionID={sid}", "-d", json.dumps({"text": prompt})],
                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
with open(f"{S}/workers.txt", "a") as f:
    f.write(f"{task} {sid} {wt}\n")
print(f"{task} {sid} {wt}")
```

## Appendix B: `oc-watch.py`

Run it inside a Monitor: `python3 oc-watch.py <session> <label> 2>&1`. For several workers, use `python3 oc-watch.py A T-1 & python3 oc-watch.py B T-2 & wait`. It prints `PERMISSION …`, `STILL PENDING …` and `DONE outcome=…`.

```python
#!/usr/bin/env python3
"""Watch one OpenCode session: print new permission requests and exit when the run goes idle."""
import json, os, subprocess, sys, time

sid, label = sys.argv[1], sys.argv[2]
S = os.path.dirname(os.path.abspath(__file__))
TMP = f"{S}/watch-{sid}.json"
start_ms = int(time.time() * 1000) - 5000  # ignore idle markers from earlier turns
seen, first_seen, reminded = set(), {}, set()

def api(*args):
    # opencode2 truncates large output on pipes, so write to a file and read it back.
    try:
        with open(TMP, "w") as f:
            subprocess.run(["opencode2", "api", *args], stdout=f, stderr=subprocess.DEVNULL, timeout=30)
        with open(TMP) as f:
            return json.load(f).get("data")
    except Exception:
        return None

while True:
    now = time.time()
    for p in api("session.permission.list", "--param", f"sessionID={sid}") or []:
        if p["id"] not in seen:
            seen.add(p["id"]); first_seen[p["id"]] = now
            print(f"{label} PERMISSION {p['id']} {p['action']} {json.dumps(p.get('resources'))[:1500]}", flush=True)
        elif now - first_seen.get(p["id"], now) > 180 and p["id"] not in reminded:
            reminded.add(p["id"])
            print(f"{label} STILL PENDING {p['id']} (over 3 minutes)", flush=True)
    msgs = api("session.message.list", "--param", f"sessionID={sid}", "--param", "limit=2", "--param", "order=desc") or []
    if msgs and msgs[0].get("type") == "idle" and msgs[0].get("time", {}).get("created", 0) >= start_ms:
        print(f"{label} DONE outcome={msgs[0].get('outcome')}", flush=True)
        sys.exit(0)
    time.sleep(10)
```

Answer a permission request:
```bash
opencode2 api session.permission.reply --param sessionID=ses_… --param requestID=per_… \
  -d '{"decision":"once"}'            # or {"decision":"reject","message":"why + what to do instead"}
```

## Appendix C: permission rules

`rules.json` (the base for every worker):
```json
[
 {"action":"shell","resource":"curl *","effect":"ask"},
 {"action":"shell","resource":"wget *","effect":"ask"},
 {"action":"shell","resource":"npx *","effect":"ask"},
 {"action":"shell","resource":"pnpm dlx *","effect":"ask"},
 {"action":"shell","resource":"brew *","effect":"ask"},
 {"action":"shell","resource":"docker *","effect":"ask"},
 {"action":"shell","resource":"rm -rf *","effect":"ask"},
 {"action":"shell","resource":"rm -rf node_modules*","effect":"allow"},
 {"action":"shell","resource":"rm -rf dist*","effect":"allow"},
 {"action":"shell","resource":"rm -rf .turbo*","effect":"allow"},
 {"action":"shell","resource":"git push*","effect":"deny"},
 {"action":"shell","resource":"git merge*","effect":"deny"},
 {"action":"shell","resource":"git rebase*","effect":"deny"},
 {"action":"shell","resource":"git reset --hard*","effect":"deny"},
 {"action":"shell","resource":"git checkout main*","effect":"deny"},
 {"action":"shell","resource":"git switch *","effect":"deny"},
 {"action":"shell","resource":"git branch -D*","effect":"deny"},
 {"action":"shell","resource":"git worktree *","effect":"deny"},
 {"action":"shell","resource":"git remote *","effect":"deny"},
 {"action":"shell","resource":"git config *","effect":"deny"},
 {"action":"shell","resource":"git clean *","effect":"deny"},
 {"action":"shell","resource":"gh *","effect":"deny"},
 {"action":"shell","resource":"sudo *","effect":"deny"},
 {"action":"shell","resource":"ssh *","effect":"deny"},
 {"action":"shell","resource":"scp *","effect":"deny"},
 {"action":"shell","resource":"npm publish*","effect":"deny"},
 {"action":"shell","resource":"pnpm publish*","effect":"deny"},
 {"action":"shell","resource":"opencode*","effect":"deny"},
 {"action":"shell","resource":"security *","effect":"deny"}
]
```

Extras for a task that runs integration tests against **Julio's running stack**:
```json
[
 {"action":"shell","resource":"docker compose * logs*","effect":"allow"},
 {"action":"shell","resource":"docker ps*","effect":"allow"},
 {"action":"shell","resource":"docker compose * up*","effect":"deny"},
 {"action":"shell","resource":"docker compose * down*","effect":"deny"},
 {"action":"shell","resource":"docker compose * stop*","effect":"deny"},
 {"action":"shell","resource":"docker compose * restart*","effect":"deny"},
 {"action":"shell","resource":"pnpm infra:*","effect":"deny"},
 {"action":"shell","resource":"kill *","effect":"deny"},
 {"action":"shell","resource":"pkill *","effect":"deny"}
]
```

## Appendix D: prompt templates

**Review round:**
> Review round N is in work/T-XXXX-name.md (Review section, committed on your branch). Fix findings 1–K. [One line per finding only if it needs a hint.] Run every check, add a "Round N" part to your Report with real results, keep status: review, and commit with a message starting with "T-XXXX:". [Finding M needs no change.]

**Nudge after an early stop:**
> Continue the task in work/T-XXXX-name.md from where you stopped. Finish every item in the Spec, run every check, fill in the Report with real results, set status: review and commit with a message starting with "T-XXXX:".

**Answering a blocked question:**
> Answer to your question in the Report: … Proceed on that basis, keep within the Allowed files, and finish as usual.

Send any of them detached:
```bash
python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "…prompt…" > "$S/p.json"
nohup opencode2 api session.prompt --param sessionID=ses_… -d "$(cat "$S/p.json")" >/dev/null 2>&1 &
```
