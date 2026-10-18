import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useState } from 'react';
import type { CreatedInviteLink, GroupInviteLink, GroupRole, PublicAi } from '@/lib/api';
import { createGroupInviteLink, revokeGroupInviteLink } from '@/lib/api';
import { runWeb } from '@/lib/effect/runtime';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import type { AvatarStackEntry } from './group-info/AvatarStack';
import { GroupInfoPage } from './group-info/GroupInfoPage';
import { GROUP_INFO_TITLES, GroupInfoRoot } from './group-info/GroupInfoRoot';
import type { GroupInfoPageId } from './group-info/GroupInfoRoot';
import { PeoplePage } from './group-info/PeoplePage';
import { ActivitySection } from './ais/AiActivity';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { ChatBackgroundDialog } from './ChatBackgroundDialog';
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';
import { InviteLinksSection } from './InviteLinksSection';
import { RoutinesSection } from './tools/RoutinesSection';
import { ToolsSection } from './tools/ToolsSection';
import { VisibilitySection } from './VisibilitySection';
import { GroupPictureSection } from './panels/GroupPictureSection';
import { GroupListenerSetting, GroupTopicSetting } from './panels/GroupSettingSwitch';
import { apiStep, loadLinks, loadRoles, messageOf, rolesViewOf } from './panels/groupPanelOps';
import type { PanelFailure } from './panels/groupPanelOps';

