// Invite links (T-0115): create, list and revoke per group, plus the join
// preview and the join, mirroring web's `groups/invite-links` and `join` routes.
// A created token is shown once and kept only in the token map; the list carries
// hints. Preview and join enforce the server rules (revoked, expired, used-up)
// with one neutral 404 `invalid_link`, the 50-member cap answers 409
// `group_full`, and past 20 attempts per link the join is 429 `rate_limited`.
import type { MockData } from '../../state';
import { findGroup, joinGroup } from '../directory/groups';
import {
  errorResponse,
  jsonResponse,
  noContent,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';
import type { MockInviteLink } from './seed';

const MAX_ACTIVE_LINKS = 10;
const MAX_GROUP_MEMBERS = 50;
const MAX_JOIN_ATTEMPTS = 20;
const MAX_LABEL_LENGTH = 60;

export function handleInviteLinks(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (head === 'groups' && second === 'invite-links') {
    return handleGroupLinks(data, request, decodeURIComponent(first ?? ''));
  }
  if (head === 'join' && first !== undefined && second === undefined) {
    return handleJoin(data, request, decodeURIComponent(first));
  }
  return undefined;
}

function handleGroupLinks(
  data: MockData,
  request: MockHttpRequest,
  groupId: string,
): Response | undefined {
  if (findGroup(data, groupId) === undefined) {
    return errorResponse('not_found', 'Group not found', 404);
  }
  const linkId = request.segments[3];
  if (linkId !== undefined && request.method === 'DELETE') {
    const link = data.inviteLinks.find(
      (item) => item.id === decodeURIComponent(linkId) && item.groupId === groupId,
    );
    if (link !== undefined) {
      link.revoked = true;
    }
    return noContent();
  }
  if (request.segments.length !== 3) {
    return undefined;
  }
  if (request.method === 'GET') {
    return jsonResponse({ links: data.inviteLinks.filter((link) => link.groupId === groupId) });
  }
  if (request.method === 'POST') {
    return createLink(data, request, groupId);
  }
  return undefined;
}

function createLink(data: MockData, request: MockHttpRequest, groupId: string): Response {
  const body = readJsonBody(request.init);
  const active = data.inviteLinks.filter((link) => link.groupId === groupId && !link.revoked);
  if (active.length >= MAX_ACTIVE_LINKS) {
    return errorResponse('too_many_links', 'This group already has 10 links', 409);
  }
  if (!validInviteLinkOptions(body.expiresInHours, body.maxUses)) {
    return errorResponse('invalid_request', 'Invalid invite link options', 400);
  }
  const label =
    typeof body.label === 'string' && body.label.trim() !== ''
      ? body.label.trim().slice(0, MAX_LABEL_LENGTH)
      : null;
  const maxUses =
    typeof body.maxUses === 'number' && Number.isInteger(body.maxUses) && body.maxUses >= 1
      ? body.maxUses
      : null;
  const expiresAt =
    typeof body.expiresInHours === 'number' &&
    Number.isInteger(body.expiresInHours) &&
    body.expiresInHours >= 1
      ? new Date(Date.now() + body.expiresInHours * 3_600_000).toISOString()
      : null;
  const token = randomToken();
  const id = `link-mock-${data.nextInviteLinkSequence}`;
  data.nextInviteLinkSequence += 1;
  data.inviteLinks.push({
    id,
    groupId,
    label,
    tokenHint: token.slice(-4),
    uses: 0,
    maxUses,
    expiresAt,
    revoked: false,
    createdAt: new Date().toISOString(),
  });
  data.inviteTokens.set(token, id);
  return jsonResponse({ id, token, url: `http://localhost:5173/j/${token}` }, 201);
}

function handleJoin(data: MockData, request: MockHttpRequest, token: string): Response | undefined {
  const link = usableLink(data, token);
  if (link === undefined) {
    return invalidLink();
  }
  const group = findGroup(data, link.groupId);
  if (group === undefined) {
    return invalidLink();
  }
  const alreadyMember = group.joined;
  if (request.method === 'GET') {
    return jsonResponse({
      groupTitle: group.title,
      memberCount: group.memberCount,
      alreadyMember,
      ...(alreadyMember ? { groupId: group.id } : {}),
      ...(group.kind === 'channel' ? { kind: 'channel' as const } : {}),
    });
  }
  if (request.method === 'POST') {
    const attempts = (data.joinAttempts.get(link.id) ?? 0) + 1;
    data.joinAttempts.set(link.id, attempts);
    if (attempts > MAX_JOIN_ATTEMPTS) {
      return errorResponse('rate_limited', 'Too many join attempts, try again later', 429);
    }
    if (group.memberCount >= MAX_GROUP_MEMBERS && !alreadyMember) {
      return errorResponse('group_full', 'This group is full', 409);
    }
    if (!alreadyMember) {
      link.uses += 1;
      joinGroup(data, group.id);
    }
    return jsonResponse({ groupId: group.id, alreadyMember });
  }
  return undefined;
}

function usableLink(data: MockData, token: string): MockInviteLink | undefined {
  const id = data.inviteTokens.get(token);
  const link = id === undefined ? undefined : data.inviteLinks.find((item) => item.id === id);
  if (link === undefined || link.revoked) {
    return undefined;
  }
  if (link.expiresAt !== null && Date.parse(link.expiresAt) <= Date.now()) {
    return undefined;
  }
  if (link.maxUses !== null && link.uses >= link.maxUses) {
    return undefined;
  }
  return link;
}

function invalidLink(): Response {
  return errorResponse('invalid_link', 'This invite link is invalid', 404);
}

// Like the server's create schema: outside 1..8760 hours or 1..10000 uses is a
// 400, never a silent clamp.
function validInviteLinkOptions(expiresInHours: unknown, maxUses: unknown): boolean {
  if (
    expiresInHours !== undefined &&
    (typeof expiresInHours !== 'number' ||
      !Number.isInteger(expiresInHours) ||
      expiresInHours < 1 ||
      expiresInHours > 8760)
  ) {
    return false;
  }
  if (
    maxUses !== undefined &&
    (typeof maxUses !== 'number' || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000)
  ) {
    return false;
  }
  return true;
}

function randomToken(): string {
  return Array.from({ length: 64 }, () =>
    '0123456789abcdef'.charAt(Math.floor(Math.random() * 16)),
  ).join('');
}
