import type { ChatSummary } from '@zilar/chat-core';
import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Brain, Image, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  CreatedInviteLink,
  GroupAi,
  GroupInviteLink,
  GroupRole,
  ListenerEagerness,
  PublicAi,
  SetGroupListenerInput,
} from '@/lib/api';
import {
  createGroupInviteLink,
  createGroupRole,
  deleteGroupRole,
  listGroupInviteLinks,
  listGroupRoles,
  renameGroupRole,
  revokeGroupInviteLink,
  setGroupRoleMembers,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { runWeb } from '@/lib/effect/runtime';
import { failureOf, isWaiting, useAction, type ActionState } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { HandleSuffix } from './HandleSuffix';
import { ActivitySection } from './ais/AiActivity';
import { AiMemoryDialog } from './ais/AiMemoryDialog';
import { AlwaysAllowedList } from './approvals/AlwaysAllowedList';
import { PinsSection } from './PinsPanel';
import { AiBadge } from './AiBadge';
import { AvatarUploader } from './AvatarUploader';
import { ChatBackgroundDialog } from './ChatBackgroundDialog';
import { FieldError } from './ais/AiPageShell';
import { describeAiError } from './ais/errors';
import { Avatar } from './Avatar';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { ListRow } from './ui/list-row';
import { Sheet } from './ui/sheet';
import { SegmentedControl } from './ui/segmented-control';
import { StateMessage } from './ui/state-message';
import { Switch } from './ui/switch';
import { TextInput } from './ui/text-input';
import { InviteLinksSection } from './InviteLinksSection';
import { RoutinesSection } from './tools/RoutinesSection';
import { ToolsSection } from './tools/ToolsSection';
import { VisibilitySection } from './VisibilitySection';

function roleLabel(role: 'owner' | 'admin' | 'member'): string | undefined {
  return role === 'member' ? undefined : role;
}

/** A failed panel action; `message` is the sentence the panel shows. */
class PanelFailure extends Data.TaggedError('PanelFailure')<{ readonly message: string }> {}

/**
 * The sentence for a failed API call: the server's message, or the fallback
 * when the call never reached the server (`toApiFailure` marks that case).
 */
function apiFailureText(failure: ApiFailure, fallback: string): string {
  return failure.code === 'unknown_error' ? fallback : failure.message;
}

/** An API call whose failure shows `fallback` unless the server sent a message. */
function apiStep<A>(call: () => Promise<A>, fallback: string): Effect.Effect<A, PanelFailure> {
  return fromApi(call).pipe(
    Effect.mapError((failure) => new PanelFailure({ message: apiFailureText(failure, fallback) })),
  );
}

/**
 * A store call. The store throws the raw error, so `textOf` builds the
 * sentence from that error (the text the panel showed before the move).
 */
function storeStep<A>(
  call: () => Promise<A>,
  textOf: (error: unknown) => string,
): Effect.Effect<A, PanelFailure> {
  return Effect.tryPromise({
    try: call,
    catch: (error) => new PanelFailure({ message: textOf(error) }),
  });
}

function settingText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not save the setting.';
}

function addAiText(error: unknown): string {
  return describeAiError(error, 'Could not add the AI').message;
}

function removeAiText(error: unknown): string {
  return describeAiError(error, 'Could not remove the AI').message;
}

/** The shown failure of the last call; hidden while a new call runs. */
function messageOf<A>(state: ActionState<A, PanelFailure>): string | undefined {
  return isWaiting(state) ? undefined : failureOf(state)?.message;
}

/** The invite links, for managers only; a plain member makes no request. */
function loadLinks(
  manager: boolean,
  groupId: string | undefined,
): Effect.Effect<GroupInviteLink[], PanelFailure> {
  if (!manager || groupId === undefined) {
    return Effect.succeed([]);
  }
  return fromApi(() => listGroupInviteLinks(groupId)).pipe(
    Effect.mapError(() => new PanelFailure({ message: 'Could not load the invite links.' })),
  );
}