export function GroupPanel({
  chat,
  onClose,
  onSearch,
  onOpenMedia,
}: {
  chat: ChatSummary;
  onClose: () => void;
  onSearch: () => void;
  onOpenMedia: () => void;
}) {
  const storeApi = useChatStoreApi();

  const info = useChatSelector((s) => s.groupInfo(chat.id));
  const me = useChatSelector((s) => s.currentUserId);
  const meRole = info?.members.find((member) => member.userId === me)?.role;
  const isManager = meRole === 'owner' || meRole === 'admin';
  const memberCount =
    info === undefined ? (chat.memberCount ?? 0) : info.members.length + info.ais.length;

  // The add picker's list is a snapshot taken on open, so a just-added option stays mounted.
  const [pickerChoices, setPickerChoices] = useState<PublicAi[] | undefined>(undefined);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [page, setPage] = useState<GroupInfoPageId>('root');
  const [pickerOnMount, setPickerOnMount] = useState(false);

  // Invite links carry hints, never tokens; the created URL is shown once.
  const groupId = info?.id;
  const [linksResult, refreshLinks] = useQuery(
    () => loadLinks(isManager, groupId),
    [isManager, groupId],
  );
  const links = AsyncResult.getOrElse(linksResult, (): GroupInviteLink[] => []);
  const [createdLink, setCreatedLink] = useState<CreatedInviteLink | undefined>(undefined);
  const [createState, createLink] = useAction<
    { label?: string; expiresInHours?: number; maxUses?: number },
    void,
    PanelFailure
  >((input) => {
    if (groupId === undefined) {
      return Effect.void;
    }
    return apiStep(() => createGroupInviteLink(groupId, input), 'Could not create the link.').pipe(
      Effect.tap((created) =>
        Effect.sync(() => {
          setCreatedLink(created);
          refreshLinks();
        }),
      ),
      Effect.asVoid,
    );
  });
  const linksBusy = isWaiting(createState);
  const [revokeError, setRevokeError] = useState<string | undefined>(undefined);
  const linksError = messageOf(createState) ?? revokeError ?? messageOf(linksResult);

  const revokeLink = (linkId: string): Promise<void> =>
    runWeb(
      groupId === undefined
        ? Effect.void
        : apiStep(() => revokeGroupInviteLink(groupId, linkId), 'Could not revoke the link.').pipe(
            Effect.tap(() => Effect.sync(refreshLinks)),
            Effect.tapError((failure) => Effect.sync(() => setRevokeError(failure.message))),
            Effect.ignore,
          ),
    );

  const [rolesResult, refreshRoles] = useQuery(() => loadRoles(info?.id), [info?.id]);
  const rolesState = rolesViewOf(rolesResult);

  const rolesByUser = new Map<string, GroupRole[]>();
  if (rolesState.status === 'ready') {
    for (const role of rolesState.roles) {
      for (const holder of role.members) {
        const list = rolesByUser.get(holder.userId) ?? [];
        list.push(role);
        rolesByUser.set(holder.userId, list);
      }
    }
  }

  const [myAisResult] = useQuery(
    () =>
      Effect.tryPromise({
        try: () => storeApi.getState().listMyAis(),
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed((): PublicAi[] => [])),
    [storeApi],
  );
  const myAis = AsyncResult.getOrElse(myAisResult, (): PublicAi[] => []);

  const eligibleAis = myAis.filter(
    (ai) => ai.status === 'active' && info?.ais.some((item) => item.aiId === ai.id) !== true,
  );

  useEffect(() => {
    storeApi.getState().refreshGroupInfo(chat.id);
  }, [storeApi, chat.id]);

  const isOwner = meRole === 'owner';
  // A General topic row's `title` is the topic name, so show the group title.
  const panelTitle = chat.groupTitle ?? chat.title;

  const stack: AvatarStackEntry[] =
    info === undefined
      ? []
      : [
          ...info.ais.map((ai) => ({
            id: ai.aiId,
            name: ai.name,
            ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
          })),
          ...info.members.map((member) => ({
            id: member.userId,
            name: member.name,
            ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
          })),
        ];

  const openPage = (next: GroupInfoPageId): void => {
    setPickerOnMount(false);
    setPage(next);
  };

  const openMembersWithPicker = (): void => {
    setPickerOnMount(true);
    setPage('people');
  };

  return (
    <Sheet open onClose={onClose} ariaLabel={`${panelTitle} info`}>
      {page === 'root' ? (
        <GroupInfoRoot
          chat={chat}
          title={panelTitle}
          groupId={info?.id}
          memberCount={memberCount}
          stack={stack}
          isManager={isManager}
          isOwner={isOwner}
          canLeave={meRole !== undefined && meRole !== 'owner'}
          onClose={onClose}
          onSearch={onSearch}
          onOpenMedia={onOpenMedia}
          onOpenBackground={() => setBackgroundOpen(true)}
          onOpenPage={openPage}
          onAddMembers={openMembersWithPicker}
        />
      ) : (
        <GroupInfoPage
          title={GROUP_INFO_TITLES[page]}
          onBack={() => setPage('root')}
          onClose={onClose}
        >
          {info === undefined ? (
            <StateMessage kind="loading" size="inline" title="Loading…" />
          ) : (
            <>
              {page === 'people' && (
                <PeoplePage
                  chatId={chat.id}
                  info={info}
                  me={me}
                  isManager={isManager}
                  rolesByUser={rolesByUser}
                  rolesState={rolesState}
                  onReloadRoles={refreshRoles}
                  onOpenLinks={() => setPage('links')}
                  openPickerOnMount={pickerOnMount}
                  eligibleAis={eligibleAis}
                  pickerChoices={pickerChoices}
                  onOpenPicker={() => setPickerChoices(eligibleAis)}
                  onClosePicker={() => setPickerChoices(undefined)}
                />
              )}

              {page === 'links' && isManager && (
                <InviteLinksSection
                  links={links}
                  busy={linksBusy}
                  error={linksError}
                  created={createdLink === undefined ? undefined : { url: createdLink.url }}
                  onCreate={(input) => createLink(input)}
                  onRevoke={revokeLink}
                  onDismissCreated={() => setCreatedLink(undefined)}
                />
              )}

              {page === 'tools' && (
                <>
                  <ToolsSection
                    scope={{ groupId: info.id }}
                    scopeKey={`group:${info.id}`}
                    canManage={isManager}
                  />
                  <RoutinesSection
                    scope={{ groupId: info.id }}
                    scopeKey={`group-routines:${info.id}`}
                    canManage={isManager}
                  />
                </>
              )}

              {page === 'activity' && isManager && <ActivitySection scope={{ groupId: info.id }} />}

              {page === 'allowed' && isManager && (
                <AlwaysAllowedList scope={{ groupId: info.id }} />
              )}

              {page === 'settings' && (
                <>
                  {isManager && (
                    <GroupPictureSection
                      groupId={info.id}
                      title={info.title}
                      currentUrl={info.avatarUrl}
                      chatId={chat.id}
                    />
                  )}

                  {isManager && (
                    <GroupTopicSetting
                      chatId={chat.id}
                      canCreateTopics={info.membersCanCreateTopics}
                    />
                  )}

                  {isManager && (
                    <GroupListenerSetting
                      chatId={chat.id}
                      enabled={info.listener?.enabled === true}
                      available={info.listener?.available === true}
                      eagerness={info.listener?.eagerness ?? 'normal'}
                    />
                  )}

                  {isOwner && (
                    <VisibilitySection
                      chatId={chat.id}
                      groupId={info.id}
                      visibility={info.visibility ?? 'private'}
                      handle={info.handle ?? null}
                      title={info.title}
                    />
                  )}
                </>
              )}
            </>
          )}
        </GroupInfoPage>
      )}

      {isManager && info !== undefined && (
        <ChatBackgroundDialog
          chat={chat}
          groupId={info.id}
          open={backgroundOpen}
          onClose={() => setBackgroundOpen(false)}
        />
      )}
    </Sheet>
  );
}
