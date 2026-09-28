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
  userId: z.string().optional(),
  avatarUrl: z.string().optional(),
  /** Set on the caller's AIs; absent or false for human contacts. */
  isAi: z.boolean().optional(),
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

const groupMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
});

const groupAiSchema = z.object({
  aiId: z.string(),
  jid: z.string(),
  name: z.string(),
  ownerId: z.string(),
});

const groupDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdBy: z.string(),
  members: z.array(groupMemberSchema),
  ais: z.array(groupAiSchema),
});

export type GroupMember = z.infer<typeof groupMemberSchema>;
export type GroupAi = z.infer<typeof groupAiSchema>;
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

export function getGroup(groupId: string): Promise<GroupDetail> {
  return request(`/groups/${encodeURIComponent(groupId)}`, groupDetailSchema);
}

// T-0054: an owner or admin adds their own AI to a group, and its owner or a
// group manager removes it. Both answer the fresh group detail.
export function addGroupAi(groupId: string, aiId: string): Promise<GroupDetail> {
  return request(`/groups/${encodeURIComponent(groupId)}/ais`, groupDetailSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aiId }),
  });
}

export function removeGroupAi(groupId: string, aiId: string): Promise<GroupDetail> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/ais/${encodeURIComponent(aiId)}`,
    groupDetailSchema,
    { method: 'DELETE' },
  );
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

// --- AIs (T-0032) --------------------------------------------------------
// The wire contract lives in apps/server/src/ais/routes.ts and service.ts.
// `ApiError` already carries the server's `code` and `status`, so callers can
// branch without parsing the message again.

const aiTemplateSchema = z.enum(['dev', 'marketing', 'fun', 'custom']);

export type AiTemplate = z.infer<typeof aiTemplateSchema>;

const aiLimitsSchema = z.object({
  perDayUsd: z.number(),
  perMonthUsd: z.number(),
});

export type AiLimits = z.infer<typeof aiLimitsSchema>;

// T-0058: the AI's spend summary. Optional (not just nullable) so responses
// from older servers still parse; absent means "unavailable" like null.
const aiUsageSchema = z.object({
  todayUsd: z.number(),
  windowUsd: z.number(),
});

export type AiUsage = z.infer<typeof aiUsageSchema>;

const publicAiSchema = z.object({
  id: z.string(),
  name: z.string(),
  template: aiTemplateSchema,
  persona: z.string(),
  model: z.string(),
  jid: z.string(),
  status: z.enum(['active', 'disabled']),
  providerConnectionId: z.string(),
  limits: aiLimitsSchema,
  usage: aiUsageSchema.nullable().optional(),
  createdAt: z.string(),
});

export type PublicAi = z.infer<typeof publicAiSchema>;

const connectionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  label: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});

export type Connection = z.infer<typeof connectionSchema>;

export interface CreateAiInput {
  name: string;
  template: AiTemplate;
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimits;
}

export interface UpdateAiInput {
  name?: string;
  persona?: string;
  limits?: AiLimits;
  model?: string;
  providerConnectionId?: string;
}

export function listAis(): Promise<PublicAi[]> {
  return request('/ais', z.array(publicAiSchema));
}

export function getAi(id: string): Promise<PublicAi> {
  return request(`/ais/${encodeURIComponent(id)}`, publicAiSchema);
}

export function createAi(input: CreateAiInput): Promise<PublicAi> {
  const body = {
    name: input.name,
    template: input.template,
    ...(input.persona === undefined ? {} : { persona: input.persona }),
    providerConnectionId: input.providerConnectionId,
    model: input.model,
    limits: input.limits,
  };
  return request('/ais', publicAiSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function updateAi(id: string, input: UpdateAiInput): Promise<PublicAi> {
  return request(`/ais/${encodeURIComponent(id)}`, publicAiSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deleteAi(id: string): Promise<void> {
  await request(`/ais/${encodeURIComponent(id)}`, z.null(), { method: 'DELETE' });
}

export function listConnections(): Promise<Connection[]> {
  return request('/connections', z.array(connectionSchema));
}
