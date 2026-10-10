// The media-gallery route (T-1045): `GET /media?chat&type&before&limit`. It
// rebuilds the chat's rows from the messages domain's seed (`data.messages`,
// the combined `MockData`), so it never edits the message files. The tab to
// kind mapping and the row shape mirror the server (`apps/server/src/media`),
// and the contract lives in `@zilar/api-contract` (`media.ts`).
import type { MediaItem, MediaTab } from '@zilar/api-contract';
import type { MockMessage } from '../../data';
import { currentUser } from '../../data/people';
import type { MockData } from '../../state';
import { badRequest, jsonResponse, notFound, type MockHttpRequest } from '../../http/shared';
import { extractLinks } from './links';

// The tab a client asks for maps to the kinds it shows; `media` is the grid.
const TYPE_KINDS: Record<MediaTab, readonly MediaItem['kind'][]> = {
  media: ['image', 'gif'],
  files: ['file'],
  links: ['link'],
  voice: ['voice'],
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface IndexedItem {
  readonly item: MediaItem;
  readonly atMicros: number;
}

export function handleMedia(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.segments.length !== 1 || request.segments[0] !== 'media') {
    return undefined;
  }
  if (request.method !== 'GET') {
    return undefined;
  }
  const chat = request.query.get('chat') ?? '';
  const type = request.query.get('type') ?? 'media';
  const limit = parseLimit(request.query.get('limit'));
  const before = parseBefore(request.query.get('before'));
  if (chat === '' || !isTab(type) || limit === null || before === null) {
    return badRequest('invalid_request', 'Invalid media query');
  }
  const thread = data.messages[chat];
  if (thread === undefined) {
    return notFound('Chat not found');
  }
  const kinds = new Set(TYPE_KINDS[type]);
  const indexed = thread
    .flatMap((message) => messageItems(data, chat, message))
    .filter((entry) => kinds.has(entry.item.kind))
    .filter((entry) => before === undefined || entry.atMicros < before)
    .sort(compareItems);
  const page = indexed.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const shown = hasMore ? page.slice(0, limit) : page;
  const last = shown[shown.length - 1];
  return jsonResponse({
    items: shown.map((entry) => entry.item),
    next: hasMore && last !== undefined ? String(last.atMicros) : null,
  });
}

// Newest first, then by message id, like the server's `ORDER BY at_micros DESC,
// id ASC`.
function compareItems(a: IndexedItem, b: IndexedItem): number {
  if (a.atMicros !== b.atMicros) {
    return b.atMicros - a.atMicros;
  }
  return a.item.messageId < b.item.messageId ? -1 : a.item.messageId > b.item.messageId ? 1 : 0;
}

function messageItems(data: MockData, chat: string, message: MockMessage): IndexedItem[] {
  const atMicros = message.timestamp.getTime() * 1000;
  const base = {
    messageId: message.id,
    chat,
    at: message.timestamp.toISOString(),
    senderName: senderNameFor(data, message.fromJid),
  };
  const items: MediaItem[] = [];
  const payload = message.payload;
  if (payload?.type === 'attachment') {
    const attachment = payload.data;
    // A GIF is a `gif-` attachment with a video mime, like the server.
    const isGif = attachment.name.startsWith('gif-') && attachment.mime.startsWith('video/');
    items.push({
      ...base,
      kind: isGif ? 'gif' : attachment.kind,
      url: attachment.url,
      name: attachment.name,
      size: attachment.size,
      mime: attachment.mime,
      ...(attachment.width === undefined ? {} : { width: attachment.width }),
      ...(attachment.height === undefined ? {} : { height: attachment.height }),
    });
  } else if (payload?.type === 'voice') {
    const voice = payload.data;
    items.push({
      ...base,
      kind: 'voice',
      ...(voice.url === undefined ? {} : { url: voice.url }),
      mime: voice.mime,
      durationMs: voice.duration_ms,
      waveform: [...voice.waveform],
    });
  }
  if (message.body !== undefined) {
    for (const link of extractLinks(message.body)) {
      items.push({ ...base, kind: 'link', linkUrl: link.url, linkHost: link.host });
    }
  }
  return items.map((item) => ({ item, atMicros }));
}

// A DM: the viewer's own messages read "You", the peer reads its seed name. A
// room message carries its occupant nick after `/`, which wins.
function senderNameFor(data: MockData, fromJid: string): string {
  const [bare, resource] = fromJid.split('/');
  const nick = resource?.trim() ?? '';
  if (nick !== '') {
    return nick;
  }
  const jid = (bare ?? '').toLowerCase();
  if (jid === currentUser.jid) {
    return 'You';
  }
  const person = data.people.find((candidate) => candidate.jid.toLowerCase() === jid);
  return person?.name ?? (jid.split('@')[0] || 'Unknown');
}

function parseLimit(raw: string | null): number | null {
  if (raw === null) {
    return DEFAULT_LIMIT;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT ? value : null;
}

function parseBefore(raw: string | null): number | undefined | null {
  if (raw === null) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isTab(value: string): value is MediaTab {
  return value === 'media' || value === 'files' || value === 'links' || value === 'voice';
}
