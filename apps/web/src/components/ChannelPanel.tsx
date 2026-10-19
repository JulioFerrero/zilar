import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type {
  CreateGroupInviteLinkInput,
  CreatedInviteLink,
  GroupAi,
  GroupInviteLink,
  GroupMember,
  PublicAi,
} from '@/lib/api';
import {
  createGroupInviteLink,
  listGroupInviteLinks,
  listGroupMembers,
  revokeGroupInviteLink,
} from '@/lib/api';
import { fromApi, type ApiFailure, failureOf, isWaiting } from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { ActivitySection } from './ais/AiActivity';
import { FieldError } from './ais/AiPageShell';
import { AiBadge } from './AiBadge';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { EntityAvatar } from './EntityAvatar';
import { InviteLinksSection } from './InviteLinksSection';
import { GroupAiRowView } from './panels/GroupAiRowView';
import { GroupVisibilitySetting } from './GroupPanel';
import { ChannelInfoRoot } from './channel-info/ChannelInfoRoot';
import { CHANNEL_INFO_TITLES, type ChannelInfoPageId } from './channel-info/ChannelInfoRoot';
import { ChannelAdminsPage, ChannelSubscribersPage } from './channel-info/ChannelPeople';
import { GroupInfoPage } from './group-info/GroupInfoPage';
import {
  type ChannelFailure,
  describeFailure,
  failureText,
  storeCall,
} from './panels/channelPanelOps';
import { Button } from './ui/button';
import { SectionLabel } from './ui/card';
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';

/**
 * Managers see the subscriber audience; subscribers see the count and the
 * admins who post, never the audience.
 */
