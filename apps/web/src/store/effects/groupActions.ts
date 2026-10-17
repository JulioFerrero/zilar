// The topic, group and channel actions of the web chat store. Each one wraps
// an effect module with the store's `StoreCtx`, lifetime and state accessors;
// `realStore.ts` spreads the returned slice into the store state.
import type { SetState } from '../atomStore';
import type { ChatStoreState } from '../store';
import type { StoreCtx } from './ctx';
import { loadGroupMembersInBackground } from './groupMembers';
import {
  addGroupAi,
  addTopicAi,
  addTopicMember,
  changeChannelRole,
  createChannel as createChannelEffect,
  createGroup as createGroupEffect,
  createInvite as createInviteEffect,
  createTopic,
  joinPublicGroup,
  leaveChannel,
  leaveTopic,
  patchTopic,
  refreshGeneralTopic,
  refreshTopicRow,
  removeGroupAi,
  removeTopicAi,
  removeTopicMember,
  setGroupBackground,
  setGroupListener,
  setGroupVisibility,
  setMembersCanCreateTopics,
  setTopicRoles,
} from './groups';
import { addGroupMembers, removeGroupMember, transferGroupOwner } from './groupSettings';
import { joinTopic } from './topics';
import type { StoreLocals } from './locals';
import type { PortsShape } from './ports';
import type { Lifetime } from './runtime';

export type GroupActions = Pick<
  ChatStoreState,
  | 'refreshGroupInfo'
  | 'listMyAis'
  | 'dismissTopicNotice'
  | 'refreshGeneralTopic'
  | 'createTopic'
  | 'patchTopic'
  | 'addTopicAi'
  | 'removeTopicAi'
  | 'addTopicMember'
  | 'joinTopic'
  | 'removeTopicMember'
  | 'setTopicRoles'
  | 'refreshTopicRow'
  | 'leaveTopic'
  | 'createChannel'
  | 'leaveChannel'
  | 'changeChannelRole'
  | 'addGroupMembers'
  | 'removeGroupMember'
  | 'transferGroupOwner'
  | 'setMembersCanCreateTopics'
  | 'setGroupBackground'
  | 'setGroupListener'
  | 'setGroupVisibility'
  | 'joinPublicGroup'
  | 'addGroupAi'
  | 'removeGroupAi'
  | 'createGroup'
  | 'createInvite'
>;

export interface GroupActionsDeps {
  readonly ctx: StoreCtx;
  readonly rt: Lifetime;
  readonly locals: StoreLocals;
  readonly set: SetState<ChatStoreState>;
  readonly get: () => ChatStoreState;
  readonly ports: PortsShape;
}

