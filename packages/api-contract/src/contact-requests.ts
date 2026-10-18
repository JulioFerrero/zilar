// 200 `{ request, incoming: true }` when the other side already asked, 201 for a new request.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import {
  ContactRequestByHandleRateLimit,
  ContactRequestCreateRateLimit,
  ContactRequestReadRateLimit,
  ContactRequestsSchemaErrors,
  Session,
  UserSearchRateLimit,
} from './middleware';

export const ContactRequestStatus = Schema.Literals([
  'pending',
  'accepted',
  'declined',
  'cancelled',
]);

export type ContactRequestStatus = typeof ContactRequestStatus.Type;

export const ContactRequestRow = Schema.Struct({
  id: Schema.String,
  fromUserId: Schema.String,
  toUserId: Schema.String,
  status: ContactRequestStatus,
  createdAt: Schema.String,
  decidedAt: Schema.optional(Schema.String),
});

export type ContactRequestRow = typeof ContactRequestRow.Type;

export const ContactRequestResult = Schema.Struct({ request: ContactRequestRow });

export type ContactRequestResult = typeof ContactRequestResult.Type;

// The create body is 1..64 characters; strict, so an excess key is a 400.
export const CreateContactRequestPayload = Schema.Struct({
  handle: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

// The 200 member comes first so an `incoming` value never falls through to the 201 member, which would strip it.
export const ReverseContactRequestResult = Schema.Struct({
  request: ContactRequestRow,
  incoming: Schema.Literal(true),
});

export const CreatedContactRequestResult = ContactRequestResult.pipe(HttpApiSchema.status(201));

export const ContactRequestPerson = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  handle: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Schema.String),
});

export type ContactRequestPerson = typeof ContactRequestPerson.Type;

export const ContactRequestView = Schema.Struct({
  id: Schema.String,
  status: ContactRequestStatus,
  createdAt: Schema.String,
  other: ContactRequestPerson,
});

export type ContactRequestView = typeof ContactRequestView.Type;

export const ContactRequestList = Schema.Struct({
  incoming: Schema.Array(ContactRequestView),
  outgoing: Schema.Array(ContactRequestView),
});

export const HANDLE_RELATIONS = [
  'self',
  'blocked',
  'contact',
  'request_sent',
  'request_received',
  'none',
] as const;

export type HandleRelation = (typeof HANDLE_RELATIONS)[number];

export const HandleProfile = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  handle: Schema.String,
  image: Schema.NullOr(Schema.String),
  relation: Schema.Literals(HANDLE_RELATIONS),
  bio: Schema.optional(Schema.String),
});

export type HandleProfile = typeof HandleProfile.Type;

// `q` is 1..64 characters (a leading `@` is stripped server-side); the answer is up to 10 matches.
export const UserSearchQuery = Schema.Struct({
  q: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

export const UserSearchResult = Schema.Struct({ entries: Schema.Array(HandleProfile) });

export type UserSearchResult = typeof UserSearchResult.Type;

const RequestIdParams = Schema.Struct({ id: Schema.String });
const HandleParams = Schema.Struct({ handle: Schema.String });

export const ContactRequestsGroup = HttpApiGroup.make('contactRequests')
  .add(
    HttpApiEndpoint.post('create', '/contact-requests', {
      payload: CreateContactRequestPayload,
      success: [ReverseContactRequestResult, CreatedContactRequestResult],
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(ContactRequestCreateRateLimit),
    HttpApiEndpoint.get('list', '/contact-requests', {
      success: ContactRequestList,
    }).middleware(ContactRequestReadRateLimit),
    HttpApiEndpoint.post('accept', '/contact-requests/:id/accept', {
      params: RequestIdParams,
      success: ContactRequestResult,
    }).middleware(ContactRequestReadRateLimit),
    HttpApiEndpoint.post('decline', '/contact-requests/:id/decline', {
      params: RequestIdParams,
      success: ContactRequestResult,
    }).middleware(ContactRequestReadRateLimit),
    HttpApiEndpoint.delete('cancel', '/contact-requests/:id', {
      params: RequestIdParams,
      success: ContactRequestResult,
    }).middleware(ContactRequestReadRateLimit),
    HttpApiEndpoint.get('byHandle', '/users/by-handle/:handle', {
      params: HandleParams,
      success: HandleProfile,
    }).middleware(ContactRequestByHandleRateLimit),
    HttpApiEndpoint.get('search', '/users/search', {
      query: UserSearchQuery,
      success: UserSearchResult,
    }).middleware(UserSearchRateLimit),
  )
  .middleware(Session)
  .middleware(ContactRequestsSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
