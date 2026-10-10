// effect-plain: moved unchanged from apps/server/src/media/indexer.ts (size split)
import { decodePayload, type Payload } from '@zilar/protocol';
import type { ArchiveRow } from '../search/service';
import type { ExtractedMediaItem, MediaLink } from './indexer';

// The agent payload namespace (packages/xmpp-core/src/namespaces.ts). The
// server cannot import it, so the value is repeated with this pointer.
const AGENT_NAMESPACE = 'urn:zilar:agent:0';
const AGENT_PATTERN = new RegExp(
  `<agent\\b[^>]*\\bxmlns\\s*=\\s*["']${AGENT_NAMESPACE}["'][^>]*>([\\s\\S]*?)</agent>`,
  'i',
);

// The parser unescapes the five XML entities (in this order, so an escaped
// ampersand is not double-decoded).
function unescapeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

// Small defensive regex readers, like `stanzaFrom`/`tagAttribute` in
// search/routes.ts — a missing or malformed element is null, never a throw.
function decodeAgentPayload(xml: string): Payload | null {
  const match = AGENT_PATTERN.exec(xml);
  if (match === null) {
    return null;
  }
  const result = decodePayload(unescapeXmlText(match[1] ?? ''));
  return result.ok ? result.payload : null;
}

// The link rule copied from `packages/chat-core/src/links.ts` (which the server
// does not depend on): only `http(s)` URLs, trailing sentence punctuation
// trimmed, a closing bracket kept only when the URL opened it. The host comes
// from `new URL`, so anything the parser rejects is dropped.
const URL_PATTERN = /https?:\/\/[^\s<]+/gi;
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
  }
  return links;
}

// The items in one archive row: an attachment or voice note plus every link in
// the body. Pure and total: malformed XML, invalid JSON or a bad payload gives
// only the links, or nothing.
export function extractMediaItems(row: ArchiveRow): ExtractedMediaItem[] {
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
