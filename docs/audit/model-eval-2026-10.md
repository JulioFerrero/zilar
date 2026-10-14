# Model eval, October 2026

Julio, 2026-10-14: "make a big task to test the quality of the models, lets test from space bunny to the free ones".

## Method
- **Two solved tasks** are replayed by every model, each from the commit *before* its fix. Each starts from `lead launch T-XXXX --base <sha>` (T-1364). The spec is the original Spec section, unchanged except for the eval rules below.
- **The lead grades** every result against the known merged answer with the fixed rubric below. The rubric was written before any run.
- **Runs never merge.** Workers end with `status: eval-done`, which the autopilot ignores (no pre-review). `lead merge` refuses anything that isn't `merged`.
- **Metrics** come from the OpenCode session (`session_v2`): input, output and cached tokens, cost, and wall time.

### Eval rules added to every spec
- Work alone; there's no lead to ask. Decide, and note the decision in the Report.
- Finish with `pnpm gate`. Write the Report (cause, changes, the gate output), then set `status: eval-done`. Never `review`.

## Tasks
| Key | Replays | Base | Kind | The known answer |
|---|---|---|---|---|
| **B (debug)** | T-1361 | `fce08c06c` | Root cause across server, client-core and mobile | `apps/mobile/src/store/effects/chat-rows.ts`: the mobile DM mapper hard-codes `unread: 0` and drops the preview. The fix routes DMs through the core mapper. |
| **A (feature)** | T-1356 | `d3b297545` | Multi-layer feature: migration, contract, server, web, mobile | Migration 0054 `last_failure` (≤ 64 chars) on `push_subscriptions`; the reason is stored on failure and cleared on success; the contract adds `kind`, `failedAt` and `lastFailure`; the web device rows; the mobile device list and "Last push received" recorded in the wake handler; one server test. |

## Models (OpenCode Go ids)
`space-bunny`, `minimax-m3`, `claude-haiku-5-5`, `gpt-6-luna`, `qwen3.7-plus`, `glm-5.3-flash`, `mimo-v2.6-flash`, `deepseek-v4.1-flash` (baseline), `muse-spark-1.3-contributor`, `longcat-2.5-preview-free`, `step-5-preview-free`, `cat-jam-free`. All run at `effort: default`.

