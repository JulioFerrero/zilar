import { randomBytes, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { classifyHandle, normalizeHandle } from '../handles/rules';
import { isUniqueViolation } from '../handles/store';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { assertContacts, inviteNewMembers } from './invites';
import { destroyQuietly, getGroupDetail, getMembership, requireGroup } from './queries';
import {
  ROOM_ALPHABET,
  ROOM_LOCALPART_LENGTH,
  mapXmppError,
  resolveGroupBackground,
  type ChannelKind,
  type CreateGroupInput,
  type GroupDetail,
  type PatchGroupInput,
} from './schemas';

// T-0108: group owner/admin toggles whether plain members may create topics.
// T-0463: an owner/admin also sets or clears the group background.
// T-0474: an owner/admin also sets the listener switch and eagerness.
export async function patchGroup(db: ServerDatabase, input: PatchGroupInput): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  // A non-member sees the same 404 as a missing group.
  if (!group || !actor) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  if (actor.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only owners and admins can change group settings');
  }
  const background =
    input.background === undefined
      ? undefined
      : await resolveGroupBackground(
          db,
          input.actorId,
          {
            backgroundPreset: group.backgroundPreset,
            backgroundImageId: group.backgroundImageId,
            backgroundDim: group.backgroundDim,
          },
          input.background,
        );
  if (
    input.membersCanCreateTopics !== undefined ||
    background !== undefined ||
    input.listenerEnabled !== undefined ||
    input.listenerEagerness !== undefined
  ) {
    const changes = {
      ...(input.membersCanCreateTopics === undefined
        ? {}
        : { members_can_create_topics: input.membersCanCreateTopics }),
      ...(input.listenerEnabled === undefined ? {} : { listener_enabled: input.listenerEnabled }),
      ...(input.listenerEagerness === undefined
        ? {}
        : { listener_eagerness: input.listenerEagerness }),
      ...(background === undefined
        ? {}
        : {
            background_preset: background.backgroundPreset,
            background_image_id: background.backgroundImageId,
            background_dim: background.backgroundDim,
          }),
    };
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE groups SET ${sql.update(changes)} WHERE id = ${input.groupId}`;
      }),
    );
  }
  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while patching it');
  }
  return detail;
}

// `g` followed by 16 random lowercase base32 characters. Never derived from the
// title, so a rename (later) can never collide or leak anything.
export function randomRoomLocalpart(): string {
  const bytes = randomBytes(ROOM_LOCALPART_LENGTH);
  let localpart = 'g';
  for (const byte of bytes) {
    localpart += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
  }
  return localpart;
}

export async function createGroup(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: CreateGroupInput,
): Promise<GroupDetail> {
  const memberIds = [...new Set(input.memberIds)].filter((id) => id !== input.creatorId);
  await assertContacts(db, input.creatorId, memberIds);
  const kind: ChannelKind = input.kind ?? 'group';
  const description = input.description?.trim() === '' ? null : (input.description ?? null);
  const now = input.now ?? new Date();

  const groupId = randomUUID();
  const roomLocalpart = randomRoomLocalpart();
  let roomCreated = false;

  // T-0164: a public create validates the handle up front (shape + reserved
  // words), so the transaction below never has to roll back for a bad
  // value; the uniqueness race still maps to 409 `handle_taken` inside.
  const wantPublic = input.visibility === 'public';
  const trimmedHandle = (input.handle ?? '').trim();
  if (wantPublic) {
    if (trimmedHandle === '') {
      throw new HttpError(400, 'invalid_request', 'A public group needs a handle');
    }
    const rule = classifyHandle(trimmedHandle);
    if (rule === 'invalid') {
      throw new HttpError(400, 'handle_invalid', 'That handle is not valid');
    }
    if (rule === 'reserved') {
      throw new HttpError(409, 'handle_reserved', 'That handle is reserved');
    }
  } else if (input.handle !== undefined) {
    throw new HttpError(400, 'invalid_request', 'A private group has no handle');
  }

  try {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO groups ${sql.insert({
              id: groupId,
              room_localpart: roomLocalpart,
              title: input.title,
              created_by: input.creatorId,
              kind,
              description,
              ...(wantPublic ? { visibility: 'public' } : {}),
            })}`;
            yield* sql`INSERT INTO group_members ${sql.insert([
              { group_id: groupId, user_id: input.creatorId, role: 'owner' },
              ...memberIds.map((userId) => ({
                group_id: groupId,
                user_id: userId,
                role: 'member',
              })),
            ])}`;
            // T-0108: the group's room becomes its General topic (same room, same
            // history). The row is created in the same transaction as the group.
            // T-0124: a channel's General topic is its only topic — the feed.
            yield* sql`INSERT INTO topics ${sql.insert({
              id: randomUUID(),
              group_id: groupId,
              name: 'General',
              glyph: 'G',
              room_localpart: roomLocalpart,
              visibility: 'public',
              kind: 'chat',
              status: 'open',
              is_general: true,
              created_by: input.creatorId,
            })}`;

            // T-0164: a public create claims the handle in the same transaction
            // (the creator's first claim is always allowed — no interval — and a
            // retired reservation of this group reads as free, reclaimed by
            // deleting it here). Concurrent creates race on the primary key:
            // exactly one wins and the loser maps to 409 `handle_taken`.
            if (wantPublic) {
              const lower = normalizeHandle(trimmedHandle);
              const [taken] = yield* sql<{ handleLower: string }>`SELECT handle_lower
                FROM handles WHERE handle_lower = ${lower} LIMIT 1`;
              if (taken) {
                return yield* Effect.fail(
                  new HttpError(409, 'handle_taken', 'That handle is taken'),
                );
              }
              const [retired] = yield* sql<{
                formerGroupId: string | null;
                reservedUntil: Date | string;
              }>`SELECT former_group_id, reserved_until FROM retired_handles
                WHERE handle_lower = ${lower} LIMIT 1`;
              if (retired) {
                const reserved = new Date(retired.reservedUntil).getTime() > now.getTime();
                if (reserved && retired.formerGroupId !== groupId) {
                  return yield* Effect.fail(
                    new HttpError(409, 'handle_taken', 'That handle is taken'),
                  );
                }
                yield* sql`DELETE FROM retired_handles WHERE handle_lower = ${lower}`;
              }
              yield* sql`INSERT INTO handles ${sql.insert({
                handle_lower: lower,
                handle: trimmedHandle,
                user_id: null,
                group_id: groupId,
                created_at: now,
                changed_at: now,
              })}`.pipe(
                Effect.catchIf(
                  (error) => isUniqueViolation(error),
                  () => Effect.fail(new HttpError(409, 'handle_taken', 'That handle is taken')),
                ),
              );
            }

            // T-0124: a channel's room is moderated with `members_by_default:
            // false`, so subscribers (affiliation `member`) join as visitors:
            // they read but cannot post. Affiliations `admin`/`owner` carry voice,
            // so admins and the owner post. Group rooms stay unmoderated with the
            // ejabberd default, so every member keeps voice.
            yield* Effect.tryPromise({
              try: () =>
                adminClient.createRoom(roomLocalpart, {
                  title: input.title,
                  membersOnly: true,
                  persistent: true,
                  mam: true,
                  anonymous: false,
                  ...(kind === 'channel' ? { moderated: true, membersByDefault: false } : {}),
                }),
              catch: (error) => error,
            });
            roomCreated = true;
            yield* Effect.tryPromise({
              try: () =>
                adminClient.setAffiliation(
                  roomLocalpart,
                  jidFor(localpartFor(input.creatorId), input.domain),
                  'owner',
                ),
              catch: (error) => error,
            });
            for (const userId of memberIds) {
              // T-0124: in a moderated channel room only affiliations admin/owner
              // carry voice, so every initial member joins as a voice-less member
              // (a visitor once they enter). Group rooms keep `member` for all.
              yield* Effect.tryPromise({
                try: () =>
                  adminClient.setAffiliation(
                    roomLocalpart,
                    jidFor(localpartFor(userId), input.domain),
                    'member',
                  ),
                catch: (error) => error,
              });
            }
          }),
        );
      }),
    );
  } catch (error) {
    if (roomCreated) {
      await destroyQuietly(adminClient, roomLocalpart);
    }
    throw mapXmppError(error);
  }

  const detail = await getGroupDetail(db, groupId);
  if (!detail) {
    throw new Error('group disappeared right after creation');
  }
  await inviteNewMembers(adminClient, roomLocalpart, memberIds, input.domain, input.logger);
  return detail;
}

export { MAX_GROUP_MEMBERS, ROOM_LOCALPART_LENGTH } from './schemas';
export type {
  AddGroupAiInput,
  AddGroupMembersInput,
  ChangeMemberRoleInput,
  ChannelKind,
  ChatGroup,
  CreateGroupInput,
  GroupAiView,
  GroupBackground,
  GroupDetail,
  GroupListenerEagerness,
  GroupMemberView,
  GroupRole,
  InviteLogger,
  PatchGroupInput,
  RemoveGroupAiInput,
  RemoveGroupMemberInput,
} from './schemas';
export { getGroupDetail, getMembership, listGroupsForUser, listMembersForViewer } from './queries';
export { addGroupMembers, changeMemberRole, removeGroupMember, syncChannelVoice } from './members';
export { addGroupAi, removeGroupAi } from './ais';
