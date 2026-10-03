import { API_URL } from './auth';

/**
 * The contacts API (`/api/users/by-handle/:handle` and `/api/contact-requests`),
 * the mobile twin of the web client in `apps/web/src/lib/api.ts`. The wire
 * contract lives in `apps/server/src/contact-requests/routes.ts` and
 * `apps/server/src/contact-requests/service.ts`.
 *
 * Mobile has no zod, so — like `ais-api.ts` and `approvals-api.ts` — the
 * boundary is validated with type guards. `ContactsApiError` keeps the
 * server's `code` and `status`, so screens can branch on the error without
 * parsing the message again (404 = unknown handle, 429 = rate limited).
 */

export type ContactRelation = 'none' | 'contact' | 'request_sent' | 'request_received' | 'self';

export interface HandleProfile {
  userId: string;
  name: string;
  handle: string;
  image: string | null;
  relation: ContactRelation;
}

export type ContactRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface ContactRequestPerson {
  userId: string;
  name: string;
  handle: string | null;
  image: string | null;
}

export interface ContactRequestView {
  id: string;
  status: ContactRequestStatus;
  createdAt: string;
  other: ContactRequestPerson;
}

export interface ContactRequestList {
  incoming: ContactRequestView[];
  outgoing: ContactRequestView[];
}

export interface ContactRequestRow {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: ContactRequestStatus;
  createdAt: string;
  decidedAt?: string | undefined;
}

export interface CreatedContactRequest {
  request: ContactRequestRow;
  /** Present when the other side already asked: offer Accept, not a second row. */
  incoming?: boolean | undefined;
}

export interface ContactsApi {
  lookupByHandle(handle: string): Promise<HandleProfile>;
  sendContactRequest(handle: string): Promise<CreatedContactRequest>;
  listContactRequests(): Promise<ContactRequestList>;
  acceptContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  declineContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
  cancelContactRequest(id: string): Promise<{ request: ContactRequestRow }>;
}

export class ContactsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ContactsApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Normalizes a typed @handle for lookup: strips a leading @, trims
 * whitespace, lowercases. The server compares case-insensitively, so the
 * lookup sends the normalized form.
 */
export function normalizeHandleInput(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isRelation(value: unknown): value is ContactRelation {
  return (
    value === 'none' ||
    value === 'contact' ||
    value === 'request_sent' ||
    value === 'request_received' ||
    value === 'self'
  );
}

function isRequestStatus(value: unknown): value is ContactRequestStatus {
  return (
    value === 'pending' || value === 'accepted' || value === 'declined' || value === 'cancelled'
  );
}

function parseHandleProfile(value: unknown): HandleProfile | null {
  if (!isRecord(value)) return null;
  const userId = value['userId'];
  const name = value['name'];
  const handle = value['handle'];
  const image = value['image'];
  const relation = value['relation'];
  if (!isString(userId) || !isString(name) || !isString(handle) || !isRelation(relation)) {
    return null;
  }
  return { userId, name, handle, image: isString(image) ? image : null, relation };
}

function parseRequestPerson(value: unknown): ContactRequestPerson | null {
  if (!isRecord(value)) return null;
  const userId = value['userId'];
  const name = value['name'];
  const handle = value['handle'];
  const image = value['image'];
  if (!isString(userId) || !isString(name)) return null;
  return {
    userId,
    name,
    handle: isString(handle) ? handle : null,
    image: isString(image) ? image : null,
  };
}

function parseRequestView(value: unknown): ContactRequestView | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const status = value['status'];
  const createdAt = value['createdAt'];
  const other = parseRequestPerson(value['other']);
  if (!isString(id) || !isRequestStatus(status) || !isString(createdAt) || other === null) {
    return null;
  }
  return { id, status, createdAt, other };
}

