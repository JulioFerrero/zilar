import { z } from 'zod';

/** Base path for the server API. The Vite dev server proxies it same-origin. */
export const API_BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  image: z.string().nullable().optional(),
  jid: z.string().nullable().optional(),
});

export type Me = z.infer<typeof meSchema>;

const contactSchema = z.object({
  userId: z.string(),
  name: z.string(),
  jid: z.string(),
  avatarUrl: z.string().optional(),
});

export type Contact = z.infer<typeof contactSchema>;

const dmEntrySchema = z.object({
  kind: z.literal('dm'),
  chatJid: z.string(),
  title: z.string(),
  userId: z.string(),
  avatarUrl: z.string().optional(),
});

const groupEntrySchema = z.object({
  kind: z.literal('group'),
  chatJid: z.string(),
  title: z.string(),
  groupId: z.string(),
  memberCount: z.number(),
  role: z.enum(['owner', 'admin', 'member']),
});

const chatEntrySchema = z.discriminatedUnion('kind', [dmEntrySchema, groupEntrySchema]);

export type ChatEntry = z.infer<typeof chatEntrySchema>;

const chatsSchema = z.object({ chats: z.array(chatEntrySchema) });

const groupDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdBy: z.string(),
  members: z.array(
    z.object({ userId: z.string(), name: z.string(), role: z.enum(['owner', 'admin', 'member']) }),
  ),
});

export type GroupDetail = z.infer<typeof groupDetailSchema>;

const inviteSchema = z.object({
  code: z.string(),
  url: z.string(),
  expiresAt: z.string().optional(),
});

export type Invite = z.infer<typeof inviteSchema>;

const xmppTokenSchema = z.object({
  jid: z.string(),
  token: z.string(),
  expiresAt: z.string(),
  service: z.string(),
  domain: z.string(),
  mucDomain: z.string(),
});

export type XmppToken = z.infer<typeof xmppTokenSchema>;

async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server');
  }

  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(raw);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : 'request_failed',
      parsed.success ? parsed.data.error.message : `Request failed (${response.status})`,
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.data;
}

export function getMe(): Promise<Me> {
  return request('/me', meSchema);
}

export function updateMe(name: string): Promise<Me> {
  return request('/me', meSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function getChats(): Promise<ChatEntry[]> {
  const { chats } = await request('/chats', chatsSchema);
  return chats;
}

export async function getContacts(): Promise<Contact[]> {
  return request('/contacts', z.array(contactSchema));
}

export function createGroup(input: { title: string; memberIds: string[] }): Promise<GroupDetail> {
  return request('/groups', groupDetailSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function createInvite(): Promise<Invite> {
  return request('/invites', inviteSchema, { method: 'POST' });
}

export function getInvite(code: string): Promise<{ valid: boolean }> {
  return request(`/invites/${encodeURIComponent(code)}`, z.object({ valid: z.boolean() }));
}

export function getXmppToken(): Promise<XmppToken> {
  return request('/xmpp/token', xmppTokenSchema, { method: 'POST' });
}
