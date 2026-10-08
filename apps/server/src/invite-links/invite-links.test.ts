import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { MAX_GROUP_MEMBERS } from '../groups/service';
import { createApp } from '../app';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { createAuditRecorder } from '../audit/service';
import { auditLog } from '../db/schema';
import { groupInviteLinks } from '../db/schema';
import { groupMembers } from '../db/schema';
import { groups } from '../db/schema';
import { user } from '../auth/auth-schema';
import { localpartFor } from '../xmpp/provisioning';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type SignedInUser,
  type TestApp,
  type TestContext,
} from '../test-support';
import { setTestAppInviteLinks } from '../app';
import { trustedClientIp } from '../http/client-ip';
import { joinByInviteLink, type InviteLinkServiceDeps } from './service';

interface CreatedLinkBody {
  id: string;
  token: string;
  url: string;
}

interface LinkViewBody {
  id: string;
  label: string | null;
  tokenHint: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

interface PreviewBody {
  groupTitle: string;
  memberCount: number;
  alreadyMember: boolean;
  groupId?: string;
  kind?: string;
}

function errorOf(body: unknown): { code: string; message: string } {
  const parsed = body as { error: { code: string; message: string } };
  return { code: parsed.error.code, message: parsed.error.message };
}

describe('group invite links', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  // A group owned by `owner` with no other members.
  async function lonelyGroup(owner: SignedInUser, title = 'Hiking'): Promise<string> {
    const response = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ title, memberIds: [] }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  function createLink(cookie: string, groupId: string, body: unknown = {}) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/invite-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  function listLinks(cookie: string, groupId: string) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/invite-links`, {
      headers: { cookie },
    });
  }

  function revokeLink(cookie: string, groupId: string, linkId: string) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/invite-links/${linkId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
  }

  function preview(token: string, cookie: string) {
    return app.request(`${TEST_BASE_URL}/api/join/${token}`, { headers: { cookie } });
  }

  function join(token: string, cookie: string) {
    return app.request(`${TEST_BASE_URL}/api/join/${token}`, {
      method: 'POST',
      headers: { cookie },
    });
  }

  async function auditActions(): Promise<string[]> {
    const rows = await context.db.select({ action: auditLog.action }).from(auditLog);
    return rows.map((row) => row.action);
  }

  async function auditDetails(): Promise<unknown[]> {
    const rows = await context.db.select({ detail: auditLog.detail }).from(auditLog);
    return rows.map((row) => row.detail);
  }

  it('creates a link: the token is shown once, only the hash is stored', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const groupId = await lonelyGroup(owner);

    const response = await createLink(owner.cookie, groupId, { label: 'Friends' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as CreatedLinkBody;
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.url).toBe(`http://localhost:5173/j/${body.token}`);

    const rows = await context.db.select().from(groupInviteLinks);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(createHash('sha256').update(body.token, 'utf8').digest('hex'));
    expect(rows[0]!.tokenHash).not.toContain(body.token.slice(0, 8));
    expect(rows[0]!.tokenHint).toBe(body.token.slice(-4));
    expect(rows[0]!.label).toBe('Friends');
    expect(context.logOutput()).not.toContain(body.token);
  });

  it('validates the create body and caps active links at 10', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const groupId = await lonelyGroup(owner);

    expect((await createLink(owner.cookie, groupId, { maxUses: 0 })).status).toBe(400);
    expect((await createLink(owner.cookie, groupId, { maxUses: 10001 })).status).toBe(400);
    expect((await createLink(owner.cookie, groupId, { expiresInHours: 0 })).status).toBe(400);
    expect((await createLink(owner.cookie, groupId, { expiresInHours: 8761 })).status).toBe(400);
    expect((await createLink(owner.cookie, groupId, { label: 'x'.repeat(61) })).status).toBe(400);
    expect((await createLink(owner.cookie, groupId, { unknown: true })).status).toBe(400);

    for (let index = 0; index < 10; index += 1) {
      expect((await createLink(owner.cookie, groupId)).status).toBe(201);
    }
    const eleventh = await createLink(owner.cookie, groupId);
    expect(eleventh.status).toBe(409);
    expect(errorOf(await eleventh.json()).code).toBe('too_many_links');

    // A revoked link frees a slot.
    const listed = (await (await listLinks(owner.cookie, groupId)).json()) as {
      links: LinkViewBody[];
    };
    expect((await revokeLink(owner.cookie, groupId, listed.links[0]!.id)).status).toBe(204);
    expect((await createLink(owner.cookie, groupId)).status).toBe(201);
  });

  it('only owners and admins create, list and revoke', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const created = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ title: 'Team', memberIds: [member.id] }),
    });
    const groupId = ((await created.json()) as { id: string }).id;

    expect((await createLink(member.cookie, groupId)).status).toBe(403);
    expect((await createLink(stranger.cookie, groupId)).status).toBe(404);
    expect((await listLinks(member.cookie, groupId)).status).toBe(403);
    expect((await listLinks(stranger.cookie, groupId)).status).toBe(404);
    expect((await revokeLink(member.cookie, groupId, 'whatever')).status).toBe(403);
    expect((await revokeLink(stranger.cookie, groupId, 'whatever')).status).toBe(404);

    await context.db
      .update(groupMembers)
      .set({ role: 'admin' })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, member.id)));
    expect((await createLink(member.cookie, groupId)).status).toBe(201);
    expect((await listLinks(member.cookie, groupId)).status).toBe(200);
  });

  it('requires authentication on every invite-link route', async () => {
    expect((await app.request(`${TEST_BASE_URL}/api/groups/x/invite-links`)).status).toBe(401);
    expect(
      (await app.request(`${TEST_BASE_URL}/api/groups/x/invite-links`, { method: 'POST' })).status,
    ).toBe(401);
    expect(
      (await app.request(`${TEST_BASE_URL}/api/groups/x/invite-links/y`, { method: 'DELETE' }))
        .status,
    ).toBe(401);
    expect((await app.request(`${TEST_BASE_URL}/api/join/${'a'.repeat(64)}`)).status).toBe(401);
    expect(
      (
        await app.request(`${TEST_BASE_URL}/api/join/${'a'.repeat(64)}`, {
          method: 'POST',
        })
      ).status,
    ).toBe(401);
  });

  it('lists links without tokens and revokes idempotently', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const groupId = await lonelyGroup(owner);
    const created = (await (
      await createLink(owner.cookie, groupId, { maxUses: 3 })
    ).json()) as CreatedLinkBody;

    const listed = await listLinks(owner.cookie, groupId);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { links: LinkViewBody[] };
    expect(body.links).toHaveLength(1);
    expect(body.links[0]).toMatchObject({
      id: created.id,
      label: null,
      tokenHint: created.token.slice(-4),
      uses: 0,
      maxUses: 3,
      revoked: false,
    });
    // No token anywhere in the list payload.
    expect(JSON.stringify(body)).not.toContain(created.token);

    expect((await revokeLink(owner.cookie, groupId, created.id)).status).toBe(204);
    expect((await revokeLink(owner.cookie, groupId, created.id)).status).toBe(204);
    expect((await revokeLink(owner.cookie, groupId, 'missing-id')).status).toBe(204);
    const relisted = (await (await listLinks(owner.cookie, groupId)).json()) as {
      links: LinkViewBody[];
    };
    expect(relisted.links[0]!.revoked).toBe(true);
  });

  it('previews the group (title + count only) and joins as a member', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const friend = await bootstrapUser(context, app, 'friend@example.com');
    const groupId = await lonelyGroup(owner, 'Hiking club');
    const created = (await (await createLink(owner.cookie, groupId)).json()) as CreatedLinkBody;

    const shown = await preview(created.token, friend.cookie);
    expect(shown.status).toBe(200);
    const previewBody = (await shown.json()) as PreviewBody;
    expect(previewBody).toEqual({
      groupTitle: 'Hiking club',
      memberCount: 1,
      alreadyMember: false,
      kind: 'group',
    });
    // Only the title and the count — never member names, never the group id.
    expect(JSON.stringify(previewBody)).not.toContain('owner@example.com');
    expect(previewBody.groupId).toBeUndefined();

    const joined = await join(created.token, friend.cookie);
    expect(joined.status).toBe(200);
    expect(await joined.json()).toEqual({ groupId, alreadyMember: false });

    const membership = await context.db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, friend.id)));
    expect(membership).toHaveLength(1);
    expect(membership[0]!.role).toBe('member');

    // The room sync ran through the add-member flow: the newcomer holds a
    // member affiliation on the group room and every public topic room.
    const [groupRow] = await context.db.select().from(groups).where(eq(groups.id, groupId));
    const newcomerJid = `${localpartFor(friend.id)}@${TEST_XMPP_DOMAIN}`;
    expect(
      context.adminClient.affiliationState.get(groupRow!.roomLocalpart)?.get(newcomerJid),
    ).toBe('member');

    // The use was consumed.
    const [linkRow] = await context.db
      .select()
      .from(groupInviteLinks)
      .where(eq(groupInviteLinks.id, created.id));
    expect(linkRow!.uses).toBe(1);

    // Preview now reports membership, with the group id the join page
    // uses to open the group chat.
    const reshown = (await (await preview(created.token, friend.cookie)).json()) as PreviewBody;
    expect(reshown.alreadyMember).toBe(true);
    expect(reshown.groupId).toBe(groupId);
  });

  it('an existing member joins idempotently without consuming a use', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const created = await app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ title: 'Team', memberIds: [member.id] }),
    });
    const groupId = ((await created.json()) as { id: string }).id;
    const link = (await (
      await createLink(owner.cookie, groupId, { maxUses: 1 })
    ).json()) as CreatedLinkBody;

    const response = await join(link.token, member.cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ groupId, alreadyMember: true });
    const [row] = await context.db
      .select()
      .from(groupInviteLinks)
      .where(eq(groupInviteLinks.id, link.id));
    expect(row!.uses).toBe(0);
  });

  it('answers the identical 404 for unknown, expired, revoked and exhausted links', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const friend = await bootstrapUser(context, app, 'friend@example.com');
    const groupId = await lonelyGroup(owner);

    const missingToken = 'b'.repeat(64);
    const missingPreview = await preview(missingToken, friend.cookie);
    const missingJoin = await join(missingToken, friend.cookie);
    expect(missingPreview.status).toBe(404);
    expect(missingJoin.status).toBe(404);
    const missingBody = errorOf(await missingPreview.json());
    const missingJoinBody = errorOf(await missingJoin.json());
    expect(missingBody.code).toBe('invalid_link');
    expect(missingJoinBody).toEqual(missingBody);

    // A malformed token answers the same code too (never a 400 shape leak).
    const malformed = await preview('not-a-token', friend.cookie);
    expect(malformed.status).toBe(404);
    expect(errorOf(await malformed.json())).toEqual(missingBody);

    const doomed = (await (await createLink(owner.cookie, groupId)).json()) as CreatedLinkBody;
    await revokeLink(owner.cookie, groupId, doomed.id);
    const revoked = errorOf(await (await preview(doomed.token, friend.cookie)).json());
    expect(revoked).toEqual(missingBody);
    expect(errorOf(await (await join(doomed.token, friend.cookie)).json())).toEqual(missingBody);

    const single = (await (
      await createLink(owner.cookie, groupId, { maxUses: 1 })
    ).json()) as CreatedLinkBody;
    expect((await join(single.token, friend.cookie)).status).toBe(200);
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    expect(errorOf(await (await preview(single.token, stranger.cookie)).json())).toEqual(
      missingBody,
    );
    expect(errorOf(await (await join(single.token, stranger.cookie)).json())).toEqual(missingBody);

    const expiring = (await (
      await createLink(owner.cookie, groupId, { expiresInHours: 1 })
    ).json()) as CreatedLinkBody;
    await context.db
      .update(groupInviteLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(groupInviteLinks.id, expiring.id));
    expect(errorOf(await (await preview(expiring.token, stranger.cookie)).json())).toEqual(
      missingBody,
    );
    expect(errorOf(await (await join(expiring.token, stranger.cookie)).json())).toEqual(
      missingBody,
    );
  });

  it('the loser of a same-user race answers alreadyMember and consumes no use', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const friend = await bootstrapUser(context, app, 'friend@example.com');
    const groupId = await lonelyGroup(owner);
    const link = (await (await createLink(owner.cookie, groupId)).json()) as CreatedLinkBody;

    // Park the first join right before its transaction — past its
    // pre-transaction member check, before its claim, while it holds no
    // lock — so the second join commits first. The first join's in-tx
    // re-check must then see the committed membership and answer
    // `alreadyMember` without claiming. (A true both-claimed interleave is
    // impossible on PGlite: parking inside the open transaction blocks the
    // second join's queries behind it. The `onConflictDoNothing` no-row
    // backstop only triggers under real Postgres concurrency.)
    const serviceDeps: InviteLinkServiceDeps = {
      db: context.db,
      adminClient: context.adminClient,
      domain: TEST_XMPP_DOMAIN,
      logger: context.logger,
    };
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let parked = 0;
    const firstDeps: InviteLinkServiceDeps = {
      ...serviceDeps,
      beforeJoinTransaction: async () => {
        parked += 1;
        await firstGate;
      },
    };

    try {
      const first = joinByInviteLink(firstDeps, link.token, friend.id);
      const deadline = Date.now() + 5000;
      while (parked === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(parked).toBe(1);

      // The second join commits first: it takes the honest join path.
      const second = await joinByInviteLink(serviceDeps, link.token, friend.id);
      expect(second).toEqual({ groupId, alreadyMember: false });
      releaseFirst();
      const firstResult = await first;
      // The loser path: 200 with `alreadyMember: true`, not a second join.
      expect(firstResult).toEqual({ groupId, alreadyMember: true });
    } finally {
      releaseFirst();
    }

    const members = await context.db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, friend.id)));
    expect(members).toHaveLength(1);
    const [row] = await context.db
      .select()
      .from(groupInviteLinks)
      .where(eq(groupInviteLinks.id, link.id));
    // One membership was created, so exactly one use was consumed — the
    // loser never claimed.
    expect(row!.uses).toBe(1);
  });

  it('two parallel joins on a 1-use link admit exactly one newcomer', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const first = await bootstrapUser(context, app, 'first@example.com');
    const second = await bootstrapUser(context, app, 'second@example.com');
    const groupId = await lonelyGroup(owner);
    const link = (await (
      await createLink(owner.cookie, groupId, { maxUses: 1 })
    ).json()) as CreatedLinkBody;

    const [one, two] = await Promise.all([
      join(link.token, first.cookie),
      join(link.token, second.cookie),
    ]);
    const statuses = [one.status, two.status].sort();
    expect(statuses).toEqual([200, 404]);
    const loser = one.status === 200 ? two : one;
    expect(errorOf(await loser.json()).code).toBe('invalid_link');

    const members = await context.db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    expect(members).toHaveLength(2);
    const [row] = await context.db
      .select()
      .from(groupInviteLinks)
      .where(eq(groupInviteLinks.id, link.id));
    expect(row!.uses).toBe(1);
  });

  it('answers 409 group_full when the group is at the member cap', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const groupId = await lonelyGroup(owner);
    for (let index = 0; index < MAX_GROUP_MEMBERS - 1; index += 1) {
      const id = `cap-user-${index}`;
      await context.db
        .insert(user)
        .values({ id, name: `Cap ${index}`, email: `${id}@example.com` });
      await context.db.insert(groupMembers).values({ groupId, userId: id, role: 'member' });
    }
    const link = (await (await createLink(owner.cookie, groupId)).json()) as CreatedLinkBody;
    const late = await bootstrapUser(context, app, 'late@example.com');

    const response = await join(link.token, late.cookie);
    expect(response.status).toBe(409);
    expect(errorOf(await response.json()).code).toBe('group_full');

    // A full group never burns a use: the cap check runs before the claim.
    const [row] = await context.db
      .select()
      .from(groupInviteLinks)
      .where(eq(groupInviteLinks.id, link.id));
    expect(row!.uses).toBe(0);
  });

  it('a failing room call answers 503 without burning the use', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const friend = await bootstrapUser(context, app, 'friend@example.com');
    const groupId = await lonelyGroup(owner);
    const link = (await (await createLink(owner.cookie, groupId)).json()) as CreatedLinkBody;
    context.adminClient.failAffiliation = true;

    const response = await join(link.token, friend.cookie);
    expect(response.status).toBe(503);
    expect(errorOf(await response.json()).code).toBe('xmpp_unavailable');
    const [row] = await context.db
      .select()
      .from(groupInviteLinks)
      .where(eq(groupInviteLinks.id, link.id));
    expect(row!.uses).toBe(0);
    expect(
      await context.db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, friend.id))),
    ).toEqual([]);

    // The link still works once the room is back: the refunded use was not lost.
    context.adminClient.failAffiliation = false;
    expect((await join(link.token, friend.cookie)).status).toBe(200);
    const [after] = await context.db
      .select()
      .from(groupInviteLinks)
      .where(eq(groupInviteLinks.id, link.id));
    expect(after!.uses).toBe(1);
  });

  it('never writes the raw join token to the request log', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const friend = await bootstrapUser(context, app, 'friend@example.com');
    const groupId = await lonelyGroup(owner);
    const link = (await (await createLink(owner.cookie, groupId)).json()) as CreatedLinkBody;
    // A second link whose join fails, so the error log line is covered too.
    const doomed = (await (await createLink(owner.cookie, groupId)).json()) as CreatedLinkBody;
    await revokeLink(owner.cookie, groupId, doomed.id);

    expect((await preview(link.token, friend.cookie)).status).toBe(200);
    expect((await join(link.token, friend.cookie)).status).toBe(200);
    expect((await preview(doomed.token, friend.cookie)).status).toBe(404);
    expect((await join(doomed.token, friend.cookie)).status).toBe(404);
    // Variants that miss the route (trailing slash, extra segment) still log.
    for (const suffix of ['/', '/extra', '//']) {
      await app.request(`${TEST_BASE_URL}/api/join/${link.token}${suffix}`, {
        headers: { cookie: friend.cookie },
      });
    }

    const output = context.logOutput();
    expect(output).not.toContain(link.token);
    expect(output).not.toContain(doomed.token);
    expect(output).toContain('/api/join/:token');
  });

  it('resolves the join limiter IP from x-forwarded-for per TRUSTED_PROXY_HOPS', async () => {
    // Unit cases: 0 hops ignores headers; N > 0 reads from the right; a
    // forged left-most entry never counts; short headers fall back.
    expect(trustedClientIp(undefined, 1)).toBeNull();
    expect(trustedClientIp('', 1)).toBeNull();
    expect(trustedClientIp('203.0.113.7', 1)).toBe('203.0.113.7');
    expect(trustedClientIp('203.0.113.7, 10.0.0.1', 1)).toBe('10.0.0.1');
    expect(trustedClientIp('203.0.113.7, 10.0.0.1', 2)).toBe('203.0.113.7');
    expect(trustedClientIp('forged, 203.0.113.7, 10.0.0.1', 1)).toBe('10.0.0.1');
    expect(trustedClientIp('forged, 203.0.113.7, 10.0.0.1', 2)).toBe('203.0.113.7');
    expect(trustedClientIp('203.0.113.7', 2)).toBeNull();
    expect(trustedClientIp(' 203.0.113.7 ,, 10.0.0.1 ', 1)).toBe('10.0.0.1');
  });

  // Fires `count` failing join guesses, each with its own user but the
  // same-shaped headers, and returns the statuses.
  async function guessJoins(
    requestApp: TestApp,
    count: number,
    headersFor: (index: number) => Record<string, string>,
    cookies: string[],
  ): Promise<number[]> {
    const statuses: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const response = await requestApp.request(`${TEST_BASE_URL}/api/join/${'e'.repeat(64)}`, {
        method: 'POST',
        headers: { ...headersFor(index), cookie: cookies[index] ?? '' },
      });
      statuses.push(response.status);
    }
    return statuses;
  }

  it('limits joins per resolved client IP: 0 hops shares the socket, 1 hop splits by header', async () => {
    for (const hops of [0, 1]) {
      const limited = await mountLimited({
        trustedProxyHops: hops,
        joinLimiters: {
          user: createRateLimiter({ max: 1000, windowMs: 60 * 60 * 1000 }),
          ip: createRateLimiter({ max: 2, windowMs: 60 * 60 * 1000 }),
        },
      });
      try {
        const cookies: string[] = [];
        for (let index = 0; index < 4; index += 1) {
          const guest = await bootstrapUser(
            limited.context,
            limited.app,
            `h${hops}-${index}@example.com`,
          );
          cookies.push(guest.cookie);
        }
        // Every request carries its own right-most address; the left-most
        // entry is forged and must never affect the budget.
        const statuses = await guessJoins(
          limited.app,
          4,
          (index) => ({ 'x-forwarded-for': `forged-${index}, 203.0.113.${index}` }),
          cookies,
        );
        if (hops === 0) {
          // Headers ignored: all four share the socket budget of 2.
          expect(statuses).toEqual([404, 404, 429, 429]);
        } else {
          // One hop: each request resolves to its own right-most address.
          expect(statuses).toEqual([404, 404, 404, 404]);
        }
      } finally {
        await limited.close();
      }
    }
  });

  it('with 2 hops the limiter reads the second address from the right', async () => {
    const limited = await mountLimited({
      trustedProxyHops: 2,
      joinLimiters: {
        user: createRateLimiter({ max: 1000, windowMs: 60 * 60 * 1000 }),
        ip: createRateLimiter({ max: 1, windowMs: 60 * 60 * 1000 }),
      },
    });
    try {
      const first = await bootstrapUser(limited.context, limited.app, 'two-a@example.com');
      const second = await bootstrapUser(limited.context, limited.app, 'two-b@example.com');
      // Same second-from-right (`10.0.0.1`), different edge addresses: the
      // second guess shares the first's budget.
      const one = await limited.app.request(`${TEST_BASE_URL}/api/join/${'e'.repeat(64)}`, {
        method: 'POST',
        headers: { cookie: first.cookie, 'x-forwarded-for': 'client-a, 10.0.0.1, 10.9.9.9' },
      });
      expect(one.status).toBe(404);
      const two = await limited.app.request(`${TEST_BASE_URL}/api/join/${'e'.repeat(64)}`, {
        method: 'POST',
        headers: { cookie: second.cookie, 'x-forwarded-for': 'client-b, 10.0.0.1, 10.9.9.9' },
      });
      expect(two.status).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('rate-limits join previews per user (120 per hour, windowed)', async () => {
    let now = Date.now();
    const clock = (): number => now;
    const limited = await mountLimited({
      now: clock,
      joinLimiters: {
        user: createRateLimiter({ max: 1000, windowMs: 60 * 60 * 1000 }),
        ip: createRateLimiter({ max: 1000, windowMs: 60 * 60 * 1000 }),
        preview: createRateLimiter({ max: 3, windowMs: 60 * 60 * 1000, now: clock }),
      },
    });
    try {
      const owner = await bootstrapUser(limited.context, limited.app, 'owner@example.com');
      const groupId = await lonelyGroupOn(limited.app, owner);
      const link = await limited.createLink(owner.cookie, groupId);

      // 3 previews pass (even for a missing token — the limit runs first);
      // the 4th is rate limited.
      for (let index = 0; index < 3; index += 1) {
        const response = await limited.app.request(`${TEST_BASE_URL}/api/join/${link.token}`, {
          headers: { cookie: owner.cookie },
        });
        expect(response.status).toBe(200);
      }
      const blocked = await limited.app.request(`${TEST_BASE_URL}/api/join/${link.token}`, {
        headers: { cookie: owner.cookie },
      });
      expect(blocked.status).toBe(429);
      expect(errorOf(await blocked.json()).code).toBe('rate_limited');

      // The window passes: previews work again.
      now += 60 * 60 * 1000 + 1;
      const afterWindow = await limited.app.request(`${TEST_BASE_URL}/api/join/${link.token}`, {
        headers: { cookie: owner.cookie },
      });
      expect(afterWindow.status).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('rate-limits joins per user (20 per hour, windowed)', async () => {
    let now = Date.now();
    const limited = await mountLimited({ now: () => now, getClientIp: () => '10.9.9.9' });
    try {
      const owner = await bootstrapUser(limited.context, limited.app, 'owner@example.com');
      const groupId = await lonelyGroupOn(limited.app, owner);
      const link = await limited.createLink(owner.cookie, groupId);

      // 20 guesses with bad tokens: the 21st is rate limited per user.
      for (let index = 0; index < 20; index += 1) {
        const response = await limited.app.request(`${TEST_BASE_URL}/api/join/${'c'.repeat(64)}`, {
          method: 'POST',
          headers: { cookie: owner.cookie },
        });
        expect(response.status).toBe(404);
      }
      const limitedByUser = await limited.app.request(`${TEST_BASE_URL}/api/join/${link.token}`, {
        method: 'POST',
        headers: { cookie: owner.cookie },
      });
      expect(limitedByUser.status).toBe(429);
      expect(errorOf(await limitedByUser.json()).code).toBe('rate_limited');

      // The window passes: the owner (already a member) joins cleanly.
      now += 60 * 60 * 1000 + 1;
      const afterWindow = await limited.app.request(`${TEST_BASE_URL}/api/join/${link.token}`, {
        method: 'POST',
        headers: { cookie: owner.cookie },
      });
      expect(afterWindow.status).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('rate-limits joins per IP (60 per hour)', async () => {
    const fixed = await mountLimited({ getClientIp: () => '10.8.0.1' });
    try {
      const owner = await bootstrapUser(fixed.context, fixed.app, 'owner@example.com');
      const groupId = await lonelyGroupOn(fixed.app, owner);
      const link = (await fixed.createLink(owner.cookie, groupId)) as CreatedLinkBody;
      expect(link.token).toMatch(/^[0-9a-f]{64}$/);

      // 60 distinct users guessing from the same IP: the 61st guess is
      // limited even though the user is fresh.
      for (let index = 0; index < 60; index += 1) {
        const guest = await bootstrapUser(fixed.context, fixed.app, `guest-${index}@example.com`);
        const response = await fixed.app.request(`${TEST_BASE_URL}/api/join/${'d'.repeat(64)}`, {
          method: 'POST',
          headers: { cookie: guest.cookie },
        });
        expect(response.status).toBe(404);
      }
      const late = await bootstrapUser(fixed.context, fixed.app, 'late@example.com');
      const ipBlocked = await fixed.app.request(`${TEST_BASE_URL}/api/join/${'d'.repeat(64)}`, {
        method: 'POST',
        headers: { cookie: late.cookie },
      });
      expect(ipBlocked.status).toBe(429);
      expect(errorOf(await ipBlocked.json()).code).toBe('rate_limited');
    } finally {
      await fixed.close();
    }
  });

  it('audits creation, revocation and joins with the hint only, never the token', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const friend = await bootstrapUser(context, app, 'friend@example.com');
    const groupId = await lonelyGroup(owner);
    const link = (await (
      await createLink(owner.cookie, groupId, { label: 'Team' })
    ).json()) as CreatedLinkBody;
    await revokeLink(owner.cookie, groupId, link.id);

    const second = (await (await createLink(owner.cookie, groupId)).json()) as CreatedLinkBody;
    expect((await join(second.token, friend.cookie)).status).toBe(200);

    expect(await auditActions()).toEqual([
      'group.link_created',
      'group.link_revoked',
      'group.link_created',
      'group.joined_by_link',
    ]);
    const details = await auditDetails();
    for (const detail of details) {
      expect(JSON.stringify(detail)).not.toContain(link.token);
      expect(JSON.stringify(detail)).not.toContain(second.token);
    }
    expect(details[0]).toMatchObject({ linkId: link.id, hint: link.token.slice(-4) });
    expect(details[1]).toMatchObject({ linkId: link.id, hint: link.token.slice(-4) });
    expect(details[3]).toMatchObject({ linkId: second.id, hint: second.token.slice(-4) });
  });

  it('a failing topic sync still commits the member and answers 200', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const friend = await bootstrapUser(context, app, 'friend@example.com');
    const groupId = await lonelyGroup(owner);
    // A second topic, so the post-commit sync has more than the group's own
    // room to touch.
    const extra = await app.request(`${TEST_BASE_URL}/api/groups/${groupId}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ name: 'Side' }),
    });
    expect(extra.status).toBe(201);
    const link = (await (await createLink(owner.cookie, groupId)).json()) as CreatedLinkBody;
    // The group room itself works; only the topic rooms fail. The member
    // row still commits and the route answers 200 (best effort, logged).
    const [groupRow] = await context.db.select().from(groups).where(eq(groups.id, groupId));
    const groupRoom = groupRow!.roomLocalpart;
    const realSetAffiliation = context.adminClient.setAffiliation.bind(context.adminClient);
    context.adminClient.setAffiliation = (roomId, jid, affiliation) => {
      if (roomId !== groupRoom) {
        return Promise.reject(new Error('ejabberd is down'));
      }
      return realSetAffiliation(roomId, jid, affiliation);
    };

    const response = await join(link.token, friend.cookie);
    expect(response.status).toBe(200);
    const membership = await context.db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, friend.id)));
    expect(membership).toHaveLength(1);
    expect(context.logOutput()).toContain('could not sync a topic room');
  });

  // A mounted app with an injected clock and client IP (like the machines
  // tests): the join rate windows can advance without waiting. Returns the
  // context plus a link creator bound to it.
  async function mountLimited(overrides: {
    now?: () => number;
    getClientIp?: () => string;
    trustedProxyHops?: number;
    joinLimiters?: { user: RateLimiter; ip: RateLimiter; preview?: RateLimiter };
  }): Promise<{
    context: TestContext;
    app: TestApp;
    createLink: (cookie: string, groupId: string) => Promise<CreatedLinkBody>;
    close: () => Promise<void>;
  }> {
    const limitedContext = await createTestContext();
    const record = createAuditRecorder({ db: limitedContext.db });
    setTestAppInviteLinks(overrides);
    try {
      const full = createApp({
        db: limitedContext.db,
        logger: limitedContext.logger,
        config: limitedContext.config,
        auth: limitedContext.auth,
        adminClient: limitedContext.adminClient,
        audit: record,
      });
      return {
        context: limitedContext,
        app: full,
        createLink: async (cookie: string, groupId: string) => {
          const response = await full.request(
            `${TEST_BASE_URL}/api/groups/${groupId}/invite-links`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', cookie },
              body: JSON.stringify({}),
            },
          );
          expect(response.status).toBe(201);
          return (await response.json()) as CreatedLinkBody;
        },
        close: async () => {
          setTestAppInviteLinks(undefined);
          await limitedContext.close();
        },
      };
    } catch (error) {
      setTestAppInviteLinks(undefined);
      await limitedContext.close();
      throw error;
    }
  }

  async function lonelyGroupOn(appInstance: TestApp, owner: SignedInUser): Promise<string> {
    const response = await appInstance.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: owner.cookie },
      body: JSON.stringify({ title: 'Hiking', memberIds: [] }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }
});
