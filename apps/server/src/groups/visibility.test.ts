// Public groups and channels (T-0164): visibility changes with handles,
// the Explore directory, open join, and the by-handle lookup. Every new
// route needs a session (covered by the 401 sweep) and is rate limited.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { aiLocalpart } from '../ais/service';
import { joinPublicGroup } from './join';
import { PUBLIC_GROUP_MAX_MEMBERS } from '../directory/service';
import { DIRECTORY_RATE_LIMIT_MAX } from '../directory/api';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  testApp,
  testSql,
  TEST_BASE_URL,
  TEST_XMPP_DOMAIN,
  type TestApp,
  type TestContext,
} from '../test-support';
import { localpartFor } from '../xmpp/provisioning';

interface VisibilityBody {
  id: string;
  title: string;
  kind: string;
  visibility: string;
  handle: string | null;
  members: Array<{ userId: string; role: string }>;
}

interface DirectoryBody {
  entries: Array<{
    id: string;
    kind: string;
    title: string;
    handle: string;
    description: string | null;
    memberCount: number;
    joined: boolean;
  }>;
  next: string | null;
}

describe('public groups and channels', () => {
  let context: TestContext;
  let app: TestApp;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  function createGroupRequest(cookie: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  function patchGroupRequest(cookie: string, groupId: string, body: unknown) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  }

  function directoryRequest(cookie: string, query = '') {
    return app.request(`${TEST_BASE_URL}/api/directory${query}`, { headers: { cookie } });
  }

  function byHandleRequest(cookie: string, handle: string) {
    return app.request(`${TEST_BASE_URL}/api/groups/by-handle/${encodeURIComponent(handle)}`, {
      headers: { cookie },
    });
  }

  function joinRequest(cookie: string, groupId: string) {
    return app.request(`${TEST_BASE_URL}/api/groups/${groupId}/join`, {
      method: 'POST',
      headers: { cookie },
    });
  }

  async function ownedGroup(): Promise<{
    ownerCookie: string;
    ownerId: string;
    memberCookie: string;
    memberId: string;
    strangerCookie: string;
    strangerId: string;
    groupId: string;
  }> {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const created = await createGroupRequest(owner.cookie, {
      title: 'Weekend trip',
      memberIds: [member.id],
    });
    expect(created.status).toBe(201);
    const { id: groupId } = (await created.json()) as { id: string };
    return {
      ownerCookie: owner.cookie,
      ownerId: owner.id,
      memberCookie: member.cookie,
      memberId: member.id,
      strangerCookie: stranger.cookie,
      strangerId: stranger.id,
      groupId,
    };
  }

  it('keeps existing groups private with a null handle', async () => {
    const { ownerCookie, groupId } = await ownedGroup();
    const detail = (await (
      await app.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
        headers: { cookie: ownerCookie },
      })
    ).json()) as VisibilityBody;
    expect(detail.visibility).toBe('private');
    expect(detail.handle).toBeNull();
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ visibility: string }>`
          SELECT visibility FROM "groups" WHERE id = ${groupId}
        `;
      }),
    );
    expect(row?.visibility).toBe('private');
  });

  it('creates a public group with a handle in one request', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const created = await createGroupRequest(owner.cookie, {
      title: 'Hiking club',
      memberIds: [member.id],
      visibility: 'public',
      handle: 'hiking_club',
    });
    expect(created.status).toBe(201);
    const detail = (await created.json()) as VisibilityBody;
    expect(detail.visibility).toBe('public');
    expect(detail.handle).toBe('hiking_club');

    // Immediately in the directory.
    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const listed = (await (
      await directoryRequest(stranger.cookie, '?q=hiking')
    ).json()) as DirectoryBody;
    expect(listed.entries.map((entry) => entry.id)).toEqual([detail.id]);

    // A taken handle races to 409 on create too.
    const second = await createGroupRequest(owner.cookie, {
      title: 'Second',
      memberIds: [],
      visibility: 'public',
      handle: 'hiking_club',
    });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe('handle_taken');

    // Private create with a handle is refused.
    const bad = await createGroupRequest(owner.cookie, {
      title: 'Third',
      memberIds: [],
      handle: 'third_pub',
    });
    expect(bad.status).toBe(400);
  });

  it('lets the owner make a group public with a handle, visible in the directory', async () => {
    const { ownerCookie, strangerCookie, groupId } = await ownedGroup();

    const patched = await patchGroupRequest(ownerCookie, groupId, {
      visibility: 'public',
      handle: 'Weekend_Trip',
    });
    expect(patched.status).toBe(200);
    const detail = (await patched.json()) as VisibilityBody;
    expect(detail.visibility).toBe('public');
    expect(detail.handle).toBe('Weekend_Trip');

    // The stranger finds it by handle prefix and title prefix…
    const byHandle = (await (
      await directoryRequest(strangerCookie, '?q=weekend')
    ).json()) as DirectoryBody;
    expect(byHandle.entries).toHaveLength(1);
    expect(byHandle.entries[0]).toMatchObject({
      id: groupId,
      kind: 'group',
      title: 'Weekend trip',
      handle: 'Weekend_Trip',
      memberCount: 2,
      joined: false,
    });
    const byTitle = (await (
      await directoryRequest(strangerCookie, '?q=Week')
    ).json()) as DirectoryBody;
    expect(byTitle.entries.map((entry) => entry.id)).toEqual([groupId]);
  });

  it('refuses visibility changes to non-owners with the same 404', async () => {
    const { memberCookie, strangerCookie, groupId } = await ownedGroup();

    for (const cookie of [memberCookie, strangerCookie]) {
      const response = await patchGroupRequest(cookie, groupId, {
        visibility: 'public',
        handle: 'weekend_trip',
      });
      expect(response.status).toBe(404);
    }
    const unknown = await patchGroupRequest(memberCookie, 'does-not-exist', {
      visibility: 'public',
      handle: 'weekend_trip',
    });
    expect(unknown.status).toBe(404);
    // Untouched: still private.
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ visibility: string }>`
          SELECT visibility FROM "groups" WHERE id = ${groupId}
        `;
      }),
    );
    expect(row?.visibility).toBe('private');
  });

  it('validates handles like users: invalid, reserved and taken', async () => {
    const { ownerCookie, groupId } = await ownedGroup();

    const invalid = await patchGroupRequest(ownerCookie, groupId, {
      visibility: 'public',
      handle: 'no!',
    });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe(
      'handle_invalid',
    );

    const reserved = await patchGroupRequest(ownerCookie, groupId, {
      visibility: 'public',
      handle: 'admin',
    });
    expect(reserved.status).toBe(409);
    expect(((await reserved.json()) as { error: { code: string } }).error.code).toBe(
      'handle_reserved',
    );

    // A user's handle is taken for a group too (one namespace).
    await app.request(`${TEST_BASE_URL}/api/me/handle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ handle: 'taken_by_owner' }),
    });
    const taken = await patchGroupRequest(ownerCookie, groupId, {
      visibility: 'public',
      handle: 'taken_by_owner',
    });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: { code: string } }).error.code).toBe('handle_taken');
  });

  it('lets exactly one of two racing groups win the same handle', async () => {
    const first = await bootstrapUser(context, app, 'first@example.com');
    const second = await bootstrapUser(context, app, 'second@example.com');
    const firstGroup = (await (
      await createGroupRequest(first.cookie, { title: 'One', memberIds: [] })
    ).json()) as { id: string };
    const secondGroup = (await (
      await createGroupRequest(second.cookie, { title: 'Two', memberIds: [] })
    ).json()) as { id: string };

    const [a, b] = await Promise.all([
      patchGroupRequest(first.cookie, firstGroup.id, {
        visibility: 'public',
        handle: 'race_winner',
      }),
      patchGroupRequest(second.cookie, secondGroup.id, {
        visibility: 'public',
        handle: 'race_winner',
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 200 ? b : a;
    expect(((await loser.json()) as { error: { code: string } }).error.code).toBe('handle_taken');
  });

  it('lets exactly one winner emerge when a group and a user race for one handle', async () => {
    // One namespace: the user claim (per-user lock) and the group claim
    // (per-group lock) do not serialize each other — the primary key
    // decides, and the loser maps to 409 `handle_taken` on both sides.
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const user = await bootstrapUser(context, app, 'user@example.com');
    const group = (await (
      await createGroupRequest(owner.cookie, { title: 'Racing', memberIds: [] })
    ).json()) as { id: string };

    const [groupSide, userSide] = await Promise.all([
      patchGroupRequest(owner.cookie, group.id, { visibility: 'public', handle: 'shared_prize' }),
      app.request(`${TEST_BASE_URL}/api/me/handle`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: user.cookie },
        body: JSON.stringify({ handle: 'shared_prize' }),
      }),
    ]);
    const both = [groupSide.status, userSide.status].sort();
    expect(both).toEqual([200, 409]);
    const loser = groupSide.status === 200 ? userSide : groupSide;
    expect(((await loser.json()) as { error: { code: string } }).error.code).toBe('handle_taken');
  });

  it('going private retires the handle for 30 days and hides the group at once', async () => {
    const { ownerCookie, strangerCookie, groupId } = await ownedGroup();
    expect(
      (await patchGroupRequest(ownerCookie, groupId, { visibility: 'public', handle: 'trip_pub' }))
        .status,
    ).toBe(200);

    const back = await patchGroupRequest(ownerCookie, groupId, { visibility: 'private' });
    expect(back.status).toBe(200);
    const detail = (await back.json()) as VisibilityBody;
    expect(detail.visibility).toBe('private');
    expect(detail.handle).toBeNull();

    // Gone from the directory and the lookup at once…
    const listed = (await (await directoryRequest(strangerCookie, '?q=trip')).json()) as Omit<
      DirectoryBody,
      'next'
    > & { next: string | null };
    expect(listed.entries).toEqual([]);
    expect((await byHandleRequest(strangerCookie, 'trip_pub')).status).toBe(404);
    // …but members stay members.
    expect(
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ userId: string }>`
            SELECT user_id FROM group_members WHERE group_id = ${groupId}
          `;
        }),
      ),
    ).toHaveLength(2);

    // The old handle is reserved for this group: a stranger cannot take it…
    const other = await bootstrapUser(context, app, 'other@example.com');
    const otherGroup = (await (
      await createGroupRequest(other.cookie, { title: 'Other', memberIds: [] })
    ).json()) as { id: string };
    const refused = await patchGroupRequest(other.cookie, otherGroup.id, {
      visibility: 'public',
      handle: 'trip_pub',
    });
    expect(refused.status).toBe(409);
    // …but the group may reuse it.
    const reused = await patchGroupRequest(ownerCookie, groupId, {
      visibility: 'public',
      handle: 'trip_pub',
    });
    expect(reused.status).toBe(200);
    expect(((await reused.json()) as VisibilityBody).handle).toBe('trip_pub');
  });

  it('refuses a public create on a handle another group retired and still reserves', async () => {
    const { ownerCookie, groupId } = await ownedGroup();
    expect(
      (await patchGroupRequest(ownerCookie, groupId, { visibility: 'public', handle: 'kept_pub' }))
        .status,
    ).toBe(200);
    expect((await patchGroupRequest(ownerCookie, groupId, { visibility: 'private' })).status).toBe(
      200,
    );

    const stranger = await bootstrapUser(context, app, 'stranger@example.com');
    const refused = await createGroupRequest(stranger.cookie, {
      title: 'Retired create',
      memberIds: [],
      visibility: 'public',
      handle: 'kept_pub',
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('handle_taken');

    // Nothing was written: no group with that title, and no handle row for a new group.
    expect(
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ id: string }>`
            SELECT id FROM "groups" WHERE title = 'Retired create'
          `;
        }),
      ),
    ).toEqual([]);
    const claims = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ groupId: string | null }>`
          SELECT group_id FROM handles WHERE handle_lower = ${'kept_pub'}
        `;
      }),
    );
    expect(claims.every((claim) => claim.groupId === groupId)).toBe(true);
  });

  it('refuses a handle change within 14 days with nextChangeAt', async () => {
    const { ownerCookie, groupId } = await ownedGroup();
    expect(
      (await patchGroupRequest(ownerCookie, groupId, { visibility: 'public', handle: 'first_pub' }))
        .status,
    ).toBe(200);

    const soon = await patchGroupRequest(ownerCookie, groupId, {
      visibility: 'public',
      handle: 'second_pub',
    });
    expect(soon.status).toBe(409);
    const body = (await soon.json()) as {
      error: { code: string; nextChangeAt: string };
    };
    expect(body.error.code).toBe('handle_change_too_soon');
    expect(new Date(body.error.nextChangeAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('joins a public group with one tap, idempotently; private stays 404', async () => {
    const { ownerCookie, strangerCookie, strangerId, groupId } = await ownedGroup();
    expect(
      (await patchGroupRequest(ownerCookie, groupId, { visibility: 'public', handle: 'open_trip' }))
        .status,
    ).toBe(200);

    const joined = await joinRequest(strangerCookie, groupId);
    expect(joined.status).toBe(200);
    expect(await joined.json()).toEqual({ groupId, alreadyMember: false });

    // Joining twice is harmless.
    const again = await joinRequest(strangerCookie, groupId);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ groupId, alreadyMember: true });

    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`
          SELECT user_id FROM group_members WHERE group_id = ${groupId}
        `;
      }),
    );
    expect(rows.map((row) => row.userId).sort()).toContain(strangerId);

    // The joiner holds a `member` room affiliation in the group's
    // unmoderated room — voice to post, like an invited member.
    const [groupRow] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roomLocalpart: string }>`
          SELECT room_localpart FROM "groups" WHERE id = ${groupId}
        `;
      }),
    );
    const strangerJid = `${localpartFor(strangerId)}@${TEST_XMPP_DOMAIN}`;
    expect(
      context.adminClient.affiliationState.get(groupRow!.roomLocalpart)?.get(strangerJid),
    ).toBe('member');

    // The directory now reports the newcomer as joined with the new count.
    const listed = (await (
      await directoryRequest(strangerCookie, '?q=open_trip')
    ).json()) as DirectoryBody;
    expect(listed.entries[0]).toMatchObject({ id: groupId, memberCount: 3, joined: true });

    // Private groups answer the same 404 as unknown ids.
    const other = await bootstrapUser(context, app, 'other@example.com');
    const closed = (await (
      await createGroupRequest(other.cookie, { title: 'Closed', memberIds: [] })
    ).json()) as { id: string };
    expect((await joinRequest(strangerCookie, closed.id)).status).toBe(404);
    expect((await joinRequest(strangerCookie, 'does-not-exist')).status).toBe(404);
    const closedBody = (await (await joinRequest(strangerCookie, closed.id)).json()) as {
      error: { code: string; message: string };
    };
    const unknownBody = (await (await joinRequest(strangerCookie, 'does-not-exist')).json()) as {
      error: { code: string; message: string };
    };
    expect(closedBody.error.code).toBe('not_found');
    expect(closedBody.error.message).toBe(unknownBody.error.message);
  });

  it('resolves a public group by exact handle; users, private and unknown share the 404', async () => {
    const { ownerCookie, strangerCookie, groupId } = await ownedGroup();
    expect(
      (await patchGroupRequest(ownerCookie, groupId, { visibility: 'public', handle: 'Open_Trip' }))
        .status,
    ).toBe(200);

    // Case-insensitive exact match…
    const found = await byHandleRequest(strangerCookie, 'open_trip');
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      id: groupId,
      kind: 'group',
      title: 'Weekend trip',
      handle: 'Open_Trip',
      memberCount: 2,
      joined: false,
    });

    // …but no prefix search: a prefix is a 404, not a match.
    expect((await byHandleRequest(strangerCookie, 'open_')).status).toBe(404);

    // A user's handle is not a group.
    await app.request(`${TEST_BASE_URL}/api/me/handle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ handle: 'owner_person' }),
    });
    expect((await byHandleRequest(strangerCookie, 'owner_person')).status).toBe(404);
    expect((await byHandleRequest(strangerCookie, 'no_such_handle')).status).toBe(404);

    // Private groups answer the same 404.
    await patchGroupRequest(ownerCookie, groupId, { visibility: 'private' });
    const hidden = await byHandleRequest(strangerCookie, 'Open_Trip');
    expect(hidden.status).toBe(404);
    const hiddenBody = (await hidden.json()) as { error: { code: string; message: string } };
    const unknownBody = (await (
      await byHandleRequest(strangerCookie, 'no_such_handle')
    ).json()) as { error: { code: string; message: string } };
    expect(hiddenBody.error.code).toBe('not_found');
    expect(hiddenBody.error.message).toBe(unknownBody.error.message);
  });

  it('requires at least 2 characters, filters by kind, and pages with a cursor', async () => {
    const { ownerCookie, strangerCookie } = await ownedGroup();
    const first = (await (
      await createGroupRequest(ownerCookie, { title: 'Hiking club', memberIds: [] })
    ).json()) as { id: string };
    const second = (await (
      await createGroupRequest(ownerCookie, {
        title: 'Hiking channel',
        memberIds: [],
        kind: 'channel',
        description: 'Trail news',
      })
    ).json()) as { id: string };
    for (const [id, handle] of [
      [first.id, 'hiking_club'],
      [second.id, 'hiking_news'],
    ] as const) {
      expect(
        (await patchGroupRequest(ownerCookie, id, { visibility: 'public', handle })).status,
      ).toBe(200);
    }

    // One character is refused.
    expect((await directoryRequest(strangerCookie, '?q=h')).status).toBe(400);

    // The kind filter splits groups from channels…
    const channels = (await (
      await directoryRequest(strangerCookie, '?q=hiking&kind=channel')
    ).json()) as DirectoryBody;
    expect(channels.entries.map((entry) => entry.id)).toEqual([second.id]);
    expect(channels.entries[0]).toMatchObject({
      kind: 'channel',
      handle: 'hiking_news',
      description: 'Trail news',
    });
    const groupsOnly = (await (
      await directoryRequest(strangerCookie, '?q=hiking&kind=group')
    ).json()) as DirectoryBody;
    expect(groupsOnly.entries.map((entry) => entry.id)).toEqual([first.id]);

    // …and an empty query lists the newest public rows with a cursor.
    const page = (await (await directoryRequest(strangerCookie)).json()) as DirectoryBody;
    expect(page.entries.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(page.next).toBeNull();
  });

  it('rejects a bad kind and an overlong query with the schema 400', async () => {
    const user = await bootstrapUser(context, app, 'directory-400@example.com');

    const badKind = await directoryRequest(user.cookie, '?kind=bogus');
    expect(badKind.status).toBe(400);
    const badKindBody = (await badKind.json()) as { error: { code: string; message: string } };
    expect(badKindBody.error.code).toBe('invalid_request');
    expect(badKindBody.error.message).toBe('Expected "group" | "channel"\n  at ["kind"]');

    const longQuery = await directoryRequest(user.cookie, `?q=${'a'.repeat(101)}`);
    expect(longQuery.status).toBe(400);
    const longQueryBody = (await longQuery.json()) as { error: { code: string; message: string } };
    expect(longQueryBody.error.code).toBe('invalid_request');
    expect(longQueryBody.error.message).toBe(
      'Expected a value with a length of at most 100\n  at ["q"]',
    );
  });

  it('answers 429 once the directory limiter is exhausted', async () => {
    const user = await bootstrapUser(context, app, 'directory-limit@example.com');

    for (let attempt = 0; attempt < DIRECTORY_RATE_LIMIT_MAX; attempt += 1) {
      const response = await directoryRequest(user.cookie);
      expect(response.status).toBe(200);
      await response.text();
    }

    const limited = await directoryRequest(user.cookie);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('treats LIKE wildcards in the query as literal text', async () => {
    const { ownerCookie, strangerCookie } = await ownedGroup();
    const created = (await (
      await createGroupRequest(ownerCookie, { title: 'Hiking club', memberIds: [] })
    ).json()) as { id: string };
    expect(
      (
        await patchGroupRequest(ownerCookie, created.id, {
          visibility: 'public',
          handle: 'hiking_club',
        })
      ).status,
    ).toBe(200);

    // `%` and `_` never act as wildcards: neither matches the public row,
    // and neither errors.
    for (const query of ['?q=hiking_%25', '?q=%25%25', '?q=hi_ki']) {
      const response = await directoryRequest(strangerCookie, query);
      expect(response.status).toBe(200);
      const body = (await response.json()) as DirectoryBody;
      expect(body.entries).toEqual([]);
    }
  });

  it('extends the handle check with kind=group', async () => {
    const { ownerCookie, strangerCookie, groupId } = await ownedGroup();
    const check = (cookie: string, query: string) =>
      app.request(`${TEST_BASE_URL}/api/handles/check${query}`, { headers: { cookie } });

    expect(await (await check(strangerCookie, '?handle=hiking_pub&kind=group')).json()).toEqual({
      available: true,
    });
    expect(await (await check(strangerCookie, '?handle=admin&kind=group')).json()).toEqual({
      available: false,
      reason: 'reserved',
    });
    expect(await (await check(strangerCookie, '?handle=no!&kind=group')).json()).toEqual({
      available: false,
      reason: 'invalid',
    });

    expect(
      (
        await patchGroupRequest(ownerCookie, groupId, {
          visibility: 'public',
          handle: 'hiking_pub',
        })
      ).status,
    ).toBe(200);
    expect(await (await check(strangerCookie, '?handle=hiking_pub&kind=group')).json()).toEqual({
      available: false,
      reason: 'taken',
    });
  });

  it('audits visibility changes and public joins with ids only', async () => {
    const profiles = await ownedGroup();
    const { ownerCookie, strangerCookie, groupId } = profiles;
    expect(
      (await patchGroupRequest(ownerCookie, groupId, { visibility: 'public', handle: 'audit_pub' }))
        .status,
    ).toBe(200);
    expect((await joinRequest(strangerCookie, groupId)).status).toBe(200);

    const rows = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ action: string; detail: unknown }>`
          SELECT action, detail FROM audit_log WHERE group_id = ${groupId}
        `;
      }),
    );
    const actions = rows.map((row) => row.action);
    expect(actions).toContain('group.visibility_changed');
    expect(actions).toContain('group.joined_public');
    for (const row of rows) {
      const text = JSON.stringify(row.detail);
      expect(text).not.toContain('audit_pub');
      expect(text).not.toContain('Weekend trip');
    }
  });

  it('lets a newcomer join a public channel and read as a subscriber', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const created = await createGroupRequest(owner.cookie, {
      title: 'Releases',
      memberIds: [],
      kind: 'channel',
      description: 'Ship notes',
    });
    expect(created.status).toBe(201);
    const { id: groupId } = (await created.json()) as { id: string };
    expect(
      (await patchGroupRequest(owner.cookie, groupId, { visibility: 'public', handle: 'releases' }))
        .status,
    ).toBe(200);

    const newcomer = await bootstrapUser(context, app, 'newcomer@example.com');
    expect((await joinRequest(newcomer.cookie, groupId)).status).toBe(200);
    // A public channel keeps the channel rule: the joiner reads (empty
    // audience in the detail) but holds a voiceless `member` row.
    const detail = (await (
      await app.request(`${TEST_BASE_URL}/api/groups/${groupId}`, {
        headers: { cookie: newcomer.cookie },
      })
    ).json()) as VisibilityBody;
    expect(detail.visibility).toBe('public');
    expect(detail.handle).toBe('releases');
    expect(detail.members).toEqual([]);
    const [row] = await testSql(context)(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`
          SELECT user_id FROM group_members WHERE group_id = ${groupId}
        `;
      }),
    );
    expect(row).toBeDefined();
  });

  it('requires authentication on the new routes', async () => {
    expect((await app.request(`${TEST_BASE_URL}/api/directory`)).status).toBe(401);
    expect((await app.request(`${TEST_BASE_URL}/api/groups/by-handle/some`)).status).toBe(401);
    expect(
      (await app.request(`${TEST_BASE_URL}/api/groups/x/join`, { method: 'POST' })).status,
    ).toBe(401);
  });

  it('uses the production cap by default', async () => {
    expect(PUBLIC_GROUP_MAX_MEMBERS).toBe(5000);
  });

  it('rejects a raw visibility value outside private/public at the database', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    await expect(
      testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO "groups" ("id", "room_localpart", "title", "created_by", "visibility")
            VALUES ('g-raw', 'grawroomlocalpart1', 'Raw', ${owner.id}, 'archived')
          `;
        }),
      ),
    ).rejects.toThrow();
    // …while both legal values write fine.
    for (const visibility of ['private', 'public'] as const) {
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO "groups" ("id", "room_localpart", "title", "created_by", "visibility")
            VALUES (${`g-raw-${visibility}`}, ${`grawroom${visibility}12`}, 'Raw', ${owner.id}, ${visibility})
          `;
        }),
      );
    }
    expect(
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ id: string }>`
            SELECT id FROM "groups" WHERE created_by = ${owner.id}
          `;
        }),
      ),
    ).toHaveLength(2);
  });

  describe('join cap', () => {
    function service(maxMembers: number) {
      return {
        db: context.db,
        adminClient: context.adminClient,
        domain: context.config.xmpp.domain,
        logger: context.logger,
        maxMembers,
      };
    }

    async function seedAi(ownerId: string): Promise<string> {
      const aiId = randomUUID();
      const connectionId = randomUUID();
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO provider_connections ("id", "owner", "provider", "encrypted_key", "label")
            VALUES (${connectionId}, ${ownerId}, 'openai', 'sealed-placeholder', NULL)
          `;
        }),
      );
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO ais ("id", "owner", "name", "template", "persona", "provider_connection_id", "model", "localpart", "jid", "status")
            VALUES (${aiId}, ${ownerId}, 'Helper AI', 'dev', 'A helpful persona.', ${connectionId}, 'gpt-4o-mini', ${aiLocalpart(aiId)}, ${`${aiLocalpart(aiId)}@example.com`}, 'active')
          `;
        }),
      );
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO ai_limits ("ai_id", "per_day_usd", "per_month_usd")
            VALUES (${aiId}, '1.00', '20.00')
          `;
        }),
      );
      return aiId;
    }

    async function publicGroup(ownerCookie: string, title: string): Promise<string> {
      const created = await app.request(`${TEST_BASE_URL}/api/groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ title, memberIds: [] }),
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      const patched = await app.request(`${TEST_BASE_URL}/api/groups/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ visibility: 'public', handle: `pub_${id.slice(0, 8)}` }),
      });
      expect(patched.status).toBe(200);
      return id;
    }

    it('admits exactly one of two simultaneous joins at the last seat', async () => {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const fillerA = await bootstrapUser(context, app, 'filler-a@example.com');
      const fillerB = await bootstrapUser(context, app, 'filler-b@example.com');
      const racerA = await bootstrapUser(context, app, 'racer-a@example.com');
      const racerB = await bootstrapUser(context, app, 'racer-b@example.com');
      const groupId = await publicGroup(owner.cookie, 'Last seat');
      // Cap 4: owner + 2 fillers = 3 occupants (cap-1), one seat left.
      for (const filler of [fillerA, fillerB]) {
        const joined = await joinPublicGroup(service(4), groupId, filler.id);
        expect(joined.alreadyMember).toBe(false);
      }

      // Both racers join at once: the per-group advisory lock serializes
      // the two transactions, so exactly one wins and the loser answers
      // 409 `group_full` — never two memberships for one seat.
      const [first, second] = await Promise.all([
        joinPublicGroup(service(4), groupId, racerA.id).then(
          (result) => ({ ok: true as const, result }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
        joinPublicGroup(service(4), groupId, racerB.id).then(
          (result) => ({ ok: true as const, result }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
      ]);
      const winners = [first, second].filter((outcome) => outcome.ok);
      const losers = [first, second].filter((outcome) => !outcome.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const loser = losers[0];
      expect(loser?.ok).toBe(false);
      if (loser !== undefined && !loser.ok) {
        expect(loser.error).toMatchObject({ status: 409, code: 'group_full' });
      }
      const rows = await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ userId: string }>`
            SELECT user_id FROM group_members WHERE group_id = ${groupId}
          `;
        }),
      );
      // Owner + 2 fillers + exactly one racer: the cap is never exceeded.
      expect(rows).toHaveLength(4);
    });

    it('counts AIs toward the cap in the pre-check and in the transaction', async () => {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const newcomer = await bootstrapUser(context, app, 'newcomer@example.com');
      const late = await bootstrapUser(context, app, 'late@example.com');
      const groupId = await publicGroup(owner.cookie, 'AI room');
      // Cap 3: owner (person) + 1 AI = 2 occupants, one seat left…
      const aiId = await seedAi(owner.id);
      await testSql(context)(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO group_ais ("group_id", "ai_id", "added_by")
            VALUES (${groupId}, ${aiId}, ${owner.id})
          `;
        }),
      );

      const joined = await joinPublicGroup(service(3), groupId, newcomer.id);
      expect(joined).toEqual({ groupId, alreadyMember: false });

      // …owner + AI + newcomer = 3 = cap: the next join is refused, even
      // though only 2 of the 3 occupants are people.
      const refused = await joinPublicGroup(service(3), groupId, late.id).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused).toMatchObject({ status: 409, code: 'group_full' });
    });

    it('refuses a join when AIs alone fill the cap', async () => {
      const owner = await bootstrapUser(context, app, 'owner@example.com');
      const newcomer = await bootstrapUser(context, app, 'newcomer@example.com');
      const groupId = await publicGroup(owner.cookie, 'AI full');
      // Cap 3: owner + 2 AIs = cap before anyone joins.
      for (let index = 0; index < 2; index += 1) {
        const aiId = await seedAi(owner.id);
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`
              INSERT INTO group_ais ("group_id", "ai_id", "added_by")
              VALUES (${groupId}, ${aiId}, ${owner.id})
            `;
          }),
        );
      }
      const refused = await joinPublicGroup(service(3), groupId, newcomer.id).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused).toMatchObject({ status: 409, code: 'group_full' });
      expect(
        await testSql(context)(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ userId: string }>`
              SELECT user_id FROM group_members WHERE group_id = ${groupId}
            `;
          }),
        ),
      ).toHaveLength(1);
    });
  });
});
