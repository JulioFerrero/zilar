// The outside world of the web chat store, read from one Ports service. PortsTest fills every
// port a test did not supply with an inert one, so no test reaches the network by accident.
import { Context, Effect, Layer } from 'effect';
import { createXmppCore, type XmppCore, type XmppCoreOptions } from '@zilar/xmpp-core';
import type {
  ChatRows,
  Notifications,
  OutgoingBytes,
  SessionCheck,
  StoreFlags,
  Visibility,
  VoiceOut,
} from '@zilar/client-core/store';
import {
  addGroupAi as addGroupAiRequest,
  archiveTopic as archiveTopicRequest,
  addTopicAi as addTopicAiRequest,
  addTopicMember as addTopicMemberRequest,
  changeGroupMemberRole as changeGroupMemberRoleRequest,
  clearChatHistory as clearChatHistoryRequest,
  createGroup as createGroupRequest,
  createGroupInviteLink as createGroupInviteLinkRequest,
  createInvite as createInviteRequest,
  createTopic as createTopicRequest,
  deleteMessageForMe as deleteMessageForMeRequest,
  getChats,
  getChatBackgroundDefault as getChatBackgroundDefaultRequest,
  getContacts,
  getGroup,
  getMe,
  getTopic as getTopicRequest,
  getXmppToken,
  joinByLink as joinByLinkRequest,
  joinPublicGroup as joinPublicGroupRequest,
  joinTopic as joinTopicRequest,
  listAis as listAisRequest,
  listChatPrefs as listChatPrefsRequest,
  listGroupInviteLinks as listGroupInviteLinksRequest,
  listGroupMembers as listGroupMembersRequest,
  listGroupTopics as listGroupTopicsRequest,
  lookupGroupByHandle as lookupGroupByHandleRequest,
  listPins as listPinsRequest,
  markChatDelivered as markChatDeliveredRequest,
  markChatRead as markChatReadRequest,
  listChatMedia as listChatMediaRequest,
  listTopicAis as listTopicAisRequest,
  listTopicMembers as listTopicMembersRequest,
  patchTopic as patchTopicRequest,
  pinMessage as pinMessageRequest,
  previewJoinLink as previewJoinLinkRequest,
  putChatBackgroundDefault as putChatBackgroundDefaultRequest,
  putChatPref as putChatPrefRequest,
  removeGroupAi as removeGroupAiRequest,
  removeGroupMember as removeGroupMemberRequest,
  removeTopicAi as removeTopicAiRequest,
  removeTopicMember as removeTopicMemberRequest,
  revokeGroupInviteLink as revokeGroupInviteLinkRequest,
  searchDirectory as searchDirectoryRequest,
  setGroupBackground as setGroupBackgroundRequest,
  setGroupListener as setGroupListenerRequest,
  setGroupVisibility as setGroupVisibilityRequest,
  setMembersCanCreateTopics as setMembersCanCreateTopicsRequest,
  setTopicRoles as setTopicRolesRequest,
  unpinMessage as unpinMessageRequest,
} from '@/lib/api';
import {
  checkSession as checkSessionAdapter,
  sessionGone as sessionGoneAdapter,
} from '@/lib/api/sessionGone';
import { subscribeToDrafts, type OpenDraftStream } from '@/lib/drafts';
import { defaultVoicePort, type VoicePort } from '@/lib/voice/convert';
import { defaultAttachmentPort, type AttachmentPort } from '@/lib/attachments';
import {
  bytesFromAttachmentPort,
  defaultGoToLogin,
  defaultOnFocus,
  defaultStorage,
  defaultVisible,
  liveNotifications,
  realRows,
  voiceFromPort,
  webFlags,
} from './portAdapters';
import type { ApiClient, StorageLike } from './portTypes';

export type { ApiClient, StorageLike } from './portTypes';

