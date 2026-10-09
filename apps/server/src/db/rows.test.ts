import { describe, expectTypeOf, it } from 'vitest';
import {
  aiToolRuns,
  aiToolVersions,
  aiTools,
  ais,
  approvalRules,
  approvals,
  avatars,
  chatBackgrounds,
  chatFolders,
  chatPrefs,
  groupAis,
  groupInviteLinks,
  groupMembers,
  groupRoles,
  groups,
  invites,
  machinePairingCodes,
  machines,
  mediaItems,
  pendingActions,
  pinnedMessages,
  pushSettings,
  pushSubscriptions,
  routines,
  stickerPacks,
  stickers,
  topics,
  xmppAccounts,
  type AvatarOwnerKind as SchemaAvatarOwnerKind,
} from './schema';
import type {
  AiToolRow,
  AiToolRunRow,
  AiToolVersionRow,
  AisRow,
  ApprovalInsert,
  ApprovalRow,
  ApprovalRuleRow,
  AvatarOwnerKind,
  AvatarRow,
  ChatBackgroundRow,
  ChatFolderRow,
  ChatPrefRow,
  GroupAiRow,
  GroupInviteLinkRow,
  GroupMemberRow,
  GroupRoleRow,
  GroupRow,
  InviteRow,
  MachinePairingCodeRow,
  MachineRow,
  MediaItemRow,
  PendingActionRow,
  PinnedMessageRow,
  PushSettingRow,
  PushSubscriptionRow,
  RoutineRow,
  StickerPackRow,
  StickerRow,
  TopicRow,
  XmppAccountRow,
} from './rows';

describe('db/rows types match drizzle', () => {
  it('row interfaces equal the $inferSelect of their table', () => {
    expectTypeOf<InviteRow>().toEqualTypeOf<typeof invites.$inferSelect>();
    expectTypeOf<XmppAccountRow>().toEqualTypeOf<typeof xmppAccounts.$inferSelect>();
    expectTypeOf<GroupRow>().toEqualTypeOf<typeof groups.$inferSelect>();
    expectTypeOf<GroupInviteLinkRow>().toEqualTypeOf<typeof groupInviteLinks.$inferSelect>();
    expectTypeOf<GroupMemberRow>().toEqualTypeOf<typeof groupMembers.$inferSelect>();
    expectTypeOf<GroupAiRow>().toEqualTypeOf<typeof groupAis.$inferSelect>();
    expectTypeOf<TopicRow>().toEqualTypeOf<typeof topics.$inferSelect>();
    expectTypeOf<GroupRoleRow>().toEqualTypeOf<typeof groupRoles.$inferSelect>();
    expectTypeOf<AisRow>().toEqualTypeOf<typeof ais.$inferSelect>();
    expectTypeOf<PinnedMessageRow>().toEqualTypeOf<typeof pinnedMessages.$inferSelect>();
    expectTypeOf<ChatBackgroundRow>().toEqualTypeOf<typeof chatBackgrounds.$inferSelect>();
    expectTypeOf<ChatPrefRow>().toEqualTypeOf<typeof chatPrefs.$inferSelect>();
    expectTypeOf<ChatFolderRow>().toEqualTypeOf<typeof chatFolders.$inferSelect>();
    expectTypeOf<StickerPackRow>().toEqualTypeOf<typeof stickerPacks.$inferSelect>();
    expectTypeOf<StickerRow>().toEqualTypeOf<typeof stickers.$inferSelect>();
    expectTypeOf<AvatarRow>().toEqualTypeOf<typeof avatars.$inferSelect>();
    expectTypeOf<PushSubscriptionRow>().toEqualTypeOf<typeof pushSubscriptions.$inferSelect>();
    expectTypeOf<PushSettingRow>().toEqualTypeOf<typeof pushSettings.$inferSelect>();
    expectTypeOf<MachineRow>().toEqualTypeOf<typeof machines.$inferSelect>();
    expectTypeOf<MachinePairingCodeRow>().toEqualTypeOf<typeof machinePairingCodes.$inferSelect>();
    expectTypeOf<ApprovalRow>().toEqualTypeOf<typeof approvals.$inferSelect>();
    expectTypeOf<PendingActionRow>().toEqualTypeOf<typeof pendingActions.$inferSelect>();
    expectTypeOf<ApprovalRuleRow>().toEqualTypeOf<typeof approvalRules.$inferSelect>();
    expectTypeOf<AiToolRow>().toEqualTypeOf<typeof aiTools.$inferSelect>();
    expectTypeOf<AiToolVersionRow>().toEqualTypeOf<typeof aiToolVersions.$inferSelect>();
    expectTypeOf<AiToolRunRow>().toEqualTypeOf<typeof aiToolRuns.$inferSelect>();
    expectTypeOf<RoutineRow>().toEqualTypeOf<typeof routines.$inferSelect>();
    expectTypeOf<MediaItemRow>().toEqualTypeOf<typeof mediaItems.$inferSelect>();
  });

  it('ApprovalInsert equals the $inferInsert of approvals', () => {
    expectTypeOf<ApprovalInsert>().toEqualTypeOf<typeof approvals.$inferInsert>();
  });

  it('AvatarOwnerKind equals the schema owner kind', () => {
    expectTypeOf<AvatarOwnerKind>().toEqualTypeOf<SchemaAvatarOwnerKind>();
  });
});
