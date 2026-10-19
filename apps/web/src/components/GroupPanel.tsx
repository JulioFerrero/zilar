import { AiMemoryDialog } from './ais/AiMemoryDialog';
import { FieldError } from './ais/AiPageShell';
import { GroupMembersSection } from './GroupMembersSection';
import { GroupAiSection } from './panels/GroupAiSection';
import {
  type RolesView,
  apiStep,
  loadLinks,
  loadRoles,
  messageOf,
  rolesViewOf,
  settingText,
  storeStep,
  type PanelFailure,
} from './panels/groupPanelOps';
import { GroupRolesSection } from './panels/GroupRolesSection';
import { SectionLabel } from './ui/card';
import { ActivitySection } from './ais/AiActivity';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { AvatarUploader } from './AvatarUploader';
import { ChatBackgroundDialog } from './ChatBackgroundDialog';
import type { AvatarStackEntry } from './group-info/AvatarStack';
import { GroupInfoPage } from './group-info/GroupInfoPage';
import { GROUP_INFO_TITLES, GroupInfoRoot, type GroupInfoPageId } from './group-info/GroupInfoRoot';
import { InviteLinksSection } from './InviteLinksSection';
import { RoutinesSection } from './tools/RoutinesSection';
import { ToolsSection } from './tools/ToolsSection';
import { SegmentedControl } from './ui/segmented-control';
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';
import { Switch } from './ui/switch';
import { VisibilitySection } from './VisibilitySection';
import {
  type CreatedInviteLink,
  type GroupInviteLink,
  type GroupRole,
  type ListenerEagerness,
  type PublicAi,
  type SetGroupListenerInput,
  type GroupAi,
  type GroupDetail,
  createGroupInviteLink,
  revokeGroupInviteLink,
} from '@/lib/api';
import { runWeb } from '@/lib/effect/runtime';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useState, type ReactNode } from 'react';

function GroupPictureSection({
  groupId,
  title,
  currentUrl,
  chatId,
}: {
  groupId: string;
  title: string;
  currentUrl?: string | undefined;
  chatId: string;
}) {
  const storeApi = useChatStoreApi();
  const [changedUrl, setChangedUrl] = useState<string | undefined | null>(null);
  const shown = changedUrl !== null ? changedUrl : currentUrl;
  return (
    <AvatarUploader
      kind="group"
      ownerId={groupId}
      ownerName={title}
      currentUrl={shown}
      onChanged={(next) => {
        setChangedUrl(next);
        storeApi.getState().refreshChats();
        storeApi.getState().refreshGroupInfo(chatId);
      }}
    />
  );
}

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <SectionLabel>{label}</SectionLabel>
      <span className="font-mono text-[12px] font-normal text-muted-foreground">{count}</span>
    </div>
  );
}

function PeoplePage({
  chatId,
  info,
  me,
  isManager,
  rolesByUser,
  rolesState,
  onReloadRoles,
  onOpenLinks,
  openPickerOnMount,
  eligibleAis,
  pickerChoices,
  onOpenPicker,
  onClosePicker,
}: {
  chatId: string;
  info: GroupDetail;
  me: string | undefined;
  isManager: boolean;
  rolesByUser: Map<string, GroupRole[]>;
  rolesState: RolesView;
  onReloadRoles: () => void;
  onOpenLinks: () => void;
  openPickerOnMount: boolean;
  eligibleAis: PublicAi[];
  pickerChoices: PublicAi[] | undefined;
  onOpenPicker: () => void;
  onClosePicker: () => void;
}) {
  const [memoryAi, setMemoryAi] = useState<{ id: string; name: string } | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState('');

  const ownerName = (ai: GroupAi): string =>
    info.members.find((member) => member.userId === ai.ownerId)?.name ?? 'someone';
  const canRemove = (ai: GroupAi): boolean => ai.ownerId === me || isManager;

  return (
    <>
      <section className="flex flex-col gap-2">
        <SectionHeading label="AIs" count={info.ais.length} />
        <div className="[&>section>h2]:hidden">
          <GroupAiSection
            ais={info.ais}
            chatId={chatId}
            ownerNameOf={ownerName}
            canRemove={canRemove}
            isManager={isManager}
            eligibleAis={eligibleAis}
            pickerChoices={pickerChoices}
            onOpenPicker={onOpenPicker}
            onClosePicker={onClosePicker}
            onOpenMemory={(ai) => setMemoryAi(ai)}
            onError={setErrorMessage}
          />
        </div>
      </section>

      {memoryAi !== undefined && (
        <AiMemoryDialog
          chat={chatId}
          aiId={memoryAi.id}
          aiName={memoryAi.name}
          onClose={() => setMemoryAi(undefined)}
        />
      )}

      {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}

      <section className="flex flex-col gap-2">
        <SectionHeading label="People" count={info.members.length} />
        <GroupMembersSection
          chatId={chatId}
          info={info}
          me={me}
          rolesByUser={rolesByUser}
          onOpenLinks={onOpenLinks}
          openPickerOnMount={openPickerOnMount}
        />
      </section>

      {isManager && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Roles</SectionLabel>
          <div className="[&>section>h2]:hidden">
            <GroupRolesSection
              groupId={info.id}
              members={info.members.map((member) => ({
                userId: member.userId,
                name: member.name,
                ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
              }))}
              rolesState={rolesState}
              onReload={onReloadRoles}
            />
          </div>
        </section>
      )}
    </>
  );
}

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

