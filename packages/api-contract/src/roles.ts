// Custom group roles (T-0116): labels with two powers (private-topic access
// and approver rights) that a group owner or admin hands to members. Reading
// needs only membership; every write needs an owner or admin.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { SchemaErrors, Session } from './middleware';

export const ROLE_NAME_MAX = 30;
export const ROLE_MEMBERS_MAX = 50;

const CONTROL_CHAR_MAX = 0x1f;
const CONTROL_CHAR_DEL = 0x7f;

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL) {
      return true;
    }
  }
  return false;
}

/** Trimmed before the checks: 1..30 characters, no control characters. */
export const RoleName = Schema.Trim.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(ROLE_NAME_MAX),
  Schema.makeFilter((value) =>
    hasControlCharacters(value) ? 'name must not contain control characters' : undefined,
  ),
);

// Both bodies are strict, so an excess key is a 400.
export const CreateRolePayload = Schema.Struct({ name: RoleName });
export const RenameRolePayload = Schema.Struct({ name: RoleName });

/** Up to 50 non-empty user ids. */
export const SetRoleMembersPayload = Schema.Struct({
  userIds: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)))).check(
    Schema.isMaxLength(ROLE_MEMBERS_MAX),
  ),
});

export const RoleMember = Schema.Struct({ userId: Schema.String, name: Schema.String });

/** A role with its holders. The arrays are mutable in the type so a client can hand them on. */
export const GroupRole = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  members: Schema.mutable(Schema.Array(RoleMember)),
});

export type GroupRole = typeof GroupRole.Type;

export const GroupRoleList = Schema.Struct({ roles: Schema.mutable(Schema.Array(GroupRole)) });

const GroupIdParams = Schema.Struct({ id: Schema.String });
const RoleParams = Schema.Struct({ id: Schema.String, roleId: Schema.String });

export const RolesGroup = HttpApiGroup.make('roles')
  .add(
    HttpApiEndpoint.get('list', '/groups/:id/roles', {
      params: GroupIdParams,
      success: GroupRoleList,
    }),
    HttpApiEndpoint.post('create', '/groups/:id/roles', {
      params: GroupIdParams,
      payload: CreateRolePayload,
      success: GroupRole.pipe(HttpApiSchema.status(201)),
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.patch('rename', '/groups/:id/roles/:roleId', {
      params: RoleParams,
      payload: RenameRolePayload,
      success: GroupRole,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.delete('remove', '/groups/:id/roles/:roleId', {
      params: RoleParams,
      success: HttpApiSchema.NoContent,
    }),
    HttpApiEndpoint.put('setMembers', '/groups/:id/roles/:roleId/members', {
      params: RoleParams,
      payload: SetRoleMembersPayload,
      success: GroupRole,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
