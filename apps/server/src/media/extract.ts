// effect-plain: pure link and attachment extraction; malformed input yields no items.
import { decodeAgentPayload, isLiveAiUiRow } from '../notify/ai-cards';
import type { ArchiveRow } from '../search/service';
import type { ExtractedMediaItem, MediaKind, MediaLink } from './indexer';

// The link rule from `packages/chat-core/src/links.ts`: only `http(s)` URLs, trailing
// sentence punctuation trimmed, a closing bracket kept only when the URL opened it.
const URL_PATTERN = /https?:\/\/[^\s<]+/gi;
// The index keeps the first 50 links, so one message cannot exhaust the chat's row cap or
// the insert's parameters.
export const MEDIA_LINKS_PER_MESSAGE = 50;
const ALWAYS_STRIP = new Set(['.', ',', ';', ':', '!', '?', '…', '»', '"', "'"]);
const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function countCharacter(value: string, character: string): number {
  let total = 0;
  for (const item of value) {
    if (item === character) {
      total += 1;
    }
  }
  return total;
}

function trimTrailingPunctuation(raw: string): string {
  let url = raw;
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (last === undefined) {
      break;
    }
    if (ALWAYS_STRIP.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const opener = Object.entries(BRACKETS).find(([, closer]) => closer === last)?.[0];
    if (opener !== undefined && countCharacter(url, last) > countCharacter(url, opener)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

// Only a URL whose authority contains a letter or digit becomes a link; the URL parser
// alone accepts `https://-/x`.
function authorityOf(url: string): string {
  const match = /^https?:\/\//i.exec(url);
  if (match === null) {
    return '';
  }
  return url.slice(match[0].length).split(/[/?#]/, 1)[0] ?? '';
}

export function extractLinks(text: string): MediaLink[] {
  const links: MediaLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    if (raw === undefined) {
      continue;
    }
    const url = trimTrailingPunctuation(raw);
    if (!/[a-z0-9]/i.test(authorityOf(url))) {
      continue;
    }
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    if (host === '' || seen.has(url)) {
      continue;
    }
    seen.add(url);
    links.push({ url, host });
    if (links.length >= MEDIA_LINKS_PER_MESSAGE) {
      break;
    }
  }
  return links;
}

export function extractMediaItems(row: ArchiveRow): ExtractedMediaItem[] {
  // A live AI progress card is not a message: its stage text contributes no media or links.
  if (isLiveAiUiRow(row.xml, row.barePeer)) {
    return [];
  }
  try {
    return extractMediaItemsUnsafe(row);
  } catch {
    return [];
  }
}

function extractMediaItemsUnsafe(row: ArchiveRow): ExtractedMediaItem[] {
  const items: ExtractedMediaItem[] = [];
  const payload = decodeAgentPayload(row.xml);
  if (payload !== null) {
    if (payload.type === 'attachment') {
      const attachment = payload.data;
      // A GIF is an attachment by storage and a distinct render kind by convention.
      const isGif = attachment.name.startsWith('gif-') && attachment.mime.startsWith('video/');
      items.push({
        kind: isGif ? 'gif' : attachment.kind,
        url: attachment.url,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        width: attachment.width,
        height: attachment.height,
      });
    } else if (payload.type === 'voice') {
      items.push({
        kind: 'voice',
        url: payload.data.url,
        mime: payload.data.mime,
        durationMs: payload.data.duration_ms,
        waveform: payload.data.waveform,
      });
    }
  }
  for (const link of extractLinks(row.body ?? '')) {
    items.push({ kind: 'link', linkUrl: link.url, linkHost: link.host });
  }
  return items;
}

/** The export's `kind`: media kinds collapse to four. */
export type ExportMessageKind = 'text' | 'image' | 'file' | 'voice';

const EXPORT_KIND: Record<MediaKind, ExportMessageKind> = {
  image: 'image',
  gif: 'image',
  file: 'file',
  voice: 'voice',
  // A link is not a distinction the export's `kind` carries.
  link: 'text',
};

export function extractMessageContent(row: ArchiveRow): {
  body: string;
  kind: ExportMessageKind;
} {
  for (const item of extractMediaItems(row)) {
    if (item.kind !== 'link') {
      return { body: row.body ?? '', kind: EXPORT_KIND[item.kind] };
    }
  }
  return { body: row.body ?? '', kind: 'text' };
}
