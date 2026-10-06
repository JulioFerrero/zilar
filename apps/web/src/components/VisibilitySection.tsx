import { useEffect, useState } from 'react';
import { ApiError, checkGroupHandle } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { FieldError } from './ais/AiPageShell';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextInput } from './ui/text-input';

/**
 * Visibility settings (T-0164, owner only): flip a group or channel private
 * (invite-only, like before) or public (its own `@handle`, in the Explore
 * directory, joinable with one tap). Public asks for a handle with the live
 * availability check; going private explains that the group disappears from
 * the directory at once while members stay. The handle shows the "next
 * change possible on" message when the 14-day interval refuses, and a copy
 * button for the share link `<origin>/@handle`.
 */
export function VisibilitySection({
  chatId,
  groupId,
  visibility,
  handle,
  title,
}: {
  chatId: string;
  groupId: string;
  visibility: 'private' | 'public';
  handle: string | null;
  title: string;
}) {
  const storeApi = useChatStoreApi();
  const [picked, setPicked] = useState<'private' | 'public'>(visibility);
  const [typed, setTyped] = useState(handle ?? '');
  const [check, setCheck] = useState<
    { state: 'idle' } | { state: 'done'; available: boolean; reason?: string | undefined }
  >({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingPrivate, setConfirmingPrivate] = useState(false);

  // Fill from server truth until the owner starts typing, so a change made
  // elsewhere (or the first load) paints without clobbering typed text.
  const [seeded, setSeeded] = useState(false);
  if (!seeded) {
    setSeeded(true);
    setPicked(visibility);
    setTyped(handle ?? '');
  }

  const trimmed = typed.trim();
  const unchanged = picked === visibility && (picked === 'private' || trimmed === (handle ?? ''));
  // The live check skips the group's own handle in any casing: the server
  // sees its live row and would report "taken", which is misleading next
  // to a Save the interval rule still guards.
  const ownHandle =
    handle !== null && handle !== '' && trimmed.toLowerCase() === handle.toLowerCase();

  // Debounced live availability for a changed handle.
  useEffect(() => {
    if (picked !== 'public' || trimmed === '' || ownHandle) {
      return;
    }
    let active = true;
    const value = trimmed;
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
  }, [picked, trimmed, ownHandle]);

  const save = async (): Promise<void> => {
    if (picked === 'public' && trimmed === '') {
      setError('Choose a handle for the public group.');
      return;
    }
    if (picked === 'private' && visibility === 'public' && !confirmingPrivate) {
      setConfirmingPrivate(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await storeApi.getState().setGroupVisibility(chatId, {
        visibility: picked,
        ...(picked === 'public' ? { handle: trimmed } : {}),
      });
      setSaved(true);
      setConfirmingPrivate(false);
    } catch (saveError) {
      setError(friendlyError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const shareUrl =
    typeof window === 'undefined' || handle === null
      ? null
      : `${window.location.origin}/@${encodeURIComponent(handle)}`;

  return (
    <section aria-label="Visibility" className="flex flex-col gap-2 px-2">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Visibility</h2>
      <div className="flex flex-col gap-2 rounded-xl px-2 py-1.5">
        <SegmentedControl
          mode="radio"
          ariaLabel="Visibility"
          options={[
            { value: 'private', label: 'Private' },
            { value: 'public', label: 'Public' },
          ]}
          value={picked}
          onChange={(next) => {
            if (next !== 'private' && next !== 'public') {
              return;
            }
            setPicked(next);
            setCheck({ state: 'idle' });
            setError(undefined);
            setSaved(false);
            setConfirmingPrivate(false);
          }}
        />
        {picked === 'public' ? (
          <>
            <p className="text-[13px] text-muted-foreground">
              Anyone can find and join {title === '' ? 'this group' : `“${title}”`}.
            </p>
            <TextInput
              id={`visibility-handle-${groupId}`}
              label="Handle"
              value={typed}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              onChange={(event) => {
                setTyped(event.target.value);
                setCheck({ state: 'idle' });
                setSaved(false);
              }}
              placeholder="hiking_club"
            />
            <div aria-live="polite" className="min-h-[20px] text-[14px]">
              {check.state === 'done' &&
                (check.available ? (
                  <span className="text-muted-foreground">@{trimmed} is available</span>
                ) : (
                  <span className="text-danger">{reasonText(check.reason)}</span>
                ))}
            </div>
          </>
        ) : (
          visibility === 'public' && (
            <p className="text-[13px] text-muted-foreground">
              Going private removes the group from Explore at once. Members stay members, and the
              old handle stays reserved for this group for 30 days.
            </p>
          )
        )}
        {error !== undefined && <FieldError>{error}</FieldError>}
        {saved && <p className="text-[14px] text-muted-foreground">Saved.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void save()} disabled={busy || unchanged}>
            {busy ? 'Saving…' : confirmingPrivate ? 'Confirm going private' : 'Save visibility'}
          </Button>
          {confirmingPrivate && (
            <Button type="button" variant="outline" onClick={() => setConfirmingPrivate(false)}>
              Cancel
            </Button>
          )}
          {shareUrl !== null && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void copyText(shareUrl).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy share link'}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function reasonText(reason: string | undefined): string {
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

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'handle_invalid':
        return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
      case 'handle_reserved':
        return 'That handle is reserved. Try another.';
      case 'handle_taken':
        return 'That handle was just taken. Try another.';
      case 'handle_change_too_soon': {
        const next = error.detail.nextChangeAt;
        if (typeof next === 'string' && next !== '') {
          const date = new Date(next);
          if (!Number.isNaN(date.getTime())) {
            return `Next change possible on ${date.toLocaleDateString()}`;
          }
        }
        return error.message;
      }
      case 'rate_limited':
        return 'Too many tries — wait a little and try again.';
      default:
        return error.message;
    }
  }
  return 'Could not save the visibility. Try again.';
}
