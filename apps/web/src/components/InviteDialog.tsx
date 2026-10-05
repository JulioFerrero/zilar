import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { copyText } from '@/lib/clipboard';
import { Dialog } from './ui/dialog';

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

  const copy = (): void => {
    if (url === undefined) {
      return;
    }
    void copyText(url).then(() => setCopied(true));
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite a friend"
      description="Send them this link. They join Zilar already connected to you."
      size="sm"
      actions={
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
        >
          Close
        </button>
      }
    >
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
    </Dialog>
  );
}
