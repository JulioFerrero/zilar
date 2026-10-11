import type { XmppCore } from '@zilar/xmpp-core';

import type { MediaTokenShape } from '../../lib/attachments';
import type { PickedFile } from '../../lib/attachment-ports';
import type { GroupDetail } from '../../lib/chat-api';
import type { ChatPref } from '../../lib/chat-prefs-api';
import type { CustomGroupRole } from '../../lib/roles-api';
import type { ApproverRole, TopicRole } from '../../lib/topics-api';
import type { RecordedVoice } from '../../lib/voice';

/**
 * The mutable locals the store closure owns: the handles the effect modules
 * bridge to through `StoreState`, the caches they read and write, and the
 * per-session maps a `stop()` clears. One object so the closure and its
 * helpers share a single owner instead of a wall of `let` bindings.
 */
export interface StoreLocals {
  core: XmppCore | undefined;
  lastRead: Record<string, string>;
  cursors: Record<string, string | undefined>;
  pendingOutgoing: Map<string, string[]>;
  groupIds: Map<string, string>;
  groupDetails: Map<string, GroupDetail>;
  loadingGroupDetails: Set<string>;
  groupRolesById: Map<string, CustomGroupRole[]>;
  loadingGroupRoles: Set<string>;
  topicRolesById: Map<string, { roles: TopicRole[]; approverRole: ApproverRole | null }>;
  loadingTopicRoles: Set<string>;
  chatPrefRows: ChatPref[];
  groupMembers: Map<string, Map<string, string>>;
  loadingOlder: Set<string>;
  loadingHistory: Set<string>;
  pendingOpenChatId: string | undefined;
  groupsJoined: boolean;
  pinsPollEnabled: boolean;
  mediaToken: MediaTokenShape | undefined;
  mediaTrustedHosts: ReadonlySet<string>;
  pendingUploads: Map<string, PickedFile>;
  pendingVoices: Map<string, RecordedVoice>;
}

/** Creates the closure's mutable locals, all fresh for one store instance. */
export function createStoreLocals(): StoreLocals {
  return {
    core: undefined,
    lastRead: {},
    cursors: {},
    pendingOutgoing: new Map(),
    groupIds: new Map(),
    // groupId -> the group detail (people + roles + AIs), loaded on demand by
    // the topics screen and the task strip owner picker. Keyed by group id
    // (not chat id) so every topic row of a group shares one entry; the one
    // exception is a legacy group row, whose own chat id doubles as the key
    // until the server answers (see `rememberGroupIds`).
    groupDetails: new Map(),
    loadingGroupDetails: new Set(),
    // groupId -> the custom roles (T-0137), loaded on demand by the group
    // screen. Keyed by group id like `groupDetails` so every topic row of a
    // group shares one entry; published through `set()` (the
    // `groupDetailsRevision` bump) so selectors re-fire. Replaced wholesale
    // on every successful load or role write.
    groupRolesById: new Map(),
    loadingGroupRoles: new Set(),
    // topicId -> the attached roles + approver role (T-0137), loaded on
    // demand by the topic info sheet. Replaced wholesale from every full
    // topic response, so a private-to-public flip never leaves stale roles
    // behind (the server clears them, and the response carries none).
    topicRolesById: new Map(),
    loadingTopicRoles: new Set(),
    // Per-user chat prefs (T-0135), keyed by lowercase chat JID. Loaded with
    // the chat list at boot and after every background refresh. The API
    // client is injected by the app (`RealStoreDeps.chatPrefsApi`); tests
    // that never touch prefs inject nothing and read empty rows.
    chatPrefRows: [],
    // The user's chat folders (T-0248), sorted by position, are loaded with
    // the chats (`effects/history.ts`) and written in `effects/events.ts`; a
    // missing client keeps `[]`.
    // chatId -> (lowercased userId -> display name)
    groupMembers: new Map(),
    loadingOlder: new Set(),
    // First-page history loads currently in flight, by chat id (T-0067).
    loadingHistory: new Set(),
    // A chat opened before the core was connected or before the chats had
    // arrived. Only the latest one counts; it loads once both are ready.
    pendingOpenChatId: undefined,
    // True once the group rooms are joined; a MAM query for a group before that
    // fails, so a pending group history waits for it (T-0067).
    groupsJoined: false,
    // The open chat's pins poll (T-0135): `openChat` starts it and the chat
    // screen's `stopPinsPoll` ends it, as the per-chat poll did on mobile.
    pinsPollEnabled: false,
    // The trusted media hosts (T-0150): the service host, the XMPP domain and
    // `upload.<domain>`, from the latest XMPP token. Incoming image (and
    // GIF-video) attachments auto-load only from these hosts; anything else is
    // downgraded to a file row that never fetches without a tap.
    mediaToken: undefined,
    mediaTrustedHosts: new Set(),
    // The local bytes of an outgoing attachment, kept for a Retry after a
    // failed upload (like web's `pendingAttachments`).
    pendingUploads: new Map(),
    // A finished voice recording per optimistic message, kept for a Retry after
    // a failed convert/upload/send (like web's `pendingVoices`, T-0154).
    pendingVoices: new Map(),
  };
}
