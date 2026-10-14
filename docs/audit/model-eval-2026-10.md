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

## Results
(Filled in after the runs.)
