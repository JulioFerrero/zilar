import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Image } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CreatedInviteLink, GroupAi, GroupInviteLink, GroupRole, PublicAi } from '@/lib/api';
import { createGroupInviteLink, revokeGroupInviteLink } from '@/lib/api';
import { runWeb } from '@/lib/effect/runtime';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { GroupMembersSection } from './GroupMembersSection';
import { GroupInfoPage } from './group-info/GroupInfoPage';
import { GROUP_INFO_TITLES, GroupInfoRoot } from './group-info/GroupInfoRoot';
import type { GroupInfoPageId } from './group-info/GroupInfoRoot';
import { ActivitySection } from './ais/AiActivity';
import { AiMemoryDialog } from './ais/AiMemoryDialog';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { ChatBackgroundDialog } from './ChatBackgroundDialog';
import { FieldError } from './ais/AiPageShell';
import { ListRow } from './ui/list-row';
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';
import { InviteLinksSection } from './InviteLinksSection';
import { RoutinesSection } from './tools/RoutinesSection';
import { ToolsSection } from './tools/ToolsSection';
import { VisibilitySection } from './VisibilitySection';
import { GroupAiSection } from './panels/GroupAiSection';
import { GroupPictureSection } from './panels/GroupPictureSection';
import { GroupRolesSection } from './panels/GroupRolesSection';
import { GroupListenerSetting, GroupTopicSetting } from './panels/GroupSettingSwitch';
import { apiStep, loadLinks, loadRoles, messageOf, rolesViewOf } from './panels/groupPanelOps';
import type { PanelFailure } from './panels/groupPanelOps';

