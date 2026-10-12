// The web API client is split by feature under `api/` (T-0959). Every importer
// keeps using `@/lib/api`; this barrel re-exports the same names it always did.
import { Effect } from 'effect';
import { callApi } from '@/lib/effect/api-client';
import { runWeb } from '@/lib/effect/runtime';
import { isMockApiEnabled } from '@/mock/gate';
import { loadMockRequest } from '@/mock/load';
import { API_BASE } from './api/http';
import type { Me } from './api/chats';
export { API_BASE, ApiError } from './api/http';

// One export request: in web mock mode the mock backend (T-1262) answers the
// same path, mirroring `request` in `./api/http`, so the button works on the
// mock. The real call is a same-origin `fetch` with cookies.
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

/**
 * The account export (T-1262, button T-1265). The route answers a streamed JSON
 * download with a `Content-Disposition` filename, so the caller gets the raw
 * `Response` to save as a blob; a refused status is the caller's to map. It only
 * rejects when the server cannot be reached.
 */
export function fetchExport(): Promise<Response> {
  return runWeb(exportRequest());
}

/**
 * Save the caller's bio (T-1258). `PATCH /me` still requires the display name,
 * so it rides along unchanged. The name-only `updateMe` stays in `api/chats.ts`.
 */
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
  TopicKind,
  TopicMember,
  TopicOwner,
  TopicRole,
  TopicStatus,
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
  getApproval,
  listAiApprovalRules,
  listAis,
  listApprovals,
  listConnections,
  listGroupApprovalRules,
  publicApprovalSchema,
  resumeAi,
  revokeApprovalRule,
  setAiMachine,
  stopAi,
  testConnection,
  updateAi,
} from './api/ais';
export type {
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