export interface RealStoreDeps {
  api?: ApiClient;
  createXmpp?: (options: XmppCoreOptions) => XmppCore;
  storage?: StorageLike | null;
  now?: () => Date;
  documentVisible?: () => boolean;
  voice?: VoicePort;
  attachments?: AttachmentPort;
  openDrafts?: OpenDraftStream;
  goToLogin?: () => void;
  checkSession?: () => Promise<SessionCheck>;
  sessionGone?: () => void;
}

export interface PortsShape {
  readonly api: ApiClient;
  readonly storage: StorageLike | null;
  readonly now: () => Date;
  readonly isVisible: () => boolean;
  readonly createXmpp: (options: XmppCoreOptions) => XmppCore;
  readonly attachments: AttachmentPort;
  readonly bytes: OutgoingBytes;
  readonly voice: VoiceOut;
  readonly openDrafts: OpenDraftStream;
  readonly goToLogin: () => void;
  readonly checkSession: () => Promise<SessionCheck>;
  /** Signs out after checkSession answered gone, so the user lands on login; the adapter
   * runs the persistent half of signOutStore and then goToLogin. */
  sessionGone: () => void;
  readonly rows: ChatRows;
  readonly visibility: Visibility;
  readonly drafts: OpenDraftStream;
  readonly notifications: Notifications;
  readonly flags: StoreFlags;
}

export class Ports extends Context.Service<Ports, PortsShape>()('zilar/web/store/Ports') {}

const realApi: ApiClient = {
  getMe,
  getChats,
  getContacts,
  getGroup,
  getXmppToken,
  markChatRead: markChatReadRequest,
  markChatDelivered: markChatDeliveredRequest,
  deleteMessageForMe: deleteMessageForMeRequest,
  clearChatHistory: clearChatHistoryRequest,
  createGroup: createGroupRequest,
  listGroupMembers: listGroupMembersRequest,
  setGroupVisibility: setGroupVisibilityRequest,
  searchDirectory: searchDirectoryRequest,
  lookupGroupByHandle: lookupGroupByHandleRequest,
  joinPublicGroup: joinPublicGroupRequest,
  createInvite: createInviteRequest,
  createGroupInviteLink: createGroupInviteLinkRequest,
  listGroupInviteLinks: listGroupInviteLinksRequest,
  revokeGroupInviteLink: revokeGroupInviteLinkRequest,
  changeGroupMemberRole: changeGroupMemberRoleRequest,
  removeGroupMember: removeGroupMemberRequest,
  previewJoinLink: previewJoinLinkRequest,
  joinByLink: joinByLinkRequest,
  listAis: listAisRequest,
  addGroupAi: addGroupAiRequest,
  removeGroupAi: removeGroupAiRequest,
  createTopic: createTopicRequest,
  getTopic: getTopicRequest,
  patchTopic: patchTopicRequest,
  archiveTopic: archiveTopicRequest,
  listGroupTopics: listGroupTopicsRequest,
  listTopicMembers: listTopicMembersRequest,
  addTopicMember: addTopicMemberRequest,
  removeTopicMember: removeTopicMemberRequest,
  joinTopic: joinTopicRequest,
  listTopicAis: listTopicAisRequest,
  addTopicAi: addTopicAiRequest,
  removeTopicAi: removeTopicAiRequest,
  setTopicRoles: setTopicRolesRequest,
  setMembersCanCreateTopics: setMembersCanCreateTopicsRequest,
  setGroupBackground: setGroupBackgroundRequest,
  setGroupListener: setGroupListenerRequest,
  listChatPrefs: listChatPrefsRequest,
  getChatBackgroundDefault: getChatBackgroundDefaultRequest,
  putChatBackgroundDefault: putChatBackgroundDefaultRequest,
  putChatPref: putChatPrefRequest,
  listPins: listPinsRequest,
  listChatMedia: listChatMediaRequest,
  pinMessage: pinMessageRequest,
  unpinMessage: unpinMessageRequest,
};