function parseRequestList(value: unknown): ContactRequestList | null {
  if (!isRecord(value)) return null;
  const incoming = value['incoming'];
  const outgoing = value['outgoing'];
  if (!Array.isArray(incoming) || !Array.isArray(outgoing)) return null;
  const parsedIncoming: ContactRequestView[] = [];
  for (const item of incoming) {
    const parsed = parseRequestView(item);
    if (parsed === null) return null;
    parsedIncoming.push(parsed);
  }
  const parsedOutgoing: ContactRequestView[] = [];
  for (const item of outgoing) {
    const parsed = parseRequestView(item);
    if (parsed === null) return null;
    parsedOutgoing.push(parsed);
  }
  return { incoming: parsedIncoming, outgoing: parsedOutgoing };
}

function parseRequestRow(value: unknown): ContactRequestRow | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const fromUserId = value['fromUserId'];
  const toUserId = value['toUserId'];
  const status = value['status'];
  const createdAt = value['createdAt'];
  const decidedAt = value['decidedAt'];
  if (
    !isString(id) ||
    !isString(fromUserId) ||
    !isString(toUserId) ||
    !isRequestStatus(status) ||
    !isString(createdAt)
  ) {
    return null;
  }
  return {
    id,
    fromUserId,
    toUserId,
    status,
    createdAt,
    ...(decidedAt === undefined ? {} : { decidedAt: isString(decidedAt) ? decidedAt : undefined }),
  };
}

function parseCreatedRequest(value: unknown): CreatedContactRequest | null {
  if (!isRecord(value)) return null;
  const request = parseRequestRow(value['request']);
  if (request === null) return null;
  const incoming = value['incoming'];
  return {
    request,
    ...(incoming === undefined ? {} : { incoming: incoming === true }),
  };
}

function parseDecidedRequest(value: unknown): { request: ContactRequestRow } | null {
  if (!isRecord(value)) return null;
  const request = parseRequestRow(value['request']);
  return request === null ? null : { request };
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
    throw new ContactsApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new ContactsApiError(response.status, code, message);
  }
  return body;
}

/**
 * The domain part of a bare JID (`ana@zilar.test` -> `zilar.test`).
 * Returns undefined for anything that is not a bare user JID.
 */
export function domainOfJid(jid: string | null | undefined): string | undefined {
  if (typeof jid !== 'string') return undefined;
  const bare = jid.split('/')[0] ?? '';
  const parts = bare.split('@');
  if (parts.length !== 2) return undefined;
  const domain = parts[1] ?? '';
  return domain === '' ? undefined : domain;
}

/**
 * The DM chat id for a contact: the server builds it from the user's id
 * lowercased plus the XMPP domain (`localpartFor` + `jidFor` in
 * `apps/server/src/xmpp/provisioning.ts`). Normal ids are alphanumeric, so
 * lowercasing is the whole mapping; ids that would need the server's hash
 * fallback resolve to a chat that does not exist and the caller falls back
 * to the chats list.
 */
export function contactChatId(userId: string, domain: string): string {
  return `${userId.toLowerCase()}@${domain}`;
}

/** The production `ContactsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createContactsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ContactsApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new ContactsApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new ContactsApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return parsed;
  };

  return {
    async lookupByHandle(handle) {
      const body = await withToken(
        `/api/users/by-handle/${encodeURIComponent(handle)}`,
        { method: 'GET' },
        parseHandleProfile,
      );
      return body as HandleProfile;
    },
    async sendContactRequest(handle) {
      const body = await withToken(
        '/api/contact-requests',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle }),
        },
        parseCreatedRequest,
      );
      return body as CreatedContactRequest;
    },
    async listContactRequests() {
      const body = await withToken('/api/contact-requests', { method: 'GET' }, parseRequestList);
      return body as ContactRequestList;
    },
    async acceptContactRequest(id) {
      const body = await withToken(
        `/api/contact-requests/${encodeURIComponent(id)}/accept`,
        { method: 'POST' },
        parseDecidedRequest,
      );
      return body as { request: ContactRequestRow };
    },
    async declineContactRequest(id) {
      const body = await withToken(
        `/api/contact-requests/${encodeURIComponent(id)}/decline`,
        { method: 'POST' },
        parseDecidedRequest,
      );
      return body as { request: ContactRequestRow };
    },
    async cancelContactRequest(id) {
      const body = await withToken(
        `/api/contact-requests/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        parseDecidedRequest,
      );
      return body as { request: ContactRequestRow };
    },
  };
}
