import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';
import { cn } from '@/lib/utils';

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
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // Esc closes the dialog from any focus position, same as Cancel or the overlay.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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
    setBusy(true);
    setError(undefined);
    try {
      const chatJid = channel
        ? await storeApi.getState().createChannel(trimmed, selected, description)
        : await storeApi.getState().createGroup(trimmed, selected);
      onClose();
      navigate(`/c/${encodeURIComponent(chatJid)}`);
    } catch {
      setBusy(false);
      setError(
        channel
          ? 'Could not create the channel. Try again.'
          : 'Could not create the group. Try again.',
      );
    }
  };

  const dialogLabel = channel ? 'New channel' : 'New group';
  const nameLabel = channel ? 'Channel name' : 'Group name';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl bg-background p-5 shadow-xl"
      >
        <h2 className="text-[18px] font-semibold">
          {step === 'members' ? 'Add members' : channel ? 'Channel name' : 'Group name'}
        </h2>

        {step === 'members' ? (
          <>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
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
                    <input
                      type="checkbox"
                      checked={selected.includes(contact.userId)}
                      onChange={() => toggle(contact.userId)}
                      className="size-4 accent-[var(--accent)]"
                    />
                    <span className="truncate text-[15px]">{contact.name}</span>
                  </label>
                ))
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-1.5 text-[15px] text-muted-foreground hover:bg-list-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selected.length === 0}
                onClick={() => setStep('title')}
                className="rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <input
              autoFocus
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={nameLabel}
              aria-label={nameLabel}
              className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
            />
            {channel && (
              <textarea
                value={description}
                maxLength={300}
                rows={2}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Description (optional)"
                aria-label="Channel description"
                className="mt-2 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
              />
            )}
            {error !== undefined && (
              <p role="alert" className="mt-2 text-[14px] text-danger">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStep('members')}
                className="rounded-full px-4 py-1.5 text-[15px] text-muted-foreground hover:bg-list-hover"
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void create()}
                className={cn(
                  'rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-foreground',
                  'hover:bg-accent/90 disabled:opacity-60',
                )}
              >
                Create
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
