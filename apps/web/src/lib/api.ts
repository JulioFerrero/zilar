import { z } from 'zod';
import { isMockApiEnabled } from '@/mock/gate';
import { mockRequest } from '@/mock/api';

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
  if (isMockApiEnabled()) {
    // Standalone mock mode: answer locally, never touch the network (T-0069).
    response = await mockRequest(path, init);
  } else {
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
  // `stopped` is the owner kill switch (T-0080): the AI is paused, not
  // deleted, and a resume brings it back.
  status: z.enum(['active', 'disabled', 'stopped']),
  providerConnectionId: z.string(),
  limits: aiLimitsSchema,
  usage: aiUsageSchema.nullable().optional(),
  // T-0091: the AI's home machine id, or null when it runs on the platform.
  // Optional so a payload from a server that has not been upgraded yet
  // still parses — the panel renders the same way when it is absent.
  machine_id: z.string().nullable().optional(),
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

// T-0080: the owner's kill switch. Both return the fresh public AI so the
// panel can re-render against the server truth without a second GET. The
// server answers the same `not_active` 409 when the AI was already in the
// other terminal state, which the panel treats as a refresh cue.
export function stopAi(id: string): Promise<PublicAi> {
  return request(`/ais/${encodeURIComponent(id)}/stop`, publicAiSchema, { method: 'POST' });
}

export function resumeAi(id: string): Promise<PublicAi> {
  return request(`/ais/${encodeURIComponent(id)}/resume`, publicAiSchema, { method: 'POST' });
}

// T-0091: set or clear the AI's home machine. `null` clears the assignment
// (the AI runs on the platform); a machine id assigns it. The server
// answers the fresh public AI, so the panel re-renders against server
// truth.
export function setAiMachine(aiId: string, machineId: string | null): Promise<PublicAi> {
  return request(`/ais/${encodeURIComponent(aiId)}/machine`, publicAiSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machine_id: machineId }),
  });
}

export function listConnections(): Promise<Connection[]> {
  return request('/connections', z.array(connectionSchema));
}

// T-0074: `ConnectionsPage` used to call `fetch` directly with its own copy of
// `request`. Moving those calls here means errors flow through `ApiError` like
// everywhere else; `ApiError.message` already carries the server's
// `error.message`, so the page can keep showing it to the user.

export interface CreateConnectionInput {
  provider: string;
  key: string;
  label?: string;
}

export function createConnection(input: CreateConnectionInput): Promise<Connection> {
  const body = {
    provider: input.provider,
    key: input.key,
    ...(input.label === undefined ? {} : { label: input.label }),
  };
  return request('/connections', connectionSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const connectionTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});

export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

export function testConnection(id: string): Promise<ConnectionTestResult> {
  return request(`/connections/${encodeURIComponent(id)}/test`, connectionTestResultSchema, {
    method: 'POST',
  });
}

export async function deleteConnection(id: string): Promise<void> {
  await request(`/connections/${encodeURIComponent(id)}`, z.null(), { method: 'DELETE' });
}

// --- Machines (T-0070) ---------------------------------------------------
// The wire contract lives in apps/server/src/machines/routes.ts and
// service.ts. `ApiError` carries the server's `code` and `status`, so callers
// can branch without parsing the message again. `online` is optional so the
// schema works before T-0071 (the runner hub) lands.

export type MachineStatus = 'pending' | 'approved' | 'revoked';

export interface Machine {
  id: string;
  name: string;
  status: MachineStatus;
  os: string;
  osVersion: string;
  arch: string;
  cpu: string;
  cores: number;
  ramGb: number;
  diskFreeGb: number;
  drivers: string[];
  fingerprint: string;
  createdAt: string;
  approvedAt: string | null;
  lastSeenAt: string | null;
  /** Added by T-0071 (the runner hub). Absent before then; default to false. */
  online?: boolean | undefined;
}

const machineStatusSchema = z.enum(['pending', 'approved', 'revoked']);

export const machineSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: machineStatusSchema,
  os: z.string(),
  osVersion: z.string(),
  arch: z.string(),
  cpu: z.string(),
  cores: z.number(),
  ramGb: z.number(),
  diskFreeGb: z.number(),
  drivers: z.array(z.string()),
  fingerprint: z.string(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  online: z.boolean().optional(),
});

export interface PairingCode {
  code: string;
  expiresAt: string;
}

const pairingCodeSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
});

export function listMachines(): Promise<Machine[]> {
  return request('/machines', z.array(machineSchema));
}

export function createPairingCode(): Promise<PairingCode> {
  return request('/machines/pairing-codes', pairingCodeSchema, { method: 'POST' });
}

