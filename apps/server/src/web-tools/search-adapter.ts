// T-0993: the `web.search` adapter, split out of `web-tools/adapters.ts` unchanged.
import { Schema } from 'effect';
import type { ActionAdapter, ArgsSchema } from '../actions/registry';
import { truncateChars } from '../text';
import {
  formatSearchResults,
  MAX_SEARCH_RESULTS,
  searchUnavailableText,
  type WebSearchResult,
} from './search';
import { MAX_SEARCH_QUERY_CHARS, withWebRateLimit, type WebToolsState } from './shared';

// `web.search`: best-effort search through the provider port. Tier 1:
// the query leaves the server, so the description warns the model not
// to put private or sensitive text in it. Any failure or 0 results is
// "search unavailable right now" with a hint at the reliable tools.
const webSearchArgsSchema = Schema.Struct({
  query: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SEARCH_QUERY_CHARS)),
});

export function webSearchAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.search',
    description:
      'Best-effort web search (unreliable); never put private or sensitive text in the query.',
    tier: 1,
    argsSchema: webSearchArgsSchema as unknown as ArgsSchema<unknown>,
    describe: (args) => {
      const parsed = args as { query: string };
      return { summary: `Search the web for "${parsed.query}"` };
    },
    execute: withWebRateLimit(state, async (args) => {
      const parsed = args as { query: string };
      // One attempt per call, never a retry loop: the provider returns
      // `[]` on any failure and the adapter answers "unavailable".
      let results: WebSearchResult[];
      try {
        results = await state.searchProvider.search(parsed.query, { limit: MAX_SEARCH_RESULTS });
      } catch {
        results = [];
      }
      if (results.length === 0) {
        return { summary: 'search unavailable right now', modelText: searchUnavailableText() };
      }
      return {
        summary: `search results for "${truncateChars(parsed.query, 80)}" (${results.length})`,
        modelText: formatSearchResults(parsed.query, results),
      };
    }),
  };
}
