import { useEffect, useRef, useState } from 'react';
import { ApiError, importTelegramStickers, type TelegramImportResult } from '@/lib/api';

type DialogStatus = 'idle' | 'busy' | 'done';

/**
 * The Telegram import dialog (T-0123, overlay + unavailable state T-0162):
 * paste a pack link or name, run the import, and read the summary.
 * Imported packs are personal-use only — the dialog says so next to the
 * form, and the summary repeats the attribution
 * ("Imported from Telegram: <pack title>").
 *
 * The dialog is an overlay like `InviteDialog`: a `fixed inset-0` backdrop
 * with a centered panel, `role="dialog"` + `aria-modal`, a close button,
 * close on Escape and on backdrop click (not while busy), and focus moved
 * into the dialog on open. A 501 never closes it: it shows the not-set-up
 * state instead (with a settings link for the server owner).
 */
export function TelegramImportDialog({
  onDone,
  onClose,
  onUnavailable,
  isOwner = false,
  importFn = importTelegramStickers,
}: {
  onDone: () => void;
  onClose: () => void;
  /**
   * Called when the server answers 501, so the entry point's primary action
   * can be disabled. The entry stays visible and the dialog shows why.
   */
  onUnavailable?: () => void;
  /** The server owner gets a link to the integrations settings page. */
  isOwner?: boolean;
  /** Injected in tests so no network is touched. */
  importFn?: typeof importTelegramStickers;
}) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<DialogStatus>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<TelegramImportResult | undefined>(undefined);
  const [unavailable, setUnavailable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = status === 'busy';

  // Focus into the dialog on open, like the other overlay dialogs.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc closes the dialog from any focus position — but never while busy.
  useEffect(() => {
    if (busy || unavailable) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, unavailable, onClose]);

  // Esc also closes the unavailable state (it has no in-flight request).
  useEffect(() => {
    if (!unavailable) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [unavailable, onClose]);

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

  const overlay = (label: string, panel: React.ReactNode) => (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-xl"
      >
        {panel}
      </div>
    </div>
  );

  if (unavailable) {
    return overlay(
      'Telegram import not set up',
      <>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[18px] font-semibold">Telegram import is not set up</h2>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Telegram import is not set up on this server.
        </p>
        {isOwner ? (
          <p className="mt-3 text-[14px]">
            <a href="/settings/integrations" className="text-accent underline hover:no-underline">
              Open the integrations settings to add a bot token.
            </a>
          </p>
        ) : (
          <p className="mt-3 text-[14px] text-muted-foreground">
            Ask the person who runs this server to set it up.
          </p>
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
      </>,
    );
  }

  if (status === 'done' && result !== undefined) {
    return overlay(
      'Telegram import result',
      <>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[18px] font-semibold">Imported from Telegram: {result.pack.title}</h2>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-[14px]">
          {result.imported} sticker{result.imported === 1 ? '' : 's'} added
          {result.skippedAnimated > 0 &&
            `, ${result.skippedAnimated} animated sticker${result.skippedAnimated === 1 ? ' was' : 's were'} skipped`}
          {result.skippedInvalid > 0 &&
            `, ${result.skippedInvalid} file${result.skippedInvalid === 1 ? ' was' : 's were'} skipped as invalid`}
          .
        </p>
        {result.partial === true && (
          <p className="mt-1 text-[14px] text-muted-foreground">
            The import ran out of time — run it again to fill in the rest.
          </p>
        )}
        <p className="mt-1 text-[13px] text-muted-foreground">
          Imported packs are for personal use: this pack stays private and its art belongs to its
          creators.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => {
              onDone();
              onClose();
            }}
            className="rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
          >
            Done
          </button>
        </div>
      </>,
    );
  }

  return overlay(
    'Import from Telegram',
    <>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[18px] font-semibold">Import from Telegram</h2>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
          disabled={busy}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted disabled:opacity-60"
        >
          ✕
        </button>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Paste a pack link (<code>t.me/addstickers/…</code>) or the bare pack name. Only static
        stickers import — animated and video ones are skipped. Imported packs are for personal use:
        they stay private and cannot be shared server-wide.
      </p>
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
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-full px-4 py-1.5 text-[15px] text-muted-foreground hover:bg-list-hover disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </>,
  );
}
