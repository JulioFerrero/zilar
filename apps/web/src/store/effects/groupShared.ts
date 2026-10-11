// Group and topic plumbing shared by the topics and group-settings effects:
// the group a chat belongs to, the web halves of the shared group and topic
// actions, and the quiet room join the created topic rows use.
import { Effect } from 'effect';
import {
  applyTopicRow as applyTopicRowCore,
  type ChangeGroupStore,
  type GroupActionStore,
  type GroupTarget,
  type TopicRowStore,
} from '@zilar/client-core/store';
import type { ChatEntry, GroupDetail, Topic } from '@/lib/api';
import { summariesFor } from './chatRows';
import type { StoreCtx } from './ctx';
import { applyGroupDetail, domainOf } from './groupMembers';
import { refreshChatsOrThrow } from './history';
import type { Ports } from './ports';
import { fromPromise } from './util';

/** The group a chat belongs to: from its row first, else from the ids remembered. */
export const groupIdOf = (ctx: StoreCtx, chatId: string): string | undefined =>
  ctx.get().chats.find((entry) => entry.id === chatId)?.groupId ?? ctx.groupIds.get(chatId);

// The group id and my XMPP domain, or undefined when either is unknown (the
// shared actions turn that into the fixed "not available yet" failure).
const groupTarget = (ctx: StoreCtx, groupId: string | undefined): GroupTarget | undefined => {
  const mine = ctx.k.myJid();
  if (groupId === undefined || mine === undefined) {
    return undefined;
  }
  return { groupId, domain: domainOf(mine) };
};

// The web half of the shared group change (settings, group AIs, channel role):
// the detail is repainted from the server's answer, and the list is refreshed
// through web's throwing refresh.
export const groupChangeStore = (
  ctx: StoreCtx,
  groupId: string | undefined,
): ChangeGroupStore<GroupDetail, Ports> => ({
  resolve: () => groupTarget(ctx, groupId),
  applyDetail: (chatId, detail, domain) => applyGroupDetail(ctx, chatId, detail, domain),
  refreshList: () => refreshChatsOrThrow(ctx),
});

/** The web half of the core topic-row refresh (R17): `/api/chats` and prefs. */
const topicRowStore = (ctx: StoreCtx): TopicRowStore => ({
  getChats: () => ctx.ports.api.getChats(),
  summariesFor: (entry) => summariesFor(entry as ChatEntry),
  rememberGroupIds: (entries) => ctx.k.rememberGroupIds(entries as ChatEntry[]),
  prefRows: () => Object.values(ctx.get().chatPrefs),
  now: () => ctx.ports.now(),
});

export const applyTopicRow = (ctx: StoreCtx, topic: Topic): Effect.Effect<void, unknown> =>
  applyTopicRowCore(ctx, topicRowStore(ctx), topic);

// The web half of the shared topic actions: the group ids remembered beside
// the rows, and the topic-row store the shared repaint uses (R17).
export const actionStore = (ctx: StoreCtx): GroupActionStore => ({
  groupIdFor: (chatId) => ctx.groupIds.get(chatId),
  rows: topicRowStore(ctx),
});

// Joins a topic's room, ignoring a failure (the created row is already painted).
export const joinRoomQuietly = (ctx: StoreCtx, rowId: string): Effect.Effect<void, never> => {
  const me = ctx.get().me;
  const current = ctx.core;
  if (current === undefined || me === undefined) {
    return Effect.void;
  }
  return fromPromise(() => current.joinRoom(rowId, ctx.k.nick(me))).pipe(Effect.ignore);
};
