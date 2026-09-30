import { API_URL } from './auth';

/**
 * The mobile twin of the web chat-prefs client
 * (`apps/web/src/lib/api.ts`): list and set the caller's per-user prefs.
 * The wire contract lives in `apps/server/src/chat-prefs/routes.ts` and
 * `service.ts` (T-0113).
 *
 * Mobile has no zod, so — like `chat-api.ts` — the boundary is validated
 * with type guards. Muting a group covers its topics: the pref sits on the
 * General room JID and the client applies it to every topic unless the
 * topic has its own row.
 */

export interface ChatPref {
  chatJid: string;
  mutedUntil: string | null;
  archived: boolean;
  pinnedAt: string | null;
  updatedAt: string;
}

export interface PutChatPrefInput {
  mutedUntil?: string | null | undefined;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
}

export interface ChatPrefsApi {
  listChatPrefs(): Promise<ChatPref[]>;
  /** Answers the saved row, or null when the write landed on defaults. */
  putChatPref(chatJid: string, input: PutChatPrefInput): Promise<ChatPref | null>;
}

export class ChatPrefsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatPrefsApiError';
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

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isString(value) ? value : undefined;
}

/** A pref row the server sent; malformed rows return null and are dropped. */
export function parseChatPref(value: unknown): ChatPref | null {
  if (!isRecord(value)) return null;
  const chatJid = value['chatJid'];
  const archived = value['archived'];
  const updatedAt = value['updatedAt'];
  const mutedUntil = nullableString(value['mutedUntil']);
  const pinnedAt = nullableString(value['pinnedAt']);
  if (
    !isString(chatJid) ||
    typeof archived !== 'boolean' ||
    !isString(updatedAt) ||
    mutedUntil === undefined ||
    pinnedAt === undefined
  ) {
    return null;
  }
  return { chatJid, mutedUntil, archived, pinnedAt, updatedAt };
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
    throw new ChatPrefsApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new ChatPrefsApiError(response.status, code, message);
  }
  return body;
}

/** The production `ChatPrefsApi`: bearer auth, `fetch`, the build API URL. */
export function createChatPrefsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ChatPrefsApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new ChatPrefsApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new ChatPrefsApiError(
        200,
        'invalid_response',
        'The server sent an unexpected response',
      );
    }
    return parsed;
  };

  return {
    async listChatPrefs() {
      const body = await withToken('/api/chat-prefs', { method: 'GET' }, (value) => {
        if (!isRecord(value) || !Array.isArray(value['prefs'])) return null;
        const prefs: ChatPref[] = [];
        for (const entry of value['prefs']) {
          const pref = parseChatPref(entry);
          if (pref === null) return null;
          prefs.push(pref);
        }
        return prefs;
      });
      return body as ChatPref[];
    },
    async putChatPref(chatJid, input) {
      const body = await withToken(
        `/api/chat-prefs/${encodeURIComponent(chatJid)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        (value) => {
          // The server answers `{ prefs: null }` when the write landed on
          // all defaults (the row is deleted); the caller drops it locally.
          if (isRecord(value) && 'prefs' in value && value['prefs'] === null) {
            return 'deleted';
          }
          return parseChatPref(value);
        },
      );
      return body === 'deleted' ? null : (body as ChatPref);
    },
  };
}
