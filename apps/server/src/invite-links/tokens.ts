// effect-plain: moved unchanged from apps/server/src/invite-links/service.ts (size split)
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { GroupInviteLinkRow } from '../db/rows';
import { HttpError } from '../errors';
import type { InviteLogger } from '../groups/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';

export const INVITE_LINK_TOKEN_BYTES = 32;
// The label and create limits live in the shared contract (T-0892).
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
// The preview reveals only a title and a count for a valid link, but probing
// tokens at full speed must still be expensive: 120 previews per hour.
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
  // The group id, present only when `alreadyMember` is true: a member
  // already knows it, and the join page uses it to open the group chat.
  // Never sent for non-members, so previews leak no ids to strangers.
  groupId?: string | undefined;
  // T-0124: `channel` previews read "Join channel" on the web (and count
  // subscribers). The kind of a group the caller may join is not a secret.
  kind: 'group' | 'channel';
}

// Byte-identical for an unknown token, an expired link, a revoked link and
// an exhausted link, so failure answers never reveal why a link fails.
export const INVALID_LINK = {
  status: 404 as const,
  code: 'invalid_link',
  message: 'This invite link is invalid or has expired',
};

export function toInvalidLink(): HttpError {
  return new HttpError(INVALID_LINK.status, INVALID_LINK.code, INVALID_LINK.message);
}

// The raw token is shown once at creation and never stored — only its
// SHA-256 hash reaches the database, the logs or the audit trail.
export function generateInviteToken(): string {
  return randomBytes(INVITE_LINK_TOKEN_BYTES).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Constant time over the hash digest, so a local timing oracle cannot probe
// token prefixes.
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
  /** Override the clock in tests. Defaults to the wall clock. */
  now?: () => Date;
  /**
   * Test-only seam: awaited right before the join transaction, after the
   * pre-transaction checks. A test parks the first join here so a second one
   * commits first and the in-tx re-check drives the loser path. Production
   * never sets it.
   */
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
