import { bareJid } from '@zilar/protocol';
import { commonPrefixLength } from './smooth-text';
import type { MentionMember, UiMention } from './types';

// Offsets here are UTF-16 code units; `@zilar/xmpp-core` converts them to and from the XEP-0372 code-point offsets on the wire.

export interface MentionQuery {
  start: number;
  query: string;
}

const WHITESPACE = /\s/;

// The `@` must start the text or follow whitespace, and the query runs from the `@` to the caret with no spaces in between.
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
  caret: number;
  mention: UiMention;
}

// Replaces the `@query` with `@handle ` when the member has one, else `@Name `; the recorded range excludes the trailing space.
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

function commonSuffixLength(left: string, right: string, prefix: number): number {
  const max = Math.min(left.length, right.length) - prefix;
  let index = 0;
  while (index < max && left[left.length - 1 - index] === right[right.length - 1 - index]) {
    index += 1;
  }
  return index;
}

// A range entirely before the edit stays, one entirely after shifts, and one the edit touches is dropped.
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

// Ranges that are out of bounds or overlap an earlier one are ignored.
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

// Handle prefix matches rank first, then name matches; ties keep the existing order. Matching is case- and accent-insensitive.
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

// The bare JID must equal `meJid` exactly; a matching localpart on another domain is not me.
export function isMentionOfMe(jid: string, meJid: string | undefined): boolean {
  if (meJid === undefined) {
    return false;
  }
  return bareJid(jid).split('?')[0] === meJid;
}

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