export function resolvePorts(deps: RealStoreDeps = {}): PortsShape {
  const attachments = deps.attachments ?? defaultAttachmentPort;
  return {
    api: deps.api ?? realApi,
    storage: deps.storage === undefined ? defaultStorage() : deps.storage,
    now: deps.now ?? ((): Date => new Date()),
    isVisible: deps.documentVisible ?? defaultVisible,
    createXmpp: deps.createXmpp ?? ((options: XmppCoreOptions) => createXmppCore(options)),
    voice: voiceFromPort(deps.voice ?? defaultVoicePort),
    attachments,
    bytes: bytesFromAttachmentPort(attachments),
    openDrafts: deps.openDrafts ?? subscribeToDrafts,
    goToLogin: deps.goToLogin ?? defaultGoToLogin,
    checkSession: deps.checkSession ?? checkSessionAdapter,
    // The revoked session lands on sign-in through the persistent half of signOutStore
    // (server sign-out, cache and device clears, then /login).
    sessionGone: deps.sessionGone ?? (() => sessionGoneAdapter(deps.goToLogin ?? defaultGoToLogin)),
    rows: realRows,
    visibility: { isVisible: deps.documentVisible ?? defaultVisible, onFocus: defaultOnFocus },
    drafts: deps.openDrafts ?? subscribeToDrafts,
    notifications: liveNotifications,
    flags: webFlags,
  };
}

export const portsLayer = (deps: RealStoreDeps = {}): Layer.Layer<Ports> =>
  Layer.sync(Ports, () => resolvePorts(deps));

export const PortsLive: Layer.Layer<Ports> = portsLayer();

function inertApi(): ApiClient {
  return new Proxy({} as ApiClient, {
    get: (_target, name) => () =>
      Promise.reject(new Error(`ApiClient.${String(name)} is not provided in this test`)),
  });
}

function inert(name: string): never {
  throw new Error(`${name} is not provided in this test`);
}

/** The ports of a test: supplied fakes win, every other port is inert. */
export function testPorts(fakes: RealStoreDeps = {}): PortsShape {
  const attachments =
    fakes.attachments ??
    ({
      classify: () => 'file',
      readImageSize: () => Promise.resolve(undefined),
      upload: () => Promise.reject(new Error('attachments are not provided in this test')),
    } as AttachmentPort);
  const voicePort =
    fakes.voice ??
    ({
      convert: () => Promise.reject(new Error('voice is not provided in this test')),
      upload: () => Promise.reject(new Error('voice is not provided in this test')),
    } as VoicePort);
  return {
    api: fakes.api ?? inertApi(),
    storage: fakes.storage === undefined ? null : fakes.storage,
    now: fakes.now ?? ((): Date => new Date(0)),
    isVisible: fakes.documentVisible ?? ((): boolean => true),
    createXmpp: fakes.createXmpp ?? (() => inert('createXmpp')),
    voice: voiceFromPort(voicePort),
    attachments,
    bytes: bytesFromAttachmentPort(attachments),
    openDrafts: fakes.openDrafts ?? (() => () => undefined),
    goToLogin: fakes.goToLogin ?? ((): void => undefined),
    checkSession: fakes.checkSession ?? (async () => 'unknown' as const),
    sessionGone: fakes.sessionGone ?? ((): void => undefined),
    rows: { summariesFor: () => [] },
    visibility: { isVisible: () => true, onFocus: () => () => undefined },
    drafts: fakes.openDrafts ?? (() => () => undefined),
    notifications: { syncBadge: () => undefined, dismissChat: () => undefined },
    flags: { connectRetry: true, reconnectOnResume: false },
  };
}

export const PortsTest = (fakes: RealStoreDeps = {}): Layer.Layer<Ports> =>
  Layer.succeed(Ports, testPorts(fakes));

/** Reads the ports of a layer once, synchronously (every layer here is sync). */
export function readPorts(layer: Layer.Layer<Ports>): PortsShape {
  return Effect.runSync(Effect.service(Ports).pipe(Effect.provide(layer)));
}
