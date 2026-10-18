// effect-plain: Promise port over the contract; each app's `call` owns the Effect edge.
// The shared chats calls: web and phone each supply the transport.
import { Exit, Schema, type Effect } from 'effect';
import {
  ApiError,
  ChatEntry as ChatEntrySchema,
  omitUndefined,
  type AuthInvite,
  type AuthMe,
  type BackgroundPreset,
  type ChatBackgroundChoice,
  type ChatEntry,
  type ChatFolder,
  type ChatPref,
  type Contact,
  type FolderChatType,
  type FolderIcon,
  type PatchedMe,
  type XmppTokenResult,
  type ZilarClient,
} from '@zilar/api-contract';

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

type ChatsCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;

const invalidResponse = (): ApiError =>
  new ApiError(200, 'invalid_response', 'The server sent an unexpected response');

const ChatListBody = Schema.Struct({ chats: Schema.Array(Schema.Unknown) });
const decodeChatListBody = Schema.decodeUnknownExit(ChatListBody);
const decodeChatEntry = Schema.decodeUnknownExit(ChatEntrySchema);

/** Decodes a `/api/chats` body; one malformed entry fails the whole list. */
export function chatEntriesFromList(value: unknown): ChatEntry[] | null {
  const body = decodeChatListBody(value);
  if (!Exit.isSuccess(body)) {
    return null;
  }
  const entries: ChatEntry[] = [];
  for (const row of body.value.chats) {
    const entry = decodeChatEntry(row);
    if (!Exit.isSuccess(entry)) {
      return null;
    }
    entries.push(entry.value);
  }
  return entries;
}

function prefPayload(input: PutChatPrefInput) {
  return omitUndefined({
    ...input,
    backgroundPreset: input.backgroundPreset as BackgroundPreset | null | undefined,
  });
}

/**
 * The chats API shared by both apps, over the caller's `call`: me, the chat list and its
 * receipts, contacts, invites, chat prefs and chat folders. The server trims names; the
 * client sends the trimmed form, and the chat list is validated here once for both apps.
 */
export function makeChatsApi(call: ChatsCall) {
  return {
    getMe: (): Promise<AuthMe> => call((client) => client.auth.me()),

    // The contract encodes the trimmed name; an optional time zone rides the same payload.
    updateMe: (name: string, timeZone?: string): Promise<PatchedMe> =>
      call((client) =>
        client.auth.patchMe({
          payload: { name: name.trim(), ...(timeZone === undefined ? {} : { timeZone }) },
        }),
      ),

    getChats: async (): Promise<ChatEntry[]> => {
      const entries = chatEntriesFromList(await call((client) => client.chats.list()));
      if (entries === null) {
        throw invalidResponse();
      }
      return entries;
    },

    /** messageId is the archive id (a decimal string of microseconds), not lastMessage.id,
     * which is the origin id; a non-numeric id is a 400. Best effort: callers ignore failures. */
    markChatRead: (jid: string, messageId: string): Promise<void> =>
      call((client) => client.chats.markRead({ params: { jid }, payload: { messageId } })).then(
        () => undefined,
      ),

    /** originIds are wire ids, 1 to 50 per call; the server ignores the caller's own messages.
     * Best effort: callers ignore failures. */
    markChatDelivered: (jid: string, originIds: string[]): Promise<void> =>
      call((client) =>
        client.chats.markDelivered({ params: { jid }, payload: { originIds } }),
      ).then(() => undefined),

    /** Deletes one message from the caller's own copy of a DM, by archive id. Rejects on
     * failure, so the caller keeps its local row. */
    deleteMessageForMe: (jid: string, archiveId: string): Promise<void> =>
      call((client) => client.chats.deleteForMe({ params: { jid, archiveId } })).then(
        () => undefined,
      ),

    /** Clears the caller's own copy of a DM's history; the peer's copy is untouched. Rejects
     * on failure. */
    clearChatHistory: (jid: string): Promise<void> =>
      call((client) => client.chats.clearHistory({ params: { jid } })).then(() => undefined),

    getContacts: (): Promise<Contact[]> =>
      call((client) => client.contacts.list()).then((rows) => [...rows]),

    // The server answers 404 when the two are not contacts.
    removeContact: (userId: string): Promise<void> =>
      call((client) => client.contacts.remove({ params: { userId } })).then(() => undefined),

    createInvite: (): Promise<AuthInvite> => call((client) => client.auth.createInvite()),

    getInvite: (code: string): Promise<{ valid: boolean }> =>
      call((client) => client.authInvitesPublic.checkInvite({ params: { code } })),

    getXmppToken: (): Promise<XmppTokenResult> => call((client) => client.xmpp.token()),

    listChatPrefs: (): Promise<ChatPref[]> =>
      call((client) => client.chatPrefs.list()).then((body) => [...body.prefs]),

    // The caller's global chat background default. All-null means the caller never chose one, so
    // chats fall back to the slate grid.
    getChatBackgroundDefault: (): Promise<ChatBackgroundChoice> =>
      call((client) => client.chatPrefs.getBackground()).then((body) => body.defaultBackground),

    putChatBackgroundDefault: (input: ChatBackgroundChoice): Promise<ChatBackgroundChoice> =>
      call((client) => client.chatPrefs.putBackground({ payload: prefPayload(input) })).then(
        (body) => body.defaultBackground,
      ),

    putChatPref: (chatJid: string, input: PutChatPrefInput): Promise<ChatPref | null> =>
      call((client) =>
        client.chatPrefs.putPref({ params: { chatJid }, payload: prefPayload(input) }),
      ).then((saved) => ('prefs' in saved ? null : saved)),

    listChatFolders: (): Promise<ChatFolder[]> =>
      call((client) => client.chatFolders.list()).then((body) => [...body.folders]),

    // The contract encodes the trimmed name, so the client trims before sending.
    createChatFolder: (input: CreateChatFolderInput): Promise<ChatFolder> =>
      call((client) =>
        client.chatFolders.create({
          payload: { ...omitUndefined(input), name: input.name.trim() },
        }),
      ).then((body) => body.folder),

    // The contract encodes the trimmed name, so the client trims before sending.
    patchChatFolder: (id: string, input: PatchChatFolderInput): Promise<ChatFolder> =>
      call((client) =>
        client.chatFolders.update({
          params: { id },
          payload: {
            ...omitUndefined(input),
            ...(input.name === undefined ? {} : { name: input.name.trim() }),
          },
        }),
      ).then((body) => body.folder),

    reorderChatFolders: (ids: string[]): Promise<ChatFolder[]> =>
      call((client) => client.chatFolders.order({ payload: { ids } })).then((body) => [
        ...body.folders,
      ]),

    deleteChatFolder: (id: string): Promise<void> =>
      call((client) => client.chatFolders.remove({ params: { id } })).then(() => undefined),
  };
}
