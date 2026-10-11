import { FOLD_FROM, FOLD_TO, matchMessageTerms, mergeMarks, type MarkedSnippet } from './match';
import { SEARCH_MAX_CANDIDATES } from './routes';
import type { SearchOwner } from './service';

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
export function exactInCodeMarks(
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