export function ChannelPanel({
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
  const navigate = useNavigate();

  const info = useChatSelector((s) => s.groupInfo(chat.id));
  const me = useChatSelector((s) => s.currentUserId);
  const meRole = info?.members.find((member) => member.userId === me)?.role;
  const isManager = meRole === 'owner' || meRole === 'admin';
  const isOwner = meRole === 'owner';
  const count = chat.subscriberCount ?? chat.memberCount ?? info?.members.length ?? 0;
  const description = chat.description ?? info?.description ?? null;
  const groupId = info?.id;

  const [page, setPage] = useState<ChannelInfoPageId>('root');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingAiId, setPendingAiId] = useState<string | undefined>(undefined);
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState('');
  const [roleError, setRoleError] = useState('');
  const [leaveError, setLeaveError] = useState('');
  const [linksActionError, setLinksError] = useState<string | undefined>(undefined);
  const [createdLink, setCreatedLink] = useState<CreatedInviteLink | undefined>(undefined);

  const [myAisQuery] = useQuery(() => fromApi(() => storeApi.getState().listMyAis()), [storeApi]);
  const myAis = AsyncResult.isSuccess(myAisQuery) ? myAisQuery.value : [];

  // Managers read the full list from the detail; subscribers get only the admins
  // slice (who posts is public), never the subscriber audience.
  const [adminsQuery] = useQuery(
    (): Effect.Effect<GroupMember[], ApiFailure> =>
      groupId === undefined || isManager
        ? Effect.never
        : fromApi(() => listGroupMembers(groupId)).pipe(
            Effect.map((members) => members.filter((member) => member.role !== 'member')),
          ),
    [groupId, isManager],
  );
  const adminsList = AsyncResult.isSuccess(adminsQuery) ? adminsQuery.value : [];
  const adminsFailure = failureOf(adminsQuery);

  const [linksQuery, refreshLinks] = useQuery(
    (): Effect.Effect<GroupInviteLink[], ApiFailure> =>
      groupId === undefined || !isManager
        ? Effect.never
        : fromApi(() => listGroupInviteLinks(groupId)),
    [isManager, groupId],
  );
  const linksList = AsyncResult.isSuccess(linksQuery) ? linksQuery.value : [];
  const linksError =
    linksActionError ??
    (failureOf(linksQuery) !== undefined ? 'Could not load the invite links.' : undefined);

  const [createState, createLink] = useAction<CreateGroupInviteLinkInput, void, ApiFailure>(
    (input) =>
      groupId === undefined
        ? Effect.void
        : Effect.sync(() => setLinksError(undefined)).pipe(
            Effect.andThen(fromApi(() => createGroupInviteLink(groupId, input))),
            Effect.tap((created) =>
              Effect.sync(() => {
                setCreatedLink(created);
                refreshLinks();
              }),
            ),
            Effect.asVoid,
            Effect.tapError((failure) =>
              Effect.sync(() => setLinksError(failureText(failure, 'Could not create the link.'))),
            ),
          ),
  );

  const revokeLink = (linkId: string): Effect.Effect<void, ApiFailure> =>
    groupId === undefined
      ? Effect.void
      : fromApi(() => revokeGroupInviteLink(groupId, linkId)).pipe(
          Effect.tap(() => Effect.sync(() => refreshLinks())),
          Effect.tapError((failure) =>
            Effect.sync(() => setLinksError(failureText(failure, 'Could not revoke the link.'))),
          ),
        );

  const eligibleAis = myAis.filter(
    (ai) => ai.status === 'active' && info?.ais.some((item) => item.aiId === ai.id) !== true,
  );

  useEffect(() => {
    storeApi.getState().refreshGroupInfo(chat.id);
  }, [storeApi, chat.id]);

  const [addState, addAi] = useAction<string, void, ChannelFailure>((aiId) =>
    Effect.sync(() => setErrorMessage('')).pipe(
      Effect.andThen(
        storeCall(() => storeApi.getState().addGroupAi(chat.id, aiId), 'Could not add the AI'),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          setPickerOpen(false);
          setConfirmingId(undefined);
        }),
      ),
      Effect.asVoid,
      Effect.tapError((failure) =>
        Effect.sync(() => setErrorMessage(describeFailure(failure, 'Could not add the AI'))),
      ),
    ),
  );
  const addingId = isWaiting(addState) ? pendingAiId : undefined;
  const pickAi = (aiId: string): void => {
    setPendingAiId(aiId);
    addAi(aiId);
  };

  const [leaveState, leave] = useAction<void, void, ChannelFailure>(() =>
    Effect.sync(() => setLeaveError('')).pipe(
      Effect.andThen(
        storeCall(() => storeApi.getState().leaveChannel(chat.id), 'Could not leave the channel.'),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          onClose();
          navigate('/');
        }),
      ),
      Effect.asVoid,
      Effect.tapError((failure) =>
        Effect.sync(() => setLeaveError(failureText(failure, 'Could not leave the channel.'))),
      ),
    ),
  );
  const leaving = isWaiting(leaveState);

  const [roleState, flipRole] = useAction<
    { userId: string; role: 'admin' | 'member' },
    void,
    ChannelFailure
  >(({ userId, role }) =>
    Effect.sync(() => setRoleError('')).pipe(
      Effect.andThen(
        storeCall(
          () => storeApi.getState().changeChannelRole(chat.id, userId, role),
          'Could not change the role.',
        ),
      ),
      Effect.asVoid,
      Effect.tapError((failure) =>
        Effect.sync(() => setRoleError(failureText(failure, 'Could not change the role.'))),
      ),
    ),
  );
  const roleBusy = isWaiting(roleState);

  const ownerName = (ai: GroupAi): string =>
    info?.members.find((member) => member.userId === ai.ownerId)?.name ??
    adminsList.find((member) => member.userId === ai.ownerId)?.name ??
    'someone';

  const audience = isManager ? (info?.members ?? []) : [];
  const admins = isManager ? audience.filter((member) => member.role !== 'member') : adminsList;
  const adminsLoaded = AsyncResult.isSuccess(adminsQuery);

  return (
    <Sheet open onClose={onClose} ariaLabel={`${chat.title} channel info`}>
      {page === 'root' ? (
        <ChannelInfoRoot
          chat={chat}
          title={chat.title}
          groupId={groupId}
          count={count}
          handle={info?.handle ?? null}
          description={description}
          adminsCount={isManager ? admins.length : adminsLoaded ? adminsList.length : undefined}
          aisCount={info?.ais.length ?? 0}
          linksCount={isManager ? linksList.length : undefined}
          isManager={isManager}
          isOwner={isOwner}
          canLeave={!isManager}
          leaving={leaving}
          leaveError={leaveError}
          onLeave={() => leave()}
          onClose={onClose}
          onSearch={onSearch}
          onOpenMedia={onOpenMedia}
          onOpenPage={setPage}
        />
      ) : (
        <GroupInfoPage
          title={CHANNEL_INFO_TITLES[page]}
          noun="channel"
          onBack={() => setPage('root')}
          onClose={onClose}
        >
          {info === undefined ? (
            <StateMessage kind="loading" size="inline" title="Loading…" />
          ) : (
            <>
              {page === 'admins' && (
                <ChannelAdminsPage
                  admins={admins}
                  loading={isManager ? false : !adminsLoaded && adminsFailure === undefined}
                  failure={isManager ? undefined : adminsFailure}
                />
              )}

              {page === 'subscribers' && isManager && (
                <ChannelSubscribersPage
                  members={audience}
                  me={me}
                  isOwner={isOwner}
                  roleBusy={roleBusy}
                  flipRole={flipRole}
                  roleError={roleError}
                />
              )}

              {page === 'ais' && (
                <ChannelAisPage
                  chatId={chat.id}
                  ais={info.ais}
                  ownerNameOf={ownerName}
                  canRemove={(ai) => ai.ownerId === me || isManager}
                  isManager={isManager}
                  eligibleAis={eligibleAis}
                  pickerOpen={pickerOpen}
                  addingId={addingId}
                  onPick={pickAi}
                  onOpenPicker={() => setPickerOpen(true)}
                  onClosePicker={() => setPickerOpen(false)}
                  confirmingId={confirmingId}
                  onConfirm={setConfirmingId}
                  errorMessage={errorMessage}
                  onError={setErrorMessage}
                />
              )}

              {page === 'links' && isManager && (
                <InviteLinksSection
                  links={linksList}
                  busy={isWaiting(createState)}
                  error={linksError}
                  created={createdLink === undefined ? undefined : { url: createdLink.url }}
                  onCreate={(input) => createLink(input)}
                  onRevoke={revokeLink}
                  onDismissCreated={() => setCreatedLink(undefined)}
                />
              )}

              {page === 'activity' && isManager && <ActivitySection scope={{ groupId: info.id }} />}

              {page === 'allowed' && isManager && (
                <AlwaysAllowedList scope={{ groupId: info.id }} />
              )}

              {page === 'settings' && isOwner && <GroupVisibilitySetting chat={chat} info={info} />}
            </>
          )}
        </GroupInfoPage>
      )}
    </Sheet>
  );
}

