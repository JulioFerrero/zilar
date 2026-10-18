import type { SetState } from '@zilar/client-core';
import type { ChatStoreState } from '../store';
import type { StoreCtx } from './ctx';
import { loadGroupMembersInBackground } from './groupMembers';
import {
  createChannel as createChannelEffect,
  createGroup as createGroupEffect,
  createInvite as createInviteEffect,
} from './groupCreate';
import {
  addGroupAi,
  changeChannelRole,
  joinPublicGroup,
  leaveChannel,
  removeGroupAi,
  setGroupBackground,
  setGroupListener,
  setGroupVisibility,
  setMembersCanCreateTopics,
} from './groupSettings';
import {
  addTopicAi,
  addTopicMember,
  createTopic,
  leaveTopic,
  patchTopic,
  refreshGeneralTopic,
  refreshTopicRow,
  removeTopicAi,
  removeTopicMember,
  setTopicRoles,
} from './topics';
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

export function makeGroupActions(deps: GroupActionsDeps): GroupActions {
  const { ctx, rt, set, ports } = deps;
  const { api } = ports;

  return {
    refreshGroupInfo: (chatId) => {
      loadGroupMembersInBackground(ctx, chatId, true);
    },
    listMyAis: () => api.listAis(),
    dismissTopicNotice: () => set({ topicNotice: undefined }),
    // Resolves General from the painted list, running the real refresh and waiting for it:
    // refreshChats only schedules the 500 ms debounce.
    refreshGeneralTopic: (groupId) => rt.runPromise(refreshGeneralTopic(ctx, groupId)),
    createTopic: (chatId, input) => rt.runPromise(createTopic(ctx, chatId, input)),
    patchTopic: (chatId, input) => rt.runPromise(patchTopic(ctx, chatId, input)),
    addTopicAi: (chatId, aiId) => rt.runPromise(addTopicAi(ctx, chatId, aiId)),
    removeTopicAi: (chatId, aiId) => rt.runPromise(removeTopicAi(ctx, chatId, aiId)),
    addTopicMember: (chatId, userId) => rt.runPromise(addTopicMember(ctx, chatId, userId)),
    joinTopic: (chatId) => rt.runPromise(joinTopic(ctx, chatId)),
    removeTopicMember: (chatId, userId) => rt.runPromise(removeTopicMember(ctx, chatId, userId)),
    setTopicRoles: (chatId, input) => rt.runPromise(setTopicRoles(ctx, chatId, input)),
    // Re-reads the chat list and reports whether the topic row is still there, so a member-
    // removal 404 can be told apart from a gone topic. A failed refresh throws instead of
    // reading a stale list as alive, so the panel shows the inline removal error.
    refreshTopicRow: (chatId, topicId) => rt.runPromise(refreshTopicRow(ctx, chatId, topicId)),
    leaveTopic: (chatId) => rt.runPromise(leaveTopic(ctx, chatId)),
    // Channels share the create flow with groups; visibility public with a handle creates
    // the directory entry in one transaction.
    createChannel: (title, memberIds, description, options) =>
      rt.runPromise(createChannelEffect(ctx, title, memberIds, description, options)),
    // Leaving a channel removes the caller's membership through the same route admins use.
    leaveChannel: (chatId) => rt.runPromise(leaveChannel(ctx, chatId)),
    // Promote/demote through the role route (owner only); the detail and list refresh, so the
    // acting device matches server truth. The target converges on the next list refresh.
    changeChannelRole: (chatId, userId, role) =>
      rt.runPromise(changeChannelRole(ctx, chatId, userId, role)),
    // Owners and admins add contacts or remove a member; both refresh the detail and the list.
    addGroupMembers: (chatId, userIds) => rt.runPromise(addGroupMembers(ctx, chatId, userIds)),
    removeGroupMember: (chatId, userId) => rt.runPromise(removeGroupMember(ctx, chatId, userId)),
    // The owner hands the group over; the detail and list refresh, so Leave appears.
    transferGroupOwner: (chatId, userId) => rt.runPromise(transferGroupOwner(ctx, chatId, userId)),
    setMembersCanCreateTopics: (chatId, allowed) =>
      rt.runPromise(setMembersCanCreateTopics(ctx, chatId, allowed)),
    // The detail refresh repaints every chat of the group at once.
    setGroupBackground: (chatId, background) =>
      rt.runPromise(setGroupBackground(ctx, chatId, background)),
    // The detail refresh repaints the panel.
    setGroupListener: (chatId, input) => rt.runPromise(setGroupListener(ctx, chatId, input)),
    // The detail refreshes from server truth, so the panel, label and share link update at once.
    setGroupVisibility: (chatId, input) => rt.runPromise(setGroupVisibility(ctx, chatId, input)),
    // Joins with one request, refreshes the list and resolves General from the painted rows,
    // falling back to undefined when the list has not caught up (the caller goes home).
    joinPublicGroup: (groupId) => rt.runPromise(joinPublicGroup(ctx, groupId)),
    addGroupAi: (chatId, aiId) => rt.runPromise(addGroupAi(ctx, chatId, aiId)),
    removeGroupAi: (chatId, aiId) => rt.runPromise(removeGroupAi(ctx, chatId, aiId)),
    createGroup: (title, memberIds, options) =>
      rt.runPromise(createGroupEffect(ctx, title, memberIds, options)),
    createInvite: () => rt.runPromise(createInviteEffect()),
  };
}
