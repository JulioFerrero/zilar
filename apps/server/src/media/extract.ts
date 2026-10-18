// effect-plain: moved unchanged from apps/server/src/media/indexer.ts (size split)
import { decodeAgentPayload, isLiveAiUiRow } from '../notify/ai-cards';
import type { ArchiveRow } from '../search/service';
import type { ExtractedMediaItem, MediaKind, MediaLink } from './indexer';

// The link rule copied from `packages/chat-core/src/links.ts` (which the server
// does not depend on): only `http(s)` URLs, trailing sentence punctuation
// trimmed, a closing bracket kept only when the URL opened it. The host comes
// from `new URL`, so anything the parser rejects is dropped.
const URL_PATTERN = /https?:\/\/[^\s<]+/gi;
// A single message can carry thousands of links; the index keeps the first 50
// so one message cannot exhaust the chat's row cap or the insert's parameters.
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

// The authority rule from `packages/chat-core/src/links.ts` (`toHref`): only a
// URL whose authority (the part before the path/query/fragment) contains a
// letter or digit becomes a link. `https://-/x` is dropped here, not by the URL
// parser.
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

// The items in one archive row: an attachment or voice note plus every link in
// the body. Pure and total: malformed XML, invalid JSON or a bad payload gives
// only the links, or nothing.
export function extractMediaItems(row: ArchiveRow): ExtractedMediaItem[] {
  // The live AI UI (a progress card) is not a message: its stage text is not
  // content, so it contributes no media and no links (T-1400).
  if (isLiveAiUiRow(row.xml)) {
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
      // A GIF is an attachment by storage and a distinct render kind by
      // convention (plan §3a): a `gif-` name with a video mime.
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

/** The account export's own `kind` (plan §6a): media kinds collapse to four. */
export type ExportMessageKind = 'text' | 'image' | 'file' | 'voice';

const EXPORT_KIND: Record<MediaKind, ExportMessageKind> = {
  image: 'image',
  // A GIF is an attachment rendered as an image (the same convention as the
  // media indexer, plan §3a), so the export's `image` covers both.
  gif: 'image',
  file: 'file',
  voice: 'voice',
  // A link is not a distinction the export's `kind` carries.
  link: 'text',
};

/**
 * One archive row as the export's message content: `body` is the row's `txt`,
 * and `kind` comes from the same extractor the media indexer uses, so the XML
 * is parsed in one place. A row with no attachment, voice note or link is text.
 */
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
