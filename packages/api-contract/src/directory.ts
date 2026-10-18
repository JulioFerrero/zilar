// Public groups and channels only, never users or private groups; 20 per page with a cursor. Reads are rate limited.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { lenientLiterals } from './lenient';
import { DirectoryRateLimit, SchemaErrors, Session } from './middleware';

export const DIRECTORY_KINDS = ['group', 'channel'] as const;

export type DirectoryKind = (typeof DIRECTORY_KINDS)[number];

export const DirectoryQuery = Schema.Struct({
  q: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
  kind: Schema.optional(Schema.Literals(DIRECTORY_KINDS)),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});

export type DirectoryQuery = typeof DirectoryQuery.Type;

export const DirectoryEntry = Schema.Struct({
  id: Schema.String,
  kind: lenientLiterals(DIRECTORY_KINDS, 'group'),
  title: Schema.String,
  handle: Schema.String,
  description: Schema.NullOr(Schema.String),
  memberCount: Schema.Number,
  joined: Schema.Boolean,
  avatarUrl: Schema.optional(Schema.String),
});

export type DirectoryEntry = typeof DirectoryEntry.Type;

export const DirectoryPage = Schema.Struct({
  entries: Schema.Array(DirectoryEntry),
  next: Schema.NullOr(Schema.String),
});

export type DirectoryPage = typeof DirectoryPage.Type;

export const DirectoryGroup = HttpApiGroup.make('directory')
  .add(
    HttpApiEndpoint.get('search', '/directory', {
      query: DirectoryQuery,
      success: DirectoryPage,
    }).middleware(DirectoryRateLimit),
    HttpApiEndpoint.get('byHandle', '/groups/by-handle/:handle', {
      params: { handle: Schema.String },
      success: DirectoryEntry,
    }).middleware(DirectoryRateLimit),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
