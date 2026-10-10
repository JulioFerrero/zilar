// T-0993: the `web.fetch` adapter, split out of `web-tools/adapters.ts` unchanged.
import { Schema } from 'effect';
import type { ActionAdapter, ArgsSchema } from '../actions/registry';
import { guardedGet, truncateChars } from './guarded-fetch';
import { extractText } from './html';
import {
  DEFAULT_FETCH_CHARS,
  failureResult,
  guardedOptions,
  hostOf,
  MAX_FETCH_CHARS,
  MAX_FETCH_URL_CHARS,
  withWebRateLimit,
  type WebToolsState,
} from './shared';

// `web.fetch`: read one caller-chosen page. Tier 1: the URL is a
// data-exfiltration channel, so the topic's "always allow here" rules
// and the kill switch apply.
const webFetchArgsSchema = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_FETCH_URL_CHARS)),
  maxChars: Schema.optional(
    Schema.Number.pipe(
      Schema.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(1),
        Schema.isLessThanOrEqualTo(MAX_FETCH_CHARS),
      ),
    ),
  ),
});

export function webFetchAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.fetch',
    description: 'Fetch one public https page and read it as plain text.',
    tier: 1,
    argsSchema: webFetchArgsSchema as unknown as ArgsSchema<unknown>,
    describe: (args) => {
      const parsed = args as { url: string };
      return { summary: `Fetch ${hostOf(parsed.url)}` };
    },
    execute: withWebRateLimit(state, async (args) => {
      const parsed = args as { url: string; maxChars?: number };
      let host: string;
      try {
        host = new URL(parsed.url).hostname.toLowerCase();
      } catch {
        return { summary: 'invalid url' };
      }
      if (host.length === 0) {
        return { summary: 'invalid url' };
      }
      const maxChars = parsed.maxChars ?? DEFAULT_FETCH_CHARS;
      const fetched = await guardedGet(parsed.url, guardedOptions(state, { allowedHosts: [host] }));
      if (!fetched.ok) {
        return failureResult(fetched);
      }
      const text =
        fetched.body.contentType === 'text/html'
          ? extractText(fetched.body.text)
          : fetched.body.text.trim();
      if (text.length === 0) {
        return { summary: `fetched ${host} (empty page)` };
      }
      return {
        summary: `fetched ${host} (${Math.min(text.length, maxChars)} chars)`,
        modelText: truncateChars(text, maxChars),
      };
    }),
  };
}
