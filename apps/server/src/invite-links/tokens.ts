// effect-plain: token primitives are plain crypto; no Effect in this module.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { GroupInviteLinkRow } from '../db/rows';
import { HttpError } from '../errors';
import type { InviteLogger } from '../groups/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';

export const INVITE_LINK_TOKEN_BYTES = 32;
export {
  INVITE_LINK_CREATE_MAX_EXPIRY_HOURS,
  INVITE_LINK_CREATE_MAX_USES,
  INVITE_LINK_LABEL_MAX,
  INVITE_LINK_MIN_EXPIRY_HOURS,
  INVITE_LINK_MIN_MAX_USES,
} from '@zilar/api-contract';
export const MAX_ACTIVE_INVITE_LINKS = 10;

export const JOIN_RATE_LIMIT_MAX_PER_USER = 20;
export const JOIN_RATE_LIMIT_MAX_PER_IP = 60;
export const JOIN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
// Probing tokens at full speed must be expensive: 120 previews per hour.
export const JOIN_PREVIEW_RATE_LIMIT_MAX_PER_USER = 120;
export const JOIN_PREVIEW_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export type { GroupInviteLinkRow };

export interface InviteLinkView {
  id: string;
  label: string | null;
  tokenHint: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface JoinPreview {
  groupTitle: string;
  memberCount: number;
  alreadyMember: boolean;
  // The group id is present only when `alreadyMember` is true: a member already knows it,
  // and a preview never leaks ids to strangers.
  groupId?: string | undefined;
  // `channel` previews read "Join channel"; the kind is not a secret.
  kind: 'group' | 'channel';
}

// Byte-identical for unknown, expired, revoked and exhausted links, so failures reveal no reason.
export const INVALID_LINK = {
  status: 404 as const,
  code: 'invalid_link',
  message: 'This invite link is invalid or has expired',
};

export function toInvalidLink(): HttpError {
  return new HttpError(INVALID_LINK.status, INVALID_LINK.code, INVALID_LINK.message);
}

// The raw token is shown once and never stored — only its SHA-256 hash reaches the
// database, the logs or the audit trail.
export function generateInviteToken(): string {
  return randomBytes(INVITE_LINK_TOKEN_BYTES).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Constant time over the hash digest, so a local timing oracle cannot probe prefixes.
export function inviteTokenMatches(token: string, storedHashHex: string): boolean {
  let candidate: Buffer;
  let stored: Buffer;
  try {
    candidate = Buffer.from(hashInviteToken(token), 'hex');
    stored = Buffer.from(storedHashHex, 'hex');
  } catch {
    return false;
  }
  if (candidate.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(candidate, stored);
}

export function tokenHintFor(token: string): string {
  return token.slice(-4);
}

export function toInviteLinkView(row: GroupInviteLinkRow): InviteLinkView {
  return {
    id: row.id,
    label: row.label,
    tokenHint: row.tokenHint,
    uses: row.uses,
    maxUses: row.maxUses,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    revoked: row.revokedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface InviteLinkServiceDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
  now?: () => Date;
  beforeJoinTransaction?: () => Promise<void>;
}

export interface CreateInviteLinkInput {
  groupId: string;
  actorId: string;
  label?: string | undefined;
  expiresInHours?: number | undefined;
  maxUses?: number | undefined;
}

export interface CreatedInviteLink {
  id: string;
  /** The raw token, shown once. Never stored, logged or audited. */
  token: string;
  url: string;
}

export function joinUrlFor(webBaseUrl: string, token: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/j/${token}`;
}
