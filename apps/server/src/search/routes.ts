import type { Auth } from '../auth/auth';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import type { Logger } from 'pino';
import {
  allowedArchives,
  resolveChatFilter,
  type ArchivePool,
  type ArchiveRow,
  type SearchOwner,
} from './service';
import {
  buildTsQuery,
  FOLD_FROM,
  FOLD_TO,
  matchMessageTerms,
  mergeMarks,
  searchTerms,
  windowSnippet,
  type MarkedSnippet,
} from './match';

export const SEARCH_RATE_LIMIT_MAX = 30;
export const SEARCH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const SEARCH_MAX_LIMIT = 50;
export const SEARCH_DEFAULT_LIMIT = 20;
// No expression index is possible in the ejabberd database, so every search
// scans only the last 12 months and at most 5 000 candidate rows.
export const SEARCH_WINDOW_MONTHS = 12;
export const SEARCH_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
export const SEARCH_MAX_CANDIDATES = 5000;

export interface SearchRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  logger: Logger;
  /** Absent when XMPP_ARCHIVE_DATABASE_URL is unset → every search 501s. */
  archive?: ArchivePool;
  /** Injected in tests so the rate-limit window can advance without waiting. */
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
  /** Which pass produced the hit. Both clients ignore unknown fields. */
  match?: 'exact' | 'fuzzy';
}

export const SEARCH_MIN_FUZZY_QUERY_CHARS = 3;

const START_SEL = '\u0001';
const STOP_SEL = '\u0002';

// `ts_headline` marks hits with the StartSel/StopSel sentinels. Split the
// headline into plain text plus character ranges, so the client highlights
// with spans and never renders HTML.
export function headlineToSnippet(headline: string): MarkedSnippet {
  let snippet = '';
  const marks: Array<[number, number]> = [];
  let open: number | null = null;
  for (const char of headline) {
    if (char === START_SEL) {
      if (open === null) {
        open = [...snippet].length;
      }
      continue;
    }
    if (char === STOP_SEL) {
      if (open !== null) {
        const end = [...snippet].length;
        if (end > open) {
          marks.push([open, end]);
        }
        open = null;
      }
      continue;
    }
    snippet += char;
  }
  return { snippet, marks };
}

function timestampToIso(value: ArchiveRow['timestamp']): string {
  const micros = typeof value === 'bigint' ? value : BigInt(value);
  return new Date(Number(micros / 1000n)).toISOString();
}

function senderNameFor(
  row: ArchiveRow,
  ownBareJid: string,
  peerNames: Map<string, string>,
): string {
  if (row.kind === 'groupchat') {
    return row.nick === '' ? 'Unknown' : row.nick;
  }
  // In a DM archive the caller's own outgoing messages are stored under the
  // same `bare_peer` as incoming ones. The stanza's `from` decides: a `from`
  // naming the caller means the caller sent it.
  const from = stanzaFrom(row.xml);
  if (from !== null && bareJid(from) === ownBareJid) {
    return 'You';
  }
  return peerNames.get(row.barePeer) ?? 'Unknown';
}

// Bare JID, lowercased: the comparison key for sender direction.
function bareJid(jid: string): string {
  return jid.split('/')[0]?.toLowerCase() ?? '';
}

