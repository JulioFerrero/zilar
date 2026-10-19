import { EntityAvatar } from './EntityAvatar';
import { HandleSuffix } from './HandleSuffix';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogStepper } from './ui/dialog';
import { SearchField } from './ui/search-field';
import { SegmentedControl } from './ui/segmented-control';
import {
  checkHandleAvailability,
  handleReasonText,
  IDLE_AVAILABILITY,
  type HandleAvailability,
} from './settings/handleField';
import { TextArea, TextInput } from './ui/text-input';
import { checkGroupHandle, type Contact } from '@/lib/api';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router';

const checkHandle = (
  visibility: 'private' | 'public',
  handle: string,
): Effect.Effect<HandleAvailability> =>
  visibility === 'public'
    ? checkHandleAvailability(handle, checkGroupHandle)
    : Effect.succeed(IDLE_AVAILABILITY);

class NameMissing extends Data.TaggedError('NameMissing') {}
class HandleMissing extends Data.TaggedError('HandleMissing') {}
class HandleRefused extends Data.TaggedError('HandleRefused')<{
  readonly reason: string | undefined;
}> {}

type CreateFailure = NameMissing | HandleMissing | HandleRefused | ApiFailure;

function NewGroupMembers({
  contacts,
  selected,
  onToggle,
}: {
  contacts: Contact[];
  selected: string[];
  onToggle: (userId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
      return contacts;
    }
    return contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(needle) ||
        (contact.handle ?? '').toLowerCase().includes(needle),
    );
  }, [contacts, query]);

  return (
    <div className="mt-3">
      {contacts.length > 0 && (
        <div className="mb-2">
          <SearchField
            autoFocus
            value={query}
            placeholder="Search contacts"
            aria-label="Search contacts"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-muted-foreground">
          {contacts.length === 0 ? 'Invite a friend first to start a group.' : 'No contacts match'}
        </p>
      ) : (
        filtered.map((contact) => (
          <label
            key={contact.userId}
            className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-list-hover"
          >
            <Checkbox
              checked={selected.includes(contact.userId)}
              onCheckedChange={() => onToggle(contact.userId)}
            />
            <EntityAvatar person={contact} size={28} />
            <span className="truncate text-[15px]">
              {contact.name} <HandleSuffix handle={contact.handle} />
            </span>
          </label>
        ))
      )}
    </div>
  );
}

