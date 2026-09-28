import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { copyText } from '@/lib/clipboard';

/** Creates an invite link and lets the user copy it. */
export function InviteDialog({ onClose }: { onClose: () => void }) {
  const storeApi = useChatStoreApi();
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    storeApi
      .getState()
      .createInvite()
      .then((value) => {
        if (active) {
          setUrl(value);
        }
      })
      .catch(() => {
        if (active) {
          setError('Could not create an invite link. Try again.');
        }
      });
    return () => {
      active = false;
    };
  }, [storeApi]);

  // Esc closes the dialog from any focus position, same as Close or the overlay.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const copy = (): void => {
    if (url === undefined) {
      return;
    }
    void copyText(url).then(() => setCopied(true));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite a friend"
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-xl"
      >
        <h2 className="text-[18px] font-semibold">Invite a friend</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Send them this link. They join Galena already connected to you.
        </p>

        {error !== undefined ? (
          <p role="alert" className="mt-4 text-[14px] text-danger">
            {error}
          </p>
        ) : (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-divider bg-muted px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px]">{url ?? 'Creating link…'}</span>
            <button
              type="button"
              aria-label="Copy invite link"
              disabled={url === undefined}
              onClick={copy}
              className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[13px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
            >
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
