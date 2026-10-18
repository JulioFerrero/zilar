// effect-plain: the promise edge over the Effect client.
import {
  ApiError,
  ApprovalRule,
  PublicApproval,
  isProviderId,
  type AiCatalog,
  type AiComputerOptions,
  type AiLimits,
  type AiTemplate,
  type AiUsage,
  type ApprovalDecision,
  type ApprovalStatus,
  type ConnectionView,
  type PublicAi as ContractAi,
} from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';

export type { AiComputerOptions, AiLimits, AiTemplate, AiUsage };

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
  // The owner's delegation opt-ins.
  canDelegate?: boolean;
  acceptsDelegation?: boolean;
  // Where the AI's computer runs.
  computerMode?: 'off' | 'cloud' | 'runner' | 'auto';
}

export async function listAis(): Promise<PublicAi[]> {
  const rows = await callApi((client) => client.ais.list());
  return [...rows];
}

export function getAi(id: string): Promise<PublicAi> {
  return callApi((client) => client.ais.detail({ params: { id } }));
}

export function getAiCatalog(): Promise<AiCatalog> {
  return callApi((client) => client.ais.catalog());
}

export function getComputerOptions(): Promise<AiComputerOptions> {
  return callApi((client) => client.ais.computerOptions());
}

// The contract encodes the trimmed form the server checks length on.
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
        ...(input.computerMode === undefined ? {} : { computerMode: input.computerMode }),
      },
    }),
  );
}

export async function deleteAi(id: string): Promise<void> {
  await callApi((client) => client.ais.remove({ params: { id } }));
}

// Both return the fresh public AI so the panel re-renders without a second GET; the
// not_active 409 when the AI was already terminal is a refresh cue.
export function stopAi(id: string): Promise<PublicAi> {
  return callApi((client) => client.ais.stop({ params: { id } }));
}

export function resumeAi(id: string): Promise<PublicAi> {
  return callApi((client) => client.ais.resume({ params: { id } }));
}

// Stops the turn running in one chat, not the AI kill switch.
export function stopAiTurn(id: string, chatJid: string): Promise<{ stopped: boolean }> {
  return callApi((client) =>
    client.ais.stopTurn({ params: { id }, payload: { chatJid: chatJid.trim() } }),
  );
}

// null clears the machine assignment: the AI runs on the platform.
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

export interface CreateConnectionInput {
  provider: string;
  key: string;
  label?: string;
  /** Required for openai-compatible, refused for every other provider. */
  baseUrl?: string;
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
        ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl.trim() }),
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

// Replaces the key in place, so AIs using it keep working; the next turn decrypts the new key.
export function replaceConnectionKey(id: string, key: string): Promise<Connection> {
  return callApi((client) =>
    client.connections.update({ params: { id }, payload: { key: key.trim() } }),
  );
}

// Dates arrive as ISO strings and stay strings, matching ApprovalRequest.expires_at.

export type { ApprovalDecision, ApprovalStatus, ApprovalRule, PublicApproval };

// Old names for schemas that decode a payload from an older server.
export const publicApprovalSchema = PublicApproval;

export function getApproval(id: string): Promise<PublicApproval> {
  return callApi((client) => client.approvals.detail({ params: { id } }));
}

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

// A viewer who may not manage the rules gets the same 404 from both list routes and revoke.

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