export function NewGroupDialog({
  onClose,
  channel = false,
}: {
  onClose: () => void;
  channel?: boolean;
}) {
  const storeApi = useChatStoreApi();
  const contacts = useChatSelector((s) => s.contacts);
  const navigate = useNavigate();
  const [step, setStep] = useState<'members' | 'title'>('members');
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  // The short blurb is at most 300 characters, stored in `groups.description`.
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [handle, setHandle] = useState('');
  const trimmedHandle = handle.trim();
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Moving to the Name step unmounts the Members keys, so focus the Name field here.
  useEffect(() => {
    if (step === 'title') {
      nameInputRef.current?.focus();
    }
  }, [step]);

  const [checkResult] = useQuery(
    () => checkHandle(visibility, trimmedHandle),
    [visibility, trimmedHandle],
  );
  const check: HandleAvailability = AsyncResult.isSuccess(checkResult)
    ? checkResult.value
    : IDLE_AVAILABILITY;

  const toggle = (userId: string): void => {
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const [createState, runCreate, createControls] = useAction<void, void, CreateFailure>(
    (): Effect.Effect<void, CreateFailure> => {
      const trimmed = title.trim();
      if (trimmed.length === 0) {
        return Effect.fail(new NameMissing());
      }
      const cleanDescription = description.trim();
      if (visibility === 'public') {
        if (trimmedHandle === '') {
          return Effect.fail(new HandleMissing());
        }
        if (check.state === 'done' && !check.available) {
          return Effect.fail(new HandleRefused({ reason: check.reason }));
        }
      }
      return fromApi(() =>
        channel
          ? storeApi
              .getState()
              .createChannel(
                trimmed,
                selected,
                description,
                visibility === 'public'
                  ? { visibility: 'public' as const, handle: trimmedHandle }
                  : undefined,
              )
          : storeApi.getState().createGroup(trimmed, selected, {
              ...(channel ? { kind: 'channel' as const } : {}),
              ...(cleanDescription === '' ? {} : { description: cleanDescription }),
              ...(visibility === 'public'
                ? { visibility: 'public' as const, handle: trimmedHandle }
                : {}),
            }),
      ).pipe(
        Effect.map((chatJid) => {
          onClose();
          navigate(`/c/${encodeURIComponent(chatJid)}`);
        }),
      );
    },
  );
  const createFailure = isWaiting(createState) ? undefined : failureOf(createState);

  const dialogLabel = channel ? 'New channel' : 'New group';
  const nameLabel = channel ? 'Channel name' : 'Group name';

  return (
    <Dialog
      open
      onClose={onClose}
      title={step === 'members' ? 'Add members' : channel ? 'Channel name' : 'Group name'}
      ariaLabel={dialogLabel}
      size="sm"
      busy={isWaiting(createState)}
      error={createFailure === undefined ? undefined : createErrorText(createFailure, channel)}
      stepper={
        <DialogStepper
          steps={[
            {
              label: 'Members',
              value: `${selected.length} ${selected.length === 1 ? 'member' : 'members'}`,
            },
            { label: 'Name' },
          ]}
          current={step === 'members' ? 0 : 1}
          onStep={() => setStep('members')}
        />
      }
      onSubmit={(event) => {
        event.preventDefault();
        if (step === 'members') {
          setStep('title');
          return;
        }
        if (isWaiting(createState)) {
          return;
        }
        runCreate();
      }}
      footer={
        step === 'members' ? (
          <Button type="submit" size="lg">
            Next
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" size="lg" onClick={() => setStep('members')}>
              Back
            </Button>
            <Button type="submit" size="lg" disabled={isWaiting(createState)}>
              Create
            </Button>
          </>
        )
      }
    >
      {step === 'members' ? (
        <NewGroupMembers contacts={contacts} selected={selected} onToggle={toggle} />
      ) : (
        <>
          <div className="mt-3">
            <TextInput
              ref={nameInputRef}
              data-autofocus
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={nameLabel}
              aria-label={nameLabel}
            />
          </div>
          {channel && (
            <div className="mt-2">
              <TextArea
                value={description}
                maxLength={300}
                rows={2}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Description (optional)"
                aria-label="Channel description"
                className="min-h-0 resize-none"
              />
            </div>
          )}
          <fieldset className="mt-3">
            <legend className="text-[14px] font-medium">Visibility</legend>
            <div className="mt-1">
              <SegmentedControl
                mode="radio"
                ariaLabel="Visibility"
                options={[
                  { value: 'private', label: 'Private' },
                  { value: 'public', label: 'Public' },
                ]}
                value={visibility}
                onChange={(next) => {
                  if (next !== 'private' && next !== 'public') {
                    return;
                  }
                  setVisibility(next);
                  if (!isWaiting(createState)) {
                    createControls.reset();
                  }
                }}
              />
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {visibility === 'public'
                ? channel
                  ? 'Anyone can find and join this channel.'
                  : 'Anyone can find and join this group.'
                : channel
                  ? 'Only invited people can join this channel.'
                  : 'Only invited people can join this group.'}
            </p>
          </fieldset>
          {visibility === 'public' && (
            <>
              <div className="mt-3">
                <TextInput
                  id="new-group-handle"
                  label="Handle"
                  value={handle}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={32}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="hiking_club"
                  aria-label="Group handle"
                />
              </div>
              <div aria-live="polite" className="mt-1 min-h-[20px] text-[14px]">
                {check.state === 'done' &&
                  (check.available ? (
                    <span className="text-muted-foreground">@{trimmedHandle} is available</span>
                  ) : (
                    <span className="text-danger">{handleReasonText(check.reason, 'handle')}</span>
                  ))}
              </div>
              {!channel && (
                <div className="mt-2">
                  <TextArea
                    value={description}
                    maxLength={300}
                    rows={2}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Description (optional, one line)"
                    aria-label="Group description"
                    className="min-h-0 resize-none"
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

function createErrorText(failure: CreateFailure, channel: boolean): string {
  switch (failure._tag) {
    case 'NameMissing':
      return channel ? 'Enter a channel name' : 'Enter a group name';
    case 'HandleMissing':
      return 'Choose a handle for the public group.';
    case 'HandleRefused':
      return handleReasonText(failure.reason, 'handle');
    case 'ApiFailure':
      return friendlyCreateError(failure, channel);
  }
}

function friendlyCreateError(error: ApiFailure, channel: boolean): string {
  if (error.status === 0) {
    return channel
      ? 'Could not create the channel. Try again.'
      : 'Could not create the group. Try again.';
  }
  switch (error.code) {
    case 'handle_invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'handle_reserved':
      return 'That handle is reserved. Try another.';
    case 'handle_taken':
      return 'That handle was just taken. Try another.';
    case 'rate_limited':
      return 'Too many tries — wait a little and try again.';
    default:
      return error.message;
  }
}
