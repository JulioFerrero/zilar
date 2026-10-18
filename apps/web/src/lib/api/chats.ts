// effect-plain: promise edge over callApi; the shared calls live in @zilar/client-core.
import {
  ChatEntry as chatEntrySchema,
  Topic as topicSchema,
  type AuthInvite,
  type AuthMe,
  type ChatBackgroundChoice,
  type ChatFolder as ApiChatFolder,
  type ChatPref,
  type Contact,
  type Topic,
  type XmppTokenResult,
} from '@zilar/api-contract';
import {
  makeChatsApi,
  type CreateChatFolderInput,
  type PatchChatFolderInput,
  type PutChatPrefInput,
} from '@zilar/client-core';
import { callApi } from '@/lib/effect/api-client';
import { decodeResponse } from './http';

// Later fields are optional, so payloads from an older server still parse.
export type Me = AuthMe;

export type { Contact };

// The same union mobile decodes: entries ride as unknown and are validated here for the web rows.
export type ChatEntry = typeof chatEntrySchema.Type;

/** The topics that parse: malformed entries are dropped, and an older server's missing
 * topics give an empty list. */
export function chatEntryTopics(entry: ChatEntry): Topic[] {
  if (entry.kind !== 'group' || entry.topics === undefined) {
    return [];
  }
  const result: Topic[] = [];
  for (const raw of entry.topics) {
    const parsed = decodeResponse(topicSchema, raw);
    if (parsed.ok) {
      result.push(parsed.value);
    }
  }
  return result;
}

export type Invite = AuthInvite;

export type XmppToken = XmppTokenResult;

const api = makeChatsApi(callApi);

export function getMe(): Promise<Me> {
  return api.getMe().then((me) => {
    void reportTimeZoneOnce(me);
    return me;
  });
}

// Report the browser's IANA zone once per app start when it differs; silent, retried next start.
let timeZoneReported = false;

async function reportTimeZoneOnce(me: Me): Promise<void> {
  if (timeZoneReported) {
    return;
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone === '' || zone === me.timeZone) {
    return;
  }
  timeZoneReported = true;
  try {
    await api.updateMe(me.name, zone);
  } catch {
    // Ignored: a failure only means the next start tries again.
  }
}

export type { ChatBackgroundChoice, ChatPref, ApiChatFolder };

export type { CreateChatFolderInput, PatchChatFolderInput, PutChatPrefInput };

export const {
  clearChatHistory,
  createChatFolder,
  createInvite,
  deleteChatFolder,
  deleteMessageForMe,
  getChatBackgroundDefault,
  getChats,
  getContacts,
  getInvite,
  getXmppToken,
  listChatFolders,
  listChatPrefs,
  markChatDelivered,
  markChatRead,
  patchChatFolder,
  putChatBackgroundDefault,
  putChatPref,
  reorderChatFolders,
  removeContact,
  updateMe,
} = api;
