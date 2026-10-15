---
id: T-1616
title: "web.price works again and the AI sees each action's args: Stooq's CSV quote API is gone (404/403), so indexes, stocks and gold move to Yahoo's chart endpoint (tested 200 from the VPS); every action gets an argsExample the model sees in request_action, checked against its argsSchema"
status: merged
milestone: M5
branch: task/T-1616-prices-and-action-args
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1616: Working prices, and actions the model can call right

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 Julio asked his AI for the morning prices on live (`WEB_TOOLS_ENABLED` is on). It reported: `web.price` for BTC and gold failed (403/404), and `web.wikipedia` "rejected my args twice, so I need the right field name".

What the lead verified from the live server container:
- **Stooq's endpoint is gone.** `GET https://stooq.com/q/l/?s=xauusd&f=sd2t2ohlcv&h&e=csv` (`apps/server/src/web-tools/prices.ts:7-10`) returns 404 "The page you requested does not exist" for `xauusd` and `^spx`. Stooq's daily CSV (`/q/d/l/`) returns 403.
- **The replacement works.** `GET https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1d&interval=1d` and `…/chart/GC%3DF?…`, with `user-agent: Mozilla/5.0`, return 200 JSON with `chart.result[0].meta` (`currency`, `symbol`, `exchangeName`, …).
- **CoinGecko works** (`simple/price?ids=bitcoin`, 200) with Node's default fetch.
- **The model never sees argument names.** `request_action` lists each action only as `name — description` (`apps/server/src/agents/tools/definitions.ts:130-142`) and takes `args` as a free object (`:146-163`). A bad call comes back as just "invalid arguments" (`apps/server/src/agents/gateway/contracts.ts:321-332`).
  - `docs/audit/tool-args-schema-plan.md` §0 already records that the adapter `argsSchema` never reaches the model.
  - `web.wikipedia` wants `{ query, lang? }` (`apps/server/src/web-tools/wikipedia-adapter.ts:16-25`), but its description (`:105`) never says so.

### Facts (the lead read them on 2026-10-16)
- **`apps/server/src/web-tools/prices.ts`** (227 lines): `COINGECKO_HOST`, `STOOQ_HOST`, `MAX_PRICE_SYMBOLS = 10` and `PRICE_SYMBOL_PATTERN` (`:16-21`); `CRYPTO_IDS` (`:25`); `coingeckoUrl` (`:38`), `stooqUrl` (`:47`), `coingeckoLines` (`:81`), `parseStooqCsv` (`:131`), `splitCsvLine` (`:183`) and `stooqStamp` (`:223`).
- **`apps/server/src/web-tools/price-adapter.ts`** (103 lines): upper-cased crypto goes to CoinGecko, and everything else goes to Stooq as-is (`:17-19`); the args schema is `{ symbols: string[] }` (`:20-25`), the name `web.price` (`:31`).
- **`ActionAdapter`** (`apps/server/src/actions/registry.ts:104-130`) has `name`, `description`, `tier`, `argsSchema`, `describe`, …
- **The adapters with action names:**
  - web: `apps/server/src/web-tools/{fetch,feed,price,search,wikipedia}-adapter.ts`;
  - tools: `apps/server/src/tools/tool-adapters.ts` (320 lines) and `apps/server/src/tools/routine-adapters.ts` (238);
  - support: `apps/server/src/tools/adapter-support.ts`.

### Steps
1. **Prices: Yahoo replaces Stooq** (`prices.ts`, `price-adapter.ts`).
   - **The endpoint:** `YAHOO_HOST = 'query1.finance.yahoo.com'`, one `GET https://query1.finance.yahoo.com/v8/finance/chart/<encodeURIComponent(symbol)>?range=1d&interval=1d` per non-crypto symbol (at most `MAX_PRICE_SYMBOLS`), with `user-agent: Mozilla/5.0 (compatible; Zilar)`. Use the existing guarded fetch and rate limit, with the host fixed as Stooq's was.
   - **The parse:** `chart.result[0].meta.regularMarketPrice` (a finite number), `regularMarketTime` (unix seconds), `currency` and `symbol`. A non-null `chart.error`, a missing result or a non-finite number means "unavailable", as today.
   - **Aliases,** case-insensitive and before the lookup:
     - `SPX`, `^SPX`, `SP500` → `^GSPC`;
     - `GOLD`, `XAU`, `XAUUSD` → `GC=F`, labelled "gold (COMEX futures)";
     - `SILVER`, `XAG`, `XAGUSD` → `SI=F`;
     - `NDX`, `NASDAQ100` → `^NDX`;
     - `DJI`, `DOW` → `^DJI`;
     - a Stooq-style `.us` suffix is dropped (`aapl.us` → `AAPL`);
     - anything else passes through.
   - **Crypto (CoinGecko) is unchanged.**
   - **Remove the Stooq code and constants.**
   - **Log a failure:** for each provider failure, one `warn` line with `{ action: 'web.price', host, status }`, never content.
