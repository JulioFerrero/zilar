import type { SnapshotPinKind } from './pin-snapshot';

export type PinKind = SnapshotPinKind;

/**
 * The mobile twin of the web pins client (`apps/web/src/lib/api.ts`): list,
 * pin and unpin. The wire contract lives in
 * `apps/server/src/pins/{routes,service,access}` (T-0114).
 *
 * Mobile has no zod, so — like `chat-api.ts` — the boundary is validated
 * with type guards. `chat` is a room bare JID for groups/topics, or a DM
 * peer's bare JID (the server keeps the canonical pair key, so both sides
 * share one list). The snapshot (`senderName`/`text`/`kind`) is display
 * only: the server trusts it for rendering, never for authorization.
 */

export interface Pin {
  id: string;
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: PinKind;
  pinnedBy: string;
  pinnedAt: string;
}

export interface PinMessageInput {
  chat: string;
  messageId: string;
  senderName: string;
  text: string;
  kind: PinKind;
}

export interface PinsApi {
  listPins(chat: string): Promise<Pin[]>;
  pinMessage(input: PinMessageInput): Promise<Pin>;
  unpinMessage(id: string): Promise<Pin>;
}

export class PinsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PinsApiError';
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

/** Unknown kinds fall back to `text`, so a newer server never breaks pins. */
export function parsePinKind(value: unknown): PinKind {
  if (
    value === 'text' ||
    value === 'image' ||
    value === 'file' ||
    value === 'voice' ||
    value === 'card'
  ) {
    return value;
  }
  return 'text';
}

/** A pin row the viewer may see; malformed rows return null and are dropped. */
export function parsePin(value: unknown): Pin | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const chat = value['chat'];
  const messageId = value['messageId'];
  const senderName = value['senderName'];
  const text = value['text'];
  const pinnedBy = value['pinnedBy'];
  const pinnedAt = value['pinnedAt'];
  if (
    !isString(id) ||
    !isString(chat) ||
    !isString(messageId) ||
    !isString(senderName) ||
    !isString(text) ||
    !isString(pinnedBy) ||
    !isString(pinnedAt)
  ) {
    return null;
  }
  return {
    id,
    chat,
    messageId,
    senderName,
    text,
    kind: parsePinKind(value['kind']),
    pinnedBy,
    pinnedAt,
  };
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
    throw new PinsApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new PinsApiError(response.status, code, message);
  }
  return body;
}

/** The production `PinsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createPinsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): PinsApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new PinsApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new PinsApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return parsed;
  };

  return {
    async listPins(chat) {
      const params = new URLSearchParams();
      params.set('chat', chat);
      const body = await withToken(`/api/pins?${params.toString()}`, { method: 'GET' }, (value) => {
        if (!isRecord(value) || !Array.isArray(value['pins'])) return null;
        const pins: Pin[] = [];
        for (const entry of value['pins']) {
          const pin = parsePin(entry);
          if (pin === null) return null;
          pins.push(pin);
        }
        return pins;
      });
      return body as Pin[];
    },
    async pinMessage(input) {
      const body = await withToken(
        '/api/pins',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        parsePin,
      );
      return body as Pin;
    },
    async unpinMessage(id) {
      // The server echoes the deleted row, so the store can remove it
      // without a refetch.
      const body = await withToken(
        `/api/pins/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        parsePin,
      );
      return body as Pin;
    },
  };
}

// The snapshot helpers (`pinKindFor`, `pinSnapshotText`, `pinLabel`) live in
// the dependency-free `pin-snapshot.ts`, so components can import them
// without pulling the API client (Vitest cannot resolve `@/` for component
// modules — see `apps/mobile` test notes in T-0112).
export { pinKindFor, pinLabel, pinSnapshotText } from './pin-snapshot';
export type { SnapshotPinKind } from './pin-snapshot';
