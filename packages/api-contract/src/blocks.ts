// Blocked people (T-0235, moved to the contract by T-0894): silent blocking.
// The blocked person is not told, and their contact requests never reach the
// blocker. Writes answer `{ blocked: true/false }`, the list newest first.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { BlocksReadRateLimit, BlocksWriteRateLimit, SchemaErrors, Session } from './middleware';

// `{ blocked: true }` on PUT, `{ blocked: false }` on DELETE.
export const BlockResult = Schema.Struct({ blocked: Schema.Boolean });

export type BlockResult = typeof BlockResult.Type;

export const BlockedPerson = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  handle: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Schema.String),
  jid: Schema.NullOr(Schema.String),
});

export type BlockedPerson = typeof BlockedPerson.Type;

export const BlockedList = Schema.Struct({ blocked: Schema.Array(BlockedPerson) });

export const BlocksGroup = HttpApiGroup.make('blocks')
  .add(
    HttpApiEndpoint.put('block', '/blocks/:userId', {
      params: { userId: Schema.String },
      success: BlockResult,
    }).middleware(BlocksWriteRateLimit),
    HttpApiEndpoint.delete('unblock', '/blocks/:userId', {
      params: { userId: Schema.String },
      success: BlockResult,
    }).middleware(BlocksWriteRateLimit),
    HttpApiEndpoint.get('list', '/blocks', {
      success: BlockedList,
    }).middleware(BlocksReadRateLimit),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