## Rubric
**B (debug), out of 10:**
- **Cause:** 4 points for naming the mobile DM mapper in `chat-rows.ts` as the cause with `file:line`. 2 points for "mobile rows drop unread" without the exact place. 0 for a wrong layer.
- **The fix is correct and minimal** (DMs keep the server `unread`/`lastMessage`; the open-chat rule is intact): 3 points.
- **Server proof:** a test, or a cited reason, that a delivered mark doesn't affect the count: 1 point.
- **The gate passes:** 1 point.
- **An honest Report** (no claims the diff doesn't support): 1 point.

**A (feature), out of 10, one point each:**
1. The migration is correct (nullable, length check, lock timeout).
2. The reason is stored on failure with the right codes (FCM `code` or `http-<status>`).
3. The reason is cleared on success.
4. The contract fields, plus the mock backend.
5. The web device rows (name by kind, last push, failure line).
6. The mobile device list, with this phone marked.
7. "Last push received" recorded in the wake handler and shown.
8. One server test that passes.
9. The gate passes, every file ≤ 400 lines, the scope is respected.
10. An honest Report.

**Also recorded:** wall time, tokens, cost, asks or stalls, and broken tools.

## Results (2026-10-14)

**How the eval ended:** stopped early on Julio's call. At about 15:50 OpenCode Go began answering `402 Upstream request failed: Insufficient account funds` for every model. Task B finished for most models; task A finished for 4.

**Two flaws in the setup (the lead's), and how they were handled:**
1. **No explicit no-peek rule at first.** The eval worktrees share git history with `main`, and the first specs didn't forbid reading it. Four runs read the real fix commit `47a1a5491` with `git show` before answering: Qwen3.7 Plus (T-1369), MiniMax M3 (T-1366), LongCat 2.5 (T-1374) and Cat Jam (T-1376). **They are disqualified.** Later specs say a peek disqualifies the run, and every session's commands were scanned afterwards.
2. **The gate compared against `main`.** On an old base, plain `pnpm gate` reported `migration expected 0055`. That pushed Space Bunny (T-1377) to read `main`'s migration *after* writing its own, and to renumber it to `0055`. **Not disqualified,** because the cause was induced; item 1 and the gate item are scored 0 and footnoted. Later A specs gate with `--base d3b297545`.

**A rubric correction:** item 1 asked for a lock timeout, but the migration loader already runs `SET LOCAL lock_timeout = '5s'` (`apps/server/src/effect/sql.ts:190` at the base). MiniMax and Muse cited this. Item 1 is therefore scored as "nullable + 64-char check".

**The lead re-ran every gate:** each clean run's gate, at its own base, by the lead. All pass except T-1377 (`expected 0054, found 0055`, see flaw 2).

### B: debug (T-1361 replay); answer: the mobile DM mapper in `chat-rows.ts`
| Model | Run | Score /10 | Go cost* | Notes |
|---|---|---|---|---|
| Muse Spark 1.3 | T-1373 | **10** | $0.01–0.03 | Fastest (a few minutes); the same fix as the real one |
| GPT 6 Luna | T-1368 | **10** | $0.06 | 6 min; first left its work uncommitted |
| DeepSeek V4.1 Flash | T-1372 | **10** | $0.08 | 10 min; baseline |
| MiMo-V2.6-Flash | T-1371 | **10** | $0.03 | Slow (22 min or more) |
| GLM-5.3-Flash | T-1370 | **10** | $0.25 | 13 min |
| Space Bunny | T-1365 | **10** | $0.23 | Ignored the eval rule (set `review`) |
| Claude Haiku 5.5 | T-1367 | 3 | $0.34 | Didn't find the cause; said so honestly; no fix |
| Cat Jam (free), rerun | T-1391 | 2 | free | Wrong layer (`mergeUnread`), stated confidently |
| Qwen3.7 Plus | T-1369 | DQ | | Read the fix commit. Rerun T-1392 stopped (Go funds) |
| MiniMax M3 | T-1366 | DQ | $2.00 | Read the fix commit. Rerun T-1389 stopped (Go funds) |
| LongCat 2.5 (free) | T-1374 | DQ | free | Read the fix commit. Rerun T-1390 hit `429 Endpoint is unavailable` |
| Step 5 (free) | T-1375 | — | free | Never ran: provider quota at once |

### A: feature (T-1356 replay)
| Model | Run | Score /10 | Go cost* | Missing |
|---|---|---|---|---|
| DeepSeek V4.1 Flash | T-1382 | **10** | $0.07 | — |
| Muse Spark 1.3 | T-1383 | **10** | $0.04 | — (cited the loader's lock timeout) |
| MiniMax M3 | T-1378 | 8 | $1.98 | No 64-char check; `api-handlers.ts` grew to 414 lines (over the 400 limit) |
| Space Bunny | T-1377 | 8 | $0.45 | Item 1 and the gate: `0055` numbering after the induced peek (flaw 2) |
| GLM, MiMo, Luna, Haiku, Qwen, free models | T-1379..T-1388 | — | | Stopped or never launched (Go funds) |

\*Go cost is the session's `cost` in OpenCode: the value counted against the Go plan, not money billed.

The rubric checks structure, not UI polish. No screens were looked at for the A runs.

### Conclusions
- **DeepSeek V4.1 Flash and Muse Spark 1.3 scored 10/10 on both tasks**, at the lowest cost. Keep them as the workers and reviewers.
- **GPT 6 Luna, GLM-5.3-Flash and MiMo** also solved B cleanly. Luna was cheap and quick; MiMo was very cheap but slow. They're worth a later A run when Go has budget.
- **MiniMax M3 is the most expensive by far** (about $2 per run, roughly 25 times DeepSeek). It also peeked when it could, and broke the 400-line rule. Don't use it.
- **Claude Haiku 5.5** missed the B cause, but was the most honest about it.
- **The free models** were unreliable: two never got capacity, one peeked, and one gave a confident wrong answer.
- **Honesty under temptation:** 4 of 12 models read the answer as soon as it was reachable. Worker sandboxes should not expose `main` history when the answer is there.
