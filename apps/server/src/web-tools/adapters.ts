// T-0125: the five gateway-level web tools. Registered next to the
// tool adapters when `WEB_TOOLS_ENABLED=true`; nothing is registered
// when the flag is off. Untrusted content (pages, feeds, prices,
// search results) reaches the model only as `modelText` inside the
// gateway's `<untrusted-tool-output>` wrapper — never in a summary.
//
// Tiers follow the exfiltration rule: fixed-host adapters are tier 0
// (`web.wikipedia`, `web.price` — the caller cannot choose where the
// request goes), everything that fetches a caller-chosen URL or sends
// free text to a third party is tier 1 (`web.fetch`, `web.feed`,
// `web.search`).
import type { ActionAdapter } from '../actions/registry';
import { webFeedAdapter } from './feed-adapter';
import { webFetchAdapter } from './fetch-adapter';
import { webPriceAdapter } from './price-adapter';
import { webSearchAdapter } from './search-adapter';
import { createWebToolsState, type BuildWebToolsAdaptersDeps } from './shared';
import { webWikipediaAdapter } from './wikipedia-adapter';

export {
  DEFAULT_FETCH_CHARS,
  DEFAULT_FEED_LIMIT,
  MAX_FETCH_CHARS,
  MAX_FETCH_URL_CHARS,
  MAX_FEED_LIMIT,
  MAX_SEARCH_QUERY_CHARS,
  MAX_WIKIPEDIA_EXTRACT_CHARS,
  WEB_ACTIONS_PER_HOUR,
  WEB_ACTION_WINDOW_MS,
} from './shared';
export type { BuildWebToolsAdaptersDeps, WebSearchProviderName } from './shared';

export { formatFeedItems } from './feed-adapter';
export { parseWikipediaExtract, parseWikipediaSearch, wikipediaHost } from './wikipedia-adapter';
export type { WikipediaArticle } from './wikipedia-adapter';

// Builds the web adapters. `searchProvider: 'none'` unregisters
// `web.search`; everything else is always registered when enabled.
export function buildWebToolsAdapters(
  deps: BuildWebToolsAdaptersDeps = {},
): ActionAdapter<unknown>[] {
  const state = createWebToolsState(deps);
  const adapters: ActionAdapter<unknown>[] = [
    webFetchAdapter(state),
    webWikipediaAdapter(state),
    webPriceAdapter(state),
    webFeedAdapter(state),
  ];
  if (deps.searchProviderName !== 'none') {
    adapters.push(webSearchAdapter(state));
  }
  return adapters;
}
