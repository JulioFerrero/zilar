// effect-plain: moved unchanged from apps/web/src/lib/api.ts (size split)
import {
  ApiError,
  ApprovalRule,
  PublicApproval,
  isProviderId,
  type AiLimits,
  type AiTemplate,
  type AiUsage,
  type ApprovalDecision,
  type ApprovalStatus,
  type ConnectionView,
  type PublicAi as ContractAi,
} from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';

// --- AIs (T-0032) --------------------------------------------------------
// The wire contract lives in apps/server/src/ais/api.ts and service.ts.
// `ApiError` already carries the server's `code` and `status`, so callers can
// branch without parsing the message again.

export type { AiLimits, AiTemplate, AiUsage };

// The contract's AI with mutable fields, the shape the mock backend and the
// fixtures build.
export type PublicAi = { -readonly [K in keyof ContractAi]: ContractAi[K] };

export type Connection = ConnectionView;

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
  // T-0478: the owner's delegation opt-ins.
  canDelegate?: boolean;
  acceptsDelegation?: boolean;
}

export async function listAis(): Promise<PublicAi[]> {
  const rows = await callApi((client) => client.ais.list());
  return [...rows];
}

export function getAi(id: string): Promise<PublicAi> {
  return callApi((client) => client.ais.detail({ params: { id } }));
}

// The server trims these strings before its length checks; the contract
// encodes the trimmed form, so they are trimmed here.
export function createAi(input: CreateAiInput): Promise<PublicAi> {
  return callApi((client) =>
    client.ais.create({
      payload: {
        name: input.name.trim(),
        template: input.template,
        ...(input.persona === undefined ? {} : { persona: input.persona.trim() }),
        providerConnectionId: input.providerConnectionId.trim(),
        model: input.model.trim(),
        limits: input.limits,
      },
    }),
  );
}

export function updateAi(id: string, input: UpdateAiInput): Promise<PublicAi> {
  return callApi((client) =>
    client.ais.patch({
      params: { id },
      payload: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.persona === undefined ? {} : { persona: input.persona.trim() }),
        ...(input.limits === undefined ? {} : { limits: input.limits }),
        ...(input.model === undefined ? {} : { model: input.model.trim() }),
        ...(input.providerConnectionId === undefined
          ? {}
          : { providerConnectionId: input.providerConnectionId.trim() }),
        ...(input.canDelegate === undefined ? {} : { canDelegate: input.canDelegate }),
        ...(input.acceptsDelegation === undefined
          ? {}
          : { acceptsDelegation: input.acceptsDelegation }),
      },
    }),
  );
}

export async function deleteAi(id: string): Promise<void> {
  await callApi((client) => client.ais.remove({ params: { id } }));
}

// T-0080: the owner's kill switch. Both return the fresh public AI so the
// panel can re-render against the server truth without a second GET. The
// server answers the same `not_active` 409 when the AI was already in the
// other terminal state, which the panel treats as a refresh cue.
export function stopAi(id: string): Promise<PublicAi> {
  return callApi((client) => client.ais.stop({ params: { id } }));
}

export function resumeAi(id: string): Promise<PublicAi> {
  return callApi((client) => client.ais.resume({ params: { id } }));
}

// T-0091: set or clear the AI's home machine. `null` clears the assignment
// (the AI runs on the platform); a machine id assigns it. The server
// answers the fresh public AI, so the panel re-renders against server
// truth.
export function setAiMachine(aiId: string, machineId: string | null): Promise<PublicAi> {
  return callApi((client) =>
    client.ais.assignMachine({
      params: { id: aiId },
      payload: { machineId: machineId === null ? null : machineId.trim() },
    }),
  );
}

export async function listConnections(): Promise<Connection[]> {
  const rows = await callApi((client) => client.connections.list());
  return [...rows];
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
  const { provider } = input;
  if (!isProviderId(provider)) {
    return Promise.reject(new ApiError(400, 'invalid_request', 'Invalid connection request'));
  }
  // The server trims the key and the label; the contract encodes the trimmed form.
  return callApi((client) =>
    client.connections.create({
      payload: {
        provider,
        key: input.key.trim(),
        ...(input.label === undefined ? {} : { label: input.label.trim() }),
      },
    }),
  );
}

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

export function testConnection(id: string): Promise<ConnectionTestResult> {
  return callApi((client) => client.connections.test({ params: { id } }));
}

export async function deleteConnection(id: string): Promise<void> {
  await callApi((client) => client.connections.remove({ params: { id } }));
}

// --- Approvals (T-0076) ---------------------------------------------------
// The wire contract lives in apps/server/src/approvals/api.ts and
// service.ts. Dates arrive as ISO strings; we keep them as strings so the
// types line up with `ApprovalRequest.expires_at` and we don't have to think
// about zod's string-to-Date coercion in tests.

export type { ApprovalDecision, ApprovalStatus, ApprovalRule, PublicApproval };

// Kept under their old names: the shared schemas decode a payload from an
// older server (a missing topic, `alwaysEligible: false`, no `approverNames`).
export const publicApprovalSchema = PublicApproval;

export function getApproval(id: string): Promise<PublicApproval> {
  return callApi((client) => client.approvals.detail({ params: { id } }));
}

// T-0081: the inbox page lists everything pending. The server already filters
// by pending, unexpired, decidable by the caller, newest first, max 100.
export async function listApprovals(): Promise<PublicApproval[]> {
  const rows = await callApi((client) => client.approvals.list());
  return [...rows];
}

export function decideApproval(
  id: string,
  decision: ApprovalDecision,
  note?: string,
): Promise<PublicApproval> {
  return callApi((client) =>
    client.approvals.decide({
      params: { id },
      payload: note === undefined ? { decision } : { decision, note },
    }),
  );
}

// --- Approval rules (T-0100) ------------------------------------------------
// The wire contract lives in apps/server/src/approvals/api.ts and
// rules.ts. Dates arrive as ISO strings, kept as strings like the
// approvals schemas. The two list routes 404 for a viewer who may not
// manage the rules, and so does revoke; all three flow through `ApiError`.

export const approvalRuleSchema = ApprovalRule;

export async function listAiApprovalRules(aiId: string): Promise<ApprovalRule[]> {
  const rows = await callApi((client) => client.approvals.aiRules({ params: { id: aiId } }));
  return [...rows];
}

export async function listGroupApprovalRules(groupId: string): Promise<ApprovalRule[]> {
  const rows = await callApi((client) => client.approvals.groupRules({ params: { id: groupId } }));
  return [...rows];
}

export async function revokeApprovalRule(id: string): Promise<void> {
  await callApi((client) => client.approvals.revokeRule({ params: { id } }));
}
