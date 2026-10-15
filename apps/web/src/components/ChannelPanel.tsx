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
} from '@/lib/api';
import {
  createGroupInviteLink,
  listGroupInviteLinks,
  listGroupMembers,
  revokeGroupInviteLink,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { ActivitySection } from './ais/AiActivity';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { InviteLinksSection } from './InviteLinksSection';
import { VisibilitySection } from './VisibilitySection';
import { ChannelAisPage } from './channel-info/ChannelAisPage';
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
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';

/**
 * The channel info panel (T-0124): a root page with the picture, the count and
 * the Mute / Search / Share / More keys over the grouped lists, and one subpage
 * per row holding the sections that used to stack in a single scroll (T-1519).
 * The subscriber audience is visible to managers only — subscribers see the
 * count plus who posts (the admins slice, which is public the way every admin
 * post carries its name), never the audience.
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

  // T-0124: subscribers never see the audience (`GET /api/groups/:id`
  // strips `members` for them), but the Admins page still names who posts:
  // the members endpoint answers the admins slice to subscribers
  // (owner/admins only — who posts is public, every admin post carries its
  // name — while the subscriber audience stays hidden). Managers read the
  // full list from the detail they already hold, so no second request.
  // Nothing to load for a manager or before the group is known: Effect.never.
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

  // The InviteLinksSection row waits for this Effect, so its button stays busy
  // until the DELETE settles (T-0141).
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
  // Every picker button waits on the one add in flight, which is the one picked.
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

  // The audience list: managers see everyone (names + roles) from the detail;
  // subscribers see only who posts (the admins slice, loaded above) — the
  // subscriber audience stays hidden everywhere.
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

              {/* T-0086: room activity, owners and admins only. */}
              {page === 'activity' && isManager && <ActivitySection scope={{ groupId: info.id }} />}

              {/* T-0100: the standing rules for this channel, managers only. */}
              {page === 'allowed' && isManager && (
                <AlwaysAllowedList scope={{ groupId: info.id }} />
              )}

              {/* T-0164: public visibility with a handle — the owner only. */}
              {page === 'settings' && isOwner && (
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
        </GroupInfoPage>
      )}
    </Sheet>
  );
}