function GroupAiRow({
  chatId,
  ai,
  addedBy,
  canRemove,
  confirming,
  onConfirm,
  onError,
}: {
  chatId: string;
  ai: GroupAi;
  addedBy: string;
  canRemove: boolean;
  confirming: boolean;
  onConfirm: (aiId: string | undefined) => void;
  onError: (message: string) => void;
}) {
  const storeApi = useChatStoreApi();
  const [removeState, removeAi] = useAction<void, void, ChannelFailure>(() =>
    Effect.sync(() => onError('')).pipe(
      Effect.andThen(
        storeCall(
          () => storeApi.getState().removeGroupAi(chatId, ai.aiId),
          'Could not remove the AI',
        ),
      ),
      Effect.tap(() => Effect.sync(() => onConfirm(undefined))),
      Effect.asVoid,
      Effect.tapError((failure) =>
        Effect.sync(() => onError(describeFailure(failure, 'Could not remove the AI'))),
      ),
    ),
  );
  const removing = isWaiting(removeState);

  return (
    <GroupAiRowView
      ai={ai}
      addedBy={addedBy}
      canRemove={canRemove}
      confirming={confirming}
      busy={removing}
      removeLabel={`Remove ${ai.name} from the channel`}
      onAskRemove={() => onConfirm(ai.aiId)}
      onConfirmRemove={() => removeAi()}
      onCancel={() => onConfirm(undefined)}
    />
  );
}

function ChannelAisPage({
  chatId,
  ais,
  ownerNameOf,
  canRemove,
  isManager,
  eligibleAis,
  pickerOpen,
  addingId,
  onPick,
  onOpenPicker,
  onClosePicker,
  confirmingId,
  onConfirm,
  errorMessage,
  onError,
}: {
  chatId: string;
  ais: GroupAi[];
  ownerNameOf: (ai: GroupAi) => string;
  canRemove: (ai: GroupAi) => boolean;
  isManager: boolean;
  eligibleAis: PublicAi[];
  pickerOpen: boolean;
  addingId: string | undefined;
  onPick: (aiId: string) => void;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  confirmingId: string | undefined;
  onConfirm: (aiId: string | undefined) => void;
  errorMessage: string;
  onError: (message: string) => void;
}) {
  return (
    <section aria-label="AIs" className="flex flex-col gap-1">
      <SectionLabel>AIs</SectionLabel>
      {ais.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">No AIs post in this channel yet.</p>
      )}
      {ais.map((ai) => (
        <GroupAiRow
          key={ai.aiId}
          chatId={chatId}
          ai={ai}
          addedBy={ownerNameOf(ai)}
          canRemove={canRemove(ai)}
          confirming={confirmingId === ai.aiId}
          onConfirm={onConfirm}
          onError={onError}
        />
      ))}

      {isManager && eligibleAis.length > 0 && (
        <div className="mt-1 flex flex-col gap-2 px-2">
          <p className="text-[12px] text-muted-foreground">
            An AI posts here only when its owner is a channel admin.
          </p>
          {pickerOpen ? (
            <div className="flex flex-col gap-1">
              {eligibleAis.map((ai) => (
                <Button
                  key={ai.id}
                  type="button"
                  variant="outline"
                  disabled={addingId !== undefined}
                  onClick={() => onPick(ai.id)}
                  className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
                >
                  <EntityAvatar
                    person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
                    size={28}
                    ai
                  />
                  <span className="min-w-0 flex-1 truncate">{ai.name}</span>
                  <AiBadge />
                  {addingId === ai.id && (
                    <span className="text-[12px] text-muted-foreground">Adding…</span>
                  )}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                disabled={addingId !== undefined}
                onClick={onClosePicker}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="lg"
              className="self-start rounded-full px-4"
              onClick={onOpenPicker}
            >
              Add my AI
            </Button>
          )}
        </div>
      )}

      {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
    </section>
  );
}
