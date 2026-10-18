// The five gateway-level web tools, registered only when `WEB_TOOLS_ENABLED`.
// Untrusted content (pages, feeds, prices, search results) reaches the model only
// as `modelText` inside the gateway's untrusted wrapper, never in a summary.
//
// Fixed-host adapters are tier 0; anything that fetches a caller-chosen URL or
// sends free text to a third party is tier 1.
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

// `searchProvider: 'none'` unregisters `web.search`; everything else always runs.
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
