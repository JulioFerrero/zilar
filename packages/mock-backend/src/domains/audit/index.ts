import { defineDomain } from '../domain';
import { handleAudit } from './routes';
import { seedAudit } from './seed';
import { createAuditState } from './state';

export const auditDomain = defineDomain({
  name: 'audit',
  seed: seedAudit,
  createState: createAuditState,
  routes: handleAudit,
});
