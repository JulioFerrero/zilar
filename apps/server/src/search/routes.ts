import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { bareJid, ownBareJid } from '../jid';
import { Effect } from 'effect';
import type { Logger } from 'pino';
import { allowedArchives, resolveChatFilter, type ArchivePool, type ArchiveRow } from './service';
import { buildTsQuery, matchMessageTerms, searchTerms, windowSnippet } from './match';
import { buildArchiveQuery, buildFuzzyCandidatesQuery, exactInCodeMarks } from './archive-query';
import { loadEditsForTargets, type EditOverlay, type EditScope } from './edit-overlay';
import { senderNamesByJid } from '../xmpp/archive-sender';
import {
  chatJidFor,
  correctionTarget,
  headlineToSnippet,
  plainSnippet,
  retractTarget,
  SEARCH_MIN_FUZZY_QUERY_CHARS,
  senderNameFor,
  timestampToIso,
} from './snippet';

export const SEARCH_RATE_LIMIT_MAX = 30;
export const SEARCH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export { SEARCH_MAX_LIMIT } from '@zilar/api-contract';
export const SEARCH_DEFAULT_LIMIT = 20;
// No expression index is possible in ejabberd, so a search scans 12 months and at
// most 5 000 candidates.
export const SEARCH_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
export const SEARCH_MAX_CANDIDATES = 5000;

export interface SearchRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  /** Absent when XMPP_ARCHIVE_DATABASE_URL is unset → every search 501s. */
  archive?: ArchivePool;
  now?: () => number;
}

export interface SearchQuery {
  q: string;
  chat?: string;
  limit?: number;
  before?: number;
}

export interface SearchItem {
  chatJid: string;
  messageId: string;
  senderName: string;
  at: string;
  snippet: string;
  marks: Array<[number, number]>;
  match?: 'exact' | 'fuzzy';
}

export interface SearchResult {
  items: SearchItem[];
  nextBefore?: string;
}

