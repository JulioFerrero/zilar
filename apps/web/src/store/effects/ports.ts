// The outside world of the web chat store: the HTTP client, storage, the clock,
// the XMPP factory, the voice and attachment ports, the AI draft stream and the
// sign-out redirect. The store reads them from one `Ports` service; `PortsLive`
// is the real adapter set and `PortsTest` fills every port a test did not
// supply with an inert one, so no test reaches the network by accident.
import { Context, Effect, Layer } from 'effect';
import { createXmppCore, type XmppCore, type XmppCoreOptions } from '@zilar/xmpp-core';
import type {
  ChatRows,
  Notifications,
  OutgoingBytes,
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
  createGroup as createGroupRequest,
  createGroupInviteLink as createGroupInviteLinkRequest,
  createInvite as createInviteRequest,
  createTopic as createTopicRequest,
  getChats,
  getChatBackgroundDefault as getChatBackgroundDefaultRequest,
  getContacts,
  getGroup,
  getMe,
  getTopic as getTopicRequest,
  getXmppToken,
  joinByLink as joinByLinkRequest,
  joinPublicGroup as joinPublicGroupRequest,
  listAis as listAisRequest,
  listChatPrefs as listChatPrefsRequest,
  listGroupInviteLinks as listGroupInviteLinksRequest,
  listGroupMembers as listGroupMembersRequest,
  listGroupTopics as listGroupTopicsRequest,
  lookupGroupByHandle as lookupGroupByHandleRequest,
  listPins as listPinsRequest,
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
  type ChatEntry,
  type ChatPref,
  type ChatBackgroundChoice,
  type Contact,
  type CreateGroupInviteLinkInput,
  type CreatedInviteLink,
  type CreateTopicInput,
  type DirectoryEntry,
  type DirectoryPage,
  type GroupBackground,
  type GroupDetail,
  type GroupInviteLink,
  type GroupMember,
  type Invite,
  type JoinPreview,
  type JoinResult,
  type ListChatMediaInput,
  type Me,
  type MediaPage,
  type PatchTopicInput,
  type Pin,
  type PinMessageInput,
  type PublicAi,
  type PublicJoinResult,
  type PutChatPrefInput,
  type Topic,
  type TopicAi,
  type TopicMember,
  type SetGroupListenerInput,
  type SetTopicRolesInput,
  type XmppToken,
} from '@/lib/api';
import { subscribeToDrafts, type OpenDraftStream } from '@/lib/drafts';
import { defaultVoicePort, type VoicePort } from '@/lib/voice';
import { defaultAttachmentPort, cleanFilename, type AttachmentPort } from '@/lib/attachments';
import { dismissChatNotifications, totalBadgeUnread, updateAppBadge } from '@/lib/push';
import { summariesFor } from './chatRows';
import { fromPromise } from './util';

