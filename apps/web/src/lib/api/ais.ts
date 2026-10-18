// effect-plain: the promise edge over the Effect client.
import {
  ApprovalRule,
  PublicApproval,
  type ApprovalDecision,
  type ApprovalStatus,
} from '@zilar/api-contract';
import { makeAisApi } from '@zilar/client-core';
import { callApi } from '@/lib/effect/api-client';

export type {
  AiCatalog,
  AiComputerOptions,
  AiLimits,
  AiTemplate,
  AiUsage,
  Connection,
  ConnectionTestResult,
  CreateAiInput,
  CreateConnectionInput,
  PublicAi,
  UpdateAiInput,
} from '@zilar/client-core';

const api = makeAisApi(callApi);
export const {
  createAi,
  createConnection,
  deleteAi,
  deleteConnection,
  getAi,
  getAiCatalog,
  getComputerOptions,
  listAis,
  listConnections,
  replaceConnectionKey,
  resumeAi,
  setAiMachine,
  stopAi,
  stopAiTurn,
  testConnection,
  updateAi,
} = api;

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
