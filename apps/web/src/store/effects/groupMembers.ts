import { Effect } from 'effect';
import type { MentionMember } from '@zilar/chat-core';
import {
  ensureGroupDetail,
  type GroupDetailStore,
  type JoinGroupsHooks,
} from '@zilar/client-core/store';
import { jidLocal } from '@zilar/protocol';
import type { XmppCore } from '@zilar/xmpp-core';
import type { GroupDetail, Me } from '@/lib/api';
import type { StoreCtx } from './ctx';
import { Ports } from './ports';
import { fromPromise } from './util';

/** The XMPP domain of a JID. */
export const domainOf = (jid: string): string => jid.slice(jid.indexOf('@') + 1);

/** Caches a group detail and rebuilds the mention members from it, so the picker and panel
 * agree after a load, an add or a remove; AIs have no handle. */
export function applyGroupDetail(
  ctx: StoreCtx,
  chatId: string,
  detail: GroupDetail,
  domain: string,
): void {
  const members = new Map<string, MentionMember>();
  for (const member of detail.members) {
    const localpart = member.userId.toLowerCase();
    members.set(localpart, {
      jid: `${localpart}@${domain}`,
      name: member.name,
      ...(member.handle == null || member.handle === '' ? {} : { handle: member.handle }),
    });
  }
  for (const ai of detail.ais) {
    const localpart = jidLocal(ai.jid).toLowerCase();
    members.set(localpart, { jid: ai.jid, name: ai.name });
  }
  ctx.groupMembers.set(chatId, members);
  ctx.groupInfos.set(chatId, detail);
  // The group's shared background paints every chat of that group, not only this chat.
  const nextBackground = detail.background;
  ctx.set((state) => ({
    groupInfos: { ...state.groupInfos, [chatId]: detail },
    chats:
      nextBackground === undefined
        ? state.chats
        : state.chats.map((chat) =>
            chat.groupId === detail.id ? { ...chat, groupBackground: nextBackground } : chat,
          ),
  }));
}

// The in-flight marks of the group-detail loads, keyed so a group id can never collide with a chat id.
const groupKey = (groupId: string): string => `group:${groupId}`;

/** The web view of the core's per-group cache: the detail map is chat-keyed, so the cache is
 * read by detail.id, while the in-flight marks live under a group key. */
function groupDetailStore(ctx: StoreCtx): GroupDetailStore<GroupDetail> {
  return {
    cached: (groupId) => {
      for (const detail of ctx.groupInfos.values()) {
        if (detail.id === groupId) {
          return detail;
        }
      }
      return undefined;
    },
    isLoading: (groupId) => ctx.loadingGroupMembers.has(groupKey(groupId)),
    begin: (groupId) => {
      ctx.loadingGroupMembers.add(groupKey(groupId));
    },
    finish: (groupId) => {
      ctx.loadingGroupMembers.delete(groupKey(groupId));
    },
    publish: (_groupId, detail) => {
      const mine = ctx.k.myJid();
      if (mine === undefined) {
        return;
      }
      const domain = domainOf(mine);
      // Every known row of the group is filled, so a caller that shared an in-flight load
      // still finds the detail in its own chat-keyed entry.
      for (const row of ctx.get().chats) {
        if (row.groupId === detail.id) {
          applyGroupDetail(ctx, row.id, detail, domain);
        }
      }
    },
  };
}

/** Loads a group's members once per group, so a typing indicator or a message from a
 * non-contact still shows a name, and every topic row shares one GET. */
export const ensureGroupMembers = (
  ctx: StoreCtx,
  chatId: string,
  force = false,
): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    if (!force && ctx.groupInfos.has(chatId)) {
      return;
    }
    const groupId = ctx.groupIds.get(chatId);
    const mine = ctx.k.myJid();
    if (groupId === undefined || mine === undefined) {
      return;
    }
    const { api } = yield* Ports;
    const detail = yield* ensureGroupDetail(api, groupDetailStore(ctx), groupId, force);
    // A cache hit (or a load another caller started) does not repaint; fill this chat's entry.
    if (detail !== undefined && !ctx.groupInfos.has(chatId)) {
      applyGroupDetail(ctx, chatId, detail, domainOf(mine));
    }
  });

export const loadGroupMembersInBackground = (
  ctx: StoreCtx,
  chatId: string,
  force = false,
): void => {
  ctx.rt.fork(ensureGroupMembers(ctx, chatId, force));
};

/** Joins every group room of the painted list and loads its members; hooks.first joins
 * before the rest and hooks.onJoined fires per joined room. */
export const joinGroups = (
  ctx: StoreCtx,
  current: XmppCore,
  me: Me,
  hooks?: JoinGroupsHooks,
): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const chats = ctx.get().chats.filter((chat) => chat.kind === 'group');
    const first = hooks?.first;
    const ordered =
      first === undefined
        ? chats
        : [
            ...chats.filter((chat) => chat.id === first),
            ...chats.filter((chat) => chat.id !== first),
          ];
    for (const chat of ordered) {
      loadGroupMembersInBackground(ctx, chat.id);
      // A room can be joined later when the user opens it.
      yield* fromPromise(() => current.joinRoom(chat.id, ctx.k.nick(me))).pipe(
        Effect.tap(() => Effect.sync(() => hooks?.onJoined?.(chat.id))),
        Effect.ignore,
      );
    }
  });