/** The group's roles. With no group yet the load waits, so the section reads as loading. */
function loadRoles(groupId: string | undefined): Effect.Effect<GroupRole[], PanelFailure> {
  if (groupId === undefined) {
    return Effect.never;
  }
  return apiStep(() => listGroupRoles(groupId), 'Could not load the roles.');
}

type RolesView = { status: 'loading' | 'ready' | 'error'; roles: GroupRole[]; message: string };

function rolesViewOf(result: AsyncResult.AsyncResult<GroupRole[], PanelFailure>): RolesView {
  if (isWaiting(result) || AsyncResult.isInitial(result)) {
    return { status: 'loading', roles: [], message: '' };
  }
  if (AsyncResult.isSuccess(result)) {
    return { status: 'ready', roles: result.value, message: '' };
  }
  return { status: 'error', roles: [], message: failureOf(result)?.message ?? '' };
}

/**
 * The group info panel: the people, the AIs (with their owner), add one of my
 * AIs, remove one. It slides in from the right on wide screens and fills the
 * screen on narrow ones, opened with `?panel=group` (T-0055).
 */
export function GroupPanel({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const storeApi = useChatStoreApi();
  const store = useChatStore();

  const info = store.groupInfo(chat.id);
  const me = store.currentUserId;
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

  const [switchState, setTopicsAllowed] = useAction<boolean, void, PanelFailure>((allowed) =>
    storeStep(
      () => storeApi.getState().setMembersCanCreateTopics(chat.id, allowed),
      settingText,
    ).pipe(Effect.asVoid),
  );
  const switchBusy = isWaiting(switchState);
  const switchError = messageOf(switchState) ?? '';

  const flipTopicSwitch = (): void => {
    if (info !== undefined) {
      setTopicsAllowed(info.membersCanCreateTopics !== true);
    }
  };

  // T-0478: the listener switch and eagerness. Both go through
  // `setGroupListener`; the store refreshes the detail on success and an
  // inline error shows on failure, exactly like the topic switch.
  const listenerEnabled = info?.listener?.enabled === true;
  const listenerAvailable = info?.listener?.available === true;

  const [listenerState, saveListener] = useAction<SetGroupListenerInput, void, PanelFailure>(
    (input) =>
      storeStep(() => storeApi.getState().setGroupListener(chat.id, input), settingText).pipe(
        Effect.asVoid,
      ),
  );
  const listenerBusy = isWaiting(listenerState);
  const listenerError = messageOf(listenerState) ?? '';

  const flipListenerSwitch = (): void => {
    if (info !== undefined && listenerAvailable) {
      saveListener({ listenerEnabled: !listenerEnabled });
    }
  };

  const chooseEagerness = (eagerness: ListenerEagerness): void => {
    if (info !== undefined && listenerAvailable) {
      saveListener({ listenerEagerness: eagerness });
    }
  };

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
              <RolesSection
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

            <section aria-label="AIs" className="flex flex-col gap-1">
              <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">AIs</h2>
              {info.ais.length === 0 && (
                <p className="px-2 text-[13px] text-muted-foreground">No AIs in this group yet.</p>
              )}
              {info.ais.map((ai) => (
                <GroupAiRow
                  key={ai.aiId}
                  ai={ai}
                  chatId={chat.id}
                  ownerName={ownerName(ai)}
                  canRemove={ai.ownerId === me || isManager}
                  onOpenMemory={() => setMemoryAi({ id: ai.aiId, name: ai.name })}
                  onError={setErrorMessage}
                />
              ))}

              {isManager && (eligibleAis.length > 0 || pickerChoices !== undefined) && (
                <div className="mt-1 flex flex-col gap-2 px-2">
                  {pickerChoices !== undefined ? (
                    <div className="flex flex-col gap-1">
                      {pickerChoices.map((ai) => (
                        <AddAiOption
                          key={ai.id}
                          ai={ai}
                          chatId={chat.id}
                          onAdded={() => setPickerChoices(undefined)}
                          onError={setErrorMessage}
                        />
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        onClick={() => setPickerChoices(undefined)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="lg"
                      className="self-start rounded-full px-4"
                      onClick={() => setPickerChoices(eligibleAis)}
                    >
                      Add my AI
                    </Button>
                  )}
                </div>
              )}
            </section>

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
              <section aria-label="Topic settings" className="flex flex-col gap-2 px-2">
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-list-hover">
                  <span className="text-[14px]">Members can create topics</span>
                  <Switch
                    checked={info.membersCanCreateTopics === true}
                    onCheckedChange={() => flipTopicSwitch()}
                    label="Members can create topics"
                    hideLabel
                    disabled={switchBusy}
                  />
                </label>
                {switchError !== '' && <FieldError>{switchError}</FieldError>}
              </section>
            )}

            {/* T-0478: the AI listener switch and eagerness, same visibility —
                  owners and admins only. */}
            {isManager && (
              <section aria-label="AI listener" className="flex flex-col gap-2 px-2">
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-list-hover">
                  <span className="text-[14px]">Let AIs answer without @mention</span>
                  <Switch
                    checked={listenerEnabled}
                    onCheckedChange={() => flipListenerSwitch()}
                    label="Let AIs answer without @mention"
                    hideLabel
                    disabled={!listenerAvailable || listenerBusy}
                  />
                </label>
                {listenerEnabled && (
                  <fieldset
                    disabled={!listenerAvailable || listenerBusy}
                    className="m-0 min-w-0 border-0 p-0"
                  >
                    <SegmentedControl
                      options={[
                        { value: 'quiet', label: 'Quiet' },
                        { value: 'normal', label: 'Normal' },
                        { value: 'eager', label: 'Eager' },
                      ]}
                      value={info.listener?.eagerness ?? 'normal'}
                      onChange={(value) => chooseEagerness(value as ListenerEagerness)}
                      ariaLabel="Eagerness"
                      mode="radio"
                    />
                  </fieldset>
                )}
                <p className="px-2 text-[13px] text-muted-foreground">
                  {listenerAvailable
                    ? 'Normal suits most groups. Quiet wakes AIs only for clear asks.'
                    : 'Turned off on this server'}
                </p>
                {listenerError !== '' && <FieldError>{listenerError}</FieldError>}
              </section>
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

/**
 * One AI in the group, with its own Remove action so two AIs can be removed
 * at once; a second click on the same row waits for the first.
 */
function GroupAiRow({
  ai,
  chatId,
  ownerName,
  canRemove,
  onOpenMemory,
  onError,
}: {
  ai: GroupAi;
  chatId: string;
  ownerName: string;
  canRemove: boolean;
  onOpenMemory: () => void;
  onError: (message: string) => void;
}) {
  const storeApi = useChatStoreApi();
  const [confirming, setConfirming] = useState(false);
  const [state, removeAi] = useAction<void, void, PanelFailure>(() =>
    storeStep(() => storeApi.getState().removeGroupAi(chatId, ai.aiId), removeAiText).pipe(
      Effect.asVoid,
      Effect.tap(() => Effect.sync(() => setConfirming(false))),
      Effect.tapError((failure) => Effect.sync(() => onError(failure.message))),
    ),
  );
  const busy = isWaiting(state);
  const startRemove = (): void => {
    if (busy) {
      return;
    }
    onError('');
    removeAi();
  };

  return (
    <div className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover">
      <Avatar id={ai.jid} name={ai.name} size={32} ai avatarUrl={ai.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px]">{ai.name}</span>
          <AiBadge />
        </div>
        <p className="truncate text-[12px] text-muted-foreground">Added by {ownerName}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`What ${ai.name} remembers`}
        className="shrink-0 text-muted-foreground"
        onClick={onOpenMemory}
      >
        <Brain className="size-4" aria-hidden="true" />
      </Button>
      {canRemove &&
        (confirming ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              aria-label={`Confirm removing ${ai.name}`}
              disabled={busy}
              onClick={startRemove}
            >
              {busy ? 'Removing…' : 'Remove'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Remove ${ai.name} from the group`}
            className="shrink-0"
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        ))}
    </div>
  );
}

/**
 * One of my AIs in the add picker, with its own add action so two options
 * can run at once; a second click on the same option waits for the first.
 */
function AddAiOption({
  ai,
  chatId,
  onAdded,
  onError,
}: {
  ai: PublicAi;
  chatId: string;
  onAdded: () => void;
  onError: (message: string) => void;
}) {
  const storeApi = useChatStoreApi();
  const [state, addAi] = useAction<void, void, PanelFailure>(() =>
    storeStep(() => storeApi.getState().addGroupAi(chatId, ai.id), addAiText).pipe(
      Effect.asVoid,
      Effect.tap(() => Effect.sync(onAdded)),
      Effect.tapError((failure) => Effect.sync(() => onError(failure.message))),
    ),
  );
  const busy = isWaiting(state);
  const startAdd = (): void => {
    if (busy) {
      return;
    }
    onError('');
    addAi();
  };

  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={startAdd}
      className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
    >
      <Avatar id={ai.jid} name={ai.name} size={28} ai avatarUrl={ai.avatarUrl} />
      <span className="min-w-0 flex-1 truncate">{ai.name}</span>
      <AiBadge />
      {busy && <span className="text-[12px] text-muted-foreground">Adding…</span>}
    </Button>
  );
}

/**
 * The group's picture (T-0165), for owners and admins. Refreshes the
 * group's chats from the server after a change (the uploader reports the
 * new url or undefined), so the list and header show it at once.
 */
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
  // The uploader reports the new url (or undefined after a remove) through
  // `onChanged`; while no change happened this render, the server row wins.
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

/**
 * Custom group roles for managers (T-0116): create, rename, delete, and
 * assign with a member multi-select. A role grants private-topic access and
 * approver rights in the topics it is attached to — picked per topic in
 * the topic panel, not here.
 */
function RolesSection({
  groupId,
  members,
  rolesState,
  onReload,
}: {
  groupId: string;
  members: Array<{ userId: string; name: string; avatarUrl?: string | undefined }>;
  rolesState: { status: 'loading' | 'ready' | 'error'; roles: GroupRole[]; message: string };
  onReload: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [assigningId, setAssigningId] = useState<string | undefined>(undefined);
  // One action for the section, as before: every role button is disabled
  // while a change runs, and the roles reload after each success.
  const [changeState, runChange] = useAction<Effect.Effect<void, PanelFailure>, void, PanelFailure>(
    (change) => change.pipe(Effect.tap(() => Effect.sync(onReload))),
  );
  const busy = isWaiting(changeState);
  const errorMessage = messageOf(changeState) ?? '';

  const create = (): void => {
    const name = newName.trim();
    runChange(
      name === ''
        ? Effect.fail(new PanelFailure({ message: 'Enter a role name.' }))
        : apiStep(
            () => createGroupRole(groupId, name.slice(0, 30)),
            'Could not save the roles.',
          ).pipe(Effect.tap(() => Effect.sync(() => setNewName('')))),
    );
  };

  const rename = (roleId: string): void => {
    const name = renameValue.trim();
    runChange(
      name === ''
        ? Effect.fail(new PanelFailure({ message: 'Enter a role name.' }))
        : apiStep(
            () => renameGroupRole(groupId, roleId, name.slice(0, 30)),
            'Could not save the roles.',
          ).pipe(Effect.tap(() => Effect.sync(() => setRenamingId(undefined)))),
    );
  };

  const remove = (roleId: string): void => {
    runChange(
      apiStep(() => deleteGroupRole(groupId, roleId), 'Could not save the roles.').pipe(
        Effect.tap(() => Effect.sync(() => setConfirmingId(undefined))),
      ),
    );
  };

  const toggleHolder = (role: GroupRole, userId: string): void => {
    const held = role.members.some((holder) => holder.userId === userId);
    const userIds = held
      ? role.members.filter((holder) => holder.userId !== userId).map((holder) => holder.userId)
      : [...role.members.map((holder) => holder.userId), userId];
    runChange(
      apiStep(
        () => setGroupRoleMembers(groupId, role.id, userIds),
        'Could not save the roles.',
      ).pipe(Effect.asVoid),
    );
  };

  return (
    <section aria-label="Roles" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Roles</h2>
      {rolesState.status === 'loading' && (
        <StateMessage kind="loading" size="inline" title="Loading…" />
      )}
      {rolesState.status === 'error' && (
        <div className="flex flex-col gap-2 px-2">
          <FieldError>{rolesState.message}</FieldError>
          <Button
            type="button"
            size="lg"
            className="self-start rounded-full px-4"
            onClick={onReload}
          >
            Retry
          </Button>
        </div>
      )}
      {rolesState.status === 'ready' && rolesState.roles.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">
          No roles yet. Roles grant private-topic access and approver rights.
        </p>
      )}
      {rolesState.status === 'ready' &&
        rolesState.roles.map((role) => {
          const renaming = renamingId === role.id;
          const confirming = confirmingId === role.id;
          const assigning = assigningId === role.id;
          return (
            <div key={role.id} className="flex flex-col gap-1 rounded-xl px-2 py-1.5">
              <div className="flex items-center gap-2">
                {renaming ? (
                  <TextInput
                    aria-label={`Rename ${role.name}`}
                    value={renameValue}
                    maxLength={30}
                    onChange={(event) => setRenameValue(event.target.value)}
                    className="min-w-0 flex-1"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                    {role.name} ({role.members.length})
                  </span>
                )}
                {renaming ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => rename(role.id)}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setRenamingId(undefined)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : confirming ? (
                  <>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={`Confirm deleting ${role.name}`}
                      disabled={busy}
                      onClick={() => remove(role.id)}
                    >
                      Delete
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmingId(undefined)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Assign ${role.name}`}
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => setAssigningId(assigning ? undefined : role.id)}
                    >
                      Assign
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Rename ${role.name}`}
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => {
                        setRenameValue(role.name);
                        setRenamingId(role.id);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${role.name}`}
                      className="shrink-0"
                      disabled={busy}
                      onClick={() => setConfirmingId(role.id)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
              {assigning && !renaming && !confirming && (
                <div className="flex flex-col gap-1 pl-1">
                  {members.map((member) => {
                    const checked = role.members.some((holder) => holder.userId === member.userId);
                    return (
                      <label
                        key={member.userId}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-list-hover"
                      >
                        <Checkbox
                          checked={checked}
                          disabled={busy}
                          label={`${member.name} holds ${role.name}`}
                          onCheckedChange={() => toggleHolder(role, member.userId)}
                        />
                        <Avatar
                          id={member.userId}
                          name={member.name}
                          size={28}
                          avatarUrl={member.avatarUrl}
                        />
                        <span className="min-w-0 flex-1 truncate text-[14px]">{member.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      <div className="mt-1 flex items-center gap-2 px-2">
        <TextInput
          aria-label="New role name"
          value={newName}
          maxLength={30}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="e.g. Designers"
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          size="lg"
          className="shrink-0 rounded-full px-4"
          disabled={busy || newName.trim() === ''}
          onClick={() => create()}
        >
          {busy ? 'Saving…' : 'Add role'}
        </Button>
      </div>
      {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
    </section>
  );
}
