import { defineDomain } from '../domain';
import { handleApprovalRules } from './routes';
import { seedApprovalRules } from './seed';
import { createApprovalRulesState } from './state';

export const approvalRulesDomain = defineDomain({
  name: 'approval-rules',
  seed: seedApprovalRules,
  createState: createApprovalRulesState,
  routes: handleApprovalRules,
});
