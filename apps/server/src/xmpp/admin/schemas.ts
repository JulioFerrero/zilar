import { Schema } from 'effect';
import { isJid, struct } from '@zilar/protocol';

// Localparts and room ids are lowercase by design; they become part of a JID.
// They are validated before any HTTP request goes out.
export const NameSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) =>
      /^[a-z0-9._-]{1,64}$/.test(value)
        ? undefined
        : 'must be 1-64 characters of lowercase letters, digits, ".", "_" or "-"',
    ),
  ),
);

export const PasswordSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) => (value.length >= 1 ? undefined : 'must not be empty')),
    Schema.isMaxLength(1024),
  ),
);

// The shared protocol rule, re-checked here; `isJid` is the same rule the
// protocol package applies to `JidSchema`.
const BareJidSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) =>
      isJid(value) ? undefined : 'must be a bare JID (local@domain)',
    ),
  ),
);

export const RoomAffiliationSchema = Schema.Literals(['owner', 'admin', 'member', 'none']);
export type RoomAffiliation = Schema.Schema.Type<typeof RoomAffiliationSchema>;

export const RosterSubscriptionSchema = Schema.Literals(['none', 'to', 'from', 'both']);
export type RosterSubscription = Schema.Schema.Type<typeof RosterSubscriptionSchema>;

// A roster entry as returned by `get_roster`.
export const RosterEntrySchema = struct({
  jid: BareJidSchema,
  nick: Schema.String,
  subscription: RosterSubscriptionSchema,
  pending: Schema.String,
  groups: Schema.mutable(Schema.Array(Schema.String)),
});
export type RosterEntry = Schema.Schema.Type<typeof RosterEntrySchema>;

export const RoomAffiliationEntrySchema = struct({
  jid: BareJidSchema,
  affiliation: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  reason: Schema.String,
});
export type RoomAffiliationEntry = Schema.Schema.Type<typeof RoomAffiliationEntrySchema>;

export const MutationResultSchema = Schema.Union([Schema.Literal(0), Schema.Literal('')]);
export const CheckAccountResultSchema = Schema.Union([Schema.Literal(0), Schema.Literal(1)]);

export const RoomOptionNameSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
);
export const RoomOptionValueSchema = Schema.String.pipe(Schema.check(Schema.isMaxLength(4096)));
export const SubscriptionNickSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
);
export const RosterNickSchema = Schema.String.pipe(Schema.check(Schema.isMaxLength(1024)));
const RosterGroupSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
);
export const RosterGroupsSchema = Schema.Array(RosterGroupSchema).check(Schema.isMinLength(1));
export const InvitationTargetsSchema = Schema.Array(BareJidSchema).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1000),
);
