// effect-plain: the promise edge over the Effect client.
import { ApprovalRule, PublicApproval } from '@zilar/api-contract';
import { makeAisApi, makeApprovalsApi } from '@zilar/client-core';
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

export type { ApprovalDecision, ApprovalStatus } from '@zilar/api-contract';
export type { ApprovalRule, PublicApproval };

const approvals = makeApprovalsApi(callApi);

export const {
  getApproval,
  listApprovals,
  decideApproval,
  listAiApprovalRules,
  listGroupApprovalRules,
  revokeApprovalRule,
} = approvals;
