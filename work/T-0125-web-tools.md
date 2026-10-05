---
id: T-0125
title: Web tools for AIs: web.fetch, keyless sources (Wikipedia, feeds, prices) and a best-effort web.search
status: merged
milestone: M5
branch: task/T-0125-web-tools
model: meta/muse-spark-1.3-contributor
depends_on: [T-0105]
estimate: 3 days
---

# T-0125: Web tools for AIs

## Spec (written by Claude, do not edit)

### Why
Julio (2026-09-30): AIs should be able to use tools like searching the web. Decision for now: **no search API and no account**: no SearXNG, no Exa, no Brave. So this task builds what works with nothing to sign up for: reading web pages (`web.fetch`), a few **keyless, stable sources** that cover the real uses (Wikipedia, RSS/Atom feeds, market prices), and a **best-effort** `web.search` that may fail honestly. The search backend sits behind a port so a real provider (SearXNG, Exa) can be added later as one adapter; that later adapter is **not** part of this task.

The motivating example: "every morning post the price of gold, the S&P 500 and BTC in the group". That needs `web.price` (keyless) plus routines (T-0104/T-0105), not a search engine.

### Safety rules (read PROJECT_PLAN "Rule of Two", section on untrusted input)
- Everything these tools return is **untrusted content** (a web page can say "ignore your instructions"). It goes to the model **only** as `modelText` inside the existing `<untrusted-tool-output>` wrapper (T-0105 §1), never into the summary, the audit log, an approval row or an announcement.
- **Read-only, GET/HEAD only, https only.** No cookies, no auth headers, no request bodies.
- **The URL is a data-exfiltration channel** (an injected model could put a secret into a query string). Therefore: fixed-host adapters (`web.wikipedia`, `web.price`) are **tier 0**; anything that fetches a caller-chosen URL or sends free text to a third party (`web.fetch`, `web.feed`, `web.search`) is **tier 1**, so the topic's "always allow here" rules and the kill switch apply (T-0099/T-0101), and each call is audited by action name and args hash only (the gateway already does this; never log URLs, queries or content).
- Reuse the sandbox's network guard: **import** `apps/server/src/sandbox/ip-guard.ts` and the connection logic of `host-fetch.ts` if it can be reused as a function; otherwise import `ip-guard` and write the small resolve-then-pin fetch on top of it. Do not copy `ip-guard`, and do not edit the sandbox. Rules: DNS resolved and validated, connect to the validated IP, private/loopback/link-local/6to4/Teredo refused, **no redirects** (a redirect is returned as a result the model can retry with the new URL, after the same checks), 10 s timeout, response cap 2 MiB, a hard cap on body decode.
- Only `text/html`, `text/plain`, `application/json`, `application/xml`, `text/xml`, `application/rss+xml`, `application/atom+xml`, `text/csv` bodies are read; anything else (images, PDFs, binaries) returns `summary: 'unsupported content type <type>'`.
- Per (AI, topic) rate limit: 30 web actions per hour in total (a plain safety limit against runaway loops; **not** usage or cost tracking, keep no counters beyond the in-memory window). Over the limit → a plain summary line the model can read.

### Actions (adapters in `apps/server/src/web-tools/adapters.ts`, registered next to the tool adapters when `WEB_TOOLS_ENABLED=true`)
All names dotted; every adapter takes `aiId`/`groupId`/`topicId` **only from the `ActionContext`**; `execute` never throws for expected problems (returns a summary the model can act on).