// The search core: session, archive and rate-limit checks already ran in the
// middleware, so this starts at the decoded query. Failures are typed
// `HttpError`s. The log carries only the count and duration, never the query.
export const runSearchEffect = Effect.fnUntraced(function* (
  deps: SearchRoutesDependencies,
  userId: string,
  query: SearchQuery,
): Effect.fn.Return<SearchResult, HttpError> {
  const archive = deps.archive;
  if (archive === undefined) {
    return yield* Effect.fail(
      new HttpError(501, 'search_unavailable', 'Message search is not configured'),
    );
  }
  const q = query.q.trim();
  if (q.length < 2 || q.length > 100) {
    return yield* Effect.fail(new HttpError(400, 'invalid_request', 'Invalid search query'));
  }

  const allowed = yield* Effect.promise(() => allowedArchives(deps.db, deps.config, userId));
  const chat = query.chat?.trim();
  const filter = chat === undefined || chat === '' ? null : resolveChatFilter(allowed, chat);
  if (chat !== undefined && chat !== '' && filter === null) {
    return yield* Effect.fail(new HttpError(404, 'not_found', 'Chat not found'));
  }

  const limit = query.limit ?? SEARCH_DEFAULT_LIMIT;
  const cutoffMicros = BigInt(Date.now() - SEARCH_WINDOW_MS) * 1000n;
  const beforeMicros = query.before === undefined ? null : BigInt(query.before);

  // No tokens means a query of only operators or punctuation: answer an empty
  // list, not a 500.
  const terms = searchTerms(q);
  const tsquery = terms.length === 0 ? null : buildTsQuery(terms);

  const start = performance.now();
  const scopeInput = { owners: allowed, filter, cutoffMicros, beforeMicros };
  const searchFailed = (): HttpError =>
    new HttpError(502, 'search_failed', 'Message search failed, try again later');
  let rows: ArchiveRow[] = [];
  if (tsquery !== null) {
    const built = yield* Effect.try({
      try: () => buildArchiveQuery({ tsquery, ...scopeInput }),
      catch: searchFailed,
    });
    rows = yield* Effect.tryPromise({
      try: () => archive.query(built.text, built.values),
      catch: searchFailed,
    });
  }

  // Edits are read without the page cursor, so a retraction after page 1 still
  // hides a page-2 message.
  const editScope: EditScope =
    filter === null
      ? { kind: 'all', owners: allowed }
      : filter.kind === 'dm'
        ? { kind: 'dm', owner: allowed.ownLocalpart, peer: filter.peer }
        : { kind: 'room', room: filter.room };
  const editTargets = (source: readonly ArchiveRow[]): string[] =>
    source.flatMap((row) => {
      const target = correctionTarget(row.xml);
      return target === null || target === row.originId ? [row.originId] : [row.originId, target];
    });
  const loadOverlay = (targetOriginIds: readonly string[]): Effect.Effect<EditOverlay, HttpError> =>
    Effect.tryPromise({
      try: () => loadEditsForTargets(archive, editScope, targetOriginIds),
      catch: searchFailed,
    });

  // Both passes render against one overlay. When the fuzzy pass runs, the overlay
  // is rebuilt over the union, so a fuzzy-only hit of a retracted message cannot
  // slip through.
  const render = async (
    overlay: EditOverlay,
    fuzzyRows: readonly ArchiveRow[],
  ): Promise<{ items: SearchItem[]; oldest: bigint | null }> => {
    const seen = new Set<string>();
    const items: SearchItem[] = [];
    // `as` stops TypeScript narrowing to null: pushItem assigns it in a closure.
    let oldest = null as bigint | null;
    const ownJid = ownBareJid(allowed, deps.config.xmpp.domain);
    // One batched read of the real room senders' names. A failed lookup falls back
    // to the nick rather than failing the page: the hits are already in hand.
    const roomNames = await senderNamesByJid(
      deps.db,
      [...rows, ...fuzzyRows].flatMap((row) =>
        row.kind === 'groupchat' && row.barePeer !== '' ? [bareJid(row.barePeer)] : [],
      ),
    ).catch(() => new Map<string, string>());
    const pushItem = (
      row: ArchiveRow,
      chatJid: string,
      key: string,
      snippet: string,
      marks: Array<[number, number]>,
      match: 'exact' | 'fuzzy',
    ): void => {
      const plain = plainSnippet({ snippet, marks });
      seen.add(key);
      items.push({
        chatJid,
        messageId: row.originId,
        senderName: senderNameFor(row, ownJid, allowed.peerNames, roomNames),
        at: timestampToIso(row.timestamp),
        snippet: plain.snippet,
        marks: plain.marks,
        match,
      });
      oldest = BigInt(row.timestamp);
    };
    // A candidate survives when it is not a retract row, not retracted and not
    // superseded by a newer same-sender correction. An edit row is a hit only
    // when it is the newest accepted correction.
    const visibleKey = (row: ArchiveRow): string | null => {
      // A retract row is never a hit: its text is only the stock fallback sentence.
      if (retractTarget(row.xml) !== null) {
        return null;
      }
      const correction = correctionTarget(row.xml);
      const target = correction ?? row.originId;
      const entry = overlay.get(target);
      if (entry?.retracted === true) {
        return null;
      }
      if (correction !== null) {
        if (entry?.latestText === undefined || entry.latestText !== (row.body ?? '')) {
          return null;
        }
      } else if (entry?.latestText !== undefined) {
        return null;
      }
      const key = `${chatJidFor(row)}|${target}`;
      if (seen.has(key)) {
        return null;
      }
      return key;
    };
    for (const row of rows) {
      const key = visibleKey(row);
      if (key === null) {
        continue;
      }
      const chatJid = chatJidFor(row);
      const { snippet, marks } = headlineToSnippet(row.headline);
      // ts_headline cannot mark accent-folded hits, so re-mark in code when it
      // marked nothing, with folded matching on both sides.
      const marked = exactInCodeMarks(terms, snippet, marks);
      pushItem(row, chatJid, key, marked.snippet, marked.marks, 'exact');
      if (items.length >= limit) {
        break;
      }
    }
    for (const row of fuzzyRows) {
      if (items.length >= limit) {
        break;
      }
      const key = visibleKey(row);
      if (key === null) {
        continue;
      }
      const body = row.body ?? '';
      const spans = matchMessageTerms(terms, body, true);
      if (spans === null) {
        continue;
      }
      const chatJid = chatJidFor(row);
      const { snippet, marks } = windowSnippet(body, spans);
      pushItem(row, chatJid, key, snippet, marks, 'fuzzy');
    }
    return { items, oldest };
  };

  const firstOverlay = yield* loadOverlay(editTargets(rows));
  let result = yield* Effect.promise(() => render(firstOverlay, []));

  // Typo tolerance: only when the first pass is short, and never under 3
  // characters. Same scope, cutoff, cap and order, de-duplicated against the
  // first pass, so exact hits rank first and paging stays correct.
  if (
    result.items.length < limit &&
    tsquery !== null &&
    q.trim().length >= SEARCH_MIN_FUZZY_QUERY_CHARS &&
    terms.length > 0
  ) {
    const fuzzy = yield* Effect.try({
      try: () => buildFuzzyCandidatesQuery(scopeInput),
      catch: searchFailed,
    });
    const candidates = yield* Effect.tryPromise({
      try: () => archive.query(fuzzy.text, fuzzy.values),
      catch: searchFailed,
    });
    const overlay = yield* loadOverlay(editTargets([...rows, ...candidates]));
    result = yield* Effect.promise(() => render(overlay, candidates));
  }

  deps.logger.info(
    {
      userId,
      results: result.items.length,
      durationMs: Math.round(performance.now() - start),
    },
    'search',
  );

  return {
    items: result.items,
    ...(result.oldest === null || result.items.length < limit
      ? {}
      : { nextBefore: result.oldest.toString() }),
  };
});

export {
  SEARCH_MIN_FUZZY_QUERY_CHARS,
  headlineToSnippet,
  stanzaFrom,
  correctionTarget,
  retractTarget,
} from './snippet';
export {
  buildArchiveQuery,
  buildFuzzyCandidatesQuery,
  type ArchiveQueryInput,
} from './archive-query';
export {
  loadEditsForTargets,
  type EditOverlay,
  type EditOverlayEntry,
  type EditScope,
} from './edit-overlay';
