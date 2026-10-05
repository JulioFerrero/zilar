import type { MentionMember, UiMention } from './types';

// Offsets in this module are UTF-16 code units (JS string indices): the
// textarea caret, `String.slice` and React all use them. `@zilar/xmpp-core`
// converts them to and from the XEP-0372 code-point offsets on the wire.

export interface MentionQuery {
  /** Index of the `@` that starts the query. */
  start: number;
  /** Text between the `@` and the caret; never contains a space. */
  query: string;
}

const WHITESPACE = /\s/;

/**
 * The `@query` being typed at the caret, or `undefined` when the caret is not
 * inside one. The `@` must start the text or follow whitespace, and the query
 * runs from the `@` to the caret with no spaces in between.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | undefined {
  const position = Math.max(0, Math.min(caret, text.length));
  if (position === 0) {
    return undefined;
  }
  let start = position;
  while (start > 0 && !WHITESPACE.test(text[start - 1] ?? '')) {
    start -= 1;
  }
  const at = text.lastIndexOf('@', position - 1);
  if (at < start || (at > 0 && !WHITESPACE.test(text[at - 1] ?? ''))) {
    return undefined;
  }
  return { start: at, query: text.slice(at + 1, position) };
}

export interface InsertMentionResult {
  text: string;
  /** Where the caret goes, just past the inserted token's trailing space. */
  caret: number;
  mention: UiMention;
}

/**
 * Replaces the `@query` at the caret with `@handle ` when the member has one
 * (T-0169), else `@Name ` as before, and reports the mention to record. The
 * range always covers the inserted token, without the trailing space.
 * Returns `undefined` when the caret is not in a mention query.
 */
export function insertMention(
  text: string,
  caret: number,
  member: MentionMember,
): InsertMentionResult | undefined {
  const query = findMentionQuery(text, caret);
  if (query === undefined) {
    return undefined;
  }
  const token =
    member.handle === undefined || member.handle === '' ? `@${member.name}` : `@${member.handle}`;
  const next = `${text.slice(0, query.start)}${token} ${text.slice(caret)}`;
  return {
    text: next,
    caret: query.start + token.length + 1,
    mention: {
      jid: member.jid,
      name: member.name,
      begin: query.start,
      end: query.start + token.length,
    },
  };
}

function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(left: string, right: string, prefix: number): number {
  const max = Math.min(left.length, right.length) - prefix;
  let index = 0;
  while (index < max && left[left.length - 1 - index] === right[right.length - 1 - index]) {
    index += 1;
  }
  return index;
}

/**
 * Keeps the mention ranges valid after `prevText` becomes `nextText`: a range
 * entirely before the edit stays, a range entirely after it shifts, and a
 * range the edit touches is dropped (an edited mention is no longer one).
 */
export function rebaseMentions(
  prevText: string,
  nextText: string,
  mentions: readonly UiMention[],
): UiMention[] {
  const prefix = commonPrefixLength(prevText, nextText);
  const suffix = commonSuffixLength(prevText, nextText, prefix);
  const changedEnd = prevText.length - suffix;
  const delta = nextText.length - prevText.length;

  const rebased: UiMention[] = [];
  for (const mention of mentions) {
    if (mention.end <= prefix) {
      rebased.push(mention);
    } else if (mention.begin >= changedEnd) {
      rebased.push({ ...mention, begin: mention.begin + delta, end: mention.end + delta });
    }
  }
  return rebased.filter(
    (mention) =>
      mention.begin >= 0 && mention.begin < mention.end && mention.end <= nextText.length,
  );
}

export type MentionSegment =
  { kind: 'text'; text: string } | { kind: 'mention'; text: string; jid: string; name: string };

/**
 * Splits text into plain-text and mention segments, oldest range first. Ranges
 * that are out of bounds or overlap an earlier one are ignored.
 */
export function splitMentions(
  text: string,
  mentions: readonly UiMention[] | undefined,
): MentionSegment[] {
  const valid = (mentions ?? [])
    .filter(
      (mention) => mention.begin >= 0 && mention.begin < mention.end && mention.end <= text.length,
    )
    .sort((left, right) => left.begin - right.begin);

  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const mention of valid) {
    if (mention.begin < cursor) {
      continue;
    }
    if (mention.begin > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, mention.begin) });
    }
    segments.push({
      kind: 'mention',
      text: text.slice(mention.begin, mention.end),
      jid: mention.jid,
      name: mention.name,
    });
    cursor = mention.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Members matching the query, case- and accent-insensitively: a handle prefix
 * match (T-0169, the `@` itself is not part of the query), or a word-prefix
 * match on the display name as before. Handle matches rank first, then name
 * matches; ties keep the existing order.
 */
export function filterMentionMembers(
  members: readonly MentionMember[],
  query: string,
): MentionMember[] {
  const needle = fold(query.trim().replace(/^@/, ''));
  if (needle.length === 0) {
    return [...members];
  }
  const byHandle: MentionMember[] = [];
  const byName: MentionMember[] = [];
  for (const member of members) {
    const handle =
      member.handle === undefined || member.handle === '' ? undefined : fold(member.handle);
    if (handle !== undefined && handle.startsWith(needle)) {
      byHandle.push(member);
      continue;
    }
    if (
      fold(member.name)
        .split(/\s+/)
        .some((word) => word.startsWith(needle))
    ) {
      byName.push(member);
    }
  }
  return [...byHandle, ...byName];
}

/**
 * True when a mention JID is the current user: the bare JID must equal `meJid`
 * exactly. A localpart that happens to match is not enough, so a mention of the
 * same name on another domain is not confused with me.
 */
export function isMentionOfMe(jid: string, meJid: string | undefined): boolean {
  if (meJid === undefined) {
    return false;
  }
  return (jid.split('/')[0] ?? jid).split('?')[0] === meJid;
}

/**
 * Drops or offsets mentions once `text` has been trimmed to `trimmed`, so the
 * ranges still point at the sent body.
 */
export function mentionsForTrimmedText(
  text: string,
  trimmed: string,
  mentions: readonly UiMention[],
): UiMention[] {
  const leading = text.length - text.trimStart().length;
  return mentions
    .map((mention) => ({
      ...mention,
      begin: mention.begin - leading,
      end: mention.end - leading,
    }))
    .filter(
      (mention) =>
        mention.begin >= 0 && mention.begin < mention.end && mention.end <= trimmed.length,
    );
}
