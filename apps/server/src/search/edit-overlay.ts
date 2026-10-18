// effect-plain: a Promise over the read-only ArchivePool, the same Promise
// edge search/service.ts wraps; the Effect layer adapts it at the call site.
// Corrections and retractions archive as their own rows naming the target's
// origin id, next to the original row ejabberd keeps. Every server read (search,
// the account export, the push preview, the topic preview) resolves them through
// this one helper: the target set is read in full (no time cursor, no search
// window), and only an edit whose sender equals the target's sender counts. A
// forged retraction or correction from another account is ignored.

import { bareJid } from '../jid';
import type { ArchivePool, SearchOwner } from './service';
import { correctionTarget, retractTarget } from './snippet';

export type EditScope =
  | { kind: 'dm'; owner: string; peer: string }
  | { kind: 'room'; room: string }
  | { kind: 'all'; owners: SearchOwner };

export interface EditOverlayEntry {
  /** A retraction from the target's sender: the message is deleted for everyone. */
  retracted: boolean;
  /** The newest accepted correction's full body, when one exists. */
  latestText?: string;
}

export type EditOverlay = ReadonlyMap<string, EditOverlayEntry>;

export interface EditArchiveRow {
  owner: string;
  barePeer: string;
  kind: string;
  nick: string;
  originId: string;
  timestamp: number | string | bigint;
  xml: string;
  body?: string | null;
}

// Each target may have many edits, but a target count times this bound keeps the
// scan small while still finding every edit of a normal page of messages.
const EDITS_PER_TARGET = 20;

const CORRECTION_PATTERN = '%urn:xmpp:message-correct:0%';
const RETRACTION_PATTERN = '%urn:xmpp:message-retract:1%';

interface Binder {
  values: unknown[];
  next: (value: unknown) => string;
}

function binder(): Binder {
  const values: unknown[] = [];
  return {
    values,
    next: (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    },
  };
}

function scopePredicate(scope: EditScope, next: Binder['next']): string {
  if (scope.kind === 'dm') {
    return `username = ${next(scope.owner)} AND bare_peer = ${next(scope.peer)}`;
  }
  if (scope.kind === 'room') {
    return `username = ${next(scope.room)}`;
  }
  const rooms = next(scope.owners.rooms);
  const ownLocalpart = next(scope.owners.ownLocalpart);
  const dmPeers = next(scope.owners.dmPeers);
  return `(username = ANY(${rooms}) OR (username = ${ownLocalpart} AND bare_peer = ANY(${dmPeers})))`;
}

/** The corrected or retracted target of an edit row, or null for a message. */
export function editTarget(xml: string): string | null {
  return correctionTarget(xml) ?? retractTarget(xml);
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && ' \t\n\r'.includes(char);
}

// The attribute value of the first matching tag, read with indexOf: never a
// regex over the whole stanza. Whitespace around `=` is allowed. A missing or
// malformed attribute is null.
function attributeValue(tag: string, name: string): string | null {
  let from = 0;
  for (;;) {
    const index = tag.indexOf(name, from);
    if (index === -1) {
      return null;
    }
    from = index + name.length;
    if (!isSpace(tag[index - 1])) {
      continue;
    }
    let equals = index + name.length;
    while (isSpace(tag[equals])) {
      equals += 1;
    }
    if (tag[equals] !== '=') {
      continue;
    }
    let cursor = equals + 1;
    while (isSpace(tag[cursor])) {
      cursor += 1;
    }
    const quote = tag[cursor];
    if (quote !== '"' && quote !== "'") {
      return null;
    }
    const end = tag.indexOf(quote, cursor + 1);
    if (end === -1) {
      return null;
    }
    const value = tag.slice(cursor + 1, end).trim();
    return value === '' ? null : value;
  }
}

function messageFrom(xml: string): string | null {
  const tagStart = xml.indexOf('<message');
  if (tagStart === -1) {
    return null;
  }
  const tagEnd = xml.indexOf('>', tagStart);
  if (tagEnd === -1) {
    return null;
  }
  return attributeValue(xml.slice(tagStart, tagEnd), 'from');
}

// A room compares ejabberd's stored `bare_peer`, the real sender's bare JID:
// the nick is a free display name anyone can take, and stored room XML normally
// carries no muc#user item. A DM compares the sender's bare JID from the stanza.
export function rowSenderKey(row: Pick<EditArchiveRow, 'kind' | 'barePeer' | 'xml'>): string {
  if (row.kind === 'groupchat') {
    return `room:${bareJid(row.barePeer).toLowerCase()}`;
  }
  const from = messageFrom(row.xml);
  return `dm:${from === null ? '' : bareJid(from)}`;
}

/**
 * Every accepted correction and retraction of `targetOriginIds` in `scope`,
 * newest first. The edits read has no time cursor and no search-window cap (an
 * old retraction must still hide a page-2 hit), only a cap of the target count
 * times 20. Edits from any other sender than the target's are dropped, so a
 * forged retraction or correction never hides or rewrites a message.
 */
export async function loadEditsForTargets(
  archive: ArchivePool,
  scope: EditScope,
  targetOriginIds: readonly string[],
): Promise<EditOverlay> {
  const ids = [...new Set(targetOriginIds.filter((id) => id !== ''))];
  if (ids.length === 0) {
    return new Map();
  }

  const targets = binder();
  const targetScope = scopePredicate(scope, targets.next);
  const targetIds = targets.next(ids);
  const targetRows = (await archive.query(
    `SELECT username AS owner, bare_peer AS "barePeer", kind, nick,
       origin_id AS "originId", timestamp, xml
     FROM archive WHERE ${targetScope} AND origin_id = ANY(${targetIds})`,
    targets.values,
  )) as unknown as EditArchiveRow[];

  const targetSenders = new Map<string, { sender: string; at: bigint }>();
  for (const row of targetRows) {
    targetSenders.set(row.originId, {
      sender: rowSenderKey(row),
      at: BigInt(row.timestamp),
    });
  }
  if (targetSenders.size === 0) {
    return new Map();
  }

  const edits = binder();
  const editScope = scopePredicate(scope, edits.next);
  const correction = edits.next(CORRECTION_PATTERN);
  const retraction = edits.next(RETRACTION_PATTERN);
  const cap = edits.next(ids.length * EDITS_PER_TARGET);
  const editRows = (await archive.query(
    `SELECT username AS owner, bare_peer AS "barePeer", kind, nick,
       origin_id AS "originId", timestamp, xml, txt AS "body"
     FROM archive WHERE ${editScope} AND (xml LIKE ${correction} OR xml LIKE ${retraction})
     ORDER BY timestamp DESC LIMIT ${cap}`,
    edits.values,
  )) as unknown as EditArchiveRow[];

  const overlay = new Map<string, EditOverlayEntry>();
  for (const row of editRows) {
    const target = editTarget(row.xml);
    if (target === null) {
      continue;
    }
    const original = targetSenders.get(target);
    if (original === undefined || rowSenderKey(row) !== original.sender) {
      continue;
    }
    const at = BigInt(row.timestamp);
    const entry = overlay.get(target) ?? { retracted: false };
    if (retractTarget(row.xml) !== null) {
      if (at >= original.at) {
        entry.retracted = true;
      }
    } else if (!entry.retracted && entry.latestText === undefined && at > original.at) {
      entry.latestText = row.body ?? '';
    }
    overlay.set(target, entry);
  }
  return overlay;
}