export interface ApiClient {
  getMe(): Promise<Me>;
  getChats(): Promise<ChatEntry[]>;
  getContacts(): Promise<Contact[]>;
  getGroup(groupId: string): Promise<GroupDetail>;
  getXmppToken(): Promise<XmppToken>;
  createGroup(input: {
    title: string;
    memberIds: string[];
    kind?: 'group' | 'channel';
    description?: string;
    // T-0164: `public` creates the group with a handle in one transaction.
    visibility?: 'private' | 'public';
    handle?: string;
  }): Promise<GroupDetail>;
  listGroupMembers(groupId: string): Promise<GroupMember[]>;
  // T-0164: public visibility with a handle (directory + open join), the
  // Explore search, the exact by-handle lookup, and the one-tap join.
  setGroupVisibility(
    groupId: string,
    input: { visibility: 'private' | 'public'; handle?: string },
  ): Promise<GroupDetail>;
  searchDirectory(input: {
    q?: string;
    kind?: 'group' | 'channel';
    cursor?: string;
  }): Promise<DirectoryPage>;
  lookupGroupByHandle(handle: string): Promise<DirectoryEntry>;
  joinPublicGroup(groupId: string): Promise<PublicJoinResult>;
  createInvite(): Promise<Invite>;
  createGroupInviteLink(
    groupId: string,
    input: CreateGroupInviteLinkInput,
  ): Promise<CreatedInviteLink>;
  listGroupInviteLinks(groupId: string): Promise<GroupInviteLink[]>;
  revokeGroupInviteLink(groupId: string, linkId: string): Promise<void>;
  previewJoinLink(token: string): Promise<JoinPreview>;
  joinByLink(token: string): Promise<JoinResult>;
  changeGroupMemberRole(
    groupId: string,
    userId: string,
    role: 'admin' | 'member',
  ): Promise<GroupDetail>;
  removeGroupMember(groupId: string, userId: string): Promise<GroupDetail>;
  listAis(): Promise<PublicAi[]>;
  addGroupAi(groupId: string, aiId: string): Promise<GroupDetail>;
  removeGroupAi(groupId: string, aiId: string): Promise<GroupDetail>;
  createTopic(groupId: string, input: CreateTopicInput): Promise<Topic>;
  getTopic(topicId: string): Promise<Topic>;
  patchTopic(topicId: string, input: PatchTopicInput): Promise<Topic>;
  archiveTopic(topicId: string): Promise<Topic>;
  listGroupTopics(groupId: string): Promise<Topic[]>;
  listTopicMembers(topicId: string): Promise<TopicMember[]>;
  addTopicMember(topicId: string, userId: string): Promise<Topic>;
  removeTopicMember(topicId: string, userId: string): Promise<Topic>;
  listTopicAis(topicId: string): Promise<TopicAi[]>;
  addTopicAi(topicId: string, aiId: string): Promise<Topic>;
  removeTopicAi(topicId: string, aiId: string): Promise<Topic>;
  setTopicRoles(topicId: string, input: SetTopicRolesInput): Promise<Topic>;
  setMembersCanCreateTopics(groupId: string, allowed: boolean): Promise<GroupDetail>;
  setGroupBackground(groupId: string, background: GroupBackground): Promise<GroupDetail>;
  setGroupListener(groupId: string, input: SetGroupListenerInput): Promise<GroupDetail>;
  listChatPrefs(): Promise<ChatPref[]>;
  getChatBackgroundDefault(): Promise<ChatBackgroundChoice>;
  putChatBackgroundDefault(input: ChatBackgroundChoice): Promise<ChatBackgroundChoice>;
  putChatPref(chatJid: string, input: PutChatPrefInput): Promise<ChatPref | null>;
  listPins(chat: string): Promise<Pin[]>;
  listChatMedia(input: ListChatMediaInput): Promise<MediaPage>;
  pinMessage(input: PinMessageInput): Promise<Pin>;
  unpinMessage(id: string): Promise<void>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What a caller of `createRealChatStore` may override; every field is optional. */
export interface RealStoreDeps {
  api?: ApiClient;
  createXmpp?: (options: XmppCoreOptions) => XmppCore;
  storage?: StorageLike | null;
  now?: () => Date;
  documentVisible?: () => boolean;
  /** Conversion + XEP-0363 upload; tests inject fakes. */
  voice?: VoicePort;
  /** Classification, image sizing + XEP-0363 upload; tests inject fakes. */
  attachments?: AttachmentPort;
  /** The AI draft SSE stream; tests inject a fake. */
  openDrafts?: OpenDraftStream;
  /** Leaves for the sign-in page after sign-out; tests inject a fake. */
  goToLogin?: () => void;
}

/** The resolved ports: every field is present. */
export interface PortsShape {
  readonly api: ApiClient;
  readonly storage: StorageLike | null;
  readonly now: () => Date;
  readonly isVisible: () => boolean;
  readonly createXmpp: (options: XmppCoreOptions) => XmppCore;
  /** The raw voice port tests inject; `voice` below is the core-shaped adapter. */
  readonly attachments: AttachmentPort;
  /** The core send pipeline's file and voice ports (T10). */
  readonly bytes: OutgoingBytes;
  readonly voice: VoiceOut;
  readonly openDrafts: OpenDraftStream;
  readonly goToLogin: () => void;
  // T-0915: what the core lifecycle, polling and connection retry read.
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

// The browser storage, or null where it is blocked or missing.
function defaultStorage(): StorageLike | null {
  return Effect.runSync(
    Effect.try(() => window.localStorage).pipe(Effect.orElseSucceed(() => null)),
  );
}

function defaultVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function defaultOnFocus(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('focus', handler);
  return () => window.removeEventListener('focus', handler);
}

const realRows: ChatRows = {
  summariesFor: (entry) => summariesFor(entry as ChatEntry),
};

const webFlags: StoreFlags = { connectRetry: true, reconnectOnResume: false };

// The app badge and the push dismiss, best effort (mirrors `effects/badge.ts`).
const liveNotifications: Notifications = {
  syncBadge: (chats) => {
    Effect.runFork(
      fromPromise(() => updateAppBadge(totalBadgeUnread([...chats]))).pipe(Effect.ignore),
    );
  },
  dismissChat: (chatId) => {
    Effect.runFork(fromPromise(() => dismissChatNotifications(chatId)).pipe(Effect.ignore));
  },
};

// A reload gives the next user a fresh store and XMPP connection.
function defaultGoToLogin(): void {
  if (typeof window !== 'undefined') {
    window.location.assign('/login');
  }
}

// `URL.createObjectURL` is missing in some test environments.
function objectUrlFor(blob: Blob): string | undefined {
  return Effect.runSync(
    Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => undefined)),
  );
}

// The core `bytes` port over web's attachment port (T10): classification, the
// image size and the XEP-0363 upload. Web has no cancel and ignores progress.
function bytesFromAttachmentPort(port: AttachmentPort): OutgoingBytes {
  return {
    describe: (file) => {
      const picked = file as File;
      const kind = port.classify(picked);
      return {
        kind,
        name: cleanFilename(picked.name),
        size: picked.size,
        mime: picked.type === '' ? 'application/octet-stream' : picked.type,
        ...(kind === 'image' ? { localUrl: objectUrlFor(picked) } : {}),
      };
    },
    measure: (file) => fromPromise(() => port.readImageSize(file as File)),
    upload: (core, file) => fromPromise(() => port.upload(core, file as File)),
  };
}

// The core `voice` port over web's voice port (T10). The recording's bytes are
// opaque to the core, so this unwraps them.
function voiceFromPort(port: VoicePort): VoiceOut {
  return {
    convert: (recording) => fromPromise(() => port.convert(recording.bytes as Blob)),
    upload: (core, audio) => fromPromise(() => port.upload(core, audio as Blob)),
  };
}

/** The live ports, with any field of `deps` replacing its real counterpart. */
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
    rows: realRows,
    visibility: { isVisible: deps.documentVisible ?? defaultVisible, onFocus: defaultOnFocus },
    drafts: deps.openDrafts ?? subscribeToDrafts,
    notifications: liveNotifications,
    flags: webFlags,
  };
}

/** The real adapters: HTTP API, `localStorage`, the real clock and XMPP client. */
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
