import { Effect } from 'effect';
import { callApi } from '@/lib/effect/api-client';
import { runWeb } from '@/lib/effect/runtime';
import { isMockApiEnabled } from '@/mock/gate';
import { loadMockRequest } from '@/mock/load';
import { API_BASE } from './api/http';
import type { Me } from './api/chats';
export { API_BASE, ApiError } from './api/http';

// In mock mode the mock backend answers the same path; the real call is a same-origin fetch.
const exportRequest = (): Effect.Effect<Response, unknown> =>
  Effect.suspend(() =>
    isMockApiEnabled()
      ? Effect.flatMap(
          Effect.tryPromise({
            try: () => loadMockRequest(),
            catch: (cause) => cause,
          }),
          (dispatch) =>
            Effect.tryPromise({
              try: () => dispatch('/me/export', { method: 'GET' }),
              catch: (cause) => cause,
            }),
        )
      : Effect.tryPromise({
          try: () => fetch(`${API_BASE}/me/export`, { credentials: 'include' }),
          catch: (cause) => cause,
        }),
  );

/** The route answers a streamed JSON download with a Content-Disposition filename, so the caller
 * gets the raw Response to save; only an unreachable server rejects. */
export function fetchExport(): Promise<Response> {
  return runWeb(exportRequest());
}

// PATCH /me requires the display name, so it rides along unchanged.
export function updateMeProfile(name: string, bio: string): Promise<Me> {
  return callApi((client) => client.auth.patchMe({ payload: { name: name.trim(), bio } }));
}

export {
  chatEntryTopics,
  clearChatHistory,
  createChatFolder,
  createInvite,
  deleteChatFolder,
  deleteMessageForMe,
  getChatBackgroundDefault,
  getChats,
  getContacts,
  getInvite,
  getMe,
  getXmppToken,
  listChatFolders,
  listChatPrefs,
  markChatDelivered,
  markChatRead,
  patchChatFolder,
  putChatBackgroundDefault,
  putChatPref,
  reorderChatFolders,
  updateMe,
} from './api/chats';
export type {
  ApiChatFolder,
  ChatBackgroundChoice,
  ChatEntry,
  ChatPref,
  Contact,
  CreateChatFolderInput,
  Invite,
  Me,
  PatchChatFolderInput,
  PutChatPrefInput,
  XmppToken,
} from './api/chats';

export {
  addGroupAi,
  changeGroupMemberRole,
  checkGroupHandle,
  createGroup,
  createGroupInviteLink,
  createGroupRole,
  deleteGroupRole,
  getGroup,
  joinByLink,
  joinPublicGroup,
  listGroupInviteLinks,
  listGroupMembers,
  listGroupRoles,
  lookupGroupByHandle,
  previewJoinLink,
  removeGroupAi,
  removeGroupMember,
  renameGroupRole,
  revokeGroupInviteLink,
  searchDirectory,
  setGroupBackground,
  setGroupListener,
  setGroupRoleMembers,
  setGroupVisibility,
  setMembersCanCreateTopics,
} from './api/groups';
export type {
  CreateGroupInviteLinkInput,
  CreatedInviteLink,
  DirectoryEntry,
  DirectoryPage,
  GroupAi,
  GroupBackground,
  GroupDetail,
  GroupInviteLink,
  GroupMember,
  GroupRole,
  JoinPreview,
  JoinResult,
  ListenerEagerness,
  PublicJoinResult,
  SearchDirectoryInput,
  SetGroupListenerInput,
} from './api/groups';

export {
  addTopicAi,
  addTopicMember,
  archiveTopic,
  createTopic,
  getTopic,
  getTopicPreview,
  joinTopic,
  listGroupTopics,
  listTopicAis,
  listTopicMembers,
  listTopicTools,
  patchTopic,
  removeTopicAi,
  removeTopicMember,
  setTopicRoles,
  topicSchema,
} from './api/topics';
export type {
  ApproverRole,
  CreateTopicInput,
  PatchTopicInput,
  SetTopicRolesInput,
  Topic,
  TopicAi,
  TopicMember,
  TopicRole,
  TopicTool,
  TopicVisibility,
} from './api/topics';

