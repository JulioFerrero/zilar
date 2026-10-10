// T-0993: the `web.wikipedia` adapter, split out of `web-tools/adapters.ts` unchanged.
import { Schema } from 'effect';
import type { ActionAdapter, ArgsSchema } from '../actions/registry';
import { guardedGet } from './guarded-fetch';
import {
  guardedOptions,
  MAX_WIKIPEDIA_EXTRACT_CHARS,
  wikipediaUserAgent,
  withWebRateLimit,
  type WebToolsState,
} from './shared';

// `web.wikipedia`: search + page extract on a fixed host. Tier 0: the
// caller picks only the query and the language, never the host. `lang`
// is letters-only so it cannot smuggle a different host in.
const webWikipediaArgsSchema = Schema.Struct({
  query: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  lang: Schema.optional(
    Schema.String.check(
      Schema.makeFilter((value) =>
        /^[a-zA-Z]{2,3}$/.test(value) ? undefined : 'lang must be 2-3 letters',
      ),
    ),
  ),
});

export function wikipediaHost(lang: string): string {
  return `${lang.toLowerCase()}.wikipedia.org`;
}

const wikipediaSearchSchema = Schema.Struct({
  query: Schema.Struct({
    search: Schema.Array(Schema.Struct({ title: Schema.String, pageid: Schema.Int })),
  }),
});

const wikipediaExtractSchema = Schema.Struct({
  query: Schema.Struct({
    pages: Schema.Record(
      Schema.String,
      Schema.Struct({
        pageid: Schema.optional(Schema.Int),
        title: Schema.String,
        extract: Schema.optional(Schema.String),
        fullurl: Schema.optional(Schema.String),
        missing: Schema.optional(Schema.Unknown),
      }),
    ),
  }),
});

export interface WikipediaArticle {
  title: string;
  extract: string;
  url: string;
}

export function parseWikipediaSearch(body: string): { title: string } | null {
  let parsed: typeof wikipediaSearchSchema.Type;
  try {
    parsed = Schema.decodeUnknownSync(wikipediaSearchSchema)(JSON.parse(body));
  } catch {
    return null;
  }
  const first = parsed.query.search[0];
  if (first === undefined || first.title.trim().length === 0) {
    return null;
  }
  return { title: first.title };
}

export function parseWikipediaExtract(body: string): WikipediaArticle | null {
  let parsed: typeof wikipediaExtractSchema.Type;
  try {
    parsed = Schema.decodeUnknownSync(wikipediaExtractSchema)(JSON.parse(body));
  } catch {
    return null;
  }
  const pages = Object.values(parsed.query.pages);
  const page = pages[0];
  if (page === undefined || page.missing !== undefined) {
    return null;
  }
  const extract = (page.extract ?? '').trim();
  if (extract.length === 0) {
    return null;
  }
  return {
    title: page.title,
    extract:
      extract.length <= MAX_WIKIPEDIA_EXTRACT_CHARS
        ? extract
        : `${extract.slice(0, MAX_WIKIPEDIA_EXTRACT_CHARS)}…`,
    url: page.fullurl ?? '',
  };
}

function wikipediaApiUrl(host: string, params: Record<string, string>): string {
  return `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', ...params }).toString()}`;
}

export function webWikipediaAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.wikipedia',
    description: 'Read a short Wikipedia summary of a topic (keyless, fixed host).',
    tier: 0,
    argsSchema: webWikipediaArgsSchema as unknown as ArgsSchema<unknown>,
    describe: (args) => {
      const parsed = args as { query: string };
      return { summary: `Look up "${parsed.query}" on Wikipedia` };
    },
    execute: withWebRateLimit(state, async (args) => {
      const parsed = args as { query: string; lang?: string };
      const host = wikipediaHost(parsed.lang ?? 'en');
      const headers = { 'user-agent': wikipediaUserAgent(), accept: 'application/json' };
      const found = await guardedGet(
        wikipediaApiUrl(host, {
          action: 'query',
          list: 'search',
          srsearch: parsed.query,
          srlimit: '1',
          srprop: '',
        }),
        guardedOptions(state, { allowedHosts: [host], headers }),
      );
      if (!found.ok) {
        return { summary: found.summary };
      }
      const match = parseWikipediaSearch(found.body.text);
      if (match === null) {
        return { summary: 'no article found' };
      }
      const page = await guardedGet(
        wikipediaApiUrl(host, {
          action: 'query',
          prop: 'extracts|info',
          exintro: '1',
          explaintext: '1',
          inprop: 'url',
          redirects: '1',
          titles: match.title,
        }),
        guardedOptions(state, { allowedHosts: [host], headers }),
      );
      if (!page.ok) {
        return { summary: page.summary };
      }
      const article = parseWikipediaExtract(page.body.text);
      if (article === null) {
        return { summary: 'no article found' };
      }
      const urlLine = article.url.length > 0 ? `\n${article.url}` : '';
      return {
        summary: 'wikipedia article found',
        modelText: `${article.title}\n${article.extract}${urlLine}`,
      };
    }),
  };
}
