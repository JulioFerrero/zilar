import { defineDomain } from '../domain';
import { handleApprovals } from './routes';
import { seedApprovals } from './seed';
import { createApprovalsState } from './state';

export const approvalsDomain = defineDomain({
  name: 'approvals',
  seed: seedApprovals,
  createState: createApprovalsState,
  routes: handleApprovals,
});