export {
  approvalRuleSchema,
  createAi,
  createConnection,
  decideApproval,
  deleteAi,
  deleteConnection,
  getAi,
  getAiCatalog,
  getApproval,
  getComputerOptions,
  listAiApprovalRules,
  listAis,
  listApprovals,
  listConnections,
  listGroupApprovalRules,
  publicApprovalSchema,
  replaceConnectionKey,
  resumeAi,
  revokeApprovalRule,
  setAiMachine,
  stopAi,
  testConnection,
  updateAi,
} from './api/ais';
export type {
  AiComputerOptions,
  AiLimits,
  AiTemplate,
  AiUsage,
  ApprovalDecision,
  ApprovalRule,
  ApprovalStatus,
  Connection,
  ConnectionTestResult,
  CreateAiInput,
  CreateConnectionInput,
  PublicAi,
  PublicApproval,
  UpdateAiInput,
} from './api/ais';

export {
  approveMachine,
  createPairingCode,
  deleteMachine,
  denyMachine,
  listMachines,
  machineSchema,
  renameMachine,
  revokeMachine,
} from './api/machines';
export type { Machine, MachineStatus, PairingCode } from './api/machines';

export {
  addStickerFavorite,
  addStickerPanelPack,
  createStickerPack,
  deletePackSticker,
  deleteStickerPack,
  discoverStickerPacks,
  getPushConfig,
  getPushSettings,
  gifMediaUrl,
  importTelegramStickers,
  listPushDevices,
  listStickerFavorites,
  listStickerPacks,
  patchStickerPack,
  registerPushDevice,
  removePushDevice,
  removeStickerFavorite,
  removeStickerPanelPack,
  reorderStickerPanelPacks,
  searchGifs,
  sendTestPushNotification,
  setPushSettings,
  trendingGifs,
  uploadStickerFile,
} from './api/stickers';
export type {
  GifPage,
  GifResult,
  PushConfig,
  PushDevice,
  RegisteredDevice,
  RegisterPushDeviceInput,
  Sticker,
  StickerPack,
  TelegramImportResult,
} from './api/stickers';

export {
  clearAiMemory,
  forgetAiMemoryFact,
  getAiMemory,
  listChatMedia,
  listPins,
  pinMessage,
  searchMessages,
  unpinMessage,
} from './api/media';
export type {
  AiMemory,
  ListChatMediaInput,
  MediaItem,
  MediaPage,
  MediaTab,
  Pin,
  PinKind,
  PinMessageInput,
  SearchItem,
  SearchMessagesInput,
} from './api/media';

export {
  acceptContactRequest,
  blockUser,
  cancelContactRequest,
  checkHandle,
  claimHandle,
  declineContactRequest,
  listBlockedUsers,
  listContactRequests,
  lookupByHandle,
  searchUsers,
  sendContactRequest,
  unblockUser,
} from './api/people';
export type {
  BlockedPerson,
  ContactRelation,
  ContactRequestList,
  ContactRequestPerson,
  ContactRequestRow,
  ContactRequestStatus,
  ContactRequestView,
  HandleCheck,
  HandleCheckReason,
  HandleProfile,
} from './api/people';

export {
  deleteBackground,
  getIntegrationsStatus,
  getSetupStatus,
  getVoiceTranscript,
  getVoiceTranscriptionStatus,
  listAudit,
  listBackgrounds,
  postSetup,
  removeAvatar,
  removeTelegramBotToken,
  removeVoiceTranscriptionSettings,
  saveEmailSettings,
  saveTelegramBotToken,
  saveVoiceTranscriptionSettings,
  uploadAvatar,
  uploadBackground,
} from './api/settings';
export type {
  AuditScope,
  BackgroundImage,
  BackgroundListItem,
  IntegrationsStatus,
  ListAuditInput,
  ListAuditPage,
  PublicAuditEntry,
  SaveEmailSettingsInput,
  SaveVoiceTranscriptionInput,
  SetupInput,
  SetupResult,
  SetupStatus,
} from './api/settings';