export function approveMachine(id: string): Promise<Machine> {
  return request(`/machines/${encodeURIComponent(id)}/approve`, machineSchema, {
    method: 'POST',
  });
}

export async function denyMachine(id: string): Promise<void> {
  await request(`/machines/${encodeURIComponent(id)}/deny`, z.null(), { method: 'POST' });
}

export function revokeMachine(id: string): Promise<Machine> {
  return request(`/machines/${encodeURIComponent(id)}/revoke`, machineSchema, {
    method: 'POST',
  });
}

export function renameMachine(id: string, name: string): Promise<Machine> {
  return request(`/machines/${encodeURIComponent(id)}`, machineSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteMachine(id: string): Promise<void> {
  await request(`/machines/${encodeURIComponent(id)}`, z.null(), { method: 'DELETE' });
}

// --- Approvals (T-0076) ---------------------------------------------------
// The wire contract lives in apps/server/src/approvals/routes.ts and
// service.ts. Dates arrive as ISO strings; we keep them as strings so the
// types line up with `ApprovalRequest.expires_at` and we don't have to think
// about zod's string-to-Date coercion in tests.

export type ApprovalStatus =
  'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed' | 'expired';

export type ApprovalDecision = 'approve_once' | 'approve_always' | 'deny';

const approvalWorstCaseSchema = z
  .object({
    currency: z.enum(['EUR', 'USD']),
    amount: z.number(),
  })
  .nullable();

export const publicApprovalSchema = z.object({
  id: z.string(),
  aiId: z.string(),
  groupId: z.string().nullable(),
  action: z.string(),
  summary: z.string(),
  details: z.string().nullable(),
  argsHash: z.string(),
  worstCase: approvalWorstCaseSchema,
  requestedBy: z.string(),
  status: z.enum(['pending', 'approved_once', 'approved_always', 'denied', 'consumed', 'expired']),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type PublicApproval = z.infer<typeof publicApprovalSchema>;

export function getApproval(id: string): Promise<PublicApproval> {
  return request(`/approvals/${encodeURIComponent(id)}`, publicApprovalSchema);
}

// T-0081: the inbox page lists everything pending. The server already filters
// by pending, unexpired, decidable by the caller, newest first, max 100.
export function listApprovals(): Promise<PublicApproval[]> {
  return request('/approvals', z.array(publicApprovalSchema));
}

export function decideApproval(
  id: string,
  decision: ApprovalDecision,
  note?: string,
): Promise<PublicApproval> {
  const body = note === undefined ? { decision } : { decision, note };
  return request(`/approvals/${encodeURIComponent(id)}/decision`, publicApprovalSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Audit log (T-0079, T-0084) --------------------------------------------
// The wire contract lives in apps/server/src/audit/routes.ts and service.ts.

const auditCostSchema = z
  .object({
    currency: z.enum(['EUR', 'USD']),
    amount: z.number(),
  })
  .nullable();

export const publicAuditEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  aiId: z.string().nullable(),
  groupId: z.string().nullable(),
  action: z.string(),
  subjectId: z.string().nullable(),
  argsHash: z.string().nullable(),
  cost: auditCostSchema,
  result: z.enum(['ok', 'denied', 'error']),
  detail: z.record(z.string(), z.unknown()).nullable(),
  actorUserId: z.string().nullable(),
});

export type PublicAuditEntry = z.infer<typeof publicAuditEntrySchema>;

const auditPageSchema = z.object({
  entries: z.array(publicAuditEntrySchema),
  next: z.string().nullable(),
});

export interface ListAuditPage {
  entries: PublicAuditEntry[];
  next: string | null;
}

// T-0086: the audit endpoint answers one of `?aiId=…` or `?groupId=…`, never
// both, and the server answers 400 otherwise. The discriminated union makes
// "exactly one of the two keys" a compile error: passing both or neither
// fails type-checking.
export type AuditScope =
  { aiId: string; groupId?: undefined } | { groupId: string; aiId?: undefined };

export type ListAuditInput = AuditScope & {
  limit?: number;
  before?: string;
};

export function listAudit(input: ListAuditInput): Promise<ListAuditPage> {
  const params = new URLSearchParams();
  if ('aiId' in input && input.aiId !== undefined) {
    params.set('aiId', input.aiId);
  } else if ('groupId' in input && input.groupId !== undefined) {
    params.set('groupId', input.groupId);
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.before !== undefined && input.before !== '') {
    params.set('before', input.before);
  }
  return request(`/audit?${params.toString()}`, auditPageSchema);
}
