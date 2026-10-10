import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Image, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CreatedInviteLink, GroupAi, GroupInviteLink, GroupRole, PublicAi } from '@/lib/api';
import { createGroupInviteLink, revokeGroupInviteLink } from '@/lib/api';
import { runWeb } from '@/lib/effect/runtime';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { HandleSuffix } from './HandleSuffix';
import { ActivitySection } from './ais/AiActivity';
import { AiMemoryDialog } from './ais/AiMemoryDialog';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { PinsSection } from './PinsPanel';
import { ChatBackgroundDialog } from './ChatBackgroundDialog';
import { FieldError } from './ais/AiPageShell';
import { Avatar } from './Avatar';
import { Button } from './ui/button';
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
import { roleLabel } from './panels/role-label';

/**
 * The group info panel: the people, the AIs (with their owner), add one of my
 * AIs, remove one. It slides in from the right on wide screens and fills the
 * screen on narrow ones, opened with `?panel=group` (T-0055).
 */
export function GroupPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
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

  return (
    <Sheet open onClose={onClose} ariaLabel={`${chat.title} info`}>
      <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
        <Avatar id={chat.id} name={chat.title} size={44} avatarUrl={chat.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold">{chat.title}</div>
          <p className="text-[13px] text-muted-foreground">
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label="Close group panel"
          onClick={onClose}
          className="shrink-0 rounded-full text-muted-foreground"
        >
          <X className="size-5" aria-hidden="true" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {info === undefined && <StateMessage kind="loading" size="inline" title="Loading…" />}

        {info !== undefined && (
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
            <section aria-label="Members" className="flex flex-col gap-1">
              <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Members</h2>
              {info.members.map((member) => {
                const label = roleLabel(member.role);
                // Role chips for everyone (T-0116): the fresh roles list
                // wins over the group detail's snapshot when both name a
                // holder, so the chips stay right after an assignment.
                const chipRoles = rolesByUser.get(member.userId) ?? member.roles ?? [];
                return (
                  <div
                    key={member.userId}
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
                  >
                    <Avatar
                      id={member.userId}
                      name={member.name}
                      size={32}
                      avatarUrl={member.avatarUrl}
                    />
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      {member.name} <HandleSuffix handle={member.handle} />
                    </span>
                    {chipRoles.map((role) => (
                      <span
                        key={role.id}
                        className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground"
                      >
                        {role.name}
                      </span>
                    ))}
                    {label !== undefined && (
                      <span className="font-mono rounded-[5px] border border-badge-muted px-1 text-[10px] leading-[15px] text-muted-foreground">
                        {label}
                      </span>
                    )}
                  </div>
                );
              })}
            </section>

            {/* T-0116: custom group roles — managers only. Everyone sees
                  the chips next to the member names above. */}
            {isManager && info !== undefined && (
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

            {/* T-0086: room activity for owners and admins. Plain members
                  get no section and no request is made. The section handles
                  its own load / error states; a failure here cannot break
                  the rest of the panel. */}
            {isManager && <ActivitySection scope={{ groupId: info.id }} />}

            {/* T-0100: the standing rules for this group, same visibility
                  as Activity — owners and admins only. */}
            {isManager && <AlwaysAllowedList scope={{ groupId: info.id }} />}

            {/* T-0107: tools and routines of the group (General). Plain
                  members read; managers get the actions. */}
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

            <PinsSection
              chatId={chat.id}
              onOpen={() => storeApi.getState().setPinsPanel(chat.id)}
            />

            {/* T-0115: shareable invite links, same visibility —
                  owners and admins only. */}
            {isManager && (
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

            {/* T-0111: "Members can create topics", same visibility —
                  owners and admins only. */}
            {isManager && (
              <GroupTopicSetting chatId={chat.id} canCreateTopics={info.membersCanCreateTopics} />
            )}

            {/* T-0478: the AI listener switch and eagerness, same visibility —
                  owners and admins only. */}
            {isManager && (
              <GroupListenerSetting
                chatId={chat.id}
                enabled={info.listener?.enabled === true}
                available={info.listener?.available === true}
                eagerness={info.listener?.eagerness ?? 'normal'}
              />
            )}

            {/* T-0466: the group's shared background, same visibility —
                  owners and admins only. */}
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

            {/* T-0164: public visibility with a handle — the owner only.
                  Going private removes the group from Explore at once;
                  going public puts it in the directory with one tap join. */}
            {isOwner && (
              <VisibilitySection
                chatId={chat.id}
                groupId={info.id}
                visibility={info.visibility ?? 'private'}
                handle={info.handle ?? null}
                title={info.title}
              />
            )}

            {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}

            {isManager && info !== undefined && (
              <ChatBackgroundDialog
                chat={chat}
                groupId={info.id}
                open={backgroundOpen}
                onClose={() => setBackgroundOpen(false)}
              />
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
