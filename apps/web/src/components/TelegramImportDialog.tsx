import { useState } from 'react';
import { ApiError, importTelegramStickers, type TelegramImportResult } from '@/lib/api';

type DialogStatus = 'idle' | 'busy' | 'done';

/**
 * The Telegram import dialog (T-0123): paste a pack link or name, run the
 * import, and read the summary. Imported packs are personal-use only — the
 * dialog says so next to the form, and the summary repeats the attribution
 * ("Imported from Telegram: <pack title>").
 */
export function TelegramImportDialog({
  onDone,
  onClose,
  onUnavailable,
  importFn = importTelegramStickers,
}: {
  onDone: () => void;
  onClose: () => void;
  /** Called when the server answers 501, so the caller can hide the entry. */
  onUnavailable?: () => void;
  /** Injected in tests so no network is touched. */
  importFn?: typeof importTelegramStickers;
}) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<DialogStatus>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<TelegramImportResult | undefined>(undefined);

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
        onClose();
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

  if (status === 'done' && result !== undefined) {
    return (
      <div
        role="dialog"
        aria-label="Telegram import result"
        className="mx-auto flex w-full max-w-md flex-col gap-3"
      >
        <h2 className="text-[16px] font-semibold">Imported from Telegram: {result.pack.title}</h2>
        <p className="text-[14px]">
          {result.imported} sticker{result.imported === 1 ? '' : 's'} added
          {result.skippedAnimated > 0 &&
            `, ${result.skippedAnimated} animated sticker${result.skippedAnimated === 1 ? ' was' : 's were'} skipped`}
          {result.skippedInvalid > 0 &&
            `, ${result.skippedInvalid} file${result.skippedInvalid === 1 ? ' was' : 's were'} skipped as invalid`}
          .
        </p>
        {result.partial === true && (
          <p className="text-[14px] text-muted-foreground">
            The import ran out of time — run it again to fill in the rest.
          </p>
        )}
        <p className="text-[13px] text-muted-foreground">
          Imported packs are for personal use: this pack stays private and its art belongs to its
          creators.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              onDone();
              onClose();
            }}
            className="rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-accent-foreground hover:bg-accent/90"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Import from Telegram"
      className="mx-auto flex w-full max-w-md flex-col gap-3"
    >
      <h2 className="text-[16px] font-semibold">Import from Telegram</h2>
      <p className="text-[13px] text-muted-foreground">
        Paste a pack link (<code>t.me/addstickers/…</code>) or the bare pack name. Only static
        stickers import — animated and video ones are skipped. Imported packs are for personal use:
        they stay private and cannot be shared server-wide.
      </p>
      <label className="flex flex-col gap-1 text-[14px]">
        Pack link or name
        <input
          value={input}
          aria-label="Pack link or name"
          placeholder="t.me/addstickers/FunCats"
          maxLength={512}
          disabled={status === 'busy'}
          onChange={(event) => setInput(event.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
        />
      </label>
      {error !== '' && (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={status === 'busy'}
          className="rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
        >
          {status === 'busy' ? 'Importing…' : 'Import'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={status === 'busy'}
          className="rounded-full px-4 py-2 text-[14px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
