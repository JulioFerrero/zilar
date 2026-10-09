import { Check, Copy } from 'lucide-react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { copyText } from '@/lib/clipboard';
import { fromApi } from '@/lib/effect/api-effect';
import { failureOf, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

/** Creates an invite link and lets the user copy it. */
export function InviteDialog({ onClose }: { onClose: () => void }) {
  const storeApi = useChatStoreApi();
  const [created] = useQuery(() => fromApi(() => storeApi.getState().createInvite()), [storeApi]);
  const url = AsyncResult.isSuccess(created) ? created.value : undefined;
  const failed = failureOf(created) !== undefined;

  // A copy that the clipboard refuses leaves the button on "Copy", as before.
  const [copyState, copyUrl] = useAction<string, void, unknown>((value) =>
    Effect.tryPromise({ try: () => copyText(value), catch: (cause) => cause }),
  );
  const copied = AsyncResult.isSuccess(copyState);

  const copy = (): void => {
    if (url === undefined) {
      return;
    }
    copyUrl(url);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite a friend"
      description="Send them this link. They join Zilar already connected to you."
      size="sm"
      actions={
        <Button type="button" size="lg" onClick={onClose}>
          Close
        </Button>
      }
    >
      {failed ? (
        <p role="alert" className="mt-4 text-[14px] text-danger">
          Could not create an invite link. Try again.
        </p>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-divider bg-muted px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px]">{url ?? 'Creating link…'}</span>
          <Button
            type="button"
            size="sm"
            aria-label="Copy invite link"
            disabled={url === undefined}
            onClick={copy}
            className="shrink-0"
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
