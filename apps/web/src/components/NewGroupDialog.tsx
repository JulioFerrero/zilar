import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, checkGroupHandle } from '@/lib/api';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { Avatar } from './Avatar';
import { HandleSuffix } from './HandleSuffix';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog } from './ui/dialog';
import { SegmentedControl } from './ui/segmented-control';
import { TextArea, TextInput } from './ui/text-input';

/** Two-step dialog: pick contacts, set a title, then create the group. */
export function NewGroupDialog({
  onClose,
  channel = false,
}: {
  onClose: () => void;
  channel?: boolean;
}) {
  const storeApi = useChatStoreApi();
  const { contacts } = useChatStore();
  const navigate = useNavigate();
  const [step, setStep] = useState<'members' | 'title'>('members');
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  // T-0124: the channel's short blurb (≤ 300), stored in groups.description.
  // T-0164: groups get the same one-line description when public.
  const [description, setDescription] = useState('');
  // T-0164: Private (default, invite-only like before) or Public (its own
  // `@handle`, in the directory, joinable with one tap).
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [handle, setHandle] = useState('');
  const [check, setCheck] = useState<
    { state: 'idle' } | { state: 'done'; available: boolean; reason?: string | undefined }
  >({ state: 'idle' });
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const trimmedHandle = handle.trim();

  // Debounced live availability for the public handle. The effect only
  // schedules the check; the timeout callback applies the result once.
  useEffect(() => {
    if (visibility !== 'public' || trimmedHandle === '') {
      return;
    }
    let active = true;
    const value = trimmedHandle;
    const pending = setTimeout(() => {
      void checkGroupHandle(value).then(
        (result) => {
          if (active) {
            setCheck({ state: 'done', available: result.available, reason: result.reason });
          }
        },
        (checkError: unknown) => {
          if (!active) {
            return;
          }
          if (checkError instanceof ApiError && checkError.code === 'rate_limited') {
            setCheck({ state: 'done', available: false, reason: 'rate_limited' });
            return;
          }
          setCheck({ state: 'idle' });
        },
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [visibility, trimmedHandle]);

  const toggle = (userId: string): void => {
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const create = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError(channel ? 'Enter a channel name' : 'Enter a group name');
      return;
    }
    const cleanDescription = description.trim();
    if (visibility === 'public') {
      if (trimmedHandle === '') {
        setError('Choose a handle for the public group.');
        return;
      }
      if (check.state === 'done' && !check.available) {
        setError(handleReasonText(check.reason));
        return;
      }
    }
    setBusy(true);
    setError(undefined);
    try {
      const chatJid = channel
        ? await storeApi
            .getState()
            .createChannel(
              trimmed,
              selected,
              description,
              visibility === 'public'
                ? { visibility: 'public' as const, handle: trimmedHandle }
                : undefined,
            )
        : await storeApi.getState().createGroup(trimmed, selected, {
            ...(channel ? { kind: 'channel' as const } : {}),
            ...(cleanDescription === '' ? {} : { description: cleanDescription }),
            ...(visibility === 'public'
              ? { visibility: 'public' as const, handle: trimmedHandle }
              : {}),
          });
      onClose();
      navigate(`/c/${encodeURIComponent(chatJid)}`);
    } catch (requestError) {
      setBusy(false);
      setError(friendlyCreateError(requestError, channel));
    }
  };

  const dialogLabel = channel ? 'New channel' : 'New group';
  const nameLabel = channel ? 'Channel name' : 'Group name';

  return (
    <Dialog
      open
      onClose={onClose}
      title={step === 'members' ? 'Add members' : channel ? 'Channel name' : 'Group name'}
      ariaLabel={dialogLabel}
      size="sm"
      actions={
        step === 'members' ? (
          <>
            <Button type="button" variant="ghost" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="lg"
              disabled={selected.length === 0}
              onClick={() => setStep('title')}
            >
              Next
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" size="lg" onClick={() => setStep('members')}>
              Back
            </Button>
            <Button type="button" size="lg" disabled={busy} onClick={() => void create()}>
              Create
            </Button>
          </>
        )
      }
    >
      {step === 'members' ? (
        <div className="mt-3">
          {contacts.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-muted-foreground">
              Invite a friend first to start a group.
            </p>
          ) : (
            contacts.map((contact) => (
              <label
                key={contact.userId}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-list-hover"
              >
                <Checkbox
                  checked={selected.includes(contact.userId)}
                  onCheckedChange={() => toggle(contact.userId)}
                />
                <Avatar
                  id={contact.userId}
                  name={contact.name}
                  size={28}
                  avatarUrl={contact.avatarUrl}
                />
                <span className="truncate text-[15px]">
                  {contact.name} <HandleSuffix handle={contact.handle} />
                </span>
              </label>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="mt-3">
            <TextInput
              autoFocus
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
          {/* T-0164: Private (default, invite-only) or Public (its own
                `@handle`, in the directory, joinable with one tap). Public
                asks for a handle with the live availability check and a
                one-line description. */}
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
                  setCheck({ state: 'idle' });
                  setError(undefined);
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
                  onChange={(event) => {
                    setHandle(event.target.value);
                    setCheck({ state: 'idle' });
                  }}
                  placeholder="hiking_club"
                  aria-label="Group handle"
                />
              </div>
              <div aria-live="polite" className="mt-1 min-h-[20px] text-[14px]">
                {check.state === 'done' &&
                  (check.available ? (
                    <span className="text-muted-foreground">@{trimmedHandle} is available</span>
                  ) : (
                    <span className="text-danger">{handleReasonText(check.reason)}</span>
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
          {error !== undefined && (
            <p role="alert" className="mt-2 text-[14px] text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}

function handleReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'reserved':
      return 'That handle is reserved. Try another.';
    case 'rate_limited':
      return 'Too many checks — wait a little and try again.';
    default:
      return 'That handle is taken. Try another.';
  }
}

function friendlyCreateError(error: unknown, channel: boolean): string {
  if (error instanceof ApiError) {
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
  return channel
    ? 'Could not create the channel. Try again.'
    : 'Could not create the group. Try again.';
}