/** Builds the topic, group and channel actions of one store. */
export function makeGroupActions(deps: GroupActionsDeps): GroupActions {
  const { ctx, rt, set, ports } = deps;
  const { api } = ports;

  return {
    refreshGroupInfo: (chatId) => {
      loadGroupMembersInBackground(ctx, chatId, true);
    },
    listMyAis: () => api.listAis(),
    dismissTopicNotice: () => set({ topicNotice: undefined }),
    // T-0130 (review): resolves General from the painted list, refreshing
    // it first. `refreshChats` only schedules the 500 ms debounce, so this
    // runs the real refresh and waits for it, never the schedule.
    refreshGeneralTopic: (groupId) => rt.runPromise(refreshGeneralTopic(ctx, groupId)),
    createTopic: (chatId, input) => rt.runPromise(createTopic(ctx, chatId, input)),
    patchTopic: (chatId, input) => rt.runPromise(patchTopic(ctx, chatId, input)),
    addTopicAi: (chatId, aiId) => rt.runPromise(addTopicAi(ctx, chatId, aiId)),
    removeTopicAi: (chatId, aiId) => rt.runPromise(removeTopicAi(ctx, chatId, aiId)),
    addTopicMember: (chatId, userId) => rt.runPromise(addTopicMember(ctx, chatId, userId)),
    joinTopic: (chatId) => rt.runPromise(joinTopic(ctx, chatId)),
    removeTopicMember: (chatId, userId) => rt.runPromise(removeTopicMember(ctx, chatId, userId)),
    setTopicRoles: (chatId, input) => rt.runPromise(setTopicRoles(ctx, chatId, input)),
    // T-0130 (review): re-reads the chat list and reports whether the
    // topic row is still there, so a member-removal 404 can be told
    // apart from a gone topic (last member removed → archived). A
    // failed refresh throws (instead of reading a stale list as
    // "alive"), so the panel shows the inline removal error.
    refreshTopicRow: (chatId, topicId) => rt.runPromise(refreshTopicRow(ctx, chatId, topicId)),
    leaveTopic: (chatId) => rt.runPromise(leaveTopic(ctx, chatId)),
    // T-0124: channels share the create/list/refresh flow with groups (the
    // detail carries `kind`, the chat list paints the feed row).
    // T-0164: `visibility: 'public'` + `handle` creates the channel with
    // its directory entry in one transaction.
    createChannel: (title, memberIds, description, options) =>
      rt.runPromise(createChannelEffect(ctx, title, memberIds, description, options)),
    // T-0124: leaving a channel removes the caller's membership through
    // the member route (the same route admins use to remove others). The
    // list refreshes itself away; the caller navigates away.
    leaveChannel: (chatId) => rt.runPromise(leaveChannel(ctx, chatId)),
    // T-0124: promote/demote through the role route (owner only). The
    // detail refreshes, so the panel updates at once; the chat list
    // refreshes too, so the acting device's rows (myRole, counts) match
    // server truth and the composer bar flips. The target's own device
    // converges on the next list refresh (60s poll / focus), like every
    // other membership change in the app.
    changeChannelRole: (chatId, userId, role) =>
      rt.runPromise(changeChannelRole(ctx, chatId, userId, role)),
    // T-1183: owners/admins add contacts to the group, or remove a member.
    // Both refresh the detail and the chat list.
    addGroupMembers: (chatId, userIds) => rt.runPromise(addGroupMembers(ctx, chatId, userIds)),
    removeGroupMember: (chatId, userId) => rt.runPromise(removeGroupMember(ctx, chatId, userId)),
    // T-1190: the owner hands the group over; the detail refreshes (the caller
    // is now an admin) and the list refreshes, so Leave group appears.
    transferGroupOwner: (chatId, userId) => rt.runPromise(transferGroupOwner(ctx, chatId, userId)),
    setMembersCanCreateTopics: (chatId, allowed) =>
      rt.runPromise(setMembersCanCreateTopics(ctx, chatId, allowed)),
    // T-0466: owners/admins set the group's shared background; the detail
    // refresh repaints every chat of the group at once.
    setGroupBackground: (chatId, background) =>
      rt.runPromise(setGroupBackground(ctx, chatId, background)),
    // T-0478: owners/admins turn the group's AI listener on/off or set its
    // eagerness; the detail refresh repaints the panel.
    setGroupListener: (chatId, input) => rt.runPromise(setGroupListener(ctx, chatId, input)),
    // T-0164: the owner flips a group public (with a handle) or back to
    // private. The detail refreshes from server truth (like the role
    // change), so the panel, the label and the share link update at once.
    setGroupVisibility: (chatId, input) => rt.runPromise(setGroupVisibility(ctx, chatId, input)),
    // T-0164: joins a public group with one request, then opens it: the
    // list refreshes (the new membership arrives) and the General chat id
    // resolves from the painted rows, falling back to undefined when the
    // list has not caught up yet (the caller navigates home instead).
    joinPublicGroup: (groupId) => rt.runPromise(joinPublicGroup(ctx, groupId)),
    addGroupAi: (chatId, aiId) => rt.runPromise(addGroupAi(ctx, chatId, aiId)),
    removeGroupAi: (chatId, aiId) => rt.runPromise(removeGroupAi(ctx, chatId, aiId)),
    createGroup: (title, memberIds, options) =>
      rt.runPromise(createGroupEffect(ctx, title, memberIds, options)),
    createInvite: () => rt.runPromise(createInviteEffect()),
  };
}
