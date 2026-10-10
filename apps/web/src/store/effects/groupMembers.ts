// A group's members: loading the detail once per group, caching it, and
// joining the group rooms after the connection is up. History and the
// lifecycle use these without pulling in the group actions.
import { Effect } from 'effect';
import type { MentionMember } from '@zilar/chat-core';
import { ensureGroupDetail, type GroupDetailStore } from '@zilar/client-core/store';
import { jidLocal } from '@zilar/protocol';
import type { XmppCore } from '@zilar/xmpp-core';
import type { GroupDetail, Me } from '@/lib/api';
import type { StoreCtx } from './ctx';
import { Ports } from './ports';
import { fromPromise } from './util';

/** The XMPP domain of a JID. */
export const domainOf = (jid: string): string => jid.slice(jid.indexOf('@') + 1);

/**
 * Caches a group detail and rebuilds the mention members from it, so the
 * picker and the panel agree after a load, an add or a remove. Handles pass
 * through from the detail (T-0169); AIs have none.
 */
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
  // T-0466: the group's shared background paints every chat of that group,
  // not only the chat the detail was loaded for.
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

// The in-flight marks of the group-detail loads, keyed so a group id can never
// collide with a chat id.
const groupKey = (groupId: string): string => `group:${groupId}`;

/**
 * The web view of the core's per-group cache (T-0920): the detail map is the
 * chat-keyed `groupInfos`, so the cache is read by `detail.id`; the in-flight
 * marks live in `loadingGroupMembers` under a group key.
 */
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
      // Every known row of the group is filled, so a caller that shared an
      // in-flight load still finds the detail in its own chat-keyed entry.
      for (const row of ctx.get().chats) {
        if (row.groupId === detail.id) {
          applyGroupDetail(ctx, row.id, detail, domain);
        }
      }
    },
  };
}

/**
 * Loads the members of a group once per group, so a typing indicator or a
 * message from a member who is not a contact can still show a name, and every
 * topic row of the group shares one GET (R14). The mention picker and the
 * group panel read the same list. The AIs the group holds (T-0054) ride along.
 */
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
    // A pure cache hit (or a load another caller started) does not repaint;
    // fill this chat's entry, which the publish above may not have reached.
    if (detail !== undefined && !ctx.groupInfos.has(chatId)) {
      applyGroupDetail(ctx, chatId, detail, domainOf(mine));
    }
  });

/** Starts loading the members of a group chat without waiting for them. */
export const loadGroupMembersInBackground = (
  ctx: StoreCtx,
  chatId: string,
  force = false,
): void => {
  ctx.rt.fork(ensureGroupMembers(ctx, chatId, force));
};

/** Joins every group room of the painted list and starts loading its members. */
export const joinGroups = (
  ctx: StoreCtx,
  current: XmppCore,
  me: Me,
): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    for (const chat of ctx.get().chats) {
      if (chat.kind !== 'group') {
        continue;
      }
      loadGroupMembersInBackground(ctx, chat.id);
      // A room can be joined later when the user opens it.
      yield* fromPromise(() => current.joinRoom(chat.id, ctx.k.nick(me))).pipe(Effect.ignore);
    }
  });