2. **Args examples for every action.**
   - Add `argsExample?: string` to `ActionAdapter`: a compact JSON object of valid args, at most 200 characters.
   - Give every `web.*`, `tool.*` and `routine.*` adapter one. For example: `web.price` `{"symbols":["BTC","^GSPC","GC=F"]}`; `web.wikipedia` `{"query":"Ada Lovelace","lang":"en"}`.
   - Wherever the registry lists actions for the model, pass `argsExample` through. `describeRequestAction` then renders each entry as `name — description Args: <example>`.
   - Make `denialReasonForModel('invalid_args')` read `'invalid arguments; use the Args shown for this action'`.
3. **Test:** for every registered adapter that has an `argsExample`, `JSON.parse(argsExample)` decodes with its own `argsSchema`. Put it in a new `apps/server/src/actions/args-example.test.ts`, and register the adapters the way the existing adapter tests do. Also add one pure test of the Yahoo meta parse and the aliases.
4. **Update `docs/AI_TOOLS.md`:** Stooq becomes Yahoo (`GC=F` for gold, `^GSPC` for the S&P 500).

### Tests
`args-example.test.ts` (step 3), plus the Yahoo parse and alias cases. Fix any existing test that asserted Stooq.

### Allowed files
- `apps/server/src/web-tools/prices.ts`
- `apps/server/src/web-tools/price-adapter.ts`
- `apps/server/src/web-tools/fetch-adapter.ts`
- `apps/server/src/web-tools/feed-adapter.ts`
- `apps/server/src/web-tools/search-adapter.ts`
- `apps/server/src/web-tools/wikipedia-adapter.ts`
- `apps/server/src/web-tools/adapters.test.ts`
- `apps/server/src/tools/tool-adapters.ts`
- `apps/server/src/tools/routine-adapters.ts`
- `apps/server/src/tools/adapter-support.ts`
- `apps/server/src/actions/registry.ts`
- `apps/server/src/actions/args-example.test.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `docs/AI_TOOLS.md`
- `apps/server/src/actions/gateway.ts`
- `work/T-1616-prices-and-action-args.md`

If listing actions for the model passes through another file (for example, where `listActions` is built), add it and say so in the Report.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/actions/args-example.test.ts src/web-tools/adapters.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **No Stooq host or URL remains** in `apps/server/src`.
- **Every `web.*`, `tool.*` and `routine.*` adapter has an `argsExample`** that its `argsSchema` accepts.
- **Every file stays within 400 lines.**
- **After the deploy,** the lead asks for `web.price` with `BTC`, `GOLD` and `SPX`, and all three return numbers.

---

## Report (written by the worker when done)

### What I did

**Prices: Yahoo replaces Stooq** (`prices.ts`, `price-adapter.ts`)
- Removed every Stooq constant, URL, CSV parser and helper (`STOOQ_HOST`,
  `stooqUrl`, `stooqStamp`, `stooqRowSchema`, `StooqQuote`, `parseStooqCsv`,
  `splitCsvLine`). No Stooq host or URL remains in `apps/server/src` (only
  comments that explain the old spellings/`.us` suffix).
- Added `YAHOO_HOST = 'query1.finance.yahoo.com'`, `yahooUrl(symbol)`
  (`…/v8/finance/chart/<encodeURIComponent(symbol)>?range=1d&interval=1d`) and
  `parseYahooChart(body)` reading `chart.result[0].meta` (`regularMarketPrice`
  finite, `regularMarketTime` unix seconds, `currency` default `USD`, `symbol`
  default empty). A non-null `chart.error`, a missing/empty `result` or a
  non-finite price is "unavailable".
- Added `resolveYahooSymbol(input)`, case-insensitive and before the lookup:
  `SPX`/`^SPX`/`SP500`→`^GSPC`; `GOLD`/`XAU`/`XAUUSD`→`GC=F` (labelled
  "gold (COMEX futures)" via `YAHOO_LABELS`); `SILVER`/`XAG`/`XAGUSD`→`SI=F`;
  `NDX`/`NASDAQ100`→`^NDX`; `DJI`/`DOW`→`^DJI`; a trailing `.us` is dropped
  (`aapl.us`→`AAPL`); anything else passes through.
- The adapter fetches one guarded GET per non-crypto symbol (at most
  `MAX_PRICE_SYMBOLS`) with `user-agent: Mozilla/5.0 (compatible; Zilar)`, the
  fixed host and the existing web rate limit. Crypto through CoinGecko is
  unchanged. Each provider failure logs one `console.warn` line
  (`{"action":"web.price","host":…,"status":…}`, status parsed from the fixed
  guarded-fetch summary, `null` when it carries none) and never content.

**Args examples for every action** (`registry.ts`, all adapters, `definitions.ts`, `contracts.ts`, `gateway.ts`)
- Added `argsExample?: string` to `ActionAdapter`, with a doc comment, the
  `ADAPTER_ARGS_EXAMPLE_MAX_LENGTH = 200` constant and a startup length check in
  `buildRegistry`.
- Gave every `web.*`, `tool.*` and `routine.*` adapter a compact, valid example.
- `listActions` (in `apps/server/src/actions/gateway.ts`) now passes
  `argsExample` through; `describeRequestAction` renders each entry as
  `name — description Args: <example>`; the `request_action` prose and the
  `buildTools`/`buildGroupTools` signatures were updated to match.
- `denialReasonForModel('invalid_args')` now returns
  `invalid arguments; use the Args shown for this action`.

**Tests**
- New `apps/server/src/actions/args-example.test.ts`: builds the web and
  tool/routine adapters as production does (placeholder `db`/`runner`; only
  `argsSchema`/`argsExample` are read), asserts every `web.*`/`tool.*`/`routine.*`
  adapter carries one, that each is ≤200 chars and decodes with its own
  `argsSchema` via `decodeActionArgs`, and that `buildRegistry` accepts them.
- New `apps/server/src/web-tools/adapters.test.ts`: pure tests of
  `parseYahooChart` (price/currency/time, defaults, `chart.error`, empty result,
  non-finite price, non-JSON) and all `resolveYahooSymbol` aliases.

**Docs:** `docs/AI_TOOLS.md` round 2 now says gold and the S&P 500 resolve
through Yahoo (`GC=F`, `^GSPC`) instead of Stooq.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/args-example.test.ts src/web-tools/adapters.test.ts`
  → 2 files passed, 38 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/tools/desk-definitions.test.ts src/approvals/rules.test.ts`
  → 2 files passed, 33 tests passed (the existing tests nearest the changed
  `definitions.ts`/`registry.ts`/`gateway.ts`).
- `pnpm gate` → `GATE PASS`:
  - `PASS install (frozen) (1.0s)`, `PASS format (1.2s)`, `PASS lint (1.5s)`,
    `PASS typecheck (3.2s)`, `PASS effect (0.8s)`, `PASS tests @zilar/server (7.9s)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - 17 changed files against main.

