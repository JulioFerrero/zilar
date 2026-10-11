// Group and channel creation: repainting the chat list from the server after a
// create and opening the new chat, plus the invite link used to add people.
import { Effect } from 'effect';
import {
  createGroupChannel as createGroupChannelAction,
  createInvite as createInviteAction,
} from '@zilar/client-core/store';
import type { ChatPref, GroupDetail } from '@/lib/api';
import { applyChatPrefs } from '@/lib/chatPrefs';
import { sortByRecency, summariesFor } from './chatRows';
import type { StoreCtx } from './ctx';
import { ensureGroupMembers } from './groupMembers';
import { openHistory } from './history';
import { Ports, type ApiClient } from './ports';
import { fromPromise, prefsByJid } from './util';

type CreateOptions = {
  kind?: 'group' | 'channel';
  description?: string;
  visibility?: 'private' | 'public';
  handle?: string;
};

// Repaints the chat list from the server after a create (keeping what is
// already painted) and answers the new group's chat JID (R15).
const repaintCreatedGroup = (
  ctx: StoreCtx,
  api: ApiClient,
  now: () => Date,
  detail: GroupDetail,
): Effect.Effect<string | undefined, unknown> =>
  Effect.gen(function* () {
    const [entries, prefs] = yield* Effect.all(
      [
        fromPromise(() => api.getChats()),
        fromPromise(() => api.listChatPrefs()).pipe(
          Effect.catchCause(() => Effect.succeed([] as ChatPref[])),
        ),
      ],
      { concurrency: 'unbounded' },
    );
    ctx.k.rememberGroupIds(entries);
    const previous = ctx.get().chats;
    const freshRows = entries.flatMap((entry) => summariesFor(entry));
    ctx.set({
      chats: applyChatPrefs(
        sortByRecency(
          freshRows.map((row) => {
            const before = previous.find((chat) => chat.id === row.id);
            return before === undefined
              ? row
              : {
                  ...row,
                  ...(before.lastMessage === undefined ? {} : { lastMessage: before.lastMessage }),
                  unread: before.unread,
                  ...(before.online === undefined ? {} : { online: before.online }),
                };
          }),
        ),
        prefs,
        now().getTime(),
      ),
      chatPrefs: prefsByJid(prefs),
    });
    return entries.find((entry) => entry.kind === 'group' && entry.groupId === detail.id)?.chatJid;
  });

// Joins the new group's room, loads its members and opens the chat: web's half
// of the create (R15).
const openCreatedGroup = (ctx: StoreCtx, chatJid: string): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const me = ctx.get().me;
    const current = ctx.core;
    if (current !== undefined && me !== undefined) {
      yield* fromPromise(() => current.joinRoom(chatJid, ctx.k.nick(me))).pipe(Effect.ignore);
    }
    ctx.rt.fork(ensureGroupMembers(ctx, chatJid));
    yield* openHistory(ctx, chatJid);
  });

// T-0124: channels share the create/list/refresh flow with groups (the detail
// carries `kind`, the chat list paints the feed row). T-0164: `visibility:
// 'public'` + `handle` creates the channel with its directory entry in one
// transaction.
export const createChannel = (
  ctx: StoreCtx,
  title: string,
  memberIds: string[],
  description: string | undefined,
  options: { visibility?: 'private' | 'public'; handle?: string } | undefined,
): Effect.Effect<string, unknown, Ports> =>
  Effect.gen(function* () {
    const { api, now } = yield* Ports;
    return yield* createGroupChannelAction<GroupDetail, Ports>(
      {
        create: () =>
          api.createGroup({
            title,
            memberIds,
            kind: 'channel',
            ...(description === undefined || description.trim() === ''
              ? {}
              : { description: description.trim() }),
            ...(options?.visibility === undefined ? {} : { visibility: options.visibility }),
            ...(options?.handle === undefined ? {} : { handle: options.handle }),
          }),
        refreshAndLocate: (detail) => repaintCreatedGroup(ctx, api, now, detail),
        open: (chatJid) => openCreatedGroup(ctx, chatJid),
        requireRow: true,
        result: (chatJid) => chatJid ?? '',
      },
      'the new channel did not appear in the chat list',
    );
  });

// T-0124: channels share this entry point (the dialog passes `kind` and
// `description` through the same call). T-0164: `visibility: 'public'` +
// `handle` creates the group with its directory entry in one transaction.
export const createGroup = (
  ctx: StoreCtx,
  title: string,
  memberIds: string[],
  options: CreateOptions | undefined,
): Effect.Effect<string, unknown, Ports> =>
  Effect.gen(function* () {
    const { api, now } = yield* Ports;
    return yield* createGroupChannelAction<GroupDetail, Ports>(
      {
        create: () =>
          api.createGroup({
            title,
            memberIds,
            ...(options?.kind === undefined ? {} : { kind: options.kind }),
            ...(options?.description === undefined ? {} : { description: options.description }),
            ...(options?.visibility === undefined ? {} : { visibility: options.visibility }),
            ...(options?.handle === undefined ? {} : { handle: options.handle }),
          }),
        refreshAndLocate: (detail) => repaintCreatedGroup(ctx, api, now, detail),
        open: (chatJid) => openCreatedGroup(ctx, chatJid),
        requireRow: true,
        result: (chatJid) => chatJid ?? '',
      },
      'the new group did not appear in the chat list',
    );
  });

export const createInvite = (): Effect.Effect<string, unknown, Ports> =>
  Effect.gen(function* () {
    const { api } = yield* Ports;
    return yield* createInviteAction(() => api.createInvite());
  });