function GroupSettingSwitch({
  ariaLabel,
  title,
  checked,
  onCheckedChange,
  disabled,
  error,
  children,
  description,
}: {
  ariaLabel: string;
  title: string;
  checked: boolean;
  onCheckedChange: () => void;
  disabled: boolean;
  error: string;
  children?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-2 px-2">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-list-hover">
        <span className="text-[14px]">{title}</span>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          label={title}
          hideLabel
          disabled={disabled}
        />
      </label>
      {children}
      {description}
      {error !== '' && <FieldError>{error}</FieldError>}
    </section>
  );
}

function GroupTopicSetting({
  chatId,
  canCreateTopics,
}: {
  chatId: string;
  canCreateTopics: boolean | undefined;
}) {
  const storeApi = useChatStoreApi();
  const [state, setTopicsAllowed] = useAction<boolean, void, PanelFailure>((allowed) =>
    storeStep(
      () => storeApi.getState().setMembersCanCreateTopics(chatId, allowed),
      settingText,
    ).pipe(Effect.asVoid),
  );
  return (
    <GroupSettingSwitch
      ariaLabel="Topic settings"
      title="Members can create topics"
      checked={canCreateTopics === true}
      onCheckedChange={() => setTopicsAllowed(canCreateTopics !== true)}
      disabled={isWaiting(state)}
      error={messageOf(state) ?? ''}
    />
  );
}

function GroupListenerSetting({
  chatId,
  enabled,
  available,
  eagerness,
}: {
  chatId: string;
  enabled: boolean;
  available: boolean;
  eagerness: ListenerEagerness;
}) {
  const storeApi = useChatStoreApi();
  const [state, saveListener] = useAction<SetGroupListenerInput, void, PanelFailure>((input) =>
    storeStep(() => storeApi.getState().setGroupListener(chatId, input), settingText).pipe(
      Effect.asVoid,
    ),
  );
  const busy = isWaiting(state);
  const flip = (): void => {
    if (available) {
      saveListener({ listenerEnabled: !enabled });
    }
  };
  const chooseEagerness = (value: ListenerEagerness): void => {
    if (available) {
      saveListener({ listenerEagerness: value });
    }
  };
  return (
    <GroupSettingSwitch
      ariaLabel="AI listener"
      title="Let AIs answer without @mention"
      checked={enabled}
      onCheckedChange={flip}
      disabled={!available || busy}
      error={messageOf(state) ?? ''}
      description={
        <p className="px-2 text-[13px] text-muted-foreground">
          {available
            ? 'Normal suits most groups. Quiet wakes AIs only for clear asks.'
            : 'Turned off on this server'}
        </p>
      }
    >
      {enabled && (
        <fieldset disabled={!available || busy} className="m-0 min-w-0 border-0 p-0">
          <SegmentedControl
            options={[
              { value: 'quiet', label: 'Quiet' },
              { value: 'normal', label: 'Normal' },
              { value: 'eager', label: 'Eager' },
            ]}
            value={eagerness}
            onChange={(value) => chooseEagerness(value as ListenerEagerness)}
            ariaLabel="Eagerness"
            mode="radio"
          />
        </fieldset>
      )}
    </GroupSettingSwitch>
  );
}
