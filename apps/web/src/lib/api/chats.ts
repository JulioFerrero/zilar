import { Schema } from 'effect';
import {
  ApiError,
  ChatEntry as chatEntrySchema,
  omitUndefined,
  Topic as topicSchema,
  type AuthInvite,
  type AuthMe,
  type BackgroundPreset,
  type ChatBackgroundChoice,
  type ChatFolder as ApiChatFolder,
  type ChatPref,
  type Contact,
  type Topic,
  type XmppTokenResult,
} from '@zilar/api-contract';
import type { FolderChatType, FolderIcon } from '@zilar/chat-core';
import { struct } from '@zilar/protocol';
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

const chatsSchema = struct({ chats: Schema.mutable(Schema.Array(chatEntrySchema)) });

export type Invite = AuthInvite;

export type XmppToken = XmppTokenResult;

export function getMe(): Promise<Me> {
  return callApi((client) => client.auth.me()).then((me) => {
    void reportTimeZoneOnce(me);
    return me;
  });
}

// The contract encodes the trimmed name; an optional time zone rides the same payload.
export function updateMe(name: string, timeZone?: string): Promise<Me> {
  return callApi((client) =>
    client.auth.patchMe({
      payload: { name: name.trim(), ...(timeZone === undefined ? {} : { timeZone }) },
    }),
  );
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
    await updateMe(me.name, zone);
  } catch {
    // Ignored: a failure only means the next start tries again.
  }
}

export async function getChats(): Promise<ChatEntry[]> {
  // Entries arrive as unknown and are validated here; one malformed entry fails the list.
  const body = await callApi((client) => client.chats.list());
  const parsed = decodeResponse(chatsSchema, body);
  if (!parsed.ok) {
    throw new ApiError(200, 'invalid_response', 'The server sent an unexpected response');
  }
  return parsed.value.chats;
}

/** messageId is the archive id (a decimal string of microseconds), not lastMessage.id,
 * which is the origin id; a non-numeric id is a 400. Best effort: callers ignore failures. */
export function markChatRead(jid: string, messageId: string): Promise<void> {
  return callApi((client) =>
    client.chats.markRead({ params: { jid }, payload: { messageId } }),
  ).then(() => undefined);
}

/** originIds are wire ids, 1 to 50 per call; the server ignores the caller's own messages.
 * Best effort: callers ignore failures. */
export function markChatDelivered(jid: string, originIds: string[]): Promise<void> {
  return callApi((client) =>
    client.chats.markDelivered({ params: { jid }, payload: { originIds } }),
  ).then(() => undefined);
}

/** Deletes one message from the caller's own copy of a DM, by archive id. Rejects on
 * failure, so the caller keeps its local row. */
export function deleteMessageForMe(jid: string, archiveId: string): Promise<void> {
  return callApi((client) => client.chats.deleteForMe({ params: { jid, archiveId } })).then(
    () => undefined,
  );
}

/** Clears the caller's own copy of a DM's history; the peer's copy is untouched. Rejects
 * on failure. */
export function clearChatHistory(jid: string): Promise<void> {
  return callApi((client) => client.chats.clearHistory({ params: { jid } })).then(() => undefined);
}

export async function getContacts(): Promise<Contact[]> {
  return callApi((client) => client.contacts.list()).then((rows) => [...rows]);
}

// The server answers 404 when the two are not contacts.
export async function removeContact(userId: string): Promise<void> {
  await callApi((client) => client.contacts.remove({ params: { userId } }));
}

export function createInvite(): Promise<Invite> {
  return callApi((client) => client.auth.createInvite());
}

export function getInvite(code: string): Promise<{ valid: boolean }> {
  return callApi((client) => client.authInvitesPublic.checkInvite({ params: { code } }));
}

export function getXmppToken(): Promise<XmppToken> {
  return callApi((client) => client.xmpp.token());
}

// Muting a group covers its topics: the pref sits on the General room JID, and the client
// applies it to every topic unless the topic has its own row.

// The per-chat background fields are all null when the chat inherits the global default.
export type { ChatPref };

export interface PutChatPrefInput {
  mutedUntil?: string | null | undefined;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
  /** Marks the chat unread by hand (true) or clears the mark (false). */
  unreadMark?: boolean | undefined;
  // A null clears that field, an omitted field leaves it untouched; preset and image are exclusive.
  backgroundPreset?: string | null | undefined;
  backgroundImageId?: string | null | undefined;
  backgroundDim?: number | null | undefined;
}

export function listChatPrefs(): Promise<ChatPref[]> {
  return callApi((client) => client.chatPrefs.list()).then((body) => [...body.prefs]);
}

// The caller's global chat background default. All-null means the caller never chose one, so
// chats fall back to the slate grid.
export type { ChatBackgroundChoice };

export function getChatBackgroundDefault(): Promise<ChatBackgroundChoice> {
  return callApi((client) => client.chatPrefs.getBackground()).then(
    (body) => body.defaultBackground,
  );
}

// An unknown preset fails as invalid_request before any request is sent; undefined fields are left out.
function prefPayload(input: PutChatPrefInput) {
  return omitUndefined({
    ...input,
    backgroundPreset: input.backgroundPreset as BackgroundPreset | null | undefined,
  });
}

export function putChatBackgroundDefault(
  input: ChatBackgroundChoice,
): Promise<ChatBackgroundChoice> {
  return callApi((client) => client.chatPrefs.putBackground({ payload: prefPayload(input) })).then(
    (body) => body.defaultBackground,
  );
}

export async function putChatPref(
  chatJid: string,
  input: PutChatPrefInput,
): Promise<ChatPref | null> {
  const saved = await callApi((client) =>
    client.chatPrefs.putPref({
      params: { chatJid },
      payload: prefPayload(input),
    }),
  );
  return 'prefs' in saved ? null : saved;
}

export type { ApiChatFolder };

export interface CreateChatFolderInput {
  name: string;
  icon: FolderIcon;
  includeTypes?: FolderChatType[] | undefined;
  includeChats?: string[] | undefined;
  excludeChats?: string[] | undefined;
  excludeMuted?: boolean | undefined;
  excludeRead?: boolean | undefined;
}

export type PatchChatFolderInput = Partial<CreateChatFolderInput>;

export function listChatFolders(): Promise<ApiChatFolder[]> {
  return callApi((client) => client.chatFolders.list()).then((body) => [...body.folders]);
}

// The contract encodes the trimmed name, so the client trims before sending.
export function createChatFolder(input: CreateChatFolderInput): Promise<ApiChatFolder> {
  return callApi((client) =>
    client.chatFolders.create({ payload: { ...omitUndefined(input), name: input.name.trim() } }),
  ).then((body) => body.folder);
}

// The contract encodes the trimmed name, so the client trims before sending.
export function patchChatFolder(id: string, input: PatchChatFolderInput): Promise<ApiChatFolder> {
  return callApi((client) =>
    client.chatFolders.update({
      params: { id },
      payload: {
        ...omitUndefined(input),
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
      },
    }),
  ).then((body) => body.folder);
}

export function reorderChatFolders(ids: string[]): Promise<ApiChatFolder[]> {
  return callApi((client) => client.chatFolders.order({ payload: { ids } })).then((body) => [
    ...body.folders,
  ]);
}

export async function deleteChatFolder(id: string): Promise<void> {
  await callApi((client) => client.chatFolders.remove({ params: { id } }));
}