### Notes for the lead

- **Allowed files:** step 2 passes `argsExample` through `listActions`, which
  lives in `apps/server/src/actions/gateway.ts`. As the task allowed, I added
  that path to the Allowed files list and it is the only file outside the
  original list. Everything else is inside it.
- **Logging:** `WebToolsState` has no logger and `web-tools/shared.ts` was not
  in the Allowed files, so I could not thread the pino logger through without
  touching disallowed files. I used `console.warn(JSON.stringify({ action,
  host, status }))` inside `price-adapter.ts`. If you want pino, `shared.ts`
  needs a `logger` field and `startup/components.ts` must pass it — say the word
  and I'll do it in a follow-up.
- **HTTP status in the log:** `guardedGet` hides the numeric status for success
  and exposes it only inside the failure summary (`fetch failed with status
  404`), so `status` is parsed from that fixed wording and is `null` for
  failures without one (timeout, host not allowed, redirect without a
  `Location`). No response content is ever logged.
- **Gold label:** `GOLD` (and `XAU`/`XAUUSD`) resolve to `GC=F` and the line
  carries `gold (COMEX futures)`. `SILVER`→`SI=F` has no label, matching the
  spec's wording.
- **Yahoo not called live:** the tests are pure and call no external service, per
  AGENTS.md. The live check (`web.price` with `BTC`, `GOLD`, `SPX`) is yours
  after deploy; I could not verify the endpoint from here.
- No deviations from the spec other than the two notes above.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 4 nits, 1 follow-up.
- **What the lead checked:**
  - Stooq remains only in comments;
  - every `web.*`, `tool.*` and `routine.*` adapter has an `argsExample`, and the new `args-example.test.ts` decodes each one with its own schema;
  - `listActions` (`apps/server/src/actions/gateway.ts`, added under the spec's "another file" clause and reported) passes the example to `describeRequestAction`;
  - `invalid_args` now reads "invalid arguments; use the Args shown for this action";
  - every file is within 400 lines (`tool-adapters.ts` is 326).
- **Follow-up, not filed yet:** thread the pino logger into `WebToolsState`, so `web.price` failures don't use `console.warn`.
- **After deploy, the lead checks:** a direct call to the price endpoints from the server container.