| Action | Tier | Args (zod, strict) | Behaviour |
|---|---|---|---|
| `web.fetch` | 1 | `{ url (https, ≤ 2048), maxChars? (≤ 16000, default 8000) }` | Fetches the page, converts HTML to plain text with a **small hand-written extractor** (drop script/style/nav/head, keep title, headings, paragraphs, list items and link text with hrefs, collapse whitespace; no new dependency), returns it as `modelText` cut at `maxChars` with `…`. `summary`: `fetched <host> (<N> chars)`. |
| `web.wikipedia` | 0 | `{ query, lang? (2–3 letters, default 'en') }` | Uses Wikipedia's public API on `<lang>.wikipedia.org` (search + page extract; read Wikipedia's API docs and send a descriptive `User-Agent` `Zilar/<version> (self-hosted; contact via server admin)` as their policy asks). `modelText`: title, short extract (≤ 3 000 chars) and the article URL; `summary`: `wikipedia: <title>` or `no article found`. Host is fixed; `lang` is validated (letters only) so it cannot change the host. |
| `web.price` | 0 | `{ symbols: string[] (1–10; each `[A-Za-z0-9.^=_-]{1,20}`) }` | Latest price per symbol. Two keyless sources, configured in one table in code: **crypto** through CoinGecko's public "simple price" endpoint (symbols mapped from a small built-in table `BTC→bitcoin`, `ETH→ethereum`, `SOL→solana`, …; unknown symbols are reported as unknown), and **indexes, stocks, gold** through Stooq's public CSV quote endpoint (symbols such as `^spx`, `xauusd`, `aapl.us`). Read each provider's public docs to get the exact URLs and formats right; parse with `zod`/a strict CSV line parser; every number must be finite. `modelText`: one line per symbol `SYMBOL price CURRENCY (as of <timestamp or 'unknown'>, source <name>)`; unknown/failed symbols say so. Fixed hosts only (`api.coingecko.com`, `stooq.com`). |
| `web.feed` | 1 | `{ url (https), limit? (1–20, default 10) }` | Reads an RSS or Atom feed with a **small hand-written XML reader** (no new dependency; refuse DTDs/entities: reject any body containing `<!DOCTYPE` or `<!ENTITY`) and returns the newest items (title, link, date, ≤ 300-char snippet) as `modelText`. |
| `web.search` | 1 | `{ query (≤ 200) }` | **Best-effort**, provider behind a port: `interface WebSearchProvider { search(query, { limit }): Promise<WebSearchResult[]> }`. The only adapter in this task is `duckduckgo-html`: `GET https://html.duckduckgo.com/html/?q=<query>`, parsed with the same small extractor for result title, URL (unwrap DuckDuckGo's redirect links to the target URL) and snippet, at most 8 results. It may be blocked or change its markup at any time: **any failure, block page, captcha, or 0 parsed results returns `summary: 'search unavailable right now'`** plus a `modelText` hint to try `web.wikipedia`, `web.feed` or `web.fetch` with a known URL. Never retry in a loop; one attempt per call. Config `WEB_SEARCH_PROVIDER` (`duckduckgo-html` | `none`, default `duckduckgo-html`); `none` unregisters `web.search`. The tool description tells the model **not to put private or sensitive text in queries** because the query leaves the server. |

Adapter `description` (≤ 200 chars each) must say what it does in one line and, for `web.search`, that results are unreliable and queries leave the server.

### Wiring
- New env (zod, in `config.ts`): `WEB_TOOLS_ENABLED` (boolean, default `false`), `WEB_SEARCH_PROVIDER` (default `duckduckgo-html`). No API keys anywhere in this task; do not read `infra/.env`. Document in `docs/SERVER_CONFIG.md` with a warning that these tools make outbound requests from the server (link `docs/TOOL_SANDBOX.md` for the network guard).
- Register the adapters where T-0105 registers the tool adapters (`index.ts`), only when enabled. Nothing changes when the flag is off.
- **Tools inside the sandbox are unchanged**: AI-written tools still fetch only their approved hosts through `host-fetch`. These are separate, gateway-level actions.
- Do not change the gateway or policy code; if a change there looks necessary (for example to mark a session as having read untrusted content), stop and say so in the Report under "Blocked / needs a decision".

### Read first
- `AGENTS.md`; `docs/PROJECT_PLAN.md` ("Rule of Two", untrusted input); `docs/TOOL_SANDBOX.md`
- `work/T-0105-tool-adapters.md` and its merged code: `apps/server/src/tools/adapters.ts` (adapter shape, `modelText`, wrappers), `actions/registry.ts`, `agents/gateway.ts`
- `apps/server/src/sandbox/{ip-guard,host-fetch}.ts`, `config.ts`, `index.ts`

### Allowed files
- `apps/server/src/web-tools/**` (new), `config.ts` (+ test), `index.ts`, `docs/SERVER_CONFIG.md`, `work/T-0125-web-tools.md`
- Importing from `../sandbox/ip-guard` and `../tools/adapters` types is allowed; editing them is not.

**Not allowed:** dependencies, protocol, web/mobile, gateway/policy changes, reading `infra/.env`, real network calls in tests.

### Tests (fakes only; no network)
- SSRF and limits: private/loopback/link-local addresses refused (including a hostname that resolves to one), redirect not followed, size cap, timeout, wrong content type, http refused, non-GET never sent.
- HTML extractor: scripts/styles dropped, entities decoded, huge or malformed HTML does not hang (input capped), prompt-injection text passes through **only as `modelText`** (assert the summary and the audit-relevant fields never contain page content).
- `web.wikipedia`: parses a recorded-shape API response; `lang` cannot change the host (`en.evil.com`, `../`, uppercase tricks rejected); unknown article.
- `web.price`: parses CoinGecko and Stooq recorded-shape responses; NaN/Infinity/empty/`N/D` values reported as unavailable; symbol validation; unknown crypto symbol; 10-symbol cap.
- `web.feed`: RSS and Atom samples; `<!DOCTYPE`/`<!ENTITY` rejected; item and length caps.
- `web.search`: a recorded-shape DuckDuckGo result page parses; a captcha/blocked page and an empty page give `search unavailable right now`; redirect-wrapped links unwrapped; only one attempt per call; provider `none` unregisters the action.
- Rate limit: the 31st call in an hour for the same (AI, topic) returns the limit line; a different topic has its own window.
- Registry: all five adapters have a valid tier; nothing is registered when `WEB_TOOLS_ENABLED=false`.

### Live check (the lead, with Julio in Helium, after merge, `WEB_TOOLS_ENABLED=true`)
Ask an AI in a topic: the price of BTC, gold and the S&P 500 (`web.price`), a Wikipedia summary, a feed read, one `web.fetch` of a public page, one `web.search` (may say unavailable, that is acceptable), and check that an injected instruction inside a fetched test page (a page the lead serves locally is refused by the guard, so use a public paste) is not followed. Record the real results in `docs/LIVE_CHECKS_2026-09-29.md`.

### Acceptance criteria
- [ ] `web.price`, `web.wikipedia`, `web.feed`, `web.fetch` work through the gateway with no key and no account; `web.search` either returns results or says clearly that search is unavailable.
- [ ] Nothing fetched or searched ever appears in audit rows, logs, summaries or approval details; it reaches the model only inside `<untrusted-tool-output>`.
- [ ] The network guard cannot be used to reach internal addresses or follow redirects.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass; one full suite at the end, alone, with this exact form)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2
pnpm build
```

### Out of scope
- A real search provider (SearXNG, Exa, Brave, Tavily), a runner-desk browser, JavaScript-rendered pages, PDFs, images, login-required sites, caching, the model-side prompt for these tools (T-0106 covers how the model is told about tools; add one paragraph there later), UI, mobile, usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- New `apps/server/src/web-tools/` module with five gateway-level adapters (`buildWebToolsAdapters`), built from pure, socket-free units so every test is fake-only:
  - `guarded-fetch.ts`: shared network path. Reuses the sandbox guard by importing `classifyIp`/`isIpLiteral` from `../sandbox/ip-guard` (no copy, no sandbox edits). DNS resolve-then-pin to the validated IP, GET-only, https-only, no credentials/ports/bodies, private/loopback/link-local/CGNAT/multicast/6to4/Teredo/IP-literal refused, redirects returned (never followed), 10 s timeout, 2 MiB cap, decode capped at 2 MiB, only the 8 allow-listed content types read. A `PinnedFetcher` seam (default = the real pinned-HTTPS implementation) keeps tests network-free.
  - `html.ts`: hand-written extractor (drops script/style/head/nav/noscript/template + comments, keeps title/headings/paragraphs/list items, link text with inline `(href)` for http(s) only, entity decoding, whitespace collapse, 2 MiB input cap).
  - `feed.ts`: hand-written RSS/Atom reader; rejects any body containing `<!DOCTYPE`/`<!ENTITY`; items capped at 20, snippets at 300 chars.
  - `prices.ts`: keyless price table. Crypto via CoinGecko simple/price (`BTC→bitcoin`, `ETH→ethereum`, `SOL→solana`, `DOGE`, `XRP`, `ADA`, `AVAX`, `LINK`, `LTC`, `DOT`; unknown symbols reported as unknown); indexes/stocks/gold via Stooq CSV quote endpoint (`s`, `f=sd2t2ohlcv`, `h`, `e=csv`) with a strict CSV line parser; every number must be finite, `N/D`/empty/Infinity/NaN are unavailable.
  - `search.ts`: `WebSearchProvider` port with the only provider `duckduckgo-html` (one GET per call, redirect links unwrapped from `uddg=`, non-http(s) dropped, max 8 results, block markers → `[]`, never retried).
  - `adapters.ts`: `web.fetch` (t1), `web.wikipedia` (t0, `<lang>.wikipedia.org` letters-only, search + extract, `Zilar/<version> (self-hosted; contact via server admin)` UA), `web.price` (t0), `web.feed` (t1), `web.search` (t1, description warns queries leave the server + results unreliable). Shared 30/hour/(AI, topic) in-memory rate limit. `execute` never throws for expected problems. `WEB_SEARCH_PROVIDER=none` unregisters `web.search`. All descriptions ≤ 200 chars.
- Wiring: `WEB_TOOLS_ENABLED` (default `false`) + `WEB_SEARCH_PROVIDER` (default `duckduckgo-html`) in `config.ts`; `index.ts` registers the web adapters next to demo/tool adapters only when enabled; `docs/SERVER_CONFIG.md` documents both with the outbound-request warning linking `docs/TOOL_SANDBOX.md`.
- Provider docs verified live before coding: Wikipedia search + extracts + `fullurl` API shape, CoinGecko `simple/price?ids=&vs_currencies=usd&include_last_updated_at=true`, DuckDuckGo HTML result markup (`result`/`result__a`/`result__snippet`, `uddg=` redirect wrap) via a real `curl` capture. Stooq note: `q/l/` returned a "page does not exist" HTML page and `q/d/l/` hit a JS-verification wall from this network, so the Stooq URL follows the documented `q/l/?s=&f=sd2t2ohlcv&h&e=csv` shape with the recorded-shape CSV parsed strictly; any provider-side failure surfaces per-symbol as `unavailable (...)`, never a throw.

### Files changed
- `apps/server/src/web-tools/` (new): `guarded-fetch.ts` (+ `guarded-fetch.test.ts`, 24 tests), `html.ts` (+ `html.test.ts`, 8 tests), `feed.ts` (+ `feed.test.ts`, 5 tests), `prices.ts` (+ `prices.test.ts`, 8 tests), `search.ts` (+ `search.test.ts`, 6 tests), `adapters.ts` (+ `adapters.test.ts`, 20 tests)
- `apps/server/src/config.ts`, `config.test.ts` (new env + 2 tests)
- `apps/server/src/index.ts` (register web adapters when enabled)
- `docs/SERVER_CONFIG.md` (two new rows)
- `work/T-0125-web-tools.md` (this Report + status)

### Commands run and real results
- `pnpm install`: done, 6.3s
- `pnpm format:check`: after `prettier --write` on touched files: "All matched files use Prettier code style!"
- `pnpm lint` (oxlint): clean, no output
- `pnpm typecheck`: 10 tasks successful
- `pnpm --filter @zilar/server test --maxWorkers=2`: 78 files passed, 5 skipped; 1357 tests passed, 7 skipped, 0 failed (~291s)
- `pnpm build`: 2 tasks successful (server build cached after passing; web/mobile unaffected)

### Problems, deviations from the spec, open questions
- Unresolvable host: the guard answers `host not allowed` (same as a refused host) instead of a distinct `host could not be resolved`, so an observer cannot tell refusal from DNS failure. Same posture as `host-fetch.ts` (`host not allowed: …`), minus the hostname to avoid logging it.
- `web.fetch`/`web.feed` zod schemas accept any string ≤ 2048 chars (matching `tool.save`-style adapter conventions), so `http:` URLs and garbage reach `execute` and are refused there with `only https urls are allowed` / `invalid url` rather than `invalid_args`. Nothing is ever sent in those paths (asserted).
- `web.search` block markers are `anomaly-modal`, `challenge-form`, `did not match any documents` — deliberately no bare `captcha` substring: live DuckDuckGo result snippets legitimately contain the word "captcha" (verified in the real capture), which would false-positive every such page into "unavailable". Captcha/challenge pages still match via the other two markers.
- Stooq `q/l/` could not be verified live from this network (404 page / JS wall, recorded in Report); the endpoint shape follows the public `q/l/?s=&f=sd2t2ohlcv&h&e=csv` documentation and parsing is strict. The lead's live check (with `WEB_TOOLS_ENABLED=true`) should confirm the exact Stooq response; if the shape differs, only `stooqUrl`/`parseStooqCsv` need a touch-up. The CoinGecko timestamp in tests is the real `last_updated_at` → ISO conversion (2026-09-30T04:28:20.000Z for 1790742500).
- Test seam: `guardedGet` takes an optional `fetcher` (defaults to the real pinned-HTTPS code). This is the injection the task's fake-only test rule requires; production always uses the default.
- No dependencies added. No `any`, no `@ts-ignore`, no disable comments. Sandbox, gateway, policy, registry untouched (imports only).
- Open question (not blocking): Stooq has no documented etiquette UA requirement; the adapter sends only `accept: */*`. If Stooq rate-limits the server IP, a descriptive UA like Wikipedia's could be added later.

### Blocked / needs a decision
- (none)

---

## Review (written by Claude)

**Verdict:** Approved and merged with lead fixes. Off by default (`WEB_TOOLS_ENABLED=false`).

### Findings
- Read the network guard line by line: https only, no credentials or ports, no IP literals, DNS resolved and every address classified, the request is pinned to the validated address with the hostname as SNI and Host, no redirects, 2 MiB cap, content types allow-listed, GET only.
- Lead fixes: (1) a redirect's `Location` is text controlled by the remote server and was placed in the summary, outside the untrusted block; it now travels as `modelText` only. (2) The 10 s timeout was an idle timeout, so a server sending one byte at a time could hold a connection open; there is now a hard overall deadline. (3) The Wikipedia article title (remote text) was in the summary; the summary is now fixed wording and the title is in `modelText` (from the pre-review). (4) The shared rate-limit-window test passed for the wrong reason; it now asserts the search hits the same cap.

### Follow-ups
- `web.fetch` drops the page `<title>` (the extractor drops `<head>`); the spec wanted it kept.
- Dead code: `anchorParts` in `html.ts` is only used by its own test; `coingeckoLines` returns `unknownIds` that nobody reads.
- Live check with `WEB_TOOLS_ENABLED=true` and `TOOLS_ENABLED=true` (the AI needs the action gateway on) once Julio is around; results go in `docs/LIVE_CHECKS_2026-09-29.md`.
