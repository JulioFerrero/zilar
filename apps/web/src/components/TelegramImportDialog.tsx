import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Link } from 'react-router';
import { ApiError, importTelegramStickers, type TelegramImportResult } from '@/lib/api';
import { useIsServerOwner } from '@/lib/useIsServerOwner';
import { Button } from '@/components/ui/button';
import { Dialog } from './ui/dialog';

type DialogStatus = 'idle' | 'busy' | 'done';

/**
 * The Telegram import dialog (T-0123, overlay + unavailable state T-0162):
 * paste a pack link or name, run the import, and read the summary.
 * Imported packs are personal-use only — the dialog says so next to the
 * form, and the summary repeats the attribution
 * ("Imported from Telegram: <pack title>").
 *
 * It renders through the kit `Dialog`: Escape and the backdrop close it
 * (not while busy), focus moves to the input on open, and a 501 never
 * closes it — it shows the not-set-up state instead (with a settings link
 * for the server owner).
 */
export function TelegramImportDialog({
  onDone,
  onClose,
  onUnavailable,
  isOwner,
  importFn = importTelegramStickers,
}: {
  onDone: () => void;
  onClose: () => void;
  /**
   * Called when the server answers 501, so the entry point's primary action
   * can be disabled. The entry stays visible and the dialog shows why.
   */
  onUnavailable?: () => void;
  /**
   * Forces the owner view (tests only). When omitted the dialog reads the
   * shared `useIsServerOwner` hook, which starts as not-owner and switches
   * on after the 200 — the settings link never flashes for a non-owner.
   */
  isOwner?: boolean | undefined;
  /** Injected in tests so no network is touched. */
  importFn?: typeof importTelegramStickers;
}) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<DialogStatus>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<TelegramImportResult | undefined>(undefined);
  const [unavailable, setUnavailable] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = status === 'busy';
  // The owner view: the prop wins when given (tests), else the shared hook.
  // The hook call is unconditional (rules of hooks); the prop only decides
  // which value is used.
  const hookOwner = useIsServerOwner();
  const ownerView = isOwner ?? hookOwner;

  const run = async (): Promise<void> => {
    if (input.trim() === '') {
      setError('Paste a pack link or name first.');
      return;
    }
    setStatus('busy');
    setError('');
    try {
      const outcome = await importFn(input);
      setResult(outcome);
      setStatus('done');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 501) {
        onUnavailable?.();
        setUnavailable(true);
        setStatus('idle');
        return;
      } else if (cause instanceof ApiError && cause.code === 'token_invalid') {
        // The saved token died at Telegram's side (revoked/replaced after
        // it was stored). Not a form error: the whole dialog becomes the
        // message, with the settings link for the owner.
        setTokenInvalid(true);
        setStatus('idle');
        return;
      } else if (cause instanceof ApiError && cause.status === 429) {
        setError('Too many imports — try again in an hour.');
      } else if (cause instanceof ApiError && cause.code === 'pack_not_found') {
        setError('That Telegram sticker pack was not found.');
      } else if (cause instanceof ApiError && cause.code === 'custom_emoji_unsupported') {
        setError('Custom emoji sets cannot be imported as sticker packs.');
      } else if (cause instanceof ApiError && cause.code === 'try_later') {
        setError('Telegram is busy — try again later.');
      } else {
        setError(cause instanceof Error ? cause.message : 'The import failed.');
      }
      setStatus('idle');
    }
  };

  // The old panel header's close icon, now the first thing in the body. Escape and
  // the backdrop are the kit `Dialog`'s job; this button is disabled while
  // busy, and `dismissable={false}` blocks the other two exits then.
  const closeButton = (
    <button
      type="button"
      aria-label="Close"
      title="Close"
      onClick={onClose}
      disabled={busy}
      className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted disabled:opacity-60"
    >
      <X className="size-4" aria-hidden="true" />
    </button>
  );

  if (unavailable) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Telegram import is not set up"
        ariaLabel="Telegram import not set up"
        size="sm"
        actions={
          <Button type="button" onClick={onClose} size="lg">
            Close
          </Button>
        }
      >
        <div className="mt-2 flex items-start justify-between gap-2">
          <p className="text-[14px] text-muted-foreground">
            Telegram import is not set up on this server.
          </p>
          {closeButton}
        </div>
        {ownerView ? (
          <p className="mt-3 text-[14px]">
            <Link to="/settings/integrations" className="text-accent underline hover:no-underline">
              Open the integrations settings to add a bot token.
            </Link>
          </p>
        ) : (
          <p className="mt-3 text-[14px] text-muted-foreground">
            Ask the person who runs this server to set it up.
          </p>
        )}
      </Dialog>
    );
  }

  if (tokenInvalid) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="The Telegram token was rejected"
        ariaLabel="Telegram token rejected"
        size="sm"
        actions={
          <Button type="button" onClick={onClose} size="lg">
            Close
          </Button>
        }
      >
        <div className="mt-2 flex items-start justify-between gap-2">
          {ownerView ? (
            <p className="text-[14px]">
              The Telegram token was rejected. The server owner needs to update it —{' '}
              <Link
                to="/settings/integrations"
                className="text-accent underline hover:no-underline"
              >
                open the integrations settings.
              </Link>
            </p>
          ) : (
            <p className="text-[14px] text-muted-foreground">
              The Telegram token was rejected. The server owner needs to update it.
            </p>
          )}
          {closeButton}
        </div>
      </Dialog>
    );
  }

  if (status === 'done' && result !== undefined) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={`Imported from Telegram: ${result.pack.title}`}
        ariaLabel="Telegram import result"
        size="sm"
        actions={
          <Button
            type="button"
            onClick={() => {
              onDone();
              onClose();
            }}
            size="lg"
          >
            Done
          </Button>
        }
      >
        <div className="mt-2 flex items-start justify-between gap-2">
          <p className="text-[14px]">
            {result.imported} sticker{result.imported === 1 ? '' : 's'} added
            {result.skippedAnimated > 0 &&
              `, ${result.skippedAnimated} animated sticker${result.skippedAnimated === 1 ? ' was' : 's were'} skipped`}
            {result.skippedInvalid > 0 &&
              `, ${result.skippedInvalid} file${result.skippedInvalid === 1 ? ' was' : 's were'} skipped as invalid`}
            .
          </p>
          {closeButton}
        </div>
        {result.partial === true && (
          <p className="mt-1 text-[14px] text-muted-foreground">
            The import ran out of time — run it again to fill in the rest.
          </p>
        )}
        <p className="mt-1 text-[13px] text-muted-foreground">
          Imported packs are for personal use: this pack stays private and its art belongs to its
          creators.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Import from Telegram"
      size="sm"
      dismissable={!busy}
      initialFocusRef={inputRef}
      actions={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full px-4 py-1.5 text-[15px] text-muted-foreground hover:bg-list-hover disabled:opacity-60"
          >
            Cancel
          </button>
          <Button type="button" onClick={() => void run()} disabled={busy} size="lg">
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </>
      }
    >
      <div className="mt-2 flex items-start justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">
          Paste a pack link (<code>t.me/addstickers/…</code>) or the bare pack name. Only static
          stickers import — animated and video ones are skipped. Imported packs are for personal
          use: they stay private and cannot be shared server-wide.
        </p>
        {closeButton}
      </div>
      <label className="mt-3 flex flex-col gap-1 text-[14px]">
        Pack link or name
        <input
          ref={inputRef}
          value={input}
          aria-label="Pack link or name"
          placeholder="t.me/addstickers/FunCats"
          maxLength={512}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
        />
      </label>
      {error !== '' && (
        <p role="alert" className="mt-2 text-[14px] text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
