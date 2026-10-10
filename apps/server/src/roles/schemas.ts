import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { GroupRoleRow } from '../db/rows';
import { HttpError } from '../errors';
import type { InviteLogger } from '../groups/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';

export const MAX_ROLES_PER_GROUP = 20;

export type { GroupRoleRow };

export interface GroupRoleView {
  id: string;
  name: string;
}

export interface GroupRoleDetail extends GroupRoleView {
  /** The holders, sorted by name. Role membership is not secret. */
  members: Array<{ userId: string; name: string }>;
}

export interface RolesServiceDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

export const GROUP_NOT_FOUND = {
  status: 404 as const,
  code: 'not_found',
  message: 'Group not found',
};

export const ROLE_NOT_FOUND = {
  status: 404 as const,
  code: 'not_found',
  message: 'Role not found',
};

export function toMissingGroup(): HttpError {
  return new HttpError(GROUP_NOT_FOUND.status, GROUP_NOT_FOUND.code, GROUP_NOT_FOUND.message);
}

export function toMissingRole(): HttpError {
  return new HttpError(ROLE_NOT_FOUND.status, ROLE_NOT_FOUND.code, ROLE_NOT_FOUND.message);
}
