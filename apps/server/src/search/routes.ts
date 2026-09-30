import { Hono } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
import type { Logger } from 'pino';
import {
  allowedArchives,
  resolveChatFilter,
  type ArchivePool,
  type ArchiveRow,
  type SearchOwner,
} from './service';

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

const querySchema = z
  .object({
    q: z.string().min(1).max(100),
    chat: z.string().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
    before: z.coerce.number().int().positive().optional(),
  })
  .strict();

export interface SearchItem {
  chatJid: string;
  messageId: string;
  senderName: string;
  at: string;
  snippet: string;
  marks: Array<[number, number]>;
}

interface MarkedSnippet {
  snippet: string;
  marks: Array<[number, number]>;
}

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
  q: string;
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
  const q = next(input.q);
  const cutoff = next(input.cutoffMicros);
  const columns = `username AS owner, peer, bare_peer AS "barePeer", kind, nick,
    origin_id AS "originId", timestamp,
    ts_headline('simple', txt, websearch_to_tsquery('simple', ${q}), ${headlineOptions}) AS headline,
    xml`;
  const match = `to_tsvector('simple', txt) @@ websearch_to_tsquery('simple', ${q})`;
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
export function buildArchiveEditsQuery(input: Omit<ArchiveQueryInput, 'q'>): {
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

export function createSearchRoutes(deps: SearchRoutesDependencies): Hono {
  const routes = new Hono();
  const limiter = createRateLimiter({
    max: SEARCH_RATE_LIMIT_MAX,
    windowMs: SEARCH_RATE_LIMIT_WINDOW_MS,
    now: deps.now ?? Date.now,
  });

  routes.get('/search', async (c) => {
    const { user } = await requireSession(deps.auth, c.req.raw.headers);
    if (deps.archive === undefined) {
      throw new HttpError(501, 'search_unavailable', 'Message search is not configured');
    }
    if (!limiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many searches, try again later');
    }
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid search query');
    }
    const q = parsed.data.q.trim();
    if (q.length < 2 || q.length > 100) {
      throw new HttpError(400, 'invalid_request', 'Invalid search query');
    }

    const allowed = await allowedArchives(deps.db, deps.config, user.id);
    const chat = parsed.data.chat?.trim();
    const filter = chat === undefined || chat === '' ? null : resolveChatFilter(allowed, chat);
    if (chat !== undefined && chat !== '' && filter === null) {
      throw new HttpError(404, 'not_found', 'Chat not found');
    }

    const limit = parsed.data.limit ?? SEARCH_DEFAULT_LIMIT;
    const cutoffMicros = BigInt(Date.now() - SEARCH_WINDOW_MS) * 1000n;
    const beforeMicros = parsed.data.before === undefined ? null : BigInt(parsed.data.before);

    const start = performance.now();
    let rows: ArchiveRow[];
    let editRows: ArchiveEditRow[];
    try {
      const built = buildArchiveQuery({ q, owners: allowed, filter, cutoffMicros, beforeMicros });
      const edits = buildArchiveEditsQuery({
        owners: allowed,
        filter,
        cutoffMicros,
        beforeMicros,
      });
      [rows, editRows] = await Promise.all([
        deps.archive.query(built.text, built.values),
        deps.archive.query(edits.text, edits.values),
      ]);
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
    for (const row of rows) {
      // A retract row is never a hit itself: its `txt` is only the stock
      // fallback sentence, and the XML namespace matched the query.
      if (retractTarget(row.xml) !== null) {
        continue;
      }
      const chatJid = chatJidFor(row);
      const key = `${chatJid}|${correctionTarget(row.xml) ?? row.originId}`;
      const at = BigInt(row.timestamp);
      const retractedAt = retractedByTarget.get(key);
      if (retractedAt !== undefined && retractedAt >= at) {
        continue;
      }
      const latestAt = latestByTarget.get(key);
      if (latestAt !== undefined && latestAt > at) {
        continue;
      }
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const { snippet, marks } = headlineToSnippet(row.headline);
      items.push({
        chatJid,
        messageId: row.originId,
        senderName: senderNameFor(
          row,
          ownBareJid(allowed, deps.config.xmpp.domain),
          allowed.peerNames,
        ),
        at: timestampToIso(row.timestamp),
        snippet,
        marks,
      });
      oldest = BigInt(row.timestamp);
      if (items.length >= limit) {
        break;
      }
    }

    // The log carries only the result count and duration — never the query.
    deps.logger.info(
      {
        userId: user.id,
        results: items.length,
        durationMs: Math.round(performance.now() - start),
      },
      'search',
    );

    return c.json({
      items,
      ...(oldest === null || items.length < limit ? {} : { nextBefore: oldest.toString() }),
    });
  });

  return routes;
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
