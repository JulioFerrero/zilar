import type { ChatSummary } from './types';
import { describeUserAgent } from './user-agent';

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter()
    : undefined;

// Emoji sequences, flags and ZWJ families count as one character; falls back to code-point iteration when `Intl.Segmenter` is unavailable.
export function graphemes(value: string): string[] {
  if (segmenter === undefined) {
    return Array.from(value);
  }
  return Array.from(segmenter.segment(value), (segment) => segment.segment);
}

const MAX_PLACEHOLDER_TITLE_LENGTH = 18;

// A long title wraps the placeholder on a phone-width composer, and the header already shows the full title.
export function composerPlaceholder(title: string | undefined): string {
  if (title === undefined || title === '' || title.length > MAX_PLACEHOLDER_TITLE_LENGTH) {
    return 'Message';
  }
  return `Message ${title}`;
}

// Case-insensitive prefix match on any word of the name, or on the handle.
export function matchesContactFilter(
  contact: { name: string; handle?: string | null | undefined },
  needle: string,
): boolean {
  if (needle === '') {
    return true;
  }
  if (
    contact.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(needle))
  ) {
    return true;
  }
  const handle = contact.handle;
  return handle != null && handle.toLowerCase().startsWith(needle);
}

export function jidLocalpart(jid: string): string {
  const at = jid.indexOf('@');
  return (at === -1 ? jid : jid.slice(0, at)).toLowerCase();
}

export function targetLabel(chat: ChatSummary): string {
  return chat.topic !== undefined && chat.groupTitle !== undefined
    ? `${chat.groupTitle} › ${chat.title}`
    : chat.title;
}

// The native apps' user agents say nothing useful, so name them by kind.
export function deviceName(device: {
  kind: 'webpush' | 'fcm' | 'apns';
  userAgent: string | null;
}): string {
  if (device.kind === 'fcm') {
    return 'Android app';
  }
  if (device.kind === 'apns') {
    return 'iPhone app';
  }
  return describeUserAgent(device.userAgent);
}