/**
 * The group info panel (T-1494): a root page with the picture, the member count
 * and the Mute / Search / Add keys over three grouped lists, and one subpage per
 * row holding the sections that used to stack in a single scroll. It slides in
 * from the right on wide screens and fills the screen on narrow ones, opened
 * with `?panel=group` (T-0055).
 */
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

  // The add picker: undefined while closed, else the AIs it offers. The list is
  // a snapshot taken on open, so an option that was just added stays mounted
  // until the panel closes the picker (its success callback needs that).
  const [pickerChoices, setPickerChoices] = useState<PublicAi[] | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState('');
  const [memoryAi, setMemoryAi] = useState<{ id: string; name: string } | undefined>(undefined);
  /** T-0466: the manager-only group background dialog. */
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  /** T-1494: the open subpage, and whether the members page opens its picker. */
  const [page, setPage] = useState<GroupInfoPageId>('root');
  const [pickerOnMount, setPickerOnMount] = useState(false);

  // T-0115: invite links for owners/admins. The list carries hints, never
  // tokens; the created URL is shown once with a Copy button.
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

  // Revoke runs as a promise because InviteLinksSection awaits it to keep the
  // button on "Revoking…" until the request settles (T-0141). It never rejects:
  // a failure is shown through `revokeError`.
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

  // Custom group roles (T-0116): every member sees who holds what (the
  // chips below); managers get the CRUD section further down. A failure
  // shows an inline error with Retry and never breaks the rest of the
  // panel.
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

  // The AI list feeds the add picker.
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

  // The panel refreshes the members when it opens, so a change made elsewhere
  // shows up here.
  useEffect(() => {
    storeApi.getState().refreshGroupInfo(chat.id);
  }, [storeApi, chat.id]);

  const ownerName = (ai: GroupAi): string =>
    info?.members.find((member) => member.userId === ai.ownerId)?.name ?? 'someone';
  const isOwner = meRole === 'owner';
  // T-1249: the panel can be handed the group's General topic row, whose
  // `title` is the topic name ("General"), so show the group title instead.
  const panelTitle = chat.groupTitle ?? chat.title;

  const openPage = (next: GroupInfoPageId): void => {
    setPickerOnMount(false);
    setPage(next);
  };

  // The root's Add key: the members page, with the picker already open.
  const openMembersWithPicker = (): void => {
    setPickerOnMount(true);
    setPage('members');
  };

  return (
    <Sheet open onClose={onClose} ariaLabel={`${panelTitle} info`}>
      {page === 'root' ? (
        <GroupInfoRoot
          chat={chat}
          title={panelTitle}
          memberCount={memberCount}
          aisCount={info?.ais.length ?? 0}
          linksCount={isManager ? links.length : undefined}
          isManager={isManager}
          onClose={onClose}
          onSearch={onSearch}
          onOpenMedia={onOpenMedia}
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
              {page === 'members' && (
                <>
                  <GroupMembersSection
                    chatId={chat.id}
                    info={info}
                    me={me}
                    rolesByUser={rolesByUser}
                    onClose={onClose}
                    openPickerOnMount={pickerOnMount}
                  />

                  {/* T-0116: custom group roles — managers only. Everyone sees
                        the chips next to the member names above. */}
                  {isManager && (
                    <GroupRolesSection
                      groupId={info.id}
                      members={info.members.map((member) => ({
                        userId: member.userId,
                        name: member.name,
                        ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
                      }))}
                      rolesState={rolesState}
                      onReload={refreshRoles}
                    />
                  )}
                </>
              )}

              {page === 'ais' && (
                <>
                  <GroupAiSection
                    ais={info.ais}
                    chatId={chat.id}
                    ownerNameOf={ownerName}
                    canRemove={(ai) => ai.ownerId === me || isManager}
                    isManager={isManager}
                    eligibleAis={eligibleAis}
                    pickerChoices={pickerChoices}
                    onOpenPicker={() => setPickerChoices(eligibleAis)}
                    onClosePicker={() => setPickerChoices(undefined)}
                    onOpenMemory={(ai) => setMemoryAi(ai)}
                    onError={setErrorMessage}
                  />

                  {memoryAi !== undefined && (
                    <AiMemoryDialog
                      chat={chat.id}
                      aiId={memoryAi.id}
                      aiName={memoryAi.name}
                      onClose={() => setMemoryAi(undefined)}
                    />
                  )}

                  {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
                </>
              )}

              {/* T-0115: shareable invite links, owners and admins only. */}
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

              {/* T-0107: tools and routines of the group (General). Plain
                    members read; managers get the actions. */}
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

              {/* T-0086: room activity, owners and admins only. The section
                    handles its own load / error states. */}
              {page === 'activity' && isManager && <ActivitySection scope={{ groupId: info.id }} />}

              {/* T-0100: the standing rules for this group, owners and admins
                    only. */}
              {page === 'allowed' && isManager && (
                <AlwaysAllowedList scope={{ groupId: info.id }} />
              )}

              {page === 'settings' && (
                <>
                  {/* T-0165: the group's picture, for owners and admins. */}
                  {isManager && (
                    <GroupPictureSection
                      groupId={info.id}
                      title={info.title}
                      currentUrl={info.avatarUrl}
                      chatId={chat.id}
                    />
                  )}

                  {/* T-0111: "Members can create topics", managers only. */}
                  {isManager && (
                    <GroupTopicSetting
                      chatId={chat.id}
                      canCreateTopics={info.membersCanCreateTopics}
                    />
                  )}

                  {/* T-0478: the AI listener switch and eagerness, managers
                        only. */}
                  {isManager && (
                    <GroupListenerSetting
                      chatId={chat.id}
                      enabled={info.listener?.enabled === true}
                      available={info.listener?.available === true}
                      eagerness={info.listener?.eagerness ?? 'normal'}
                    />
                  )}

                  {/* T-0466: the group's shared background, managers only. */}
                  {isManager && (
                    <section aria-label="Group background" className="px-2">
                      <ListRow
                        icon={<Image />}
                        title="Group background"
                        chevron
                        onClick={() => setBackgroundOpen(true)}
                      />
                    </section>
                  )}

                  {/* T-0164: public visibility with a handle — the owner only. */}
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
