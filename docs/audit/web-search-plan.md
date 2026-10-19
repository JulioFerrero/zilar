# AI web search and fetch through providers (plan, 2026-10-19)

## Julio's decision (10-19, 08:50 UTC)
- An AI that runs on DeepSeek uses its own DeepSeek key for search and fetch, through DeepSeek's Search and Fetch APIs (`POST https://api.deepseek.com/v1/tools/search` and `/v1/tools/fetch`). Each costs $0.75 per 1,000 successful requests.
- An AI whose provider has no search or fetch gets an option to add a search or fetch integration (Brave or another provider).
- No DuckDuckGo scraping, and no page scraping for AI reading.

## Today (read at `24764738e`)
`apps/server/src/startup/components.ts:209-317` registers the AI web tools for every AI.

| Tool | Today | Plan |
| --- | --- | --- |
| `web.search` | scrapes DuckDuckGo's HTML page (`web-tools/search.ts`, `web-tools/shared.ts:60`); at most 8 snippets; a bot check returns "unavailable" | the AI's provider (W1), else an integration (W2) |
| `web.fetch` | our own GET plus HTML-to-text (`guardedGet` + `extractText`) | the AI's provider (W1), else an integration (W2) |
| `web.wikipedia`, `web.price`, `web.feed` | public APIs and feeds | unchanged; they call APIs, not scraped pages |

Not touched by this plan: link previews and card media (`link-preview/`, `card-media/`). They are message features and keep the local guarded fetch.

Live on 2026-10-19 (read-only query): one active AI, on a direct `deepseek` connection.

## Steps
- **W1, server only (T-2209).** A DeepSeek AI's `web.search` and `web.fetch` call DeepSeek with the AI's own key, which comes from `loadModelTarget` (`agents/gateway/model-target.ts`) by the action's `ctx.aiId`. Each successful request adds $0.00075 to the AI's `ai_usage.cost_usd`, so spend limits include it. Other AIs are unchanged until W2.
- **W2, integrations.**
  1. A D24 canvas first (web and phone): where the owner adds a search or fetch key (Brave Search, and one fetch provider), and how an AI with no source says so.
  2. Then the server: store the key like a provider connection, encrypted and owner-scoped.
  3. Then the web and phone settings twins.
- **W3, remove the scraping.** Delete the DuckDuckGo provider (`web-tools/search.ts` parsing, `duckduckgoProvider`, `WEB_SEARCH_PROVIDER`). Delete the local page reader behind `web.fetch`. An AI without a provider or integration answers "no web search set up: the owner can add one in Settings". W3 runs only after W2 is live, so no AI loses search in between.

## Later, not planned
The provider-native search of OpenAI, Anthropic, xAI and Google runs inside the model call, so it is a different mechanism. Spec it when one of those AIs exists.
