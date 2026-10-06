/**
 * The mobile media-gallery client (T-0436), the twin of `pins-api.ts`: it
 * pages `GET /api/media?chat&type&before&limit` (T-0431), returning
 * `{ items, next }`. Mobile has no zod, so — like the other mobile clients —
 * the boundary is validated with type guards and malformed rows are dropped.
 *
 * A `MediaItem` is display metadata only: `messageId` is the jump key, `at`
 * is ISO, and the optional fields depend on `kind`.
 */

export type MediaTab = 'media' | 'files' | 'links' | 'voice';

export type MediaKind = 'image' | 'file' | 'gif' | 'voice' | 'link';

export interface MediaItem {
  messageId: string;
  chat: string;
  at: string;
  senderName: string;
  kind: MediaKind;
  url?: string;
  name?: string;
  size?: number;
  mime?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  linkUrl?: string;
  linkHost?: string;
}

/** One page of the gallery, newest first; `next` is the paging cursor. */
export interface MediaPage {
  items: MediaItem[];
  next: string | null;
}

export interface ListChatMediaInput {
  chat: string;
  type: MediaTab;
  before?: string;
  limit?: number;
}

export interface MediaApi {
  listChatMedia(input: ListChatMediaInput): Promise<MediaPage>;
}

export class MediaApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MediaApiError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMediaKind(value: unknown): value is MediaKind {
  return (
    value === 'image' ||
    value === 'file' ||
    value === 'gif' ||
    value === 'voice' ||
    value === 'link'
  );
}

/**
 * A gallery row the viewer may see; a malformed row returns null and is
 * dropped by the list. Optional fields are only copied when the server sent
 * a value of the right shape, so a drifted payload never widens the type.
 */
export function parseMediaItem(value: unknown): MediaItem | null {
  if (!isRecord(value)) return null;
  const messageId = value['messageId'];
  const chat = value['chat'];
  const at = value['at'];
  const senderName = value['senderName'];
  const kind = value['kind'];
  if (
    !isString(messageId) ||
    !isString(chat) ||
    !isString(at) ||
    !isString(senderName) ||
    !isMediaKind(kind)
  ) {
    return null;
  }
  const item: MediaItem = { messageId, chat, at, senderName, kind };

  const url = value['url'];
  if (isString(url)) item.url = url;
  const name = value['name'];
  if (isString(name)) item.name = name;
  const mime = value['mime'];
  if (isString(mime)) item.mime = mime;
  const linkUrl = value['linkUrl'];
  if (isString(linkUrl)) item.linkUrl = linkUrl;
  const linkHost = value['linkHost'];
  if (isString(linkHost)) item.linkHost = linkHost;

  const size = value['size'];
  if (isNumber(size)) item.size = size;
  const width = value['width'];
  if (isNumber(width)) item.width = width;
  const height = value['height'];
  if (isNumber(height)) item.height = height;
  const durationMs = value['durationMs'];
  if (isNumber(durationMs)) item.durationMs = durationMs;

  const waveform = value['waveform'];
  if (Array.isArray(waveform) && waveform.every(isNumber)) {
    item.waveform = [...waveform];
  }
  return item;
}

async function request(
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new MediaApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new MediaApiError(response.status, code, message);
  }
  return body;
}

/** The production `MediaApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createMediaApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): MediaApi {
  return {
    async listChatMedia({ chat, type, before, limit }) {
      const token = await getToken();
      if (token === undefined) {
        throw new MediaApiError(401, 'unauthorized', 'No session');
      }
      const params = new URLSearchParams();
      params.set('chat', chat);
      params.set('type', type);
      if (before !== undefined) {
        params.set('before', before);
      }
      if (limit !== undefined) {
        params.set('limit', String(limit));
      }
      const body = await request(
        apiUrl,
        `/api/media?${params.toString()}`,
        token,
        { method: 'GET' },
        fetchImpl,
      );
      if (!isRecord(body) || !Array.isArray(body['items'])) {
        throw new MediaApiError(200, 'invalid_response', 'The server sent an unexpected response');
      }
      const items: MediaItem[] = [];
      for (const entry of body['items']) {
        const item = parseMediaItem(entry);
        if (item !== null) {
          items.push(item);
        }
      }
      const next = body['next'];
      return { items, next: isString(next) ? next : null };
    },
  };
}
