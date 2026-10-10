// T-0993: the `web.feed` adapter, split out of `web-tools/adapters.ts` unchanged.
import { Schema } from 'effect';
import type { ActionAdapter, ArgsSchema } from '../actions/registry';
import { parseFeed } from './feed';
import { guardedGet } from './guarded-fetch';
import {
  DEFAULT_FEED_LIMIT,
  failureResult,
  guardedOptions,
  hostOf,
  MAX_FEED_LIMIT,
  MAX_FETCH_URL_CHARS,
  withWebRateLimit,
  type WebToolsState,
} from './shared';

// `web.feed`: read one caller-chosen RSS/Atom feed. Tier 1: the URL is
// a data-exfiltration channel, like `web.fetch`.
const webFeedArgsSchema = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_FETCH_URL_CHARS)),
  limit: Schema.optional(
    Schema.Number.pipe(
      Schema.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(1),
        Schema.isLessThanOrEqualTo(MAX_FEED_LIMIT),
      ),
    ),
  ),
});

export function formatFeedItems(
  items: { title: string; link: string; date: string; snippet: string }[],
): string {
  return items
    .map((item, index) => {
      const head = `${index + 1}. ${item.title.length > 0 ? item.title : '(no title)'}`;
      const link = item.link.length > 0 ? `\n   ${item.link}` : '';
      const date = item.date.length > 0 ? `\n   ${item.date}` : '';
      const snippet = item.snippet.length > 0 ? `\n   ${item.snippet}` : '';
      return `${head}${link}${date}${snippet}`;
    })
    .join('\n');
}

export function webFeedAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.feed',
    description: 'Read the newest items of one public RSS or Atom feed.',
    tier: 1,
    argsSchema: webFeedArgsSchema as unknown as ArgsSchema<unknown>,
    describe: (args) => {
      const parsed = args as { url: string };
      return { summary: `Read the feed at ${hostOf(parsed.url)}` };
    },
    execute: withWebRateLimit(state, async (args) => {
      const parsed = args as { url: string; limit?: number };
      let host: string;
      try {
        host = new URL(parsed.url).hostname.toLowerCase();
      } catch {
        return { summary: 'invalid url' };
      }
      if (host.length === 0) {
        return { summary: 'invalid url' };
      }
      const fetched = await guardedGet(parsed.url, guardedOptions(state, { allowedHosts: [host] }));
      if (!fetched.ok) {
        return failureResult(fetched);
      }
      const feed = parseFeed(fetched.body.text);
      if (!feed.ok) {
        return { summary: feed.summary };
      }
      const items = feed.items.slice(0, parsed.limit ?? DEFAULT_FEED_LIMIT);
      return {
        summary: `feed ${host} (${items.length} item${items.length === 1 ? '' : 's'})`,
        modelText: formatFeedItems(items),
      };
    }),
  };
}