// The stanza's `from` attribute, parsed defensively like the other tag
// readers: a missing or malformed attribute is null, never a throw.
export function stanzaFrom(xml: string): string | null {
  const match = xml.match(/<message\b[^>]*\bfrom\s*=\s*(["'])(.*?)\1/s);
  const value = match?.[2]?.trim();
  return value === undefined || value === '' ? null : value;
}

function chatJidFor(row: Pick<ArchiveRow, 'owner' | 'kind' | 'barePeer'>): string {
  return row.kind === 'groupchat' ? row.owner : row.barePeer;
}

// The caller's own bare JID: the `from` a stanza carries when the caller
// sent it. The localpart is authoritative (it scopes the archive query);
// the domain comes from config.
function ownBareJid(allowed: SearchOwner, domain: string): string {
  return `${allowed.ownLocalpart}@${domain.toLowerCase()}`;
}

export interface ArchiveQueryInput {
  /** Sanitized tsquery built with buildTsQuery (always bound, never SQL). */
  tsquery: string;
  owners: SearchOwner;
  filter: { kind: 'dm'; peer: string } | { kind: 'room'; room: string } | null;
  cutoffMicros: bigint;
  beforeMicros: bigint | null;
}

export interface ArchiveEditRow {
  owner: string;
  barePeer: string;
  kind: string;
  originId: string;
  timestamp: number | string | bigint;
  xml: string;
}

// One fully parameterized query — values travel as `$n` bindings, never
// string-built SQL, so a query containing SQL metacharacters is just text.
// Matching folds accents/case (`translate(lower(txt), …)`) and matches the
// LAST query term as a prefix (`to_tsquery` with `:*`, built from sanitized
// tokens by buildTsQuery — never string-concatenated SQL: the tsquery text
// itself is a `$n` binding, and each token is [\p{L}\p{N}]+ quoted with `"`).
// An empty tsquery (a query of only operators/punctuation) matches nothing:
// `@@` on an empty query is false and the route answers an empty list.
// The `WHERE username = … AND timestamp > …` prefix keeps the scan on the
// existing `(username, timestamp)` index inside the 12-month / 5 000-row cap.
export function buildArchiveQuery(input: ArchiveQueryInput): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const headlineOptions = next(
    'StartSel=\u0001, StopSel=\u0002, MaxWords=40, MinWords=8, MaxFragments=1',
  );
  const tsquery = next(input.tsquery);
  const foldFrom = next(FOLD_FROM);
  const foldTo = next(FOLD_TO);
  const cutoff = next(input.cutoffMicros);
  const folded = `translate(lower(txt), ${foldFrom}, ${foldTo})`;
  const columns = `username AS owner, peer, bare_peer AS "barePeer", kind, nick,
    origin_id AS "originId", timestamp,
    ts_headline('simple', txt, to_tsquery('simple', ${tsquery}), ${headlineOptions}) AS headline,
    xml`;
  const match = `to_tsvector('simple', ${folded}) @@ to_tsquery('simple', ${tsquery})`;
  const before = input.beforeMicros === null ? '' : ` AND timestamp < ${next(input.beforeMicros)}`;
  const cap = next(SEARCH_MAX_CANDIDATES);

  let scope: string;
  if (input.filter?.kind === 'room') {
    scope = `username = ${next(input.filter.room)}`;
  } else if (input.filter?.kind === 'dm') {
    scope = `username = ${next(input.owners.ownLocalpart)} AND bare_peer = ${next(input.filter.peer)}`;
  } else {
    scope = `(username = ANY(${next(input.owners.rooms)}) OR (username = ${next(input.owners.ownLocalpart)} AND bare_peer = ANY(${next(input.owners.dmPeers)})))`;
  }

  return {
    text: `SELECT ${columns} FROM archive WHERE ${scope} AND timestamp > ${cutoff}${before} AND ${match} ORDER BY timestamp DESC LIMIT ${cap}`,
    values,
  };
}

// Corrections and retractions name their target origin_id in the `xml`
// stanza but need not contain the query text, so a second bounded query
// fetches them for the same archive scope. The route then shows the latest
// text per target and drops anything retracted.
export function buildArchiveEditsQuery(input: Omit<ArchiveQueryInput, 'tsquery'>): {
  text: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const cutoff = next(input.cutoffMicros);
  const before = input.beforeMicros === null ? '' : ` AND timestamp < ${next(input.beforeMicros)}`;
  const cap = next(SEARCH_MAX_CANDIDATES);

  let scope: string;
  if (input.filter?.kind === 'room') {
    scope = `username = ${next(input.filter.room)}`;
  } else if (input.filter?.kind === 'dm') {
    scope = `username = ${next(input.owners.ownLocalpart)} AND bare_peer = ${next(input.filter.peer)}`;
  } else {
    scope = `(username = ANY(${next(input.owners.rooms)}) OR (username = ${next(input.owners.ownLocalpart)} AND bare_peer = ANY(${next(input.owners.dmPeers)})))`;
  }

  return {
    text: `SELECT username AS owner, bare_peer AS "barePeer", kind, origin_id AS "originId", timestamp, xml FROM archive WHERE ${scope} AND timestamp > ${cutoff}${before} AND (xml LIKE ${next('%urn:xmpp:message-correct:0%')} OR xml LIKE ${next('%urn:xmpp:message-retract:1%')}) ORDER BY timestamp DESC LIMIT ${cap}`,
    values,
  };
}

// The fuzzy second pass scores candidates in code, so it fetches the same
// bounded scope (same permission scoping, cutoff, cap, newest first) with no
// text filter. `body` carries the full `txt` for scoring and windowing.
export function buildFuzzyCandidatesQuery(input: Omit<ArchiveQueryInput, 'tsquery'>): {
  text: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const cutoff = next(input.cutoffMicros);
  const before = input.beforeMicros === null ? '' : ` AND timestamp < ${next(input.beforeMicros)}`;
  const cap = next(SEARCH_MAX_CANDIDATES);

  let scope: string;
  if (input.filter?.kind === 'room') {
    scope = `username = ${next(input.filter.room)}`;
  } else if (input.filter?.kind === 'dm') {
    scope = `username = ${next(input.owners.ownLocalpart)} AND bare_peer = ${next(input.filter.peer)}`;
  } else {
    scope = `(username = ANY(${next(input.owners.rooms)}) OR (username = ${next(input.owners.ownLocalpart)} AND bare_peer = ANY(${next(input.owners.dmPeers)})))`;
  }

  return {
    text: `SELECT username AS owner, peer, bare_peer AS "barePeer", kind, nick, origin_id AS "originId", timestamp, xml, txt AS "body" FROM archive WHERE ${scope} AND timestamp > ${cutoff}${before} ORDER BY timestamp DESC LIMIT ${cap}`,
    values,
  };
}

// When ts_headline marks nothing (accent-folded hits: its match ran on the
// raw text), mark the same terms in code on the headline text. Returns the
// headline marks unchanged when they exist.
function exactInCodeMarks(
  terms: string[],
  snippet: string,
  marks: Array<[number, number]>,
): MarkedSnippet {
  if (marks.length > 0) {
    return { snippet, marks };
  }
  const spans = matchMessageTerms(terms, snippet, false);
  if (spans === null) {
    return { snippet, marks };
  }
  return {
    snippet,
    marks: mergeMarks(
      spans.map((span) => [span.start, span.end] as [number, number]),
      [...snippet].length,
    ),
  };
}

export interface SearchResult {
  items: SearchItem[];
  nextBefore?: string;
}

// The search core shared by the Effect `HttpApi` adapter (`api.ts`): session,
// archive and rate-limit checks run in the endpoint middleware (in the same
// order as the old Hono route), so this starts at the decoded query. The log
// carries only the result count and duration — never the query.
export async function runSearch(
  deps: SearchRoutesDependencies,
  userId: string,
  query: SearchQuery,
): Promise<SearchResult> {
  if (deps.archive === undefined) {
    throw new HttpError(501, 'search_unavailable', 'Message search is not configured');
  }
  const q = query.q.trim();
  if (q.length < 2 || q.length > 100) {
    throw new HttpError(400, 'invalid_request', 'Invalid search query');
  }

  const allowed = await allowedArchives(deps.db, deps.config, userId);
  const chat = query.chat?.trim();
  const filter = chat === undefined || chat === '' ? null : resolveChatFilter(allowed, chat);
  if (chat !== undefined && chat !== '' && filter === null) {
    throw new HttpError(404, 'not_found', 'Chat not found');
  }

  const limit = query.limit ?? SEARCH_DEFAULT_LIMIT;
  const cutoffMicros = BigInt(Date.now() - SEARCH_WINDOW_MS) * 1000n;
  const beforeMicros = query.before === undefined ? null : BigInt(query.before);

  // Sanitized folded tokens (never raw SQL): earlier terms are whole
  // words, the last term matches as a prefix. No tokens means a query of
  // only operators/punctuation — answer an empty list, not a 500.
  const terms = searchTerms(q);
  const tsquery = terms.length === 0 ? null : buildTsQuery(terms);

  const start = performance.now();
  const scopeInput = { owners: allowed, filter, cutoffMicros, beforeMicros };
  let rows: ArchiveRow[];
  let editRows: ArchiveEditRow[];
  try {
    if (tsquery === null) {
      rows = [];
      editRows = [];
    } else {
      const built = buildArchiveQuery({ tsquery, ...scopeInput });
      const edits = buildArchiveEditsQuery(scopeInput);
      [rows, editRows] = await Promise.all([
        deps.archive.query(built.text, built.values),
        deps.archive.query(edits.text, edits.values),
      ]);
    }
  } catch {
    throw new HttpError(502, 'search_failed', 'Message search failed, try again later');
  }

  // Corrections store the new full body in a second row naming the
  // original origin_id; retractions store a fallback-body row naming the
  // target. Neither need contain the query text, so they arrive through
  // the edits query. Newest wins per chat+target: a correction target
  // hides every older row for that target (the matching row itself may
  // be an older correction), and a retraction hides everything plus the
  // retract rows themselves (their txt is only the stock fallback).
  const latestByTarget = new Map<string, bigint>();
  const retractedByTarget = new Map<string, bigint>();
  for (const edit of editRows) {
    const chatJid = chatJidFor(edit);
    const at = BigInt(edit.timestamp);
    const corrected = correctionTarget(edit.xml);
    if (corrected !== null) {
      const key = `${chatJid}|${corrected}`;
      if ((latestByTarget.get(key) ?? -1n) < at) {
        latestByTarget.set(key, at);
      }
    }
    const retracted = retractTarget(edit.xml);
    if (retracted !== null) {
      const key = `${chatJid}|${retracted}`;
      if ((retractedByTarget.get(key) ?? -1n) < at) {
        retractedByTarget.set(key, at);
      }
    }
  }
  const seen = new Set<string>();
  const items: SearchItem[] = [];
  let oldest: bigint | null = null;
  const ownJid = ownBareJid(allowed, deps.config.xmpp.domain);
  const pushItem = (
    row: ArchiveRow,
    chatJid: string,
    key: string,
    snippet: string,
    marks: Array<[number, number]>,
    match: 'exact' | 'fuzzy',
  ): void => {
    seen.add(key);
    items.push({
      chatJid,
      messageId: row.originId,
      senderName: senderNameFor(row, ownJid, allowed.peerNames),
      at: timestampToIso(row.timestamp),
      snippet,
      marks,
      match,
    });
    oldest = BigInt(row.timestamp);
  };
  // A candidate survives when it is not a retract row, not retracted, and
  // not superseded by a newer correction. Same handling for both passes.
  const visibleKey = (row: ArchiveRow): string | null => {
    // A retract row is never a hit itself: its `txt` is only the stock
    // fallback sentence, and the XML namespace matched the query.
    if (retractTarget(row.xml) !== null) {
      return null;
    }
    const chatJid = chatJidFor(row);
    const key = `${chatJid}|${correctionTarget(row.xml) ?? row.originId}`;
    const at = BigInt(row.timestamp);
    const retractedAt = retractedByTarget.get(key);
    if (retractedAt !== undefined && retractedAt >= at) {
      return null;
    }
    const latestAt = latestByTarget.get(key);
    if (latestAt !== undefined && latestAt > at) {
      return null;
    }
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
    // ts_headline cannot mark accent-folded hits (its match ran on the
    // raw text), so re-mark in code when it marked nothing: the same
    // token rule as the query, with folded matching on both sides.
    const marked = exactInCodeMarks(terms, snippet, marks);
    pushItem(row, chatJid, key, marked.snippet, marked.marks, 'exact');
    if (items.length >= limit) {
      break;
    }
  }

  // Typo-tolerance second pass: only when the first pass is short, never
  // for a query shorter than 3 characters. It reuses the same scope,
  // cutoff, cap and newest-first order, de-duplicates against the first
  // pass (same edit/retraction handling), and keeps the same cursor
  // semantics (`nextBefore` is the oldest returned timestamp), so exact
  // hits rank before fuzzy ones and paging stays correct.
  if (
    tsquery !== null &&
    items.length < limit &&
    q.trim().length >= SEARCH_MIN_FUZZY_QUERY_CHARS &&
    terms.length > 0
  ) {
    try {
      const fuzzy = buildFuzzyCandidatesQuery(scopeInput);
      const candidates = await deps.archive.query(fuzzy.text, fuzzy.values);
      for (const row of candidates) {
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
    } catch {
      throw new HttpError(502, 'search_failed', 'Message search failed, try again later');
    }
  }

  // The log carries only the result count and duration — never the query.
  deps.logger.info(
    {
      userId,
      results: items.length,
      durationMs: Math.round(performance.now() - start),
    },
    'search',
  );

  return {
    items,
    ...(oldest === null || items.length < limit ? {} : { nextBefore: oldest.toString() }),
  };
}

function tagAttribute(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\bid\\s*=\\s*["']([^"']+)["']`, 's'));
  return match?.[1] ?? null;
}

// A correction row carries `<replace xmlns="urn:xmpp:message-correct:0"
// id="…"/>` naming the original origin_id.
export function correctionTarget(xml: string): string | null {
  if (!xml.includes('urn:xmpp:message-correct:0')) {
    return null;
  }
  return tagAttribute(xml, 'replace');
}

// A retraction row carries `<retract xmlns="urn:xmpp:message-retract:1"
// id="…"/>` naming the retracted origin_id.
export function retractTarget(xml: string): string | null {
  if (!xml.includes('urn:xmpp:message-retract:1')) {
    return null;
  }
  return tagAttribute(xml, 'retract');
}
