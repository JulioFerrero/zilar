// Message search (T-0117, moved to the contract by T-0894). Snippets arrive as
// plain text plus `marks` character ranges; the client highlights with spans
// and never renders HTML.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { lenientLiterals } from './lenient';
import { SearchGuards, SearchSchemaErrors, Session } from './middleware';

export const SEARCH_MAX_LIMIT = 50;

export const SEARCH_MATCHES = ['exact', 'fuzzy'] as const;

// `q` is 1..100 raw characters (the handler trims and requires 2..100),
// optional `chat` 1..256, optional `limit` and `before` travel as strings and
// decode to numbers. Strict, so an excess key fails.
export const SearchQuery = Schema.Struct({
  q: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  chat: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  limit: Schema.optional(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(SEARCH_MAX_LIMIT),
    ),
  ),
  before: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))),
});

export type SearchQuery = typeof SearchQuery.Type;

// A mark is a character range inside the snippet: two non-negative integer
// offsets. Anything else rejects the whole page.
const MarkOffset = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const SearchMark = Schema.mutable(Schema.Tuple([MarkOffset, MarkOffset]));

export type SearchMark = typeof SearchMark.Type;

// Lists every field of the hit plus the optional cursor: the success schema is
// an encoder, so an omitted field would silently disappear.
export const SearchItem = Schema.Struct({
  chatJid: Schema.String,
  messageId: Schema.String,
  senderName: Schema.String,
  at: Schema.String,
  snippet: Schema.String,
  marks: Schema.mutable(Schema.Array(SearchMark)),
  // Which pass produced the hit. An unknown value reads as `exact`.
  match: Schema.optional(lenientLiterals(SEARCH_MATCHES, 'exact')),
});

export type SearchItem = typeof SearchItem.Type;

export const SearchPage = Schema.Struct({
  items: Schema.Array(SearchItem),
  nextBefore: Schema.optional(Schema.String),
});

export type SearchPage = typeof SearchPage.Type;

export const SearchGroup = HttpApiGroup.make('search')
  .add(
    HttpApiEndpoint.get('search', '/search', {
      query: SearchQuery,
      success: SearchPage,
    })
      .annotate(HttpApi.QueryParseOptions, { onExcessProperty: 'error' })
      .middleware(SearchGuards),
  )
  .middleware(Session)
  .middleware(SearchSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
