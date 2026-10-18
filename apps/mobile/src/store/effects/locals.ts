import type { XmppCore } from '@zilar/xmpp-core';

import type { MediaTokenShape } from '../../lib/attachments';
import type { PickedFile } from '../../lib/attachment-ports';
import type { GroupDetail } from '../../lib/chat-api';
import type { ChatPref } from '../../lib/chat-prefs-api';
import type { CustomGroupRole } from '../../lib/roles-api';
import type { ApproverRole, TopicRole } from '../../lib/topics-api';
import type { RecordedVoice } from '../../lib/voice';

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
  // Joined group rooms, so the open chat's own history can load before every room is.
  joinedRooms: Set<string>;
  pinsPollEnabled: boolean;
  mediaToken: MediaTokenShape | undefined;
  mediaTrustedHosts: ReadonlySet<string>;
  pendingUploads: Map<string, PickedFile>;
  pendingVoices: Map<string, RecordedVoice>;
}

export function createStoreLocals(): StoreLocals {
  return {
    core: undefined,
    lastRead: {},
    cursors: {},
    pendingOutgoing: new Map(),
    groupIds: new Map(),
    // Group id -> detail, one entry shared by every topic row; a legacy group row is keyed by its chat id until the server answers.
    groupDetails: new Map(),
    loadingGroupDetails: new Set(),
    // Group id -> custom roles; published through `set()` so selectors re-fire, and replaced wholesale on every load or role write.
    groupRolesById: new Map(),
    loadingGroupRoles: new Set(),
    // Topic id -> roles + approver role; replaced wholesale, so a private-to-public flip never leaves stale roles.
    topicRolesById: new Map(),
    loadingTopicRoles: new Set(),
    // Per-user chat prefs, keyed by lowercase chat JID; loaded with the chat list.
    chatPrefRows: [],
    groupMembers: new Map(),
    loadingOlder: new Set(),
    loadingHistory: new Set(),
    // A chat opened before the core or the chats were ready: only the latest counts, and it loads once both are.
    pendingOpenChatId: undefined,
    // A MAM query for a group before its rooms joined fails, so pending group history waits for this.
    groupsJoined: false,
    joinedRooms: new Set(),
    pinsPollEnabled: false,
    // The only hosts incoming attachments auto-load from: anything else becomes a file row that never fetches without a tap.
    mediaToken: undefined,
    mediaTrustedHosts: new Set(),
    pendingUploads: new Map(),
    pendingVoices: new Map(),
  };
}
