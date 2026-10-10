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
} from '@zilar/api-contract';
import type { FolderChatType, FolderIcon } from '@zilar/chat-core';
import { struct } from '@zilar/protocol';
import { callApi } from '@/lib/effect/api-client';
import { decodeResponse, request } from './http';

// The profile and invite schemas live in `@zilar/api-contract` (`auth.ts`,
// T-0895); their later fields (`handle`, `avatarUrl`, `jid`) are optional so
// payloads from an older server still parse.
export type Me = AuthMe;

export type { Contact };

// The chats-list entry schema lives in `@zilar/api-contract` (T-0924), the
// same union mobile decodes: `ChatList.chats` stays `Unknown` there so the
// server passes entries through unchanged, and this is the schema the web
// rows are validated with.
export type ChatEntry = typeof chatEntrySchema.Type;

/**
 * The validated topics of a group chat entry: entries that parse as
 * `topicSchema` (malformed ones are dropped). An older server omits
 * `topics` entirely, so the result is empty for it.
 */
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

const xmppTokenSchema = struct({
  jid: Schema.String,
  token: Schema.String,
  expiresAt: Schema.String,
  service: Schema.String,
  domain: Schema.String,
  mucDomain: Schema.String,
});

export type XmppToken = typeof xmppTokenSchema.Type;

export function getMe(): Promise<Me> {
  return callApi((client) => client.auth.me());
}

// The contract encodes the trimmed name (the server trimmed it anyway).
export function updateMe(name: string): Promise<Me> {
  return callApi((client) => client.auth.patchMe({ payload: { name: name.trim() } }));
}

export async function getChats(): Promise<ChatEntry[]> {
  // The contract passes the entries through as `unknown`; they are validated
  // here, and one malformed entry fails the whole list.
  const body = await callApi((client) => client.chats.list());
  const parsed = decodeResponse(chatsSchema, body);
  if (!parsed.ok) {
    throw new ApiError(200, 'invalid_response', 'The server sent an unexpected response');
  }
  return parsed.value.chats;
}

export async function getContacts(): Promise<Contact[]> {
  return callApi((client) => client.contacts.list()).then((rows) => [...rows]);
}

export function createInvite(): Promise<Invite> {
  return callApi((client) => client.auth.createInvite());
}

export function getInvite(code: string): Promise<{ valid: boolean }> {
  return callApi((client) => client.authInvitesPublic.checkInvite({ params: { code } }));
}

export function getXmppToken(): Promise<XmppToken> {
  return request('/xmpp/token', xmppTokenSchema, { method: 'POST' });
}

// --- Chat preferences (T-0113) -------------------------------------------------
// Per-user mute/archive/pin rows, synced across devices. The wire contract
// lives in apps/server/src/chat-prefs/api.ts and service.ts. Muting a
// group covers its topics (the pref sits on the General room JID and the
// client applies it to every topic unless the topic has its own row).

// The schemas live in `@zilar/api-contract` (T-0892). T-0461: the per-chat
// background fields are all null when the chat inherits the caller's global
// default.
export type { ChatPref };

export interface PutChatPrefInput {
  mutedUntil?: string | null | undefined;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
  // T-0462: per-chat background override fields. A null clears that field,
  // an omitted field leaves it untouched; preset and image are exclusive.
  backgroundPreset?: string | null | undefined;
  backgroundImageId?: string | null | undefined;
  backgroundDim?: number | null | undefined;
}

export function listChatPrefs(): Promise<ChatPref[]> {
  return callApi((client) => client.chatPrefs.list()).then((body) => [...body.prefs]);
}

// T-0461: the caller's global chat background default (T-0458). `GET
// /chat-background` returns it under `defaultBackground`; all-null means the
// caller never chose one, so chats fall back to the slate grid.
export type { ChatBackgroundChoice };

export function getChatBackgroundDefault(): Promise<ChatBackgroundChoice> {
  return callApi((client) => client.chatPrefs.getBackground()).then(
    (body) => body.defaultBackground,
  );
}

// The payload encoder checks the preset against the contract's list, so an
// unknown id fails as `invalid_request` before any request is sent. Fields set
// to `undefined` are left out, as `JSON.stringify` always did.
function prefPayload(input: PutChatPrefInput) {
  return omitUndefined({
    ...input,
    backgroundPreset: input.backgroundPreset as BackgroundPreset | null | undefined,
  });
}

// T-0462: write the caller's global background default. The body carries the
// same three fields as the per-chat patch and the reply is the saved default.
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

// --- Chat folders (T-0237) ---------------------------------------------------
// Folders come from the server (`apps/server/src/chat-folders/api.ts`);
// the client only lists and syncs them here (create/rename/delete/reorder
// UI is T-0238). The wire shape mirrors `ChatFolder` in chat-core.

// The schemas live in `@zilar/api-contract` (T-0892).
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

// The server trims `name`; the contract encodes the trimmed form, so the
// client trims before sending.
export function createChatFolder(input: CreateChatFolderInput): Promise<ApiChatFolder> {
  return callApi((client) =>
    client.chatFolders.create({ payload: { ...omitUndefined(input), name: input.name.trim() } }),
  ).then((body) => body.folder);
}

// The server trims `name`; the contract encodes the trimmed form, so the
// client trims before sending.
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
