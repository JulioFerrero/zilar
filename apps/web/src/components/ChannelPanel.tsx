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
import { PinsSection } from './PinsPanel';
import { AiBadge } from './AiBadge';
import { FieldError } from './ais/AiPageShell';
import { Avatar } from './Avatar';
import { Button } from './ui/button';
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';
import { InviteLinksSection } from './InviteLinksSection';
import { VisibilitySection } from './VisibilitySection';
import { ChannelAdminsSection, GroupAiRow } from './panels/ChannelAdminsSection';
import { ChannelHeader } from './panels/ChannelHeader';
import {
  type ChannelFailure,
  describeFailure,
  failureText,
  storeCall,
} from './panels/channelPanelOps';

/**
 * The channel info panel (T-0124): the feed's description, the subscriber
 * count, invite links (admins), admins management (owner), the AIs that post
 * (admin-level, voice-gated by the room), and Leave channel for subscribers.
 * The subscriber audience is visible to admins only — subscribers see the
 * count plus who posts (the admins slice, which is public the way every
 * admin post carries its name), never the audience.
 */
export function ChannelPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
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
  // strips `members` for them), but the Admins section still names who
  // posts: the members endpoint answers the admins slice to subscribers
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

  // The audience list: admins see everyone (names + roles) from the detail;
  // subscribers see only who posts (the admins slice, loaded above) — the
  // subscriber audience stays hidden everywhere.
  const audience = isManager ? (info?.members ?? []) : [];
  const admins = isManager ? audience.filter((member) => member.role !== 'member') : adminsList;
  const adminsLoaded = AsyncResult.isSuccess(adminsQuery);

  return (
    <Sheet open onClose={onClose} ariaLabel={`${chat.title} channel info`}>
      <ChannelHeader chat={chat} count={count} onClose={onClose} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {description !== null && description !== '' && (
          <section aria-label="Description" className="px-2">
            <p className="text-[14px] text-muted-foreground">{description}</p>
          </section>
        )}

        {info === undefined && <StateMessage kind="loading" size="inline" title="Loading…" />}

        {info !== undefined && (
          <>
            <ChannelAdminsSection
              isManager={isManager}
              audience={audience}
              isOwner={isOwner}
              me={me}
              roleBusy={roleBusy}
              flipRole={flipRole}
              roleError={roleError}
              adminsLoaded={adminsLoaded}
              adminsFailure={adminsFailure}
              admins={admins}
            />

            <section aria-label="AIs" className="flex flex-col gap-1">
              <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">AIs</h2>
              {info.ais.length === 0 && (
                <p className="px-2 text-[13px] text-muted-foreground">
                  No AIs post in this channel yet.
                </p>
              )}
              {info.ais.map((ai) => (
                <GroupAiRow
                  key={ai.aiId}
                  chatId={chat.id}
                  ai={ai}
                  addedBy={ownerName(ai)}
                  canRemove={ai.ownerId === me || isManager}
                  confirming={confirmingId === ai.aiId}
                  onConfirm={setConfirmingId}
                  onError={setErrorMessage}
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
                          onClick={() => pickAi(ai.id)}
                          className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
                        >
                          <Avatar
                            id={ai.jid}
                            name={ai.name}
                            size={28}
                            ai
                            avatarUrl={ai.avatarUrl}
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
                        onClick={() => setPickerOpen(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="lg"
                      className="self-start rounded-full px-4"
                      onClick={() => setPickerOpen(true)}
                    >
                      Add my AI
                    </Button>
                  )}
                </div>
              )}
            </section>

            {isManager && <ActivitySection scope={{ groupId: info.id }} />}

            {isManager && <AlwaysAllowedList scope={{ groupId: info.id }} />}

            <PinsSection
              chatId={chat.id}
              onOpen={() => storeApi.getState().setPinsPanel(chat.id)}
            />

            {isManager && (
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

            {/* T-0164: public visibility with a handle — the owner only. */}
            {isOwner && info !== undefined && (
              <VisibilitySection
                chatId={chat.id}
                groupId={info.id}
                visibility={info.visibility ?? 'private'}
                handle={info.handle ?? null}
                title={info.title}
              />
            )}

            {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}

            {!isManager && (
              <div className="flex flex-col gap-2 px-2">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="self-start rounded-full px-4"
                  disabled={leaving}
                  onClick={() => leave()}
                >
                  {leaving ? 'Leaving…' : 'Leave channel'}
                </Button>
                {leaveError !== '' && <FieldError>{leaveError}</FieldError>}
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
